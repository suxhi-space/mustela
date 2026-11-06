import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { Person } from "../../lib/backend/types";
import { fmtStamp } from "../../lib/time";
import { zoomNow } from "../appSize";
import { Avatar, NameText } from "../Avatar";
import { useBack } from "../back";
import { Icon } from "../icons";
import { copy, toast } from "../menu";
import { platform } from "../store";
import { MOBILE_UI } from "../target";

/**
 * Pictures and videos shown big, like a phone's gallery: black screen, swipe sideways between them, pinch or
 * double-tap to zoom (wheel on a computer), tap to hide the bars, pull down to close. Who sent it sits at the
 * bottom with a strip of the others; the ⋮ menu saves, shares, opens it in the browser or finds it in the chat.
 */
export type GalleryItem = { url: string; name: string; spoiler?: boolean; video?: boolean; preview?: string; from?: Person; at?: Date; locate?: () => void;
  /** An embedded player (YouTube) shown instead of a video file; `url` is then its page. */
  frame?: string;
  /** Where to start the video (carrying on from the chat). */
  start?: number };

const [items, setItems] = createSignal<GalleryItem[]>([]);
const [index, setIndex] = createSignal(0);
// Spoilers stay covered until tapped; the one you opened counts as tapped.
const [shownSpoilers, setShownSpoilers] = createSignal(new Set<string>());
const hidden = (it: GalleryItem) => !!it.spoiler && !shownSpoilers().has(it.url);
const reveal = (it: GalleryItem) => setShownSpoilers((s) => new Set(s).add(it.url));

export function openGallery(list: GalleryItem[], at = 0) {
  if (!list.length) return;
  const i = Math.max(0, Math.min(list.length - 1, at));
  setShownSpoilers(new Set([list[i]!.url]));
  setIndex(i);
  setItems(list);
}
/** One picture (or video). `locate` adds "Show in chat". */
export const openLightbox = (url: string, name: string, more?: Omit<GalleryItem, "url" | "name">) => openGallery([{ url, name, ...more }]);

const close = () => setItems([]);

async function save(it: GalleryItem) {
  if (platform === "android") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:mustela-native|media_file", { payload: { url: it.url, name: it.name, share: false } });
      toast("Saving to Downloads…");
    } catch { toast("Couldn't save it.", true); }
    return;
  }
  try {
    const blob = await (await fetch(it.url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = it.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch { openOutside(it.url); }
}

async function share(it: GalleryItem) {
  if (platform === "android") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:mustela-native|media_file", { payload: { url: it.url, name: it.name, share: true } });
      return;
    } catch { /* fall through to copying the link */ }
  }
  if (navigator.share) { try { await navigator.share({ url: it.url, title: it.name }); return; } catch { return; } }
  void copy(it.url, "Link copied");
}

async function openOutside(url: string) {
  try {
    if ("__TAURI_INTERNALS__" in globalThis) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); }
    else window.open(url, "_blank", "noopener");
  } catch { window.open(url, "_blank", "noopener"); }
}

export function Lightbox() {
  return <Show when={items().length}><GalleryView /></Show>;
}

function GalleryView() {
  useBack(close);
  const [chrome, setChrome] = createSignal(true);
  const [menu, setMenu] = createSignal(false);
  // Zoom of the picture in view, and how far it's moved (app pixels).
  const [scale, setScale] = createSignal(1);
  const [pan, setPan] = createSignal({ x: 0, y: 0 });
  // Finger drag while not zoomed: sideways moves between pictures, down closes.
  const [drag, setDrag] = createSignal({ x: 0, y: 0 });
  const [animate, setAnimate] = createSignal(false);
  let strip: HTMLDivElement | undefined;

  const cur = () => items()[index()];
  const many = () => items().length > 1;
  const resetZoom = () => { setScale(1); setPan({ x: 0, y: 0 }); };
  const go = (to: number) => {
    if (to < 0 || to >= items().length) return;
    setAnimate(true); setIndex(to); resetZoom(); setMenu(false);
  };
  createEffect(on(index, (i) => strip?.children[i]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })));

  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); menu() ? setMenu(false) : close(); }
    else if (e.key === "ArrowRight") go(index() + 1);
    else if (e.key === "ArrowLeft") go(index() - 1);
  };
  onMount(() => addEventListener("keydown", key, true));
  onCleanup(() => removeEventListener("keydown", key, true));

  /* ---- touch and mouse ---- */
  const pts = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; t: number } | null = null;
  let pinch: { d: number; s: number; mx: number; my: number; px: number; py: number } | null = null;
  let panFrom: { x: number; y: number; px: number; py: number } | null = null;
  let mode: "" | "side" | "down" | "pan" = "";
  let lastTap = 0, tapTimer: ReturnType<typeof setTimeout> | undefined;
  let moved = false;
  let onPicture = false; // where the press started (after capture, the release always lands on the stage)

  let stageEl: HTMLDivElement | undefined;
  let clickedStage = 0;
  /** Whether a point is on the picture itself, not the empty space a fitted picture or video leaves around it. */
  const onContent = (el: HTMLImageElement | HTMLVideoElement, e: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    // The player's controls run along the whole bottom of the video, beside the picture too.
    if (el instanceof HTMLVideoElement && e.clientY > r.bottom - 64 && e.clientY <= r.bottom) return true;
    const iw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth, ih = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!iw || !ih) return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const k = Math.min(r.width / iw, r.height / ih), w = iw * k, h = ih * k;
    const x = r.left + (r.width - w) / 2, y = r.top + (r.height - h) / 2;
    return e.clientX >= x && e.clientX <= x + w && e.clientY >= y && e.clientY <= y + h;
  };
  // The picture's area: the whole screen on phones, the window's middle on computers.
  const area = () => {
    const r = stageEl?.getBoundingClientRect();
    return r && !MOBILE_UI ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : { x: innerWidth / 2, y: innerHeight / 2, w: innerWidth, h: innerHeight };
  };
  const center = () => area();
  const clampPan = (p: { x: number; y: number }, s = scale()) => {
    const z = zoomNow(), a = area();
    const mx = (a.w / z) * (s - 1) / 2, my = (a.h / z) * (s - 1) / 2;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  };
  /** Zoom to `s`, keeping the screen point (cx, cy) where it is. */
  const zoomAt = (s: number, cx: number, cy: number, from = { s: scale(), p: pan() }) => {
    s = Math.max(1, Math.min(5, s));
    const z = zoomNow(), c = center();
    const ox = (cx - c.x) / z, oy = (cy - c.y) / z;
    const k = s / from.s;
    setScale(s);
    setPan(s === 1 ? { x: 0, y: 0 } : clampPan({ x: ox - (ox - from.p.x) * k, y: oy - (oy - from.p.y) * k }, s));
  };

  const down = (e: PointerEvent) => {
    const t = e.target as Element;
    if (t.closest("iframe, .gv-spoiler, .gv-top, .gv-bottom, .gv-side, .gv-menu")) return;
    // A video's player is its own (play, seek, volume); only the black space beside the picture is the background.
    if (t instanceof HTMLVideoElement && onContent(t, e)) return;
    onPicture = t instanceof HTMLImageElement && !!t.closest(".gv-slide") && onContent(t, e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimate(false);
    moved = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale(), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, px: pan().x, py: pan().y };
      setDrag({ x: 0, y: 0 }); mode = ""; moved = true;
    } else if (pts.size === 1) {
      start = { x: e.clientX, y: e.clientY, t: Date.now() };
      panFrom = { x: e.clientX, y: e.clientY, px: pan().x, py: pan().y };
      mode = "";
    }
  };
  const move = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const z = zoomNow();
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      zoomAt(pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.d), pinch.mx, pinch.my, { s: pinch.s, p: { x: pinch.px, y: pinch.py } });
      // …and follow the fingers as they move together.
      setPan((p) => scale() === 1 ? p : clampPan({ x: p.x + (mx - pinch!.mx) / z, y: p.y + (my - pinch!.my) / z }));
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      moved = true;
      mode = scale() > 1 ? "pan" : Math.abs(dx) > Math.abs(dy) ? "side" : dy > 0 ? "down" : "";
      if (!mode) { start = null; return; }
    }
    if (mode === "pan" && panFrom) setPan(clampPan({ x: panFrom.px + dx / z, y: panFrom.py + dy / z }));
    else if (mode === "side") setDrag({ x: (index() === 0 && dx > 0) || (index() === items().length - 1 && dx < 0) ? dx / 3 : dx, y: 0 });
    else if (mode === "down") setDrag({ x: 0, y: Math.max(0, dy) });
  };
  const up = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    clickedStage = Date.now();
    pts.delete(e.pointerId);
    if (pts.size >= 1) { // one finger lifted from a pinch: carry on panning with the other
      pinch = null;
      const [p] = [...pts.values()] as [{ x: number; y: number }];
      start = { x: p.x, y: p.y, t: Date.now() }; panFrom = { x: p.x, y: p.y, px: pan().x, py: pan().y }; mode = scale() > 1 ? "pan" : "";
      return;
    }
    pinch = null;
    const d = drag(), dt = Math.max(1, Date.now() - (start?.t ?? 0));
    setAnimate(true);
    if (mode === "side") {
      const w = area().w, fast = Math.abs(d.x) / dt > 0.4;
      if ((d.x < -w * 0.2 || (fast && d.x < -30)) && index() < items().length - 1) go(index() + 1);
      else if ((d.x > w * 0.2 || (fast && d.x > 30)) && index() > 0) go(index() - 1);
    } else if (mode === "down" && (d.y > innerHeight * 0.18 || d.y / dt > 0.5)) { close(); return; }
    setDrag({ x: 0, y: 0 });
    if (!moved && start && !MOBILE_UI && !onPicture) { close(); return; } // computers: clicking around the picture closes
    if (!moved && start) {
      // Two quick taps zoom in (or back out); one tap shows or hides the bars.
      const now = Date.now();
      if (now - lastTap < 280 && !cur()?.video) {
        clearTimeout(tapTimer); lastTap = 0;
        scale() > 1 ? resetZoom() : zoomAt(2.5, e.clientX, e.clientY);
      } else {
        lastTap = now;
        if (MOBILE_UI) tapTimer = setTimeout(() => { setChrome((c) => !c); setMenu(false); }, 280);
      }
    }
    start = null; mode = "";
  };
  const wheel = (e: WheelEvent) => {
    if (cur()?.video) return;
    e.preventDefault(); setAnimate(false);
    zoomAt(scale() * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  };
  onCleanup(() => clearTimeout(tapTimer));

  const fade = () => Math.max(0.25, 1 - drag().y / (innerHeight * 0.6));
  const z = () => zoomNow();

  const moreBtn = () => <button class="gv-btn gv-more" onClick={() => setMenu((m) => !m)} aria-label="More" aria-expanded={menu()}><Icon name="dots" size={MOBILE_UI ? 24 : 20} /></button>;
  const menuView = () => (
    <Show when={menu() && cur()}>{(it) => (
      <>
        <div class="gv-menu-scrim" onClick={() => setMenu(false)} />
        <div class="gv-menu" role="menu">
            <Show when={!it().frame}><button role="menuitem" onClick={() => { setMenu(false); void save(it()); }}><Icon name="download" size={20} />Save</button></Show>
            <button role="menuitem" onClick={() => { setMenu(false); void share(it()); }}><Icon name="popout" size={20} />Share</button>
            <button role="menuitem" onClick={() => { setMenu(false); void openOutside(it().url); }}><Icon name="globe" size={20} />Open in browser</button>
            <Show when={it().locate}>{(loc) => <button role="menuitem" onClick={() => { close(); loc()(); }}><Icon name="chat" size={20} />Show in chat</button>}</Show>
        </div>
      </>
    )}</Show>
  );

  return (
    <div class="gallery-view" classList={{ bare: !chrome(), desk: !MOBILE_UI }} role="dialog" aria-label={cur()?.name ?? "Picture"}
      style={MOBILE_UI ? { "background-color": `rgba(0,0,0,${fade()})` } : undefined}
      onClick={(e) => {
        // Computers: a click anywhere but the picture, a button or the sender's name closes (the stage handles its own).
        if (MOBILE_UI || Date.now() - clickedStage < 400) return;
        if ((e.target as Element).closest(".gv-stage, button, a, input, .gv-menu, .gv-who, .avatar, img, video, iframe")) return;
        close();
      }}>
      {/* Computers: the picture over the dimmed app, about the size of the full profile; click around it to close. Phones: full screen. */}
      <div class="gv-window">
      <div class="gv-stage" ref={stageEl} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <div class="gv-track" classList={{ animate: animate() }}
          style={{ transform: `translate(calc(${-index() * 100}% + ${drag().x / z()}px), ${drag().y / z()}px)` }}>
          <For each={items()}>{(it, i) => (
            <div class="gv-slide" style={{ left: `${i() * 100}%` }}>
              <Show when={Math.abs(i() - index()) <= 1 && hidden(it)}>
                <button class="gv-spoiler" onClick={() => reveal(it)}><Icon name="eye" size={28} /><span>Spoiler</span><small>Tap to show</small></button>
              </Show>
              <Show when={Math.abs(i() - index()) <= 1 && !hidden(it)}>
                <Show when={it.video} fallback={
                  <img src={it.url} alt={it.name} draggable={false}
                    style={i() === index() ? { transform: `translate(${pan().x}px, ${pan().y}px) scale(${scale()})` } : undefined}
                    classList={{ animate: animate() }} />
                }>
                  <Show when={it.frame} fallback={
                    <video src={it.url} poster={it.preview} controls playsinline autoplay={i() === index()} ref={(v) => { if (it.start) v.currentTime = it.start; }} />
                  }>{(f) => <iframe class="gv-frame" src={i() === index() ? f() : undefined} title={it.name} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerPolicy="strict-origin-when-cross-origin" />}</Show>
                </Show>
              </Show>
            </div>
          )}</For>
        </div>
      </div>

      <div class="gv-top">
        <button class="gv-btn" onClick={close} aria-label="Close"><Icon name="close" size={24} /></button>
        <Show when={MOBILE_UI && many()}><span class="gv-count">{index() + 1} / {items().length}</span></Show>
        <Show when={MOBILE_UI}>{moreBtn()}</Show>
      </div>
      <Show when={MOBILE_UI}>{menuView()}</Show>


      <Show when={many() && index() > 0}><button class="gv-side prev" onClick={() => go(index() - 1)} aria-label="Previous"><Icon name="back" size={26} /></button></Show>
      <Show when={many() && index() < items().length - 1}><button class="gv-side next" onClick={() => go(index() + 1)} aria-label="Next"><Icon name="right" size={26} /></button></Show>

      <div class="gv-bottom">
        <Show when={cur()?.from || !MOBILE_UI}>
          <div class="gv-info">
            <Show when={cur()?.from} fallback={<span class="gv-who"><span>{cur()?.name}</span><Show when={!MOBILE_UI && many()}><small>{index() + 1} / {items().length}</small></Show></span>}>{(p) => (
              <>
                <Avatar person={p()} size={36} presence={false} still />
                <span class="gv-who"><NameText person={p()} />
                  <Show when={MOBILE_UI} fallback={<small class="gv-file">{cur()?.name}<Show when={many()}> · {index() + 1} / {items().length}</Show><Show when={cur()?.at}>{(at) => <> · {fmtStamp(at())}</>}</Show></small>}>
                    <Show when={cur()?.at}>{(at) => <small>{fmtStamp(at())}</small>}</Show>
                  </Show>
                </span>
              </>
            )}</Show>
            <Show when={cur()?.locate}>{(loc) => <button class="gv-locate" onClick={() => { close(); loc()(); }}><Icon name="chat" size={16} />Show in chat</button>}</Show>
            <Show when={!MOBILE_UI && cur()}>{(it) => <button class="gv-locate" onClick={() => void openOutside(it().url)}><Icon name="globe" size={16} />View original</button>}</Show>
            <Show when={!MOBILE_UI}>{moreBtn()}{menuView()}</Show>
          </div>
        </Show>
        <Show when={many()}>
          <div class="gv-strip" ref={strip}>
            <For each={items()}>{(it, i) => (
              <button class="gv-thumb" classList={{ on: i() === index(), spoiled: hidden(it) }} onClick={() => go(i())} aria-label={it.name}>
                <Show when={!it.video || it.preview} fallback={<Icon name="video" size={18} />}><img src={it.preview ?? it.url} alt="" loading="lazy" /></Show>
              </button>
            )}</For>
          </div>
        </Show>
      </div>
      </div>
    </div>
  );
}
