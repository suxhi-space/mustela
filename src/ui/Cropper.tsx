import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useBack } from "./back";
import { Icon } from "./icons";

/**
 * Crop a picture before it's used: square for avatars; for banners the whole picture that's
 * published (Stoat shows most of it), with the middle 3:1 band Mustela's cards show marked. Drag to move, scroll or pinch (or the slider) to zoom. GIFs can skip
 * cropping to keep animating.
 */
export interface CropRequest { file: File; aspect: number; outW: number; title: string; round: boolean; resolve(f: File | null): void }

/** The picture part of a published banner: 960×448, above the profile strip (see backend saveProfile). */
const BANNER_ASPECT = 960 / 448;
/** The part of a banner Mustela's cards show: the middle 320 of its 448 rows (3:1). */
const BAND = 320 / 448;
const [req, setReq] = createSignal<CropRequest | null>(null);
/** A server's banner, shown across the top of its channel list (16:9, like Discord's). */
const SERVER_BANNER_ASPECT = 16 / 9;
export function cropImage(file: File, kind: "avatar" | "banner" | "icon" | "server-icon" | "server-banner", title?: string): Promise<File | null> {
  // Role (and other small) icons: square, kept small, like Stoat shows them. Server icons: square, rounded corners.
  const aspect = kind === "banner" ? BANNER_ASPECT : kind === "server-banner" ? SERVER_BANNER_ASPECT : 1;
  const outW = kind === "icon" ? 128 : kind === "avatar" || kind === "server-icon" ? 512 : 960;
  const name = { avatar: "Crop your avatar", icon: "Crop the icon", banner: "Crop your banner", "server-icon": "Crop the server icon", "server-banner": "Crop the server banner" }[kind];
  return new Promise((resolve) => setReq({ file, aspect, outW, title: title ?? name, round: kind === "avatar", resolve }));
}

export function CropperHost() {
  return <Show when={req()}>{(r) => <Cropper r={r()} done={(f) => { r().resolve(f); setReq(null); }} />}</Show>;
}

function Cropper(props: { r: CropRequest; done(f: File | null): void }) {
  useBack(() => props.done(null));
  // Esc cancels on a computer, like every other window.
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); props.done(null); } };
  onMount(() => addEventListener("keydown", esc, true));
  onCleanup(() => removeEventListener("keydown", esc, true));
  const url = URL.createObjectURL(props.r.file);
  onCleanup(() => URL.revokeObjectURL(url));
  const gif = props.r.file.type === "image/gif";
  let box!: HTMLDivElement, img!: HTMLImageElement;
  const [nat, setNat] = createSignal({ w: 1, h: 1 });
  const [view, setView] = createSignal({ w: 1, h: 1 });
  // Zoom 1 = the picture just covers the crop box. Offsets are in box pixels from centred.
  const [zoom, setZoom] = createSignal(1);
  const [off, setOff] = createSignal({ x: 0, y: 0 });
  /**
   * Banners: the picture only has to fill the band between the lines (what Mustela's cards show), so it can be moved
   * all the way up or down: its top or bottom edge can sit inside the band. What's left above and below the band
   * (only Stoat shows that part) gets a soft blurred copy of the picture when it's saved.
   */
  const isBanner = props.r.aspect === BANNER_ASPECT;
  const fillH = () => (isBanner ? view().h * BAND : view().h);
  const cover = () => Math.max(view().w / nat().w, fillH() / nat().h);
  const scale = () => cover() * zoom();
  /** Keeps the picture covering the box (banners: the band): no empty edges where it shows. */
  const clamp = (o: { x: number; y: number }, z = zoom()) => {
    const s = cover() * z;
    const mx = Math.max(0, (nat().w * s - view().w) / 2), my = Math.max(0, (nat().h * s - fillH()) / 2);
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  const setZ = (z: number) => { const nz = Math.max(1, Math.min(5, z)); setZoom(nz); setOff(clamp(off(), nz)); };

  onMount(() => {
    const ro = new ResizeObserver(() => { const r = box.getBoundingClientRect(); setView({ w: r.width, h: r.height }); setOff(clamp(off())); });
    ro.observe(box);
    onCleanup(() => ro.disconnect());
  });

  let drag: { x: number; y: number; o: { x: number; y: number } } | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; z: number } | null = null;
  const down = (e: PointerEvent) => {
    box.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: zoom() }; drag = null; }
    else drag = { x: e.clientX, y: e.clientY, o: off() };
  };
  const move = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) { const [a, b] = [...pointers.values()]; setZ(pinch.z * Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.d); return; }
    if (drag) setOff(clamp({ x: drag.o.x + e.clientX - drag.x, y: drag.o.y + e.clientY - drag.y }));
  };
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = null; };

  async function apply() {
    const s = scale();
    // The crop box in the picture's own pixels.
    const sw = view().w / s, sh = view().h / s;
    const sx = (nat().w - sw) / 2 - off().x / s, sy = (nat().h - sh) / 2 - off().y / s;
    const W = props.r.outW, H = Math.round(W / props.r.aspect);
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    // Moved past an edge (banners only): the space the picture doesn't reach gets a blurred copy of it first.
    if (sx < 0 || sy < 0 || sx + sw > nat().w || sy + sh > nat().h) {
      const c = Math.max(W / nat().w, H / nat().h);
      ctx.save(); ctx.filter = "blur(28px) brightness(.85)";
      ctx.drawImage(img, (W - nat().w * c) / 2 - 40, (H - nat().h * c) / 2 - 40, nat().w * c + 80, nat().h * c + 80);
      ctx.restore();
    }
    // Only the part of the picture inside the crop (drawing past its edges isn't reliable everywhere).
    const ix = Math.max(0, sx), iy = Math.max(0, sy), ix2 = Math.min(nat().w, sx + sw), iy2 = Math.min(nat().h, sy + sh);
    const k = W / sw;
    if (ix2 > ix && iy2 > iy) ctx.drawImage(img, ix, iy, ix2 - ix, iy2 - iy, (ix - sx) * k, (iy - sy) * k, (ix2 - ix) * k, (iy2 - iy) * k);
    const type = props.r.file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, type, 0.92));
    if (!blob) return props.done(props.r.file);
    props.done(new File([blob], props.r.file.name.replace(/\.[^.]+$/, type === "image/png" ? ".png" : ".jpg"), { type }));
  }

  return (
    <div class="scrim" style={{ "z-index": 96 }} onClick={(e) => e.target === e.currentTarget && props.done(null)}>
      <div class="modal cropper" role="dialog" aria-label={props.r.title}>
        <h2>{props.r.title}</h2>
        <div class="crop-stage">
          <div ref={box} class="crop-box" classList={{ round: props.r.round, squircle: props.r.aspect === 1 && !props.r.round }} style={{ "aspect-ratio": String(props.r.aspect) }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onWheel={(e) => { e.preventDefault(); setZ(zoom() * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }}>
            <Show when={props.r.aspect === BANNER_ASPECT}><div class="crop-band" style={{ height: `${BAND * 100}%` }} /></Show>
            {/* Banners: what fills the space the picture doesn't reach once it's moved past an edge (saved the same way) */}
            <Show when={isBanner}><img class="crop-bg" src={url} alt="" draggable={false} aria-hidden="true" /></Show>
            <img ref={img} src={url} alt="" draggable={false} onLoad={() => { setNat({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 }); setOff({ x: 0, y: 0 }); }}
              style={{ width: `${nat().w * scale()}px`, height: `${nat().h * scale()}px`, transform: `translate(calc(-50% + ${off().x}px), calc(-50% + ${off().y}px))` }} />
          </div>
        </div>
        <label class="crop-zoom"><Icon name="image" size={14} /><input type="range" min={1} max={5} step={0.01} value={zoom()} aria-label="Zoom" onInput={(e) => setZ(+e.currentTarget.value)} /><Icon name="image" size={20} /></label>
        <Show when={props.r.aspect === BANNER_ASPECT}><p class="muted small">Stoat shows most of this picture. Mustela's cards show the band between the lines.</p></Show>
        <div class="dialog-actions">
          <Show when={gif}><button class="btn ghost" title="Keep the GIF moving (cropping makes it a still picture)" onClick={() => props.done(props.r.file)}>Use without cropping</button></Show>
          <button class="btn" onClick={() => props.done(null)}>Cancel</button>
          <button class="btn primary" onClick={() => void apply()}>Apply</button>
        </div>
      </div>
    </div>
  );
}
