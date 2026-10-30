import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type Accessor } from "solid-js";
import type { ChannelInfo, Msg, Person, Role } from "../../lib/backend/types";
import { searchEmoji } from "../../lib/emoji";
import { plain } from "../../lib/markdown";
import { Avatar, NameText } from "../Avatar";
import { getDraft, getFiles, setDraft, setFiles, type PendingFile } from "../drafts";
import { Icon } from "../icons";
import { backend } from "../store";
import { createEditor, type ChipLookup, type EditorApi } from "./Editor";
import { completionToken } from "./complete";
import { openEmojiPicker, openGifPicker } from "./overlays";

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

const FORMATS = [
  { k: "bold", label: "Bold", icon: "bold", keys: "Ctrl+B", wrap: ["**", "**"] },
  { k: "italic", label: "Italic", icon: "italic", keys: "Ctrl+I", wrap: ["*", "*"] },
  { k: "strike", label: "Strikethrough", icon: "strike", wrap: ["~~", "~~"] },
  { k: "spoiler", label: "Spoiler", icon: "eye-off", wrap: ["||", "||"] },
  { k: "code", label: "Code", icon: "code", wrap: ["`", "`"] },
  { k: "codeblock", label: "Code block", icon: "code-block" },
  { k: "quote", label: "Quote", icon: "quote" },
  { k: "link", label: "Link", icon: "link" },
] as const;

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

  function format(k: (typeof FORMATS)[number]["k"]) {
    if (!ed) return;
    const f = FORMATS.find((x) => x.k === k)!;
    if ("wrap" in f) { ed.wrap(f.wrap[0], f.wrap[1]); return; }
    if (k === "codeblock" || k === "quote") { ed.block(k); return; }
    // Link: wrap the selection as [text](https://), with the address selected for typing.
    const s = selection();
    if (!s) return;
    const label = text().slice(s.from, s.to);
    ed.replace(s.from, s.to, `[${label}](https://)`);
    ed.view.dispatch({ selection: { anchor: s.from + label.length + 3, head: s.from + label.length + 11 } });
    ed.focus();
  }

  function key(e: KeyboardEvent): boolean {
    const list = items();
    if (list.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel() + 1) % list.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel() - 1 + list.length) % list.length); return true; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); accept(sel()); return true; }
      if (e.key === "Escape") { e.preventDefault(); const t = token(); if (t) setDismissed(`${t.start}:${t.sigil}`); return true; }
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "i")) { e.preventDefault(); format(e.key === "b" ? "bold" : "italic"); return true; }
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
  // Names for chips arrive after the member list loads.
  createEffect(on(() => props.people().length, () => ed?.refresh(), { defer: true }));
  createEffect(on(placeholder, (p) => ed?.setPlaceholder(p), { defer: true }));

  /** Where the formatting bar sits: just above the selection, inside the message box area. */
  const toolbarPos = createMemo(() => {
    const s = selection();
    if (!s || !ed || !wrap) return null;
    const a = ed.view.coordsAtPos(s.from), b = ed.view.coordsAtPos(s.to);
    if (!a || !b) return null;
    const box = wrap.getBoundingClientRect();
    const x = Math.min(a.left, b.left) / 2 + Math.max(a.right, b.right) / 2 - box.left;
    return { left: Math.max(110, Math.min(box.width - 110, x)), top: Math.min(a.top, b.top) - box.top };
  });

  return (
    <div class="composer-wrap" ref={wrap} classList={{ "fmt-open": !items().length && !!toolbarPos() }}>
      <Show when={items().length && token()}>
        <div class="suggest panel" role="listbox" aria-label="Suggestions">
          <For each={items()}>{(it, i) => (
            <button role="option" aria-selected={sel() === i()} classList={{ on: sel() === i() }} onMouseDown={(e) => { e.preventDefault(); accept(i()); }}>
              {it.kind === "user" ? <Avatar person={it.person} size={22} presence={false} still profile={null} />
                : it.kind === "emoji" ? <span class="sg-emoji"><Show when={it.img} fallback={it.char}><img class="cemoji" src={it.img} alt="" /></Show></span>
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
      <Show when={items().length ? null : toolbarPos()}>{(p) => (
        <div class="fmt-bar panel" role="toolbar" aria-label="Formatting" style={{ left: `${p().left}px`, top: `${p().top}px` }} onMouseDown={(e) => e.preventDefault()}>
          <For each={FORMATS}>{(f) => (
            <button type="button" class="icon-btn" aria-label={f.label} title={"keys" in f ? `${f.label} (${f.keys})` : f.label} onClick={() => format(f.k)}><Icon name={f.icon} size={17} /></button>
          )}</For>
        </div>
      )}</Show>
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
            <div class="pf panel-inset" classList={{ spoiler: p.spoiler }}>
              <Show when={p.thumb} fallback={<Icon name="file" size={26} />}>
                <img src={p.thumb} alt="" decoding="async" />
              </Show>
              <span class="pf-name">{p.file.name.replace(/^SPOILER_/, "")}</span>
              <Show when={!busy()}>
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
      <Show when={progress() !== null}>
        <div class="upload-bar" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round((progress() ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.round((progress() ?? 0) * 100)}%` }} /><small>Uploading… {Math.round((progress() ?? 0) * 100)}%</small>
        </div>
      </Show>
      <Show when={err()}><p class="err composer-err" role="alert">{err()}</p></Show>
      <Show when={rules().slowmode && rules().canSend}>
        <div class="slow-chip" role="status"><Icon name="info" size={13} />{wait() > 0 ? `Slowmode: you can send again in ${wait()}s` : `Slowmode is on: one message every ${rules().slowmode}s`}</div>
      </Show>
      <form class="composer" classList={{ locked: !rules().canSend }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Show when={rules().canSend && rules().canUpload}>
          <button type="button" class="icon-btn" aria-label="Attach files" title="Attach files" onClick={() => fileInput.click()}><Icon name="plus-circle" size={22} /></button>
        </Show>
        <Show when={!rules().canSend}><Icon name="lock" size={20} class="muted lock-ic" /></Show>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
        <div class="editor" ref={host} classList={{ over: text().length > MAX_CHARS }} inert={!rules().canSend} />
        <Show when={text().length > MAX_CHARS - 200}><span class="char-count" classList={{ over: text().length > MAX_CHARS }}>{MAX_CHARS - text().length}</span></Show>
        <Show when={rules().canSend}>
          <Show when={props.sendGif}>
            <button type="button" class="icon-btn" aria-label="GIF" title="GIF" onClick={(e) => openGifPicker(e.currentTarget, (url) => void props.sendGif!(url))}><Icon name="gif" size={22} /></button>
          </Show>
          <button type="button" class="icon-btn" aria-label="Emoji" title="Emoji" onClick={(e) => openEmojiPicker(e.currentTarget, ({ text: x }) => ed?.insertAtCaret(x))}><Icon name="smile" size={22} /></button>
          <button class="send-btn" disabled={busy() || wait() > 0 || (!text().trim() && !files().length)} aria-label="Send"><Icon name="send" size={18} /></button>
        </Show>
      </form>
    </div>
  );
}
