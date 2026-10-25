import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { CustomEmoji } from "../../lib/backend/types";
import type { FavGif } from "../../lib/sync/settings";
import { backend, settings, updateSettings } from "../store";
import { EMOJI_GROUPS, searchEmoji } from "../../lib/emoji";
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

export function EmojiPicker() {
  return (
    <Show when={picker()}>{(req) => {
      const [q, setQ] = createSignal("");
      const [tab, setTab] = createSignal<string>("0");
      const custom = createMemo(() => backend()?.emojis() ?? []);
      const servers = createMemo(() => {
        const m = new Map<string, { id: string; name: string; icon?: string; items: CustomEmoji[] }>();
        for (const e of custom()) {
          const g = m.get(e.serverId!) ?? { id: e.serverId!, name: e.serverName ?? "Server", icon: e.serverIcon, items: [] };
          g.items.push(e); m.set(e.serverId!, g);
        }
        return [...m.values()];
      });
      const results = createMemo(() => {
        const s = q().trim().toLowerCase().replace(/^:/, "");
        if (!s) return null;
        return {
          custom: custom().filter((e) => e.name.toLowerCase().includes(s)).slice(0, 40),
          unicode: searchEmoji(s, 80),
        };
      });
      const W = 340, H = 380;
      const left = () => Math.max(8, Math.min(req().x - W, innerWidth - W - 8));
      const top = () => (req().y - H - 8 > 8 ? req().y - H - 8 : Math.min(req().y + 36, innerHeight - H - 8));
      let input!: HTMLInputElement;
      onMount(() => input.focus());
      const pick = (p: EmojiPick) => { req().onPick(p); setPicker(null); };
      const pickCustom = (e: CustomEmoji) => pick({ text: `:${e.id}:`, key: e.id });
      // Like Stoat: the text carries your pack so other Stoat users see the same art. Reactions stay plain.
      const pickUnicode = (c: string) => pick({ text: `${PUA_OF[settings().emojiPack] ?? ""}${c}`, key: c });
      const esc = (e: KeyboardEvent) => e.key === "Escape" && setPicker(null);
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => removeEventListener("keydown", esc));
      const group = () => servers().find((g) => g.id === tab());
      return (
        <div class="pop-scrim" onClick={() => setPicker(null)}>
          <div class="emoji-pop panel" style={{ left: `${left()}px`, top: `${Math.max(8, top())}px`, width: `${W}px`, height: `${H}px` }}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Emoji picker">
            <input ref={input} class="emoji-search" placeholder="Find an emoji" value={q()} onInput={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key !== "Enter") return; const r = results(); if (r?.custom[0]) pickCustom(r.custom[0]); else if (r?.unicode[0]) pickUnicode(r.unicode[0].char); }} aria-label="Search emoji" />
            <Show when={!q()}>
              <div class="emoji-tabs" role="tablist">
                <For each={servers()}>{(g) => (
                  <button role="tab" aria-selected={tab() === g.id} classList={{ on: tab() === g.id }} title={g.name} onClick={() => setTab(g.id)}>
                    <Show when={g.icon} fallback={<span class="et-letter">{g.name.slice(0, 1)}</span>}><img src={g.icon} alt="" /></Show>
                  </button>
                )}</For>
                <For each={EMOJI_GROUPS}>{(g, i) => (
                  <button role="tab" aria-selected={tab() === String(i())} classList={{ on: tab() === String(i()) }} title={g.title} onClick={() => setTab(String(i()))}>{g.items[0]!.char}</button>
                )}</For>
              </div>
            </Show>
            <div class="emoji-grid">
              <Show when={results()} fallback={
                <Show when={group()} fallback={<For each={EMOJI_GROUPS[Number(tab())]?.items ?? []}>{(e) => <button title={`:${e.name}:`} onClick={() => pickUnicode(e.char)}><UEmoji e={e.char} /></button>}</For>}>
                  <p class="eg-title">{group()!.name}</p>
                  <For each={group()!.items}>{(e) => <button title={`:${e.name}:`} onClick={() => pickCustom(e)}><img src={e.url} alt={e.name} loading="lazy" /></button>}</For>
                </Show>
              }>
                <For each={results()!.custom}>{(e) => <button title={`:${e.name}: (${e.serverName})`} onClick={() => pickCustom(e)}><img src={e.url} alt={e.name} loading="lazy" /></button>}</For>
                <For each={results()!.unicode}>{(e) => <button title={`:${e.name}:`} onClick={() => pickUnicode(e.char)}><UEmoji e={e.char} /></button>}</For>
                <Show when={!results()!.custom.length && !results()!.unicode.length}><p class="empty small">No emoji called “{q()}”.</p></Show>
              </Show>
            </div>
          </div>
        </div>
      );
    }}</Show>
  );
}

/* ---------- GIF picker (Gifbox), with starred favourites that sync through settings ---------- */

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
  return (
    <div class="gif-tile" style={{ "aspect-ratio": ratio() }}>
      <button class="gif-play" onClick={props.onPick} aria-label="Send GIF">
        <Show when={!isImage() && !failed()} fallback={<img src={failed() ? props.g.still ?? props.g.preview : props.g.preview} alt="" loading="lazy" />}>
          <video src={props.g.preview} autoplay loop muted playsinline preload="auto" onError={() => props.g.still && setFailed(true)} />
        </Show>
      </button>
      <button class="gif-star" classList={{ on: isFav(props.g.url) }} aria-pressed={isFav(props.g.url)} aria-label={isFav(props.g.url) ? "Remove from favourites" : "Add to favourites"}
        onClick={() => toggleFav(props.g)}><Icon name="star" size={16} /></button>
    </div>
  );
}

export function GifPicker() {
  return (
    <Show when={gifReq()}>{(req) => {
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
                <button role="tab" classList={{ on: tab() === "fav" }} aria-selected={tab() === "fav"} onClick={() => setTab("fav")}><Icon name="star" size={14} /> Favourites</button>
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
                  <Show when={settings().favGifs.length} fallback={<p class="empty small">Star a GIF to keep it here. Favourites follow your account to every device.</p>}>
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
