import { MOBILE_UI } from "../target";
import { useAutoplay } from "../autoplay";
import { phoneLayout } from "../hooks";
import { useBack } from "../back";
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { CustomEmoji } from "../../lib/backend/types";
import type { FavGif } from "../../lib/sync/settings";
import { backend, ext, settings, updateExt, updateSettings } from "../store";
import { EMOJI_GROUPS, emojiName, searchEmoji, warmEmoji } from "../../lib/emoji";
import { Icon } from "../icons";
import { UEmoji } from "./UEmoji";
import { SheetTop, useExprSheet } from "./ExprSheet";
import { savedGif, syncFavGifs } from "../../lib/gifStore";
import { toast } from "../menu";

const PUA_OF: Record<string, string> = { "fluent-flat": "\uE0E2", mutant: "\uE0E3", noto: "\uE0E4", twemoji: "\uE0E6" };

/* ---------- emoji picker: one instance for the whole window, anchored to whatever opened it ---------- */

/** `text` goes into a message (":id:" for custom emoji); `key` is what a reaction uses. */
export type EmojiPick = { text: string; key: string };
/** `gif`: also offer the GIFs tab (phones), picking with this. */
type PickerReq = { x: number; y: number; onPick(p: EmojiPick): void; gif?: (url: string) => void; /** phones: stay open to pick several */ stay?: boolean };
const [picker, setPicker] = createSignal<PickerReq | null>(null);

export function openEmojiPicker(anchor: Element, onPick: (p: EmojiPick) => void, more: { gif?: (url: string) => void; stay?: boolean } = {}) {
  const r = anchor.getBoundingClientRect();
  setPicker({ x: r.right, y: r.top, onPick, gif: more.gif, stay: more.stay });
}

/** Whether the emoji or GIF picker is open (phones swap the message box's emoji button for a keyboard then). */
export const exprOpen = () => !!picker() || !!gifReq();
export function closeExpr() { setPicker(null); setGifReq(null); }

/** Emoji you use, most used first (this device only, like Discord's "Frequently used"). */
const RECENT_KEY = "mustela:emoji-recent";
/**
 * In the background, load the emoji you're most likely to see (your favorites and frequent ones, the quick
 * reactions, the first picker section) so they show in your style straight away. Called once at start-up and
 * whenever the picker opens.
 */
/** Save favorite GIFs on this device (and forget removed ones). Called at start-up and when the GIF picker opens. */
export function warmFavGifs() {
  const favs = settings().favGifs;
  syncFavGifs([...new Set(favs.flatMap((g) => [g.preview, ...(g.still ? [g.still] : [])]))]);
}

export function warmLikelyEmoji() {
  const isUni = (k: string) => !isCustomKey(k);
  const frequent = Object.entries(recentCounts()).sort((x, y) => y[1] - x[1]).map(([k]) => k).filter(isUni).slice(0, 40);
  const favs = ext().favEmoji.filter(isUni);
  warmEmoji(settings().emojiPack, [...new Set([...favs, ...frequent, "👍", "❤️", "😂", "😮", "😢", "🔥", ...EMOJI_GROUPS[0]!.items.slice(0, 96).map((e) => e.char)])]);
}

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
      const phone = phoneLayout();
      const sheet = phone ? useExprSheet(() => setPicker(null)) : null;
      const toGif = req.gif ? () => { const g = req.gif!; setPicker(null); setGifReq({ x: req.x, y: req.y, onPick: g, emoji: req.onPick }); } : undefined;
      const W = 420, H = 460;
      const left = () => Math.max(8, Math.min(req.x - W, innerWidth - W - 8));
      const top = () => (req.y - H - 8 > 8 ? req.y - H - 8 : Math.min(req.y + 36, innerHeight - H - 8));
      let input!: HTMLInputElement, list!: HTMLDivElement;
      onMount(() => { if (!phone) input.focus(); warmLikelyEmoji(); });
      // Phones, picking into the message box: the card stays for more (like Discord), back at half height if it was pulled up.
      const pick = (p: EmojiPick) => { noteUse(p.key); req.onPick(p); if (sheet && req.stay) sheet.collapse(); else setPicker(null); };
      const pickKey = (k: string) => { const e = byKey(k); if (e) pick({ text: `:${e.id}:`, key: e.id }); else pickUnicode(k); };
      // Like Stoat: the text carries your pack so other Stoat users see the same art. Reactions stay plain.
      const pickUnicode = (c: string) => pick({ text: `${PUA_OF[settings().emojiPack] ?? ""}${c}`, key: c });
      const esc = (e: KeyboardEvent) => e.key === "Escape" && setPicker(null);
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => removeEventListener("keydown", esc));

      // One button for any emoji: pick on click, favorite on right-click or a long press, name on hover.
      const Btn = (p: { k: string; title: string; render: () => JSX.Element }) => {
        // A hold (still) favorites it; moving the finger means scrolling or dragging the card, so the hold is off.
        let t: ReturnType<typeof setTimeout> | undefined, held = false, sx: number | null = null, sy = 0;
        return (
          <button title={p.title} classList={{ fav: ext().favEmoji.includes(p.k) }}
            onMouseEnter={() => setHover({ key: p.k, name: p.title, render: p.render })} onFocus={() => setHover({ key: p.k, name: p.title, render: p.render })}
            onClick={() => { if (held) { held = false; return; } pickKey(p.k); }}
            onContextMenu={(e) => { e.preventDefault(); toggleFavEmoji(p.k); }}
            onPointerMove={(e) => { if (e.pointerType === "touch" && sx !== null && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) { clearTimeout(t); sx = null; } }}
            onPointerDown={(e) => { if (e.pointerType !== "touch") return; held = false; sx = e.clientX; sy = e.clientY; t = setTimeout(() => {
              held = true; const was = ext().favEmoji.includes(p.k); toggleFavEmoji(p.k); setHover({ key: p.k, name: p.title, render: p.render });
              if (phone) { navigator.vibrate?.(15); toast(was ? `${p.title} removed from favorites` : `${p.title} added to favorites`); }
            }, 500); }}
            onPointerUp={() => clearTimeout(t)} onPointerLeave={() => clearTimeout(t)} onPointerCancel={() => clearTimeout(t)}>{p.render()}</button>
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
      // Jumping: every section above the one you picked is filled in first (they start as placeholders), then the list
      // lines it up and keeps it lined up for a moment while pictures settle, with your pick highlighted throughout.
      const [upTo, setUpTo] = createSignal(-1);
      let jumpUntil = 0;
      const jump = (id: string) => {
        const idx = sections().findIndex((x) => x.id === id);
        setActive(id);
        if (idx > upTo()) setUpTo(idx);
        jumpUntil = performance.now() + 450;
        const align = () => {
          const h = list.querySelector<HTMLElement>(`[data-sec="${id}"]`);
          if (h) list.scrollTop += h.getBoundingClientRect().top - list.getBoundingClientRect().top;
          if (performance.now() < jumpUntil) requestAnimationFrame(align);
        };
        align();
      };
      let scrollQueued = false;
      const onScroll = () => {
        if (scrollQueued || performance.now() < jumpUntil) return;
        scrollQueued = true;
        requestAnimationFrame(() => {
          scrollQueued = false;
          const top = list.getBoundingClientRect().top;
          let cur = sections()[0]?.id ?? "";
          for (const h of list.querySelectorAll<HTMLElement>("[data-sec]")) { if (h.getBoundingClientRect().top - top <= 8) cur = h.dataset.sec!; else break; }
          if (cur !== active()) setActive(cur);
        });
      };

      return (
        <div class="pop-scrim emoji-scrim" classList={{ sheet: phone, "xs-scrim": phone }} onClick={() => setPicker(null)}>
          <div class="emoji-pop panel" ref={(el) => sheet?.bind(el)} classList={{ "emoji-sheet": phone, "xs-dragging": !!sheet?.dragging() }} style={sheet ? { height: `${sheet.height()}px` } : { left: `${left()}px`, top: `${Math.max(8, top())}px`, width: `${W}px`, height: `${H}px` }}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Emoji picker">
            <SheetTop tab="emoji" toGif={toGif} toEmoji={toGif && (() => {})} grip={sheet?.grip} />
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
                  <For each={sections()}>{(s, i) => (<>
                    <p class="eg-title" data-sec={s.id}>{s.title}</p>
                    <LazyGrid count={s.keys.length} root={list} now={i() <= upTo()}>
                      <For each={s.keys}>{(k) => <Btn k={k} title={titleOf(k)} render={renderOf(k)} />}</For>
                    </LazyGrid>
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

type GifReq = { x: number; y: number; onPick(url: string): void; emoji?: (p: EmojiPick) => void };
const [gifReq, setGifReq] = createSignal<GifReq | null>(null);
export function openGifPicker(anchor: Element, onPick: (url: string) => void, more: { emoji?: (p: EmojiPick) => void } = {}) {
  const r = anchor.getBoundingClientRect();
  setGifReq({ x: r.right, y: r.top, onPick, emoji: more.emoji });
}

export const isFav = (url: string) => settings().favGifs.some((g) => g.url === url);
export function toggleFav(g: FavGif) {
  updateSettings((s) => ({ ...s, favGifs: isFav(g.url) ? s.favGifs.filter((x) => x.url !== g.url) : [g, ...s.favGifs].slice(0, 100) }));
  warmFavGifs();
}

function GifTile(props: { g: FavGif; onPick(): void; saved?: boolean }) {
  // Gifbox previews are webm (often with no file extension). If this system can't play them, show the GIF instead.
  const [failed, setFailed] = createSignal(false);
  // Favorites come from the copy kept on this device (lib/gifStore.ts); if that's missing, from the web as usual.
  const [local, setLocal] = createSignal(!!props.saved);
  const src = (u: string) => (local() ? savedGif(u) : u);
  // Phones and tablets show the small animated GIF instead of a video per tile: a phone can only decode a few videos
  // at once, so a screen of video tiles queued up and took ages to appear. (Computers keep the lighter video.)
  const isImage = () => /\.(gif|png|jpe?g|webp)(\?|$)/i.test(props.g.preview) || (MOBILE_UI && !!props.g.still);
  const ratio = () => (props.g.w && props.g.h ? `${props.g.w} / ${props.g.h}` : undefined);
  const play = useAutoplay();
  return (
    <div class="gif-tile" style={{ "aspect-ratio": ratio() }}>
      <button class="gif-play" onClick={props.onPick} aria-label="Send GIF">
        <Show when={!isImage() && !failed()} fallback={<img src={src(failed() || (MOBILE_UI && props.g.still) ? props.g.still ?? props.g.preview : props.g.preview)} alt="" loading="lazy" decoding="async" onError={() => local() && setLocal(false)} />}>
          <video ref={play} src={src(props.g.preview)} muted playsinline preload="metadata" onError={() => { if (local()) setLocal(false); else if (props.g.still) setFailed(true); }} />
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
      const [cats, { refetch: refetchCats }] = createResource(() => backend()?.gifCategories().catch(() => []));
      const [found, { refetch: refetchFound }] = createResource(deb, (x) => backend()!.gifs(x).catch(() => null));
      const phone = phoneLayout();
      const sheet = phone ? useExprSheet(() => setGifReq(null)) : null;
      const toEmoji = req().emoji ? () => { const r = req(); setGifReq(null); setPicker({ x: r.x, y: r.y, onPick: r.emoji!, gif: r.onPick, stay: true }); } : undefined;
      const W = 420, H = 460;
      const left = () => Math.max(8, Math.min(req().x - W, innerWidth - W - 8));
      const top = () => Math.max(8, req().y - H - 8 > 8 ? req().y - H - 8 : innerHeight - H - 8);
      const pick = (url: string) => { req().onPick(url); setGifReq(null); };
      onMount(warmFavGifs);
      const esc = (e: KeyboardEvent) => e.key === "Escape" && setGifReq(null);
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => { removeEventListener("keydown", esc); clearTimeout(t); });
      const search = (v: string) => { setQ(v); setTab("browse"); clearTimeout(t); t = setTimeout(() => setDeb(v.trim()), 300); };
      return (
        <div class="pop-scrim" classList={{ "xs-scrim": phone }} onClick={() => setGifReq(null)}>
          <div class="gif-pop panel" ref={(el) => sheet?.bind(el)} classList={{ "gif-sheet": phone, "xs-dragging": !!sheet?.dragging() }} style={sheet ? { height: `${sheet.height()}px` } : { left: `${left()}px`, top: `${top()}px`, width: `${W}px`, height: `${H}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="GIFs">
            <SheetTop tab="gif" toEmoji={toEmoji} toGif={toEmoji && (() => {})} grip={sheet?.grip} />
            <div class="gif-head">
              <Show when={deb()}><button class="icon-btn" aria-label="Back" onClick={() => { setQ(""); setDeb(""); }}><Icon name="back" size={18} /></button></Show>
              <input class="emoji-search" placeholder="Search Gifbox" value={q()} onInput={(e) => search(e.currentTarget.value)} aria-label="Search GIFs" autofocus={!phone} />
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
                    <Show when={cats.state === "ready" && !cats()?.length}><p class="empty small">No GIF categories came back. GIFs come from Gifbox, which is only on stoat.chat accounts. <button class="link" onClick={() => void refetchCats()}>Try again</button></p></Show>
                  </div>
                }>
                  <Show when={settings().favGifs.length} fallback={<p class="empty small">Star a GIF to keep it here. Favorites follow your account to every device.</p>}>
                    <div class="gif-grid"><For each={settings().favGifs}>{(g) => <GifTile g={g} saved onPick={() => pick(g.url)} />}</For></div>
                  </Show>
                </Show>
              }>
                <Show when={!found.loading} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
                  <Show when={found()?.length} fallback={<div class="empty small">{found() === null ? <>Couldn't reach Gifbox. <button class="link" onClick={() => void refetchFound()}>Try again</button></> : `No GIFs for “${deb()}”.`}</div>}>
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

/* ---------- pictures shown big: see Gallery.tsx ---------- */

export { Lightbox, openGallery, openLightbox } from "./Gallery";

/**
 * A section of the emoji picker, built only when you scroll near it (or jump past it): building all ~1,900 buttons
 * made the picker slow to open and kept the phone busy afterwards. 8 across, so each one's height is known
 * beforehand and jumping to a section lands in the right place.
 */
function LazyGrid(props: { count: number; root: HTMLElement | undefined; now?: boolean; children: JSX.Element }) {
  const [seen, setShow] = createSignal(false);
  const show = () => seen() || !!props.now;
  let el!: HTMLDivElement;
  onMount(() => {
    let done = false;
    // Drawn when it comes near (a screen or so ahead), not all in the background after opening: filling in every
    // section kept the phone busy for a second or more after the card opened, which felt like lag.
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { done = true; setShow(true); io.disconnect(); } }, { root: props.root ?? null, rootMargin: "700px 0px" });
    io.observe(el);
    onCleanup(() => { done = true; io.disconnect(); });
  });
  return (
    <div ref={el} class="emoji-grid" style={show() ? undefined : { "aspect-ratio": `8 / ${Math.ceil(props.count / 8)}` }}>
      <Show when={show()}>{props.children}</Show>
    </div>
  );
}
