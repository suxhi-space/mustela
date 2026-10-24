import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { EMOJI_GROUPS, searchEmoji } from "../../lib/emoji";
import { Icon } from "../icons";

/* ---------- emoji picker: one instance for the whole window, anchored to whatever opened it ---------- */

type PickerReq = { x: number; y: number; onPick(emoji: string): void };
const [picker, setPicker] = createSignal<PickerReq | null>(null);

export function openEmojiPicker(anchor: Element, onPick: (emoji: string) => void) {
  const r = anchor.getBoundingClientRect();
  setPicker({ x: r.right, y: r.top, onPick });
}

export function EmojiPicker() {
  return (
    <Show when={picker()}>{(req) => {
      const [q, setQ] = createSignal("");
      const [tab, setTab] = createSignal(0);
      const results = createMemo(() => (q() ? searchEmoji(q(), 80) : null));
      const W = 320, H = 360;
      const left = () => Math.max(8, Math.min(req().x - W, innerWidth - W - 8));
      const top = () => (req().y - H - 8 > 8 ? req().y - H - 8 : Math.min(req().y + 36, innerHeight - H - 8));
      let input!: HTMLInputElement;
      onMount(() => input.focus());
      const pick = (e: string) => { req().onPick(e); setPicker(null); };
      const esc = (e: KeyboardEvent) => e.key === "Escape" && setPicker(null);
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => removeEventListener("keydown", esc));
      return (
        <div class="pop-scrim" onClick={() => setPicker(null)}>
          <div class="emoji-pop panel" style={{ left: `${left()}px`, top: `${Math.max(8, top())}px`, width: `${W}px`, height: `${H}px` }}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Emoji picker">
            <input ref={input} class="emoji-search" placeholder="Find an emoji" value={q()} onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && results()?.[0]) pick(results()![0]!.char); }} aria-label="Search emoji" />
            <Show when={!q()}>
              <div class="emoji-tabs" role="tablist">
                <For each={EMOJI_GROUPS}>{(g, i) => (
                  <button role="tab" aria-selected={tab() === i()} classList={{ on: tab() === i() }} title={g.title} onClick={() => setTab(i())}>{g.items[0]!.char}</button>
                )}</For>
              </div>
            </Show>
            <div class="emoji-grid">
              <For each={results() ?? EMOJI_GROUPS[tab()]!.items}>{(e) => (
                <button title={`:${e.name}:`} onClick={() => pick(e.char)}>{e.char}</button>
              )}</For>
              <Show when={results()?.length === 0}><p class="empty small">No emoji called “{q()}”.</p></Show>
            </div>
          </div>
        </div>
      );
    }}</Show>
  );
}

/* ---------- image lightbox ---------- */

const [shown, setShown] = createSignal<{ url: string; name: string } | null>(null);
export const openLightbox = (url: string, name: string) => setShown({ url, name });

export function Lightbox() {
  const esc = (e: KeyboardEvent) => e.key === "Escape" && setShown(null);
  onMount(() => addEventListener("keydown", esc));
  onCleanup(() => removeEventListener("keydown", esc));
  return (
    <Show when={shown()}>{(s) => (
      <div class="lightbox" onClick={() => setShown(null)} role="dialog" aria-label={s().name}>
        <img src={s().url} alt={s().name} onClick={(e) => e.stopPropagation()} />
        <div class="lb-bar" onClick={(e) => e.stopPropagation()}>
          <span>{s().name}</span>
          <a class="btn small" href={s().url} target="_blank" rel="noopener noreferrer" download={s().name}>Open original</a>
          <button class="icon-btn" onClick={() => setShown(null)} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
      </div>
    )}</Show>
  );
}
