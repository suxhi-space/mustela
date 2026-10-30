import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useBack } from "./back";
import { Icon } from "./icons";

/**
 * Crop a picture before it's used: square for avatars; for banners the whole picture that's
 * published (Stoat shows most of it), with the middle 3:1 band Mustela's cards show marked. Drag to move, scroll or pinch (or the slider) to zoom. GIFs can skip
 * cropping to keep animating.
 */
export interface CropRequest { file: File; aspect: number; outW: number; title: string; resolve(f: File | null): void }

/** The picture part of a published banner: 960×448, above the profile strip (see backend saveProfile). */
const BANNER_ASPECT = 960 / 448;
const [req, setReq] = createSignal<CropRequest | null>(null);
export function cropImage(file: File, kind: "avatar" | "banner"): Promise<File | null> {
  return new Promise((resolve) => setReq({ file, aspect: kind === "avatar" ? 1 : BANNER_ASPECT, outW: kind === "avatar" ? 512 : 960, title: kind === "avatar" ? "Crop your avatar" : "Crop your banner", resolve }));
}

export function CropperHost() {
  return <Show when={req()}>{(r) => <Cropper r={r()} done={(f) => { r().resolve(f); setReq(null); }} />}</Show>;
}

function Cropper(props: { r: CropRequest; done(f: File | null): void }) {
  useBack(() => props.done(null));
  const url = URL.createObjectURL(props.r.file);
  onCleanup(() => URL.revokeObjectURL(url));
  const gif = props.r.file.type === "image/gif";
  let box!: HTMLDivElement, img!: HTMLImageElement;
  const [nat, setNat] = createSignal({ w: 1, h: 1 });
  const [view, setView] = createSignal({ w: 1, h: 1 });
  // Zoom 1 = the picture just covers the crop box. Offsets are in box pixels from centred.
  const [zoom, setZoom] = createSignal(1);
  const [off, setOff] = createSignal({ x: 0, y: 0 });
  const cover = () => Math.max(view().w / nat().w, view().h / nat().h);
  const scale = () => cover() * zoom();
  /** Keeps the picture covering the box: no empty edges. */
  const clamp = (o: { x: number; y: number }, z = zoom()) => {
    const s = cover() * z;
    const mx = Math.max(0, (nat().w * s - view().w) / 2), my = Math.max(0, (nat().h * s - view().h) / 2);
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
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
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
          <div ref={box} class="crop-box" classList={{ round: props.r.aspect === 1 }} style={{ "aspect-ratio": String(props.r.aspect) }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onWheel={(e) => { e.preventDefault(); setZ(zoom() * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }}>
            <Show when={props.r.aspect === BANNER_ASPECT}><div class="crop-band" style={{ height: `${(320 / 448) * 100}%` }} /></Show>
            <img ref={img} src={url} alt="" draggable={false} onLoad={() => { setNat({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 }); setOff({ x: 0, y: 0 }); }}
              style={{ width: `${nat().w * scale()}px`, height: `${nat().h * scale()}px`, transform: `translate(calc(-50% + ${off().x}px), calc(-50% + ${off().y}px))` }} />
          </div>
        </div>
        <label class="crop-zoom"><Icon name="image" size={14} /><input type="range" min={1} max={5} step={0.01} value={zoom()} aria-label="Zoom" onInput={(e) => setZ(+e.currentTarget.value)} /><Icon name="image" size={20} /></label>
        <Show when={props.r.aspect !== 1}><p class="muted small">Stoat shows most of this picture. Mustela's cards show the band between the lines.</p></Show>
        <div class="dialog-actions">
          <Show when={gif}><button class="btn ghost" title="Keep the GIF moving (cropping makes it a still picture)" onClick={() => props.done(props.r.file)}>Use without cropping</button></Show>
          <button class="btn" onClick={() => props.done(null)}>Cancel</button>
          <button class="btn primary" onClick={() => void apply()}>Apply</button>
        </div>
      </div>
    </div>
  );
}
