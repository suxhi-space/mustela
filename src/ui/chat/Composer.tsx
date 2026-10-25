import { createEffect, createMemo, createSignal, For, on, onCleanup, Show, type Accessor } from "solid-js";
import type { ChannelInfo, Msg, Person } from "../../lib/backend/types";
import { searchEmoji } from "../../lib/emoji";
import { plain } from "../../lib/markdown";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { backend } from "../store";
import { openEmojiPicker, openGifPicker } from "./overlays";

const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024; // Stoat's default attachment limit

type Pending = { id: number; file: File; thumb?: string };
let pendingId = 0;

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

type Suggest = { kind: "emoji"; items: { label: string; insert: string; char: string; img?: string }[] } | { kind: "user"; items: { label: string; insert: string; person: Person }[] };

/**
 * Message box: Enter sends, Shift+Enter makes a new line, Up edits your last
 * message. Paste or drop files to attach. ":fi" suggests emoji, "@mi" suggests people.
 */
export function Composer(props: {
  channel: ChannelInfo;
  people(): Person[];
  replyTo: Msg | null;
  onCancelReply(): void;
  onEditLast(): void;
  onSent(): void;
  send(text: string, files: File[], mention: boolean, onProgress: (f: number) => void): Promise<void>;
  /** Files dropped anywhere on the chat */
  incoming?: Accessor<File[] | null>;
  onIncomingTaken?(): void;
  /** Sends a GIF link straight away, like Stoat */
  sendGif?(url: string): Promise<void>;
}) {
  const [text, setText] = createSignal("");
  const [files, setFiles] = createSignal<Pending[]>([]);
  const [progress, setProgress] = createSignal<number | null>(null);
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [mention, setMention] = createSignal(true);
  const [sel, setSel] = createSignal(0);
  const [caret, setCaret] = createSignal(0);
  let box!: HTMLTextAreaElement;
  let fileInput!: HTMLInputElement;
  let typingOn = false, typingTimer: ReturnType<typeof setTimeout> | undefined;

  const stopTyping = () => { clearTimeout(typingTimer); if (typingOn) { typingOn = false; backend()?.typing(props.channel.id, false); } };
  const typed = () => {
    if (!typingOn) { typingOn = true; backend()?.typing(props.channel.id, true); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 3000);
  };
  onCleanup(stopTyping);

  const fit = () => { box.style.height = "auto"; box.style.height = `${Math.min(box.scrollHeight, 220)}px`; };

  /* ---------- autocomplete ---------- */
  const token = createMemo(() => {
    const before = text().slice(0, caret());
    const m = /(?:^|\s)([:@])([\w+-]{2,32})$/.exec(before);
    return m ? { kind: m[1] === ":" ? "emoji" as const : "user" as const, q: m[2]!, start: before.length - m[2]!.length - 1 } : null;
  });
  const suggest = createMemo<Suggest | null>(() => {
    const t = token();
    if (!t) return null;
    if (t.kind === "emoji") {
      const q = t.q.toLowerCase();
      const custom = (backend()?.emojis() ?? []).filter((e) => e.name.toLowerCase().startsWith(q)).slice(0, 4)
        .map((e) => ({ label: `:${e.name}:`, insert: `:${e.id}:`, char: "", img: e.url }));
      const items = [...custom, ...searchEmoji(t.q, 8 - custom.length).map((e) => ({ label: `:${e.name}:`, insert: e.char, char: e.char, img: undefined as string | undefined }))];
      return items.length ? { kind: "emoji", items } : null;
    }
    const q = t.q.toLowerCase();
    const items = props.people().filter((p) => p.name.toLowerCase().startsWith(q) || p.username?.toLowerCase().startsWith(q))
      .slice(0, 8).map((p) => ({ label: p.name, insert: `<@${p.id}>`, person: p }));
    return items.length ? { kind: "user", items } : null;
  });
  function accept(i: number) {
    const s = suggest(), t = token();
    if (!s || !t) return;
    const ins = s.items[i]!.insert + " ";
    const v = text();
    const next = v.slice(0, t.start) + ins + v.slice(caret());
    setText(next);
    box.value = next;
    const pos = t.start + ins.length;
    box.setSelectionRange(pos, pos);
    setCaret(pos);
    setSel(0);
    fit();
  }

  /* ---------- files ---------- */
  function addFiles(list: FileList | File[] | null | undefined) {
    if (!list) return;
    const incoming = [...list].filter((f) => f.size > 0 || f.type); // folders arrive as empty entries
    const big = incoming.find((f) => f.size > MAX_BYTES);
    if (big) { setErr(`${big.name} is over 20 MB, the server's limit.`); return; }
    const room = MAX_FILES - files().length;
    if (incoming.length > room) setErr(`You can attach up to ${MAX_FILES} files per message.`); else setErr("");
    const added = incoming.slice(0, Math.max(0, room)).map((file) => ({ id: ++pendingId, file }));
    setFiles([...files(), ...added]);
    for (const p of added) void thumbnail(p.file).then((thumb) => { if (thumb) setFiles(files().map((x) => (x.id === p.id ? { ...x, thumb } : x))); });
    box?.focus();
  }
  const dropFile = (id: number) => { const p = files().find((x) => x.id === id); if (p?.thumb) URL.revokeObjectURL(p.thumb); setFiles(files().filter((x) => x.id !== id)); };
  onCleanup(() => files().forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb)));
  createEffect(on(() => props.incoming?.(), (f) => { if (f?.length) { addFiles(f); props.onIncomingTaken?.(); } }));

  async function submit() {
    const t = text().trim();
    if ((!t && !files().length) || busy()) return;
    if (t.length > 2000) { setErr(`Messages can be up to 2000 characters. This one is ${t.length}.`); return; }
    setBusy(true); setErr(""); stopTyping();
    const f = files();
    setText(""); box.value = ""; fit();
    if (f.length) setProgress(0);
    try {
      await props.send(t, f.map((p) => p.file), mention(), (x) => setProgress(x));
      f.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
      setFiles([]);
      props.onSent();
    } catch (e) {
      setText(t); box.value = t; fit();
      setErr(e instanceof Error && e.message ? e.message : "Couldn't send. Check your connection and try again.");
    } finally { setBusy(false); setProgress(null); box.focus(); }
  }

  function keydown(e: KeyboardEvent) {
    const s = suggest();
    if (s) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((sel() + 1) % s.items.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((sel() - 1 + s.items.length) % s.items.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); accept(sel()); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); void submit(); return; }
    if (e.key === "Escape" && props.replyTo) { props.onCancelReply(); return; }
    if (e.key === "ArrowUp" && !text()) { e.preventDefault(); props.onEditLast(); }
  }

  const placeholder = () => props.channel.kind === "dm" ? `Message @${props.channel.name}` : props.channel.kind === "group" ? `Message ${props.channel.name}` : `Message #${props.channel.name}`;

  return (
    <div class="composer-wrap">
      <Show when={suggest()}>{(s) => (
        <div class="suggest panel" role="listbox" aria-label={s().kind === "emoji" ? "Emoji" : "People"}>
          <For each={s().items as any[]}>{(it, i) => (
            <button role="option" aria-selected={sel() === i()} classList={{ on: sel() === i() }} onMouseDown={(e) => { e.preventDefault(); accept(i()); }}>
              <Show when={s().kind === "user"} fallback={<span class="sg-emoji"><Show when={it.img} fallback={it.char}><img class="cemoji" src={it.img} alt="" /></Show></span>}>
                <Avatar person={it.person} size={22} presence={false} still profile={null} />
              </Show>
              <span>{it.label}</span>
              <Show when={s().kind === "user" && it.person.username}><small class="muted">{it.person.username}</small></Show>
            </button>
          )}</For>
        </div>
      )}</Show>
      <Show when={props.replyTo}>{(r) => (
        <div class="reply-bar">
          <Icon name="reply" size={16} class="flip" />
          <span class="rb-text">Replying to <NameText person={r().author} /> <span class="muted">{plain(r().text).slice(0, 80)}</span></span>
          <button class={`rb-mention ${mention() ? "on" : ""}`} aria-pressed={mention()} onClick={() => setMention(!mention())} title="Notify the author">
            <Icon name="at" size={15} />{mention() ? "On" : "Off"}
          </button>
          <button class="icon-btn" aria-label="Cancel reply" onClick={props.onCancelReply}><Icon name="close" size={16} /></button>
        </div>
      )}</Show>
      <Show when={files().length}>
        <div class="pending-files">
          <For each={files()}>{(p) => (
            <div class="pf panel-inset">
              <Show when={p.thumb} fallback={<Icon name="file" size={26} />}>
                <img src={p.thumb} alt="" decoding="async" />
              </Show>
              <span class="pf-name">{p.file.name}</span>
              <Show when={!busy()}><button class="icon-btn" aria-label={`Remove ${p.file.name}`} onClick={() => dropFile(p.id)}><Icon name="close" size={14} /></button></Show>
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
      <form class="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <button type="button" class="icon-btn" aria-label="Attach files" title="Attach files" onClick={() => fileInput.click()}><Icon name="plus-circle" size={22} /></button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
        <textarea ref={box} rows={1} placeholder={placeholder()} aria-label={placeholder()} value={text()} maxLength={4000}
          onInput={(e) => { setText(e.currentTarget.value); setCaret(e.currentTarget.selectionStart); setSel(0); fit(); typed(); }}
          onClick={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyUp={(e) => { if (!["ArrowUp", "ArrowDown", "Enter", "Tab"].includes(e.key)) setCaret(e.currentTarget.selectionStart); }}
          onKeyDown={keydown} onPaste={(e) => { if (e.clipboardData?.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }} />
        <Show when={props.sendGif}>
          <button type="button" class="icon-btn" aria-label="GIF" title="GIF" onClick={(e) => openGifPicker(e.currentTarget, (url) => void props.sendGif!(url))}><Icon name="gif" size={22} /></button>
        </Show>
        <button type="button" class="icon-btn" aria-label="Emoji" title="Emoji" onClick={(e) => openEmojiPicker(e.currentTarget, ({ text: x }) => {
          const pos = box.selectionStart ?? text().length;
          const v = text().slice(0, pos) + x + text().slice(pos);
          setText(v); box.value = v; box.focus(); box.setSelectionRange(pos + x.length, pos + x.length); fit();
        })}><Icon name="smile" size={22} /></button>
        <button class="send-btn" disabled={busy() || (!text().trim() && !files().length)} aria-label="Send"><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}
