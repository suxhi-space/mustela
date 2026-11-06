import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { Person } from "../../lib/backend/types";
import { filterValue, typingFilter } from "../../lib/searchQuery";
import { Avatar } from "../Avatar";
import { Icon } from "../icons";
import { TextWithEmoji } from "./EmojiText";
import { clearSearchHistory, searchHistory } from "./searchState";

/** The filters, as Discord's search box lists them when you click into it. */
const OPTIONS: { key: string; title: string; hint: string; icon: string }[] = [
  { key: "from", title: "From a specific user", hint: "user", icon: "user" },
  { key: "has", title: "Includes a specific type of data", hint: "link, file or media", icon: "link" },
  { key: "mentions", title: "Mentions a specific user", hint: "user", icon: "at" },
];

type Item = { label: JSX.Element; text: string; key: string; section?: string };
const TITLES: Record<string, string> = { from: "From user", mentions: "Mentions user", has: "Includes", authortype: "Author type" };

/**
 * Suggestions under a search box, like Discord's: with nothing typed, the filters you can use (from:, mentions:,
 * has:, before:/during:/after:, authorType:); while typing one, what can go in it (people, link/file/media, days).
 * Picking one writes it into the box. Arrow keys and Enter work, and Escape closes it.
 */
export function SearchSuggest(props: { input: () => HTMLInputElement | undefined; value: () => string; setValue: (v: string) => void; people: () => Person[]; onMore?: () => void;
  /** Run a search (the "Search for …" row and History); with it, recent searches are listed. */
  onSearch?: (q: string) => void }) {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(-1);
  const [pickDate, setPickDate] = createSignal(false);

  const typing = createMemo(() => typingFilter(props.value()));
  const items = createMemo<Item[]>(() => {
    const t = typing();
    if (!t) {
      const v = props.value().trim();
      return [
        ...(v && props.onSearch ? [{ key: "search", text: v, label: <><Icon name="search" size={18} /><span class="ss-for">Search for <b>{v}</b></span></> }] : []),
        ...OPTIONS.map((o) => ({ key: o.key, section: "Filters", text: `${o.key}:`, label: <><Icon name={o.icon} size={18} /><span class="ss-two"><b>{o.title}</b><small><b>{o.key}:</b> {o.hint}</small></span></> })),
        ...(props.onMore ? [{ key: "more", section: "Filters", text: "", label: <><Icon name="gear" size={18} /><span class="ss-two"><b>More filters</b><small>dates, author type and more</small></span></> }] : []),
        ...(props.onSearch && !v ? searchHistory().map((h) => ({ key: `h:${h}`, section: "History", text: h, label: <><Icon name="search" size={16} /><span class="ss-hist">{h}</span></> })) : []),
      ];
    }
    const v = t.value.toLowerCase();
    if (t.key === "from" || t.key === "mentions") {
      return props.people().filter((p) => !v || p.name.toLowerCase().includes(v) || p.username?.toLowerCase().includes(v)).slice(0, 8)
        .map((p) => ({ key: p.id, text: `${t.key}:${filterValue(p.name)}`, label: <><Avatar person={p} size={22} presence={false} still /><span><TextWithEmoji v={p.name} /></span><Show when={p.username}><span class="muted">{p.username}</span></Show></> }));
    }
    if (t.key === "has") return ["link", "file", "media"].filter((x) => x.startsWith(v)).map((x) => ({ key: x, text: `has:${x}`, label: <><Icon name={x === "link" ? "link" : x === "file" ? "file" : "image"} size={16} /><span>{x}</span></> }));
    if (t.key === "authortype") return ["user", "bot"].filter((x) => x.startsWith(v)).map((x) => ({ key: x, text: `authorType:${x}`, label: <><Icon name={x === "bot" ? "bot" : "user"} size={16} /><span>{x}</span></> }));
    return ["today", "yesterday"].filter((x) => x.startsWith(v)).map((x) => ({ key: x, text: `${t.key}:${x}`, label: <><Icon name="clock" size={16} /><span>{x}</span></> }));
  });
  const isDate = () => { const k = typing()?.key; return k === "before" || k === "after" || k === "during" || k === "on"; };

  /** Put a suggestion in the box: a whole filter replaces the one being typed; a bare "from:" starts one. */
  const pick = (it: Item) => {
    if (it.key === "more" && !it.text) { setOpen(false); props.onMore?.(); return; }
    if (it.key === "search" || it.key.startsWith("h:")) { props.setValue(it.text); setOpen(false); props.onSearch?.(it.text); return; }
    const t = typing(), v = props.value();
    const base = t ? v.slice(0, t.start) : v.replace(/\s*$/, v.trim() ? " " : "");
    const done = it.text.endsWith(":") ? it.text : `${it.text} `;
    props.setValue(`${base}${done}`);
    setActive(-1);
    setPickDate(false);
    const el = props.input();
    if (el) { el.focus(); queueMicrotask(() => { el.selectionStart = el.selectionEnd = el.value.length; }); }
  };
  const pickDay = (iso: string) => pick({ key: iso, text: `${typing()?.key ?? "during"}:${iso}`, label: null });

  createEffect(() => {
    const el = props.input();
    if (!el) return;
    const focus = () => setOpen(true);
    const blur = () => setTimeout(() => { if (document.activeElement !== el && !document.activeElement?.closest(".ss-pop")) setOpen(false); }, 120);
    const key = (e: KeyboardEvent) => {
      if (!open()) return;
      const n = items().length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); setActive((active() + 1) % n); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); setActive((active() - 1 + n) % n); }
      else if ((e.key === "Enter" || e.key === "Tab") && active() >= 0 && items()[active()]) { e.preventDefault(); e.stopPropagation(); pick(items()[active()]!); }
      else if (e.key === "Tab" && typing() && n === 1) { e.preventDefault(); pick(items()[0]!); }
      else if (e.key === "Escape") { setOpen(false); }
      // Searching (Enter with nothing picked) puts the list away; typing again brings it back.
      else if (e.key === "Enter") setOpen(false);
    };
    const typed = () => setOpen(true);
    el.addEventListener("focus", focus);
    el.addEventListener("blur", blur);
    el.addEventListener("keydown", key, true);
    el.addEventListener("input", typed);
    onCleanup(() => { el.removeEventListener("focus", focus); el.removeEventListener("blur", blur); el.removeEventListener("keydown", key, true); el.removeEventListener("input", typed); });
  });
  createEffect(() => { props.value(); setActive(-1); });

  return (
    <Show when={open() && (items().length || isDate())}>
      <div class="ss-pop panel" role="listbox" onMouseDown={(e) => e.preventDefault()}>
        <Show when={typing()}><p class="ss-title">{isDate() ? "Pick a day" : TITLES[typing()!.key] ?? `${typing()!.key}:`}</p></Show>
        <For each={items()}>{(it, i) => (<>
          <Show when={it.section && it.section !== items()[i() - 1]?.section}>
            <p class="ss-title" classList={{ "ss-sep": i() > 0 }}>{it.section}
              <Show when={it.section === "History"}><button type="button" class="icon-btn ss-clear" aria-label="Clear search history" title="Clear history" onClick={clearSearchHistory}><Icon name="trash" size={15} /></button></Show>
            </p>
          </Show>
          <button type="button" role="option" class="ss-item" classList={{ on: active() === i() }} aria-selected={active() === i()}
            onMouseEnter={() => setActive(i())} onClick={() => pick(it)}>{it.label}</button>
        </>)}</For>
        <Show when={isDate()}>
          <Show when={pickDate()} fallback={<button type="button" class="ss-item" onClick={() => setPickDate(true)}><Icon name="clock" size={16} /><span>Another day…</span></button>}>
            <input class="ss-date" type="date" max={new Date().toISOString().slice(0, 10)} aria-label="Day" onInput={(e) => e.currentTarget.value && pickDay(e.currentTarget.value)} />
          </Show>
        </Show>
      </div>
    </Show>
  );
}
