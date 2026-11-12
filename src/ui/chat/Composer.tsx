import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type Accessor, type JSX } from "solid-js";
import { openMenu, toast } from "../menu";
import { holdToOpen, markHeld } from "../hold";
import { quickTimes, schedule, scheduled, sendNow, unschedule } from "../schedule";
import { MOBILE_UI } from "../target";
import type { ChannelInfo, Msg, Person, Role } from "../../lib/backend/types";
import { searchEmoji } from "../../lib/emoji";
import { plain } from "../../lib/markdown";
import { Avatar, NameText } from "../Avatar";
import { getDraft, getFiles, setDraft, setFiles, type PendingFile } from "../drafts";
import { Icon } from "../icons";
import { backend, platform } from "../store";
import { inTauri } from "../../lib/platform";
import { createEditor, type ChipLookup, type EditorApi } from "./Editor";
import { completionToken } from "./complete";
import { FormatBar, formatKey } from "./FormatBar";
import { UEmoji } from "./UEmoji";
import { closeExpr, exprOpen, openEmojiPicker, openGifPicker } from "./overlays";
import { createPhone } from "../hooks";
import { Portal } from "solid-js/web";
import { dragToClose } from "../sheetDrag";
import { useBack } from "../back";
import { Switch } from "../controls";
import { formatTime } from "../../lib/markdown";

const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024; // Stoat's default attachment limit
const MAX_CHARS = 2000;

let pendingId = 0;

/** The message box on screen, so menus ("Mention") and replies can reach it. */
let active: EditorApi | undefined;
export const composer = {
  focus: () => active?.focus(),
  /** Inserts text at the caret, with a space before it if it would touch a word. */
  insert(t: string) {
    if (!active) return;
    const at = active.caret(), before = active.text().slice(0, at);
    active.insertAtCaret((before && !/\s$/.test(before) ? " " : "") + t);
    active.focus();
  },
};

/** A small thumbnail made off the main thread, so a 40-megapixel photo doesn't stall the window. */
async function thumbnail(f: File): Promise<string | undefined> {
  if (!/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(f.type)) return undefined;
  try {
    const bmp = await createImageBitmap(f, { resizeWidth: 240, resizeQuality: "low" } as ImageBitmapOptions);
    const cv = document.createElement("canvas");
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/jpeg", 0.8));
    return blob ? URL.createObjectURL(blob) : undefined;
  } catch { return undefined; }
}

type Item =
  | { kind: "emoji"; label: string; insert: string; char?: string; img?: string }
  | { kind: "user"; label: string; insert: string; person: Person }
  | { kind: "special"; label: string; insert: string; hint: string }
  | { kind: "role"; label: string; insert: string; colour?: string }
  | { kind: "channel"; label: string; insert: string; voice: boolean };


/**
 * Message box: Enter sends, Shift+Enter makes a new line, ↑ edits your last message.
 * Paste or drop files to attach. ":smi" suggests emoji, "@mi" people and roles, "#ge" channels.
 * Each channel keeps its own draft and attachments.
 */
export function Composer(props: {
  channel: ChannelInfo;
  spaceId?: string;
  people(): Person[];
  replyTo: Msg | null;
  onCancelReply(): void;
  onEditLast(): void;
  onSent(): void;
  send(text: string, files: File[], spoilers: boolean[], mention: boolean, onProgress: (f: number) => void): Promise<void>;
  /** Files dropped anywhere on the chat */
  incoming?: Accessor<File[] | null>;
  onIncomingTaken?(): void;
  /** Sends a GIF link straight away, like Stoat */
  sendGif?(url: string): Promise<void>;
  /** Shown stuck to the top of the message box (the "viewing older messages" bar, or the arrow on phones) */
  above?: JSX.Element;
}) {
  const [text, setText] = createSignal("");
  const [files, setFilesSig] = createSignal<PendingFile[]>([]);
  const [progress, setProgress] = createSignal<number | null>(null);
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [mention, setMention] = createSignal(true);
  const [sel, setSel] = createSignal(0);
  const [caret, setCaret] = createSignal(0);
  const [selection, setSelection] = createSignal<{ from: number; to: number } | null>(null);
  const [rulesTick, setRulesTick] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [sentAt, setSentAt] = createSignal<Record<string, number>>({});
  let host!: HTMLDivElement, wrap!: HTMLDivElement;
  let fileInput!: HTMLInputElement;
  let photoInput!: HTMLInputElement, videoInput!: HTMLInputElement, mediaInput!: HTMLInputElement;
  /** Phones and tablets: what to add, as a card from the bottom (like Discord's): the camera, the photo picker, or any file. */
  const [attachOpen, setAttachOpen] = createSignal(false);
  const attachSheet = (_at: Element) => setAttachOpen(true);
  /** One of the card's choices: the card closes first, then the camera, picker or files open. */
  const attachPick = (f: () => void) => () => { setAttachOpen(false); f(); };
  let ed: EditorApi | undefined;
  let typingOn = false, typingSent = 0, typingTimer: ReturnType<typeof setTimeout> | undefined;
  const cid = createMemo(() => props.channel.id);

  const rules = createMemo(() => { rulesTick(); return backend()?.channelRules(cid()) ?? { canSend: true, canUpload: true, canReact: true, canManage: false, slowmode: 0 }; });
  /** Seconds left before slowmode lets you send again. */
  const wait = createMemo(() => {
    const r = rules();
    if (!r.slowmode) return 0;
    const until = Math.max(r.waitUntil ?? 0, (sentAt()[cid()] ?? 0) + r.slowmode * 1000);
    return Math.max(0, Math.ceil((until - now()) / 1000));
  });
  createEffect(() => {
    if (!rules().slowmode) return;
    const t = setInterval(() => { setNow(Date.now()); setRulesTick((n) => n + 1); }, 1000);
    onCleanup(() => clearInterval(t));
  });

  const setFiles2 = (list: PendingFile[]) => { setFilesSig(list); setFiles(cid(), list); };

  /* ---------- typing indicator: keep it alive while you type, stop when you pause ---------- */
  const stopTyping = (channelId = cid()) => {
    clearTimeout(typingTimer);
    if (typingOn) { typingOn = false; backend()?.typing(channelId, false); }
  };
  const typed = () => {
    // Stoat clears "is typing" after a few seconds, so keep telling it while the keys keep coming.
    if (!typingOn || Date.now() - typingSent > 2500) { typingOn = true; typingSent = Date.now(); backend()?.typing(cid(), true); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => stopTyping(), 3500);
  };
  onCleanup(() => stopTyping());

  /* ---------- chips ---------- */
  const look: ChipLookup = {
    user: (id) => { const p = props.people().find((x) => x.id === id) ?? backend()?.person(id); return p && p.name !== "Unknown" ? { name: p.name, colour: p.colour } : undefined; },
    channel: (id) => backend()?.channelName(id),
    role: (id) => { const r = backend()?.role(id); return r ? { name: r.name, colour: r.colour } : undefined; },
    emoji: (id) => { const e = backend()?.emojis().find((x) => x.id === id); return e ? { name: e.name, url: e.url } : undefined; },
    messageLink: (url) => {
      const m = /\/channel\/([0-9A-HJKMNP-TV-Z]{26})\/[0-9A-HJKMNP-TV-Z]{26}$/.exec(url);
      const name = m && backend()?.channelName(m[1]!);
      return name ? `#${name} › message` : undefined;
    },
  };

  /* ---------- autocomplete ---------- */
  /** Escape hides the list until the word being completed changes. */
  const [dismissed, setDismissed] = createSignal<string | null>(null);
  const token = createMemo(() => {
    const t = completionToken(text().slice(0, Math.max(0, caret())));
    return t && dismissed() !== `${t.start}:${t.sigil}` ? t : null;
  });
  const roles = (): Role[] => (props.spaceId ? backend()?.roles(props.spaceId) ?? [] : []);
  const items = createMemo<Item[]>(() => {
    const t = token();
    if (!t) return [];
    const q = t.q.toLowerCase();
    const starts = (s?: string) => !!s && s.toLowerCase().startsWith(q);
    if (t.sigil === ":") {
      const custom = (backend()?.emojis() ?? []).filter((e) => starts(e.name)).slice(0, 4)
        .map((e): Item => ({ kind: "emoji", label: `:${e.name}:`, insert: `:${e.id}:`, img: e.url }));
      return [...custom, ...searchEmoji(t.q, 8 - custom.length).map((e): Item => ({ kind: "emoji", label: `:${e.name}:`, insert: e.char, char: e.char }))];
    }
    if (t.sigil === "#") {
      return (props.spaceId ? backend()?.channelsIn(props.spaceId) ?? [] : [])
        .filter((c) => starts(c.name)).slice(0, 8)
        .map((c): Item => ({ kind: "channel", label: c.name, insert: `<#${c.id}>`, voice: c.kind === "voice" }));
    }
    const roleItems = roles().filter((r) => starts(r.name)).slice(0, 4).map((r): Item => ({ kind: "role", label: r.name, insert: `<%${r.id}>`, colour: r.colour }));
    if (t.sigil === "%") return roleItems;
    const special: Item[] = props.channel.kind === "dm" ? [] : [
      { kind: "special", label: "everyone", insert: "@everyone", hint: "Notify everyone in this channel" },
      { kind: "special", label: "online", insert: "@online", hint: "Notify everyone online here" },
    ].filter((s) => starts(s.label)) as Item[];
    const people = props.people().filter((p) => starts(p.name) || starts(p.username)).slice(0, 8)
      .map((p): Item => ({ kind: "user", label: p.name, insert: `<@${p.id}>`, person: p }));
    return [...people, ...roleItems, ...special].slice(0, 10);
  });
  function accept(i: number) {
    const it = items()[i], t = token();
    if (!it || !t || !ed) return;
    ed.replace(t.start, caret(), it.insert + " ");
    setSel(0);
  }

  /* ---------- the camera (Android: the phone's own camera app, saved only in Mustela's cache, see Camera.kt) ---------- */
  const nativeCamera = () => platform === "android" && inTauri();
  async function takeCamera(video: boolean, again = false) {
    const channel = cid();
    // Remembered in case Android closes Mustela while the camera is open: it reopens this chat and attaches it then.
    try { localStorage.setItem(CAPTURE_KEY, JSON.stringify({ channel, at: Date.now() })); } catch { /* storage off */ }
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke<NativeFile & { cancelled?: boolean; permission?: boolean }>("plugin:mustela-native|take_media", { payload: { video } })
      .catch((e) => { toast((e as Error)?.message || String(e) || "Couldn't open the camera.", true); return null; });
    if (r?.permission === false) {
      // Android asked for the camera: once you've answered, try again (once).
      if (!again && (await answered())) return takeCamera(video, true);
      try { localStorage.removeItem(CAPTURE_KEY); } catch { /* fine */ }
      toast("Mustela needs the camera for this. Allow it in Android's settings for Mustela.", true);
      return;
    }
    try { localStorage.removeItem(CAPTURE_KEY); } catch { /* fine */ }
    if (r?.data && cid() === channel) addFiles([nativeFile(r)]);
  }
  // Mustela was closed while the camera was open, and has just opened this chat again: pick up what was taken.
  onMount(() => {
    if (!nativeCamera()) return;
    const c = pendingCapture();
    if (!c || c.channel !== cid()) return;
    try { localStorage.removeItem(CAPTURE_KEY); } catch { /* fine */ }
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke<NativeFile>("plugin:mustela-native|pending_media")).then((r) => { if (r?.data && cid() === c.channel) addFiles([nativeFile(r)]); }).catch(() => {});
  });

  /* ---------- files ---------- */
  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    if (!rules().canUpload) { setErr("You can't upload files in this channel."); return; }
    const incoming = [...list].filter((f) => f.size > 0 || f.type); // folders arrive as empty entries
    const big = incoming.find((f) => f.size > MAX_BYTES);
    if (big) { setErr(`${big.name} is over 20 MB, the server's limit.`); return; }
    const room = MAX_FILES - files().length;
    if (incoming.length > room) setErr(`You can attach up to ${MAX_FILES} files per message.`); else setErr("");
    const channel = cid();
    const added = incoming.slice(0, Math.max(0, room)).map((file): PendingFile => ({ id: ++pendingId, file, spoiler: file.name.startsWith("SPOILER_") }));
    setFiles2([...files(), ...added]);
    // Thumbnails are made in the background; they land on whichever channel the file belongs to.
    for (const p of added) void thumbnail(p.file).then((thumb) => {
      if (!thumb) return;
      const list = getFiles(channel).map((x) => (x.id === p.id ? { ...x, thumb } : x));
      setFiles(channel, list);
      if (cid() === channel) setFilesSig(list);
    });
    ed?.focus();
  }
  const dropFile = (id: number) => { const p = files().find((x) => x.id === id); if (p?.thumb) URL.revokeObjectURL(p.thumb); setFiles2(files().filter((x) => x.id !== id)); };
  const toggleSpoiler = (id: number) => setFiles2(files().map((x) => (x.id === id ? { ...x, spoiler: !x.spoiler } : x)));
  /** Phones and tablets: the attached file whose card is open (preview, spoiler, remove). */
  const [fileCard, setFileCard] = createSignal<number | null>(null);
  createEffect(on(() => props.incoming?.(), (f) => { if (f?.length) { addFiles(f); props.onIncomingTaken?.(); } }));

  /* ---------- per-channel drafts ---------- */
  createEffect(on(cid, (next, prev) => {
    if (prev) stopTyping(prev);
    const d = getDraft(next);
    setText(d.text);
    setFilesSig(getFiles(next));
    setErr("");
    setMention(d.reply?.mention ?? true);
    ed?.setText(d.text);
    ed?.setPlaceholder(placeholder());
  }, { defer: true }));
  // Remember the reply with the draft, but not the reset that happens when switching channels.
  createEffect(on([cid, () => props.replyTo] as const, ([c, r], prev) => {
    if (!prev || prev[0] !== c) return;
    setDraft(c, { text: text(), reply: r ? { id: r.id, mention: mention() } : undefined });
  }));

  /* ---------- scheduled messages (schedule.ts): right-click Send on a computer, hold it on a phone ---------- */
  const [pickTime, setPickTime] = createSignal(false);
  const phone = createPhone();
  // Insert timestamp, like Discord: a time that shows in everyone's own time zone and format.
  const [stampOpen, setStampOpen] = createSignal(false);
  const [stampAt, setStampAt] = createSignal("");
  const [stampStyle, setStampStyle] = createSignal("f");
  const STAMP_STYLES = ["t", "T", "d", "D", "f", "F", "R"] as const;
  const stampUnix = () => { const v = stampAt() ? new Date(stampAt()).getTime() : Date.now(); return Math.floor((Number.isNaN(v) ? Date.now() : v) / 1000); };
  const insertStamp = () => { setStampOpen(false); ed?.insertAtCaret(`<t:${stampUnix()}:${stampStyle()}> `); ed?.focus(); };
  const TIP = "mustela.tip.schedule";
  const [tipShown, setTipShown] = createSignal((() => { try { return !localStorage.getItem(TIP); } catch { return false; } })());
  const dismissTip = () => { setTipShown(false); try { localStorage.setItem(TIP, "1"); } catch { /* private mode */ } };
  const localNow = (plusMin = 0) => { const d = new Date(Date.now() + plusMin * 60_000); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
  const when = (at: number) => new Date(at).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  const scheduleAt = (at: number) => {
    const t = text().trim();
    if (!t) return;
    schedule(cid(), t, at);
    ed?.setText("");
    setDraft(cid(), { text: "" });
    dismissTip();
    toast(`Scheduled for ${when(at)}`);
  };
  const scheduleMenu = (e: MouseEvent) => {
    if (!text().trim()) { toast("Type a message first, then schedule it."); return; }
    if (files().length) { toast("Scheduled messages can't carry files. Send the files now, or remove them to schedule the text.", true); return; }
    openMenu(e, [
      { header: "Schedule message" },
      ...quickTimes().map((q) => ({ label: q.label, icon: "clock", hint: when(q.at), onSelect: () => scheduleAt(q.at) })),
      { sep: true },
      { label: "Pick a time…", icon: "clock", onSelect: () => setPickTime(true) },
    ]);
  };
  const scheduledMenu = (at: Element) => openMenu(at, scheduled(cid()).map((x) => ({
    label: `${when(x.at)} · ${x.text.length > 40 ? `${x.text.slice(0, 40)}…` : x.text}`, icon: "clock",
    sub: [
      { label: "Send now", icon: "send", onSelect: () => sendNow(x.id) },
      { label: "Edit", icon: "pencil", onSelect: () => { unschedule(x.id); ed?.setText(x.text); ed?.focus(); } },
      { label: "Delete", icon: "trash", danger: true, onSelect: () => unschedule(x.id) },
    ],
  })));

  async function submit() {
    const t = text().trim();
    if ((!t && !files().length) || busy()) return;
    if (!rules().canSend) return;
    if (wait() > 0) { setErr(`Slowmode is on. You can send again in ${wait()}s.`); return; }
    if (t.length > MAX_CHARS) { setErr(`Messages can be up to ${MAX_CHARS} characters. This one is ${t.length}.`); return; }
    const channel = cid();
    setBusy(true); setErr(""); stopTyping();
    const f = files();
    ed?.setText("");
    if (f.length) setProgress(0);
    try {
      await props.send(t, f.map((p) => p.file), f.map((p) => p.spoiler), mention(), (x) => setProgress(x));
      f.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
      setFiles(channel, []);
      if (cid() === channel) setFilesSig([]);
      setDraft(channel, { text: "" });
      if (rules().slowmode) setSentAt({ ...sentAt(), [channel]: Date.now() });
      props.onSent();
    } catch (e) {
      if (cid() === channel) { ed?.setText(t); setErr(e instanceof Error && e.message ? e.message : "Couldn't send. Check your connection and try again."); }
      else setDraft(channel, { text: t });
    } finally { setBusy(false); setProgress(null); ed?.focus(); }
  }

  function key(e: KeyboardEvent): boolean {
    const list = items();
    if (list.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel() + 1) % list.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel() - 1 + list.length) % list.length); return true; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); accept(sel()); return true; }
      if (e.key === "Escape") { e.preventDefault(); const t = token(); if (t) setDismissed(`${t.start}:${t.sigil}`); return true; }
    }
    if (formatKey(e, ed, selection())) return true;
    // Phones: Enter makes a new line and the send button sends, like Discord and Stoat on mobile.
    const touch = matchMedia("(pointer: coarse)").matches && !matchMedia("(hover: hover)").matches;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !touch) { e.preventDefault(); void submit(); return true; }
    if (e.key === "Escape" && props.replyTo) { props.onCancelReply(); return true; }
    if (e.key === "ArrowUp" && !text()) { e.preventDefault(); props.onEditLast(); return true; }
    return false;
  }

  const placeholder = () => !rules().canSend ? "You can't send messages in this channel"
    : props.channel.kind === "dm" ? `Message @${props.channel.name}` : props.channel.kind === "group" ? `Message ${props.channel.name}` : `Message #${props.channel.name}`;

  onMount(() => {
    const d = getDraft(cid());
    setText(d.text);
    setFilesSig(getFiles(cid()));
    setMention(d.reply?.mention ?? true);
    ed = createEditor(host, {
      text: d.text, placeholder: placeholder(), label: placeholder(), look,
      on: {
        onKey: key,
        onChange: (v) => {
          setText(v); setSel(0);
          setDraft(cid(), { text: v, reply: props.replyTo ? { id: props.replyTo.id, mention: mention() } : undefined });
          if (v) typed(); else stopTyping();
        },
        onCaret: setCaret,
        onSelection: setSelection,
        onPasteFiles: addFiles,
      },
    });
    active = ed;
    onCleanup(() => { if (active === ed) active = undefined; ed?.destroy(); ed = undefined; });
  });
  // The box scrolls only once the text really reaches its line cap. Below that it can't scroll at all: on phones and
  // some computers a line came out a fraction of a pixel taller than the box, so a single line could be scrolled (and
  // Windows drew a scroll bar beside it).
  onMount(() => {
    const content = () => host.querySelector<HTMLElement>(".cm-content");
    const fit = () => {
      const c = content();
      host.classList.toggle("scrolls", !!c && c.getBoundingClientRect().height > host.clientHeight + 3);
      // One line of text: the buttons sit on its middle, whatever the text size. More lines: they stay at the bottom.
      const lh = c ? parseFloat(getComputedStyle(c).lineHeight) || 0 : 0;
      const pad = c ? parseFloat(getComputedStyle(c).paddingTop) + parseFloat(getComputedStyle(c).paddingBottom) : 0;
      host.closest(".composer")?.classList.toggle("multi", !!c && lh > 0 && c.getBoundingClientRect().height - pad > lh * 1.5);
    };
    const ro = new ResizeObserver(fit);
    // The editor is built again when you switch chats; follow its new content.
    const watch = () => { ro.disconnect(); ro.observe(host); const c = content(); if (c) ro.observe(c); };
    const mo = new MutationObserver(watch);
    mo.observe(host, { childList: true });
    watch();
    const hold = () => { if (!host.classList.contains("scrolls") && host.scrollTop) host.scrollTop = 0; };
    host.addEventListener("scroll", hold, { passive: true });
    onCleanup(() => { ro.disconnect(); mo.disconnect(); host.removeEventListener("scroll", hold); });
  });
  // Names for chips arrive after the member list loads.
  createEffect(on(() => props.people().length, () => ed?.refresh(), { defer: true }));
  createEffect(on(placeholder, (p) => ed?.setPlaceholder(p), { defer: true }));

  return (
    <div class="composer-wrap" ref={wrap} classList={{ "fmt-open": !items().length && !!selection() }}>
      {props.above}
      <Show when={pickTime()}>
        <div class="scrim" onClick={(e) => e.target === e.currentTarget && setPickTime(false)}>
          <form class="modal panel sched-dialog" role="dialog" aria-label="Schedule message" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("when") as HTMLInputElement).value; const at = v ? new Date(v).getTime() : NaN; if (at > Date.now()) { setPickTime(false); scheduleAt(at); } }}>
            <h3>Schedule message</h3>
            <p class="muted">Sent from this device at that time, while Mustela is running. If it's closed then, it goes out when you next open it.</p>
            <input name="when" type="datetime-local" required min={localNow()} value={localNow(60)} />
            <div class="dialog-actions"><button type="button" class="btn" onClick={() => setPickTime(false)}>Cancel</button><button class="btn primary">Schedule</button></div>
          </form>
        </div>
      </Show>
      <Show when={stampOpen()}>
        <div class="scrim" onClick={(e) => e.target === e.currentTarget && setStampOpen(false)}>
          <form class="modal panel sched-dialog stamp-dialog" role="dialog" aria-label="Insert timestamp" onSubmit={(e) => { e.preventDefault(); insertStamp(); }}>
            <h3>Insert timestamp</h3>
            <p class="muted">Everyone sees it in their own time zone.</p>
            <input type="datetime-local" value={stampAt() || localNow()} onInput={(e) => setStampAt(e.currentTarget.value)} aria-label="Date and time" />
            <div class="stamp-list" role="radiogroup" aria-label="How it shows">
              <For each={STAMP_STYLES}>{(st) => (
                <button type="button" role="radio" aria-checked={stampStyle() === st} classList={{ on: stampStyle() === st }} onClick={() => setStampStyle(st)}>
                  <span>{formatTime(stampUnix(), st)}</span>
                </button>
              )}</For>
            </div>
            <div class="dialog-actions"><button type="button" class="btn" onClick={() => setStampOpen(false)}>Cancel</button><button class="btn primary">Insert</button></div>
          </form>
        </div>
      </Show>
      <Show when={items().length && token()}>
        <div class="suggest panel" role="listbox" aria-label="Suggestions">
          <For each={items()}>{(it, i) => (
            <button role="option" aria-selected={sel() === i()} classList={{ on: sel() === i() }} onMouseDown={(e) => { e.preventDefault(); accept(i()); }}>
              {it.kind === "user" ? <Avatar person={it.person} size={22} presence={false} still profile={null} />
                : it.kind === "emoji" ? <span class="sg-emoji"><Show when={it.img} fallback={<UEmoji e={it.char ?? ""} />}><img class="cemoji" src={it.img} alt="" /></Show></span>
                : it.kind === "channel" ? <Icon name={it.voice ? "speaker" : "hash"} size={18} class="muted" />
                : it.kind === "role" ? <span class="sg-role" style={{ "--role": it.colour && !it.colour.includes("gradient") ? it.colour : undefined }}>@</span>
                : <Icon name="at" size={18} class="muted" />}
              <span>{it.kind === "role" || it.kind === "special" ? `@${it.label}` : it.label}</span>
              <Show when={it.kind === "user" && it.person.username}><small class="muted">{(it as any).person.username}</small></Show>
              <Show when={it.kind === "special"}><small class="muted">{(it as any).hint}</small></Show>
              <Show when={it.kind === "role"}><small class="muted">Role</small></Show>
            </button>
          )}</For>
        </div>
      </Show>
      <FormatBar ed={() => ed} host={() => wrap} selection={selection} hidden={!!items().length} />
      <Show when={props.replyTo}>{(r) => (
        <div class="reply-bar">
          <Icon name="reply" size={16} class="flip" />
          <span class="rb-text">Replying to <NameText person={r().author} /> <span class="muted">{plain(r().text).slice(0, 80)}</span></span>
          <button class={`rb-mention ${mention() ? "on" : ""}`} aria-pressed={mention()} onClick={() => { setMention(!mention()); setDraft(cid(), { text: text(), reply: { id: r().id, mention: mention() } }); }} title="Notify the author">
            <Icon name="at" size={15} />{mention() ? "On" : "Off"}
          </button>
          <button class="icon-btn" aria-label="Cancel reply" onClick={props.onCancelReply}><Icon name="close" size={16} /></button>
        </div>
      )}</Show>
      <Show when={files().length}>
        <div class="pending-files">
          <For each={files()}>{(p) => (
            <div class="pf panel-inset" classList={{ "pf-spoiled": p.spoiler, "pf-tap": MOBILE_UI }}
              role={MOBILE_UI ? "button" : undefined} tabIndex={MOBILE_UI ? 0 : undefined} aria-label={MOBILE_UI ? `${p.file.name.replace(/^SPOILER_/, "")}: preview, spoiler or remove` : undefined}
              onClick={() => { if (MOBILE_UI && !busy()) setFileCard(p.id); }}>
              <Show when={p.thumb} fallback={<Icon name="file" size={26} />}>
                <img src={p.thumb} alt="" decoding="async" />
              </Show>
              <span class="pf-name">{p.file.name.replace(/^SPOILER_/, "")}</span>
              {/* Phones and tablets: tap the tile for a card (preview, spoiler, remove); the X removes it straight away. */}
              <Show when={!busy() && MOBILE_UI}>
                <button type="button" class="pf-x" aria-label={`Remove ${p.file.name}`} onClick={(e) => { e.stopPropagation(); dropFile(p.id); }}><Icon name="close" size={14} /></button>
              </Show>
              {/* Computers: small buttons on the tile. */}
              <Show when={!busy() && !MOBILE_UI}>
                <div class="pf-tools">
                  <button class="icon-btn" classList={{ on: p.spoiler }} aria-pressed={p.spoiler} aria-label={p.spoiler ? "Don't send as a spoiler" : "Send as a spoiler"} title={p.spoiler ? "Spoiler on" : "Mark as spoiler"} onClick={() => toggleSpoiler(p.id)}><Icon name={p.spoiler ? "eye-off" : "eye"} size={14} /></button>
                  <button class="icon-btn" aria-label={`Remove ${p.file.name}`} title="Remove" onClick={() => dropFile(p.id)}><Icon name="close" size={14} /></button>
                </div>
              </Show>
              <Show when={p.spoiler}><span class="pf-tag">Spoiler</span></Show>
            </div>
          )}</For>
        </div>
      </Show>
      <Show when={fileCard() !== null && files().find((x) => x.id === fileCard())}>{(p) => (
        <FileCard file={p()} onClose={() => setFileCard(null)} onSpoiler={() => toggleSpoiler(p().id)} onRemove={() => { dropFile(p().id); setFileCard(null); }} />
      )}</Show>
      <Show when={progress() !== null}>
        <div class="upload-bar" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round((progress() ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} /><small>Uploading… {Math.round((progress() ?? 0) * 100)}%</small>
        </div>
      </Show>
      <Show when={err()}><p class="err composer-err" role="alert">{err()}</p></Show>
      <form class="composer" classList={{ locked: !rules().canSend }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Show when={rules().canSend && rules().canUpload}>
          <button type="button" class="icon-btn" aria-label="Attach files" title="Attach files" onClick={(e) => (MOBILE_UI ? attachSheet(e.currentTarget) : fileInput.click())}><Icon name="plus-circle" size={22} /></button>
        </Show>
        <Show when={!rules().canSend}><Icon name="lock" size={20} class="muted lock-ic" /></Show>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
        {/* Phones and tablets: one picker per kind, so Android opens the right screen (camera, photo picker, files). */}
        <Show when={MOBILE_UI}>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
          <input ref={videoInput} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
          <input ref={mediaInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
          <Show when={attachOpen()}>
            <AttachCard onClose={() => setAttachOpen(false)} onFiles={(f) => addFiles(f)} big={[
              { label: "Camera", icon: "camera", run: attachPick(() => (nativeCamera() ? void takeCamera(false) : photoInput.click())) },
              { label: "Video", icon: "video", run: attachPick(() => (nativeCamera() ? void takeCamera(true) : videoInput.click())) },
              { label: "Photos", icon: "image", run: attachPick(() => mediaInput.click()) },
            ]} small={[
              { label: "Files", icon: "file", run: attachPick(() => fileInput.click()) },
              { label: "Timestamp", icon: "calendar", run: attachPick(() => setStampOpen(true)) },
            ]} />
          </Show>
        </Show>
        <div class="editor" ref={host} classList={{ over: text().length > MAX_CHARS }} inert={!rules().canSend} />
        <Show when={text().length > MAX_CHARS - 200}><span class="char-count" classList={{ over: text().length > MAX_CHARS }}>{MAX_CHARS - text().length}</span></Show>
        <Show when={rules().canSend}>
          <Show when={!phone()}>
            <button type="button" class="icon-btn" aria-label="Insert timestamp" title="Insert timestamp" onClick={() => setStampOpen(true)}><Icon name="calendar" size={22} /></button>
          </Show>
          <Show when={props.sendGif && !phone()}>
            <button type="button" class="icon-btn" aria-label="GIF" title="GIF" onClick={(e) => openGifPicker(e.currentTarget, (url) => void props.sendGif!(url), { emoji: ({ text: x }) => { ed?.insertAtCaret(x); if (MOBILE_UI && !phone()) ed?.focus(); } })}><Icon name="gif" size={22} /></button>
          </Show>
          {/* Phones, like Discord: one button for emoji and GIFs; while their card is open it's a keyboard, to type again. */}
          <Show when={phone() && exprOpen()} fallback={
            <button type="button" class="icon-btn" aria-label={phone() ? "Emoji and GIFs" : "Emoji"} title="Emoji" onClick={(e) => {
              if (phone()) (document.activeElement as HTMLElement | null)?.blur?.(); // the card takes the keyboard's place
              // Tablets: the keyboard comes back with the emoji; phones keep the card open for more instead.
              openEmojiPicker(e.currentTarget, ({ text: x }) => { ed?.insertAtCaret(x); if (MOBILE_UI && !phone()) ed?.focus(); }, { ...(props.sendGif ? { gif: (url: string) => void props.sendGif!(url) } : {}), stay: phone(), ...(phone() ? { back: () => ed?.deleteBack() } : {}) });
            }}><Icon name="smile" size={22} /></button>
          }>
            <button type="button" class="icon-btn" aria-label="Keyboard" title="Keyboard" onClick={() => { closeExpr(); ed?.focus(); }}><Icon name="keyboard" size={22} /></button>
          </Show>
          <button class="send-btn" disabled={busy() || wait() > 0 || (!text().trim() && !files().length)} aria-label="Send" title="Send (right-click to schedule)"
            {...holdToOpen()} onContextMenu={(e) => { e.preventDefault(); markHeld(); scheduleMenu(e); }}><Icon name="send" size={18} /></button>
          <Show when={tipShown()}>
            <div class="sched-tip panel" role="note">
              <Icon name="clock" size={18} />
              <span class="st-text"><span class="st-head"><b class="st-new">New</b>Scheduled messages</span>
                <span>{MOBILE_UI ? "Hold Send to pick when it goes out." : "Right-click Send to pick when it goes out."}</span></span>
              <button type="button" class="icon-btn" aria-label="Got it" onClick={dismissTip}><Icon name="close" size={14} /></button>
            </div>
          </Show>
        </Show>
      </form>
      {/* Under the box, like Discord's (above it they came between the box and the "viewing older messages" bar). */}
      <Show when={scheduled(cid()).length || (rules().slowmode && rules().canSend)}>
        <div class="composer-notes">
          <Show when={scheduled(cid()).length}>
            <button type="button" class="sched-chip" onClick={(e) => scheduledMenu(e.currentTarget)}>
              <Icon name="clock" size={14} />{scheduled(cid()).length === 1 ? "1 scheduled message" : `${scheduled(cid()).length} scheduled messages`}
            </button>
          </Show>
          <span class="grow" />
          <Show when={rules().slowmode && rules().canSend}>
            <div class="slow-chip" role="status"><Icon name="clock" size={13} />{wait() > 0 ? `Slowmode: ${wait()}s` : `Slowmode: one message every ${rules().slowmode}s`}</div>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * Phones and tablets: the + button's card, like Discord's. Big tiles for the camera, a video and your photos (Android's
 * own photo picker), and buttons for any file or a timestamp. Swipe it down or tap outside to close.
 */
function AttachCard(props: { onClose(): void; onFiles?(files: File[]): void; big: { label: string; icon: string; run(): void }[]; small: { label: string; icon: string; run(): void }[] }) {
  useBack(props.onClose);
  return (
    <Portal>
      <div class="pop-scrim att-scrim" onClick={props.onClose}>
        <div class="att-card panel" role="dialog" aria-label="Add to your message" ref={(el) => onMount(() => dragToClose(el, props.onClose, { half: true }))} onClick={(e) => e.stopPropagation()}>
          <span class="att-handle" aria-hidden="true" />
          <div class="att-big">
            <For each={props.big}>{(x) => <button type="button" onClick={x.run}><Icon name={x.icon} size={30} /><span>{x.label}</span></button>}</For>
          </div>
          <div class="att-small">
            <For each={props.small}>{(x) => <button type="button" onClick={x.run}><Icon name={x.icon} size={22} /><span>{x.label}</span></button>}</For>
          </div>
          <Show when={props.onFiles && platform === "android" && inTauri()}><RecentPhotos onPick={(fs) => { props.onClose(); props.onFiles!(fs); }} /></Show>
        </div>
      </div>
    </Portal>
  );
}

/** An attached file before sending, on phones and tablets: a big look at it, Mark as spoiler, and Remove (like Discord's). */
function FileCard(props: { file: PendingFile; onClose(): void; onSpoiler(): void; onRemove(): void }) {
  useBack(props.onClose);
  const f = () => props.file.file;
  const name = () => f().name.replace(/^SPOILER_/, "");
  const video = () => f().type.startsWith("video/");
  // The picture or video itself at full quality (not the small thumbnail on the tile), while the card is open.
  const own = f().type.startsWith("image/") || video() ? URL.createObjectURL(f()) : null;
  onCleanup(() => { if (own) URL.revokeObjectURL(own); });
  const src = () => own;
  const size = () => { const b = f().size; return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; };
  return (
    <Portal>
      <div class="pop-scrim att-scrim" onClick={props.onClose}>
        {/* Opens tall enough to show everything (the spoiler switch and Remove included), not halfway */}
        <div class="att-card panel file-card" role="dialog" aria-label={name()} ref={(el) => onMount(() => dragToClose(el, props.onClose))} onClick={(e) => e.stopPropagation()}>
          <span class="att-handle" aria-hidden="true" />
          <h3 class="fc-name">{name()}</h3>
          <div class="fc-preview" classList={{ "fc-spoiled": props.file.spoiler }}>
            <Show when={src()} fallback={<div class="fc-file"><Icon name="file" size={44} /><small>{size()}</small></div>}>
              <Show when={video()} fallback={<img src={src()!} alt="" />}><video src={src()!} controls playsinline muted /></Show>
            </Show>
            <Show when={props.file.spoiler}><span class="fc-tag">Spoiler</span></Show>
          </div>
          <div class="fc-rows">
            <label class="fc-row"><Icon name="eye-off" size={22} /><span>Mark as spoiler</span><span class="grow" />
              <Switch on={props.file.spoiler} onChange={props.onSpoiler} label="Mark as spoiler" /></label>
          </div>
          <button type="button" class="btn danger-fill fc-remove" onClick={props.onRemove}><Icon name="trash" size={18} />Remove file</button>
        </div>
      </div>
    </Portal>
  );
}

/** What Android hands back for a photo or video: the file as base64. */
type NativeFile = { data?: string; mime?: string; name?: string };
const nativeFile = (r: NativeFile) => {
  const bin = atob(r.data!), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], r.name ?? "photo.jpg", { type: r.mime ?? "image/jpeg" });
};
/** A photo or video being taken for this chat (kept so it survives Android closing Mustela meanwhile). */
export const CAPTURE_KEY = "mustela:capture";
export function pendingCapture(): { channel: string; at: number } | null {
  try {
    const c = JSON.parse(localStorage.getItem(CAPTURE_KEY) ?? "null") as { channel?: string; at?: number } | null;
    return c?.channel && c.at && Date.now() - c.at < 30 * 60_000 ? { channel: c.channel, at: c.at } : null;
  } catch { return null; }
}
/** Android's permission prompt answered: the window gets its focus back (or 20 seconds pass). */
function answered(): Promise<boolean> {
  return new Promise((resolve) => {
    let lost = !document.hasFocus();
    const blur = () => { lost = true; };
    const focus = () => { if (lost) done(true); };
    const t = setTimeout(() => done(false), 20_000);
    const done = (v: boolean) => { clearTimeout(t); removeEventListener("blur", blur); removeEventListener("focus", focus); resolve(v); };
    addEventListener("blur", blur); addEventListener("focus", focus);
  });
}

type Recent = { uri: string; thumb: string; mime: string; name: string; video: boolean; date?: number };

/** Day headings like a gallery app's: Today, Yesterday, Nov 6, and the year once it isn't this one. */
function dayLabel(ms: number) {
  const d = new Date(ms), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
const monthLabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "long", year: "numeric" });
const VIEW_KEY = "mustela:att-view";
/**
 * Android: your newest photos and videos right in the + card, like Discord's. Thumbnails only until you tap one;
 * then that file is read and attached. Without access yet, one tap asks for it (on Android 14+ you can allow just
 * the photos you choose).
 */
function RecentPhotos(props: { onPick(fs: File[]): void }) {
  const call = <T,>(cmd: string, payload?: unknown) => import("@tauri-apps/api/core").then(({ invoke }) => invoke<T>(`plugin:mustela-native|${cmd}`, payload === undefined ? {} : { payload }));
  type Page = { allowed: boolean; items: Recent[]; next?: number };
  const [data, { refetch }] = createResource(() => call<Page>("recent_photos", { limit: 30 }).catch(() => null));
  // More as you scroll: the whole card scrolls (buttons and photos together) and the next photos load near its end.
  const [more, setMore] = createSignal<Recent[]>([]);
  let next: number | undefined, loading = false;
  createEffect(on(data, (d) => { setMore([]); next = d?.next; }));
  const loadMore = async () => {
    if (loading || next === undefined || more().length >= 300) return;
    loading = true;
    const p = await call<Page>("recent_photos", { limit: 30, offset: next }).catch(() => null);
    loading = false;
    next = p?.next;
    if (p?.items.length) setMore((m) => [...m, ...p.items]);
  };
  const items = () => [...(data()?.items ?? []), ...more()];
  let grid: HTMLDivElement | undefined;
  let card: HTMLElement | null = null;
  const near = () => { if (card && card.scrollHeight - card.scrollTop - card.clientHeight < 400) void loadMore(); };
  onMount(() => requestAnimationFrame(() => {
    card = grid?.closest<HTMLElement>(".att-card") ?? document.querySelector<HTMLElement>(".att-card");
    card?.addEventListener("scroll", near, { passive: true });
  }));
  onCleanup(() => card?.removeEventListener("scroll", near));
  const [busy, setBusy] = createSignal<string | null>(null);
  /** Photos ticked so far, in the order you tapped them (up to 5: what one message can carry). */
  const [picked, setPicked] = createSignal<string[]>([]);
  const toggle = (r: Recent) => {
    const now = picked();
    if (now.includes(r.uri)) { setPicked(now.filter((u) => u !== r.uri)); return; }
    if (now.length >= MAX_FILES) { toast(`You can add up to ${MAX_FILES} at a time.`); return; }
    setPicked([...now, r.uri]); navigator.vibrate?.(6);
  };
  // Back from Android's permission prompt: look again.
  const again = () => void refetch();
  addEventListener("focus", again); document.addEventListener("visibilitychange", again);
  onCleanup(() => { removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); });
  /** Reads the ticked photos (only now: the grid only ever had thumbnails) and adds them to the message together. */
  const add = async () => {
    if (busy() || !picked().length) return;
    setBusy("add");
    const out: File[] = [];
    let failed = 0;
    for (const uri of picked()) {
      try {
        const f = await call<{ data: string; mime: string; name: string }>("photo_file", { uri });
        const bin = atob(f.data), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        out.push(new File([bytes], f.name, { type: f.mime }));
      } catch { failed++; }
    }
    setBusy(null);
    if (failed) toast(failed === 1 ? "Couldn't open one of them. It may be too big (25 MB at most)." : `Couldn't open ${failed} of them. They may be too big (25 MB at most).`, true);
    if (out.length) props.onPick(out);
  };
  // Grid, or grouped by day like a gallery app (remembered on this device).
  const [byDate, setByDate] = createSignal((() => { try { return localStorage.getItem(VIEW_KEY) === "date"; } catch { return false; } })());
  const setView = (v: boolean) => { setByDate(v); try { localStorage.setItem(VIEW_KEY, v ? "date" : "grid"); } catch { /* just this time */ } };
  const days = createMemo(() => {
    const out: { label: string; items: Recent[] }[] = [];
    for (const r of items()) {
      const label = r.date ? dayLabel(r.date) : "Earlier";
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(r); else out.push({ label, items: [r] });
    }
    return out;
  });
  const tile = (r: Recent) => {
    const n = () => picked().indexOf(r.uri) + 1;
    return (
      <button type="button" role="listitem" class="att-photo" classList={{ on: n() > 0 }} data-date={r.date} aria-pressed={n() > 0}
        aria-label={r.video ? `Video ${r.name}` : `Photo ${r.name}`} onClick={() => toggle(r)}>
        <img src={r.thumb} alt="" loading="lazy" />
        <Show when={r.video}><span class="att-vid"><Icon name="play" size={14} /></span></Show>
        {/* Ticked: its number in the order you picked them, like a gallery app's */}
        <Show when={n() > 0}><span class="att-tick" aria-hidden="true">{n()}</span></Show>
      </button>
    );
  };

  /*
   * A scroll handle on the right, like a gallery app's: it shows while you scroll; hold it and drag to move through
   * your photos quickly, with the month you're at beside it.
   */
  const TH = 46;
  const [bar, setBar] = createSignal<{ top: number; label: string } | null>(null);
  const [barOn, setBarOn] = createSignal(false);
  const [dragging, setDragging] = createSignal(false);
  let hideT: ReturnType<typeof setTimeout> | undefined, raf = 0;
  // The handle's track runs beside the photos: from the "Recent" heading down (it only reaches the card's top once
  // the buttons above have scrolled away), never over the Camera / Video / Photos buttons.
  let head: HTMLDivElement | undefined;
  const track = () => {
    const r = card!.getBoundingClientRect();
    const top = Math.max(Math.max(r.top, 0) + 20, head?.getBoundingClientRect().top ?? 0);
    return { top, h: Math.max(40, r.bottom - 24 - top - TH), r };
  };
  const monthNow = () => {
    if (!card) return "";
    // The first photo showing at the top of the card.
    const edge = Math.max(card.getBoundingClientRect().top, 0) + 40;
    const el = [...card.querySelectorAll<HTMLElement>(".att-photo")].find((x) => x.getBoundingClientRect().bottom > edge);
    const ms = Number(el?.dataset.date);
    return ms ? monthLabel(ms) : "";
  };
  const place = () => {
    raf = 0;
    if (!card) return;
    const max = card.scrollHeight - card.clientHeight;
    if (max < 300 || items().length < 24) { setBar(null); return; }
    const t = track();
    setBar({ top: t.top + (card.scrollTop / max) * t.h, label: monthNow() });
  };
  const onScroll = () => {
    if (!raf) raf = requestAnimationFrame(place);
    setBarOn(true); clearTimeout(hideT);
    hideT = setTimeout(() => { if (!dragging()) setBarOn(false); }, 1400);
  };
  onMount(() => requestAnimationFrame(() => card?.addEventListener("scroll", onScroll, { passive: true })));
  onCleanup(() => { card?.removeEventListener("scroll", onScroll); clearTimeout(hideT); cancelAnimationFrame(raf); });
  let grab = 0;
  const dragTo = (y: number) => {
    if (!card) return;
    const t = track(), max = card.scrollHeight - card.clientHeight;
    card.scrollTop = Math.max(0, Math.min(1, (y - grab - t.top) / t.h)) * max;
  };

  return (
    <Show when={data()}>{(d) => (
      <Show when={d().allowed} fallback={
        <div class="att-allow"><Icon name="image" size={20} /><span>Show your recent photos here</span>
          <button type="button" class="btn small primary" onClick={() => void call("request_photos")}>Allow</button></div>
      }>
        <div class="att-photos-head" ref={head}>
          <span>Recent</span>
          <div class="seg att-view" role="radiogroup" aria-label="Show photos">
            <button type="button" role="radio" aria-checked={!byDate()} classList={{ on: !byDate() }} onClick={() => setView(false)}><Icon name="image" size={15} />All</button>
            <button type="button" role="radio" aria-checked={byDate()} classList={{ on: byDate() }} onClick={() => setView(true)}><Icon name="calendar" size={15} />By date</button>
          </div>
        </div>
        <Show when={byDate()} fallback={<div class="att-recent" role="list" aria-label="Recent photos" ref={grid}><For each={items()}>{tile}</For></div>}>
          <div class="att-days" ref={grid}>
            <For each={days()}>{(g) => (
              <section class="att-day" aria-label={g.label}>
                <h4>{g.label}</h4>
                <div class="att-recent" role="list"><For each={g.items}>{tile}</For></div>
              </section>
            )}</For>
          </div>
        </Show>
        {/* Ticked photos: one button adds them all (stays at the bottom of the card while you scroll) */}
        <Show when={picked().length}>
          <div class="att-add-row">
            <button type="button" class="btn primary att-add" disabled={!!busy()} onClick={() => void add()}>
              <Show when={busy()} fallback={<Icon name="send" size={18} />}><span class="spinner small" /></Show>
              Add {picked().length}
            </button>
          </div>
        </Show>
        <Show when={bar()}>{(b) => (
          <Portal>
            <div class="att-scrub" classList={{ on: barOn() || dragging(), dragging: dragging() }} style={{ top: `${b().top}px`, height: `${TH}px` }}
              onTouchStart={(e) => e.stopPropagation()}
              onPointerDown={(e) => { e.stopPropagation(); grab = e.clientY - b().top; setDragging(true); setBarOn(true); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); navigator.vibrate?.(8); }}
              onPointerMove={(e) => { if (dragging()) dragTo(e.clientY); }}
              onPointerUp={() => { setDragging(false); clearTimeout(hideT); hideT = setTimeout(() => setBarOn(false), 1400); }}
              onPointerCancel={() => setDragging(false)}>
              <Show when={dragging() && b().label}><span class="att-scrub-date">{b().label}</span></Show>
              <span class="att-scrub-thumb" aria-hidden="true"><Icon name="up" size={12} /><Icon name="down" size={12} /></span>
            </div>
          </Portal>
        )}</Show>
      </Show>
    )}</Show>
  );
}
