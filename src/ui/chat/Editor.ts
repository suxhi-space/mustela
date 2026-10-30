/**
 * The message box's text editor (CodeMirror 6, the same editor Stoat's own client uses).
 *
 * The text is plain Stoat markdown, so what you see is exactly what's sent. Mentions,
 * #channels, roles, custom emoji and message links are shown as chips: each one is a
 * single uneditable piece, so the caret and Backspace treat it like one character.
 */
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder as cmPlaceholder, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { CHIP_RE, codeSpans } from "./complete";
export { CHIP_RE, codeSpans };

/** What the editor needs to draw a chip. Looked up at draw time, so names stay current. */
export interface ChipLookup {
  user(id: string): { name: string; colour?: string } | undefined;
  channel(id: string): string | undefined;
  role(id: string): { name: string; colour?: string } | undefined;
  emoji(id: string): { name: string; url: string } | undefined;
  /** "#channel › message" for a message link that points into this instance, else undefined */
  messageLink(url: string): string | undefined;
}

class ChipWidget extends WidgetType {
  constructor(readonly kind: "user" | "channel" | "role" | "emoji" | "link", readonly label: string, readonly colour?: string, readonly img?: string) { super(); }
  eq(o: ChipWidget) { return o.kind === this.kind && o.label === this.label && o.colour === this.colour && o.img === this.img; }
  toDOM() {
    if (this.kind === "emoji" && this.img) {
      const i = document.createElement("img");
      i.className = "cemoji ed-emoji";
      i.src = this.img;
      i.alt = this.label;
      i.draggable = false;
      return i;
    }
    const s = document.createElement("span");
    s.className = `ed-chip ed-${this.kind}`;
    s.textContent = this.label;
    if (this.colour && !this.colour.includes("gradient")) s.style.setProperty("--chip", this.colour);
    return s;
  }
  ignoreEvent() { return false; }
}

function chipDecorations(view: EditorView, look: ChipLookup): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    // Nothing is a chip inside `code` or ```code blocks```, like in sent messages.
    const code = codeSpans(view.state.doc.toString());
    CHIP_RE.lastIndex = 0;
    for (const m of text.matchAll(CHIP_RE)) {
      const start = from + m.index!, end = start + m[0].length;
      if (code.some(([a, z]) => start < z && end > a)) continue;
      let w: ChipWidget | null = null;
      if (m[1]) { const u = look.user(m[1]); w = new ChipWidget("user", `@${u?.name ?? "unknown"}`, u?.colour); }
      else if (m[2]) w = new ChipWidget("channel", `#${look.channel(m[2]) ?? "unknown"}`);
      else if (m[3]) { const r = look.role(m[3]); w = new ChipWidget("role", `@${r?.name ?? "role"}`, r?.colour); }
      else if (m[4]) { const e = look.emoji(m[4]); if (e) w = new ChipWidget("emoji", `:${e.name}:`, undefined, e.url); }
      else if (m[5]) { const l = look.messageLink(m[5]); if (l) w = new ChipWidget("link", l); }
      if (w) b.add(start, end, Decoration.replace({ widget: w }));
    }
  }
  return b.finish();
}

export interface EditorHandlers {
  /** Return true when the key was handled (Enter to send, ↑ to edit, Esc, autocomplete keys). */
  onKey(e: KeyboardEvent): boolean;
  onChange(text: string): void;
  onCaret(pos: number): void;
  onSelection(range: { from: number; to: number } | null): void;
  onPasteFiles(files: File[]): void;
  onFocus?(): void;
}

export interface EditorApi {
  view: EditorView;
  text(): string;
  setText(text: string): void;
  focus(): void;
  caret(): number;
  /** Replaces [from, to) and puts the caret after the new text. */
  replace(from: number, to: number, insert: string): void;
  insertAtCaret(insert: string): void;
  /** Wraps the selection in markers (or removes them if already wrapped). */
  wrap(before: string, after?: string): void;
  /** Turns each selected line into a quote, or the selection into a code block. */
  block(kind: "quote" | "codeblock"): void;
  setPlaceholder(p: string): void;
  /** Redraw chips (after names load). */
  refresh(): void;
  destroy(): void;
}

export function createEditor(parent: HTMLElement, opts: { text: string; placeholder: string; label: string; look: ChipLookup; on: EditorHandlers }): EditorApi {
  const ph = new Compartment();
  let lookTick = 0;
  const chips = ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    tick = lookTick;
    constructor(view: EditorView) { this.decorations = chipDecorations(view, opts.look); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || this.tick !== lookTick) { this.tick = lookTick; this.decorations = chipDecorations(u.view, opts.look); }
    }
  }, {
    decorations: (v) => v.decorations,
    // Chips are atomic: the caret jumps over them and Backspace removes the whole thing.
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
  });

  const extensions: Extension[] = [
    history(),
    EditorView.lineWrapping,
    ph.of(cmPlaceholder(opts.placeholder)),
    EditorView.contentAttributes.of({ "aria-label": opts.label, "aria-multiline": "true", role: "textbox", spellcheck: "true", autocapitalize: "sentences", autocorrect: "on" }),
    chips,
    EditorView.domEventHandlers({
      keydown: (e) => opts.on.onKey(e),
      paste: (e) => {
        const files = [...(e.clipboardData?.files ?? [])];
        if (files.length) { e.preventDefault(); opts.on.onPasteFiles(files); return true; }
        return false;
      },
      focus: () => { opts.on.onFocus?.(); return false; },
    }),
    keymap.of([...historyKeymap, ...defaultKeymap]),
    EditorState.transactionFilter.of((tr) => {
      // Messages are capped at 2000 characters by Stoat; leave room for a long paste to be trimmed by the user.
      return tr.newDoc.length > 4000 ? [] : tr;
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.on.onChange(u.state.doc.toString());
      if (u.selectionSet || u.docChanged) {
        const s = u.state.selection.main;
        opts.on.onCaret(s.head);
        opts.on.onSelection(s.empty ? null : { from: s.from, to: s.to });
      }
      if (u.focusChanged && !u.view.hasFocus) opts.on.onSelection(null);
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: opts.text, extensions }) });

  const api: EditorApi = {
    view,
    text: () => view.state.doc.toString(),
    setText(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(text.length) });
    },
    focus: () => view.focus(),
    caret: () => view.state.selection.main.head,
    replace(from, to, insert) {
      view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), scrollIntoView: true });
    },
    insertAtCaret(insert) {
      const s = view.state.selection.main;
      api.replace(s.from, s.to, insert);
    },
    wrap(before, after = before) {
      const { state } = view;
      view.dispatch(state.changeByRange((r) => {
        const inner = state.sliceDoc(r.from, r.to);
        const outerFrom = r.from - before.length, outerTo = r.to + after.length;
        // Already wrapped (markers just outside the selection): unwrap.
        if (outerFrom >= 0 && state.sliceDoc(outerFrom, r.from) === before && state.sliceDoc(r.to, outerTo) === after) {
          return { changes: [{ from: outerFrom, to: r.from }, { from: r.to, to: outerTo }], range: EditorSelection.range(outerFrom, r.to - before.length) };
        }
        if (inner.startsWith(before) && inner.endsWith(after) && inner.length >= before.length + after.length) {
          return { changes: { from: r.from, to: r.to, insert: inner.slice(before.length, inner.length - after.length) }, range: EditorSelection.range(r.from, r.to - before.length - after.length) };
        }
        return { changes: [{ from: r.from, insert: before }, { from: r.to, insert: after }], range: EditorSelection.range(r.from + before.length, r.to + before.length) };
      }));
      view.focus();
    },
    block(kind) {
      const { state } = view;
      const r = state.selection.main;
      if (kind === "codeblock") {
        const inner = state.sliceDoc(r.from, r.to);
        const lead = r.from > 0 && state.sliceDoc(r.from - 1, r.from) !== "\n" ? "\n" : "";
        const insert = `${lead}\`\`\`\n${inner}\n\`\`\`\n`;
        view.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: EditorSelection.cursor(r.from + lead.length + 4 + inner.length) });
      } else {
        const first = state.doc.lineAt(r.from).number, last = state.doc.lineAt(r.to).number;
        const lines = Array.from({ length: last - first + 1 }, (_, i) => state.doc.line(first + i));
        const quoted = lines.every((l) => l.text.startsWith("> "));
        view.dispatch({ changes: lines.map((l) => (quoted ? { from: l.from, to: l.from + 2 } : { from: l.from, insert: "> " })) });
      }
      view.focus();
    },
    setPlaceholder(p) { view.dispatch({ effects: ph.reconfigure(cmPlaceholder(p)) }); },
    refresh() { lookTick++; view.dispatch({}); },
    destroy: () => view.destroy(),
  };
  return api;
}
