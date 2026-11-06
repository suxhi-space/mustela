import { createMemo, For, Show } from "solid-js";
import { Icon } from "../icons";
import type { EditorApi } from "./Editor";

export const FORMATS = [
  { k: "bold", label: "Bold", icon: "bold", keys: "Ctrl+B", wrap: ["**", "**"] },
  { k: "italic", label: "Italic", icon: "italic", keys: "Ctrl+I", wrap: ["*", "*"] },
  { k: "strike", label: "Strikethrough", icon: "strike", wrap: ["~~", "~~"] },
  { k: "spoiler", label: "Spoiler", icon: "eye-off", wrap: ["||", "||"] },
  { k: "code", label: "Code", icon: "code", wrap: ["`", "`"] },
  { k: "codeblock", label: "Code block", icon: "code-block" },
  { k: "quote", label: "Quote", icon: "quote" },
  { k: "link", label: "Link", icon: "link" },
] as const;
export type FormatKey = (typeof FORMATS)[number]["k"];
type Range = { from: number; to: number };

/** Bold, italic, spoiler… around the selection (the same in the message box and when editing). */
export function applyFormat(ed: EditorApi | undefined, k: FormatKey, s: Range | null) {
  if (!ed) return;
  const f = FORMATS.find((x) => x.k === k)!;
  if ("wrap" in f) { ed.wrap(f.wrap[0], f.wrap[1]); return; }
  if (k === "codeblock" || k === "quote") { ed.block(k); return; }
  // Link: wrap the selection as [text](https://), with the address selected for typing.
  if (!s) return;
  const label = ed.text().slice(s.from, s.to);
  ed.replace(s.from, s.to, `[${label}](https://)`);
  ed.view.dispatch({ selection: { anchor: s.from + label.length + 3, head: s.from + label.length + 11 } });
  ed.focus();
}

/** Ctrl/Cmd+B and I. True when handled. */
export function formatKey(e: KeyboardEvent, ed: EditorApi | undefined, s: Range | null): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (e.key !== "b" && e.key !== "i")) return false;
  e.preventDefault();
  applyFormat(ed, e.key === "b" ? "bold" : "italic", s);
  return true;
}

/**
 * The formatting bar over selected text, inside `host` (which is position: relative). It stays inside the host's
 * width, and drops under the selection when there's no room above (an edit box at the top of the chat).
 */
export function FormatBar(props: { ed: () => EditorApi | undefined; host: () => HTMLElement | undefined; selection: () => Range | null; hidden?: boolean }) {
  const pos = createMemo(() => {
    const s = props.selection(), ed = props.ed(), host = props.host();
    if (!s || !ed || !host || props.hidden) return null;
    const a = ed.view.coordsAtPos(s.from), b = ed.view.coordsAtPos(s.to);
    if (!a || !b) return null;
    const box = host.getBoundingClientRect();
    const half = FORMATS.length * 16 + 6;
    const x = Math.min(a.left, b.left) / 2 + Math.max(a.right, b.right) / 2 - box.left;
    const top = Math.min(a.top, b.top);
    // Room above: inside the scrolling list it sits in (the chat), else the window.
    const clip = host.closest(".messages")?.getBoundingClientRect().top ?? 0;
    const below = top - 46 < clip;
    return { left: Math.max(half, Math.min(Math.max(half, box.width - half), x)), top: (below ? Math.max(a.bottom, b.bottom) : top) - box.top, below };
  });
  return (
    <Show when={pos()}>{(p) => (
      <div class="fmt-bar panel" classList={{ below: p().below }} role="toolbar" aria-label="Formatting" style={{ left: `${p().left}px`, top: `${p().top}px` }} onMouseDown={(e) => e.preventDefault()}>
        <For each={FORMATS}>{(f) => (
          <button type="button" class="icon-btn" aria-label={f.label} title={"keys" in f ? `${f.label} (${f.keys})` : f.label} onClick={() => applyFormat(props.ed(), f.k, props.selection())}><Icon name={f.icon} size={17} /></button>
        )}</For>
      </div>
    )}</Show>
  );
}
