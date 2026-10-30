import { useAutoplay } from "../autoplay";
import { useBack } from "../back";
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { CustomEmoji } from "../../lib/backend/types";
import type { FavGif } from "../../lib/sync/settings";
import { backend, ext, settings, updateExt, updateSettings } from "../store";
import { EMOJI_GROUPS, emojiName, searchEmoji } from "../../lib/emoji";
import { Icon } from "../icons";
import { UEmoji } from "./UEmoji";

const PUA_OF: Record<string, string> = { "fluent-flat": "\uE0E2", mutant: "\uE0E3", noto: "\uE0E4", twemoji: "\uE0E6" };

/* ---------- emoji picker: one instance for the whole window, anchored to whatever opened it ---------- */

/** `text` goes into a message (":id:" for custom emoji); `key` is what a reaction uses. */
export type EmojiPick = { text: string; key: string };
type PickerReq = { x: number; y: number; onPick(p: EmojiPick): void };
const [picker, setPicker] = createSignal<PickerReq | null>(null);

export function openEmojiPicker(anchor: Element, onPick: (p: EmojiPick) => void) {
  const r = anchor.getBoundingClientRect();
  setPicker({ x: r.right, y: r.top, onPick });
}

/** Emoji you use, most used first (this device only, like Discord's "Frequently used"). */
const RECENT_KEY = "mustela:emoji-recent";
function recentCounts(): Record<string, number> { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "{}") ?? {}; } catch { return {}; } }
function noteUse(key: string) {
  try {
    const c = recentCounts(); c[key] = (c[key] ?? 0) + 1;
    const top = Object.entries(c).sort((x, y) => y[1] - x[1]).slice(0, 60);
    localStorage.setItem(RECENT_KEY, JSON.stringify(Object.fromEntries(top)));
  } catch { /* storage off: just don't remember */ }
}
const isCustomKey = (k: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(k);
const toggleFavEmoji = (key: string) => updateExt((x) => ({ ...x, favEmoji: x.favEmoji.includes(key) ? x.favEmoji.filter((k) => k !== key) : [...x.favEmoji, key] }));

/**
 * The emoji picker, like Discord's: one list you scroll through (Favorites, Frequently used, then each of your
 * servers in the order they're on your server list, then the standard groups), with a rail on the side to
 * jump around. Point at an emoji to see its name; star it (or right-click / hold it) to favorite it.
 */
export function EmojiPicker() {
  return (
    <Show when={picker()} keyed>{(req) => {
      useBack(() => setPicker(null));
      const [q, setQ] = createSignal("");
      const [hover, setHover] = createSignal<{ key: string; name: string; render: () => JSX.Element } | null>(null);
      const [active, setActive] = createSignal("fav");
      const custom = createMemo(() => backend()?.emojis() ?? []);
      const [order] = createResource(() => backend(), async (b) => (await b.spaces()).filter((x) => !x.home).map((x) => x.id));
      const servers = createMemo(() => {
        const m = new Map<string, { id: string; name: string; icon?: string; items: CustomEmoji[] }>();
        for (const e of custom()) {
          const g = m.get(e.serverId!) ?? { id: e.serverId!, name: e.serverName ?? "Server", icon: e.serverIcon, items: [] };
          g.items.push(e); m.set(e.serverId!, g);
        }
        const rank = order() ?? [];
        return [...m.values()].sort((x, y) => (rank.indexOf(x.id) + 1 || 1e9) - (rank.indexOf(y.id) + 1 || 1e9));
      });
      const byKey = (k: string) => (isCustomKey(k) ? custom().find((e) => e.id === k) : undefined);
      const favs = createMemo(() => ext().favEmoji.filter((k) => !isCustomKey(k) || byKey(k)));
      const frequent = createMemo(() => Object.entries(recentCounts()).sort((x, y) => y[1] - x[1]).map(([k]) => k).filter((k) => !isCustomKey(k) || byKey(k)).slice(0, 24));
      const results = createMemo(() => {
        const s = q().trim().toLowerCase().replace(/^:|:$/g, "");
        if (!s) return null;
        return { custom: custom().filter((e) => e.name.toLowerCase().includes(s)).slice(0, 60), unicode: searchEmoji(s, 120) };
      });
      const phone = matchMedia("(max-width: 700px)").matches;
      const W = 420, H = 440;
      const left = () => Math.max(8, Math.min(req.x - W, innerWidth - W - 8));
      const top = () => (req.y - H - 8 > 8 ? req.y - H - 8 : Math.min(req.y + 36, innerHeight - H - 8));
      let input!: HTMLInputElement, list!: HTMLDivElement;
      onMount(() => { if (!phone) input.focus(); });
      const pick = (p: EmojiPick) => { noteUse(p.key); req.onPick(p); setPicker(null); };
      const pickKey = (k: string) => { const e = byKey(k); if (e) pick({ text: `:${e.id}:`, key: e.id }); else pickUnicode(k); };
      // Like Stoat: the text carries your pack so other Stoat users see the same art. Reactions stay plain.
      const pickUnicode = (c: string) => pick({ text: `${PUA_OF[settings().emojiPack] ?? ""}${c}`, key: c });
      const esc = (e: KeyboardEvent) => e.key === "Escape" && setPicker(null);
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => removeEventListener("keydown", esc));

      // One button for any emoji: pick on click, favorite on right-click or a long press, name on hover.
      const Btn = (p: { k: string; title: string; render: () => JSX.Element }) => {
        let t: ReturnType<typeof setTimeout> | undefined, held = false;
        return (
          <button title={p.title} classList={{ fav: ext().favEmoji.includes(p.k) }}
            onMouseEnter={() => setHover({ key: p.k, name: p.title, render: p.render })} onFocus={() => setHover({ key: p.k, name: p.title, render: p.render })}
            onClick={() => { if (held) { held = false; return; } pickKey(p.k); }}
            onContextMenu={(e) => { e.preventDefault(); toggleFavEmoji(p.k); }}
            onPointerDown={(e) => { if (e.pointerType !== "touch") return; held = false; t = setTimeout(() => { held = true; toggleFavEmoji(p.k); setHover({ key: p.k, name: p.title, render: p.render }); }, 500); }}
            onPointerUp={() => clearTimeout(t)} onPointerLeave={() => clearTimeout(t)}>{p.render()}</button>
        );
      };
      const uni = (c: string) => () => <UEmoji e={c} />;
      const img = (e: CustomEmoji) => () => <img src={e.url} alt={e.name} loading="lazy" />;
      const titleOf = (k: string) => { const e = byKey(k); return e ? `:${e.name}:` : `:${emojiName(k) ?? "emoji"}:`; };
      const renderOf = (k: string) => { const e = byKey(k); return e ? img(e) : uni(k); };

      const sections = createMemo(() => [
        ...(favs().length ? [{ id: "fav", title: "Favorites", icon: () => <Icon name="star" size={18} />, keys: favs() }] : []),
        ...(frequent().length ? [{ id: "recent", title: "Frequently used", icon: () => <Icon name="clock" size={18} />, keys: frequent() }] : []),
        ...servers().map((g) => ({ id: g.id, title: g.name, icon: () => (g.icon ? <img src={g.icon} alt="" /> : <span class="et-letter">{g.name.slice(0, 1)}</span>), keys: g.items.map((e) => e.id) })),
        ...EMOJI_GROUPS.map((g, i) => ({ id: `u${i}`, title: g.title, icon: () => <UEmoji e={g.items[0]!.char} />, keys: g.items.map((e) => e.char) })),
      ]);
      const jump = (id: string) => { setActive(id); list.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ block: "start" }); };
      const onScroll = () => {
        const top = list.getBoundingClientRect().top;
        let cur = sections()[0]?.id ?? "";
        for (const h of list.querySelectorAll<HTMLElement>("[data-sec]")) { if (h.getBoundingClientRect().top - top <= 8) cur = h.dataset.sec!; else break; }
        if (cur !== active()) setActive(cur);
      };

      return (
        <div class="pop-scrim emoji-scrim" classList={{ sheet: phone }} onClick={() => setPicker(null)}>
          <div class="emoji-pop panel" classList={{ "emoji-sheet": phone }} style={phone ? {} : { left: `${left()}px`, top: `${Math.max(8, top())}px`, width: `${W}px`, height: `${H}px` }}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Emoji picker">
            <div class="emoji-top">
              <input ref={input} class="emoji-search" placeholder="Find the perfect emoji" value={q()} onInput={(e) => setQ(e.currentTarget.value)}
                onKeyDown={(e) => { if (e.key !== "Enter") return; const r = results(); if (r?.custom[0]) pickKey(r.custom[0].id); else if (r?.unicode[0]) pickUnicode(r.unicode[0].char); }} aria-label="Search emoji" />
            </div>
            <div class="emoji-main">
              <Show when={!q()}>
                <nav class="emoji-rail" aria-label="Emoji groups">
                  <For each={sections()}>{(s) => (
                    <button classList={{ on: active() === s.id }} title={s.title} aria-label={s.title} onClick={() => jump(s.id)}>{s.icon()}</button>
                  )}</For>
                </nav>
              </Show>
              <div class="emoji-list" ref={list} onScroll={onScroll}>
                <Show when={results()} fallback={
                  <For each={sections()}>{(s) => (<>
                    <p class="eg-title" data-sec={s.id}>{s.title}</p>
                    <div class="emoji-grid">
                      <For each={s.keys}>{(k) => <Btn k={k} title={titleOf(k)} render={renderOf(k)} />}</For>
                    </div>
                  </>)}</For>
                }>
                  <div class="emoji-grid">
                    <For each={results()!.custom}>{(e) => <Btn k={e.id} title={`:${e.name}:`} render={img(e)} />}</For>
                    <For each={results()!.unicode}>{(e) => <Btn k={e.char} title={`:${e.name}:`} render={uni(e.char)} />}</For>
                    <Show when={!results()!.custom.length && !results()!.unicode.length}><p class="empty small">No emoji called “{q()}”.</p></Show>
                  </div>
                </Show>
              </div>
            </div>
            <footer class="emoji-foot">
              <Show when={hover()} fallback={<span class="muted small">Right-click or hold an emoji to favorite it.</span>}>{(h) => (<>
                <span class="ef-art">{h().render()}</span>
                <span class="ef-name">{h().name}</span>
                <span class="grow" />
                <button class="icon-btn ef-star" classList={{ on: ext().favEmoji.includes(h().key) }} aria-pressed={ext().favEmoji.includes(h().key)}
                  title={ext().favEmoji.includes(h().key) ? "Remove from favorites" : "Add to favorites"} onClick={() => toggleFavEmoji(h().key)}><Icon name="star" size={18} /></button>
              </>)}</Show>
            </footer>
          </div>
        </div>
      );
    }}</Show>
  );
}

/* ---------- GIF picker (Gifbox), with starred favorites that sync through settings ---------- */

type GifReq = { x: number; y: number; onPick(url: string): void };
const [gifReq, setGifReq] = createSignal<GifReq | null>(null);
export function openGifPicker(anchor: Element, onPick: (url: string) => void) {
  const r = anchor.getBoundingClientRect();
  setGifReq({ x: r.right, y: r.top, onPick });
}

export const isFav = (url: string) => settings().favGifs.some((g) => g.url === url);
export function toggleFav(g: FavGif) {
  updateSettings((s) => ({ ...s, favGifs: isFav(g.url) ? s.favGifs.filter((x) => x.url !== g.url) : [g, ...s.favGifs].slice(0, 100) }));
}

function GifTile(props: { g: FavGif; onPick(): void }) {
  // Gifbox previews are webm (often with no file extension). If this system can't play them, show the GIF instead.
  const [failed, setFailed] = createSignal(false);
  const isImage = () => /\.(gif|png|jpe?g|webp)(\?|$)/i.test(props.g.preview);
  const ratio = () => (props.g.w && props.g.h ? `${props.g.w} / ${props.g.h}` : undefined);
  const play = useAutoplay();
  return (
    <div class="gif-tile" style={{ "aspect-ratio": ratio() }}>
      <button class="gif-play" onClick={props.onPick} aria-label="Send GIF">
        <Show when={!isImage() && !failed()} fallback={<img src={failed() ? props.g.still ?? props.g.preview : props.g.preview} alt="" loading="lazy" />}>
          <video ref={play} src={props.g.preview} muted playsinline preload="metadata" onError={() => props.g.still && setFailed(true)} />
        </Show>
      </button>
      <button class="gif-star" classList={{ on: isFav(props.g.url) }} aria-pressed={isFav(props.g.url)} aria-label={isFav(props.g.url) ? "Remove from favorites" : "Add to favorites"}
        onClick={() => toggleFav(props.g)}><Icon name="star" size={16} /></button>
    </div>
  );
}

export function GifPicker() {
  return (
    <Show when={gifReq()}>{(req) => {
      useBack(() => setGifReq(null));
      const [q, setQ] = createSignal("");
      const [deb, setDeb] = createSignal("");
      const [tab, setTab] = createSignal<"fav" | "browse">(settings().favGifs.length ? "fav" : "browse");
      let t: ReturnType<typeof setTimeout> | undefined;
      const [cats] = createResource(() => backend()?.gifCategories().catch(() => []));
      const [found] = createResource(deb, (x) => backend()!.gifs(x).catch(() => null));
      const W = 400, H = 440;
      const left = () => Math.max(8, Math.min(req().x - W, innerWidth - W - 8));
      const top = () => Math.max(8, req().y - H - 8 > 8 ? req().y - H - 8 : innerHeight - H - 8);
      const pick = (url: string) => { req().onPick(url); setGifReq(null); };
      const esc = (e: KeyboardEvent) => e.key === "Escape" && setGifReq(null);
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => { removeEventListener("keydown", esc); clearTimeout(t); });
      const search = (v: string) => { setQ(v); setTab("browse"); clearTimeout(t); t = setTimeout(() => setDeb(v.trim()), 300); };
      return (
        <div class="pop-scrim" onClick={() => setGifReq(null)}>
          <div class="gif-pop panel" style={{ left: `${left()}px`, top: `${top()}px`, width: `${W}px`, height: `${H}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="GIFs">
            <div class="gif-head">
              <Show when={deb()}><button class="icon-btn" aria-label="Back" onClick={() => { setQ(""); setDeb(""); }}><Icon name="back" size={18} /></button></Show>
              <input class="emoji-search" placeholder="Search Gifbox" value={q()} onInput={(e) => search(e.currentTarget.value)} aria-label="Search GIFs" autofocus />
            </div>
            <Show when={!deb()}>
              <div class="seg gif-tabs" role="tablist">
                <button role="tab" classList={{ on: tab() === "fav" }} aria-selected={tab() === "fav"} onClick={() => setTab("fav")}><Icon name="star" size={14} /> Favorites</button>
                <button role="tab" classList={{ on: tab() === "browse" }} aria-selected={tab() === "browse"} onClick={() => setTab("browse")}>Browse</button>
              </div>
            </Show>
            <div class="gif-body">
              <Show when={deb()} fallback={
                <Show when={tab() === "fav"} fallback={
                  <div class="gif-cats">
                    <button class="gif-cat trending" onClick={() => { setQ("trending"); setDeb("trending"); }}><span>Trending</span></button>
                    <For each={cats()}>{(c) => <button class="gif-cat" style={{ "background-image": `url("${c.image.replace(/"/g, "%22")}")` }} onClick={() => { setQ(c.title); setDeb(c.title); }}><span>{c.title}</span></button>}</For>
                    <Show when={cats.state === "ready" && !cats()?.length}><p class="empty small">GIFs come from Gifbox, which is only available on stoat.chat accounts.</p></Show>
                  </div>
                }>
                  <Show when={settings().favGifs.length} fallback={<p class="empty small">Star a GIF to keep it here. Favorites follow your account to every device.</p>}>
                    <div class="gif-grid"><For each={settings().favGifs}>{(g) => <GifTile g={g} onPick={() => pick(g.url)} />}</For></div>
                  </Show>
                </Show>
              }>
                <Show when={!found.loading} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
                  <Show when={found()?.length} fallback={<p class="empty small">{found() === null ? "Couldn't reach Gifbox. Try again in a moment." : `No GIFs for “${deb()}”.`}</p>}>
                    <div class="gif-grid"><For each={found()}>{(g) => <GifTile g={g} onPick={() => pick(g.url)} />}</For></div>
                  </Show>
                </Show>
              </Show>
            </div>
            <p class="gif-credit">Powered by Gifbox</p>
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
    <Show when={shown()}>{(s) => { useBack(() => setShown(null)); return (
      <div class="lightbox" onClick={() => setShown(null)} role="dialog" aria-label={s().name}>
        <img src={s().url} alt={s().name} onClick={(e) => e.stopPropagation()} />
        <div class="lb-bar" onClick={(e) => e.stopPropagation()}>
          <span>{s().name}</span>
          <a class="btn small" href={s().url} target="_blank" rel="noopener noreferrer" download={s().name}>Open original</a>
          <button class="icon-btn" onClick={() => setShown(null)} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
      </div>
    ); }}</Show>
  );
}
