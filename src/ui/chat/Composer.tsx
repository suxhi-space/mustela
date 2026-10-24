import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { ChannelInfo, Msg, Person } from "../../lib/backend/types";
import { searchEmoji } from "../../lib/emoji";
import { plain } from "../../lib/markdown";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { backend } from "../store";
import { openEmojiPicker } from "./overlays";

const MAX_FILES = 5;
const MAX_BYTES = 20 * 1024 * 1024; // Stoat's default attachment limit

type Suggest = { kind: "emoji"; items: { label: string; insert: string; char: string }[] } | { kind: "user"; items: { label: string; insert: string; person: Person }[] };

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
  send(text: string, files: File[], mention: boolean): Promise<void>;
}) {
  const [text, setText] = createSignal("");
  const [files, setFiles] = createSignal<File[]>([]);
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
      const items = searchEmoji(t.q, 8).map((e) => ({ label: `:${e.name}:`, insert: e.char, char: e.char }));
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
    const incoming = [...list];
    const big = incoming.find((f) => f.size > MAX_BYTES);
    if (big) { setErr(`${big.name} is over 20 MB, the server's limit.`); return; }
    const next = [...files(), ...incoming].slice(0, MAX_FILES);
    if (files().length + incoming.length > MAX_FILES) setErr(`You can attach up to ${MAX_FILES} files per message.`); else setErr("");
    setFiles(next);
  }

  async function submit() {
    const t = text().trim();
    if ((!t && !files().length) || busy()) return;
    if (t.length > 2000) { setErr(`Messages can be up to 2000 characters. This one is ${t.length}.`); return; }
    setBusy(true); setErr(""); stopTyping();
    const f = files();
    setText(""); setFiles([]); box.value = ""; fit();
    try {
      await props.send(t, f, mention());
      props.onSent();
    } catch {
      setText(t); setFiles(f); box.value = t; fit();
      setErr("Couldn't send. Check your connection and try again.");
    } finally { setBusy(false); box.focus(); }
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
    <div class="composer-wrap" onDragOver={(e) => { e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer?.files); }}>
      <Show when={suggest()}>{(s) => (
        <div class="suggest panel" role="listbox" aria-label={s().kind === "emoji" ? "Emoji" : "People"}>
          <For each={s().items as any[]}>{(it, i) => (
            <button role="option" aria-selected={sel() === i()} classList={{ on: sel() === i() }} onMouseDown={(e) => { e.preventDefault(); accept(i()); }}>
              <Show when={s().kind === "user"} fallback={<span class="sg-emoji">{it.char}</span>}>
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
          <For each={files()}>{(f, i) => (
            <div class="pf panel-inset">
              <Show when={f.type.startsWith("image/")} fallback={<Icon name="file" size={26} />}>
                <img src={URL.createObjectURL(f)} alt="" onLoad={(e) => URL.revokeObjectURL(e.currentTarget.src)} />
              </Show>
              <span class="pf-name">{f.name}</span>
              <button class="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files().filter((_, j) => j !== i()))}><Icon name="close" size={14} /></button>
            </div>
          )}</For>
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
        <button type="button" class="icon-btn" aria-label="Emoji" title="Emoji" onClick={(e) => openEmojiPicker(e.currentTarget, (x) => {
          const pos = box.selectionStart ?? text().length;
          const v = text().slice(0, pos) + x + text().slice(pos);
          setText(v); box.value = v; box.focus(); box.setSelectionRange(pos + x.length, pos + x.length); fit();
        })}><Icon name="smile" size={22} /></button>
        <button class="send-btn" disabled={busy() || (!text().trim() && !files().length)} aria-label="Send"><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}
