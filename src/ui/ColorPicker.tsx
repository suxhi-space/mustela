import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "./icons";

/**
 * Mustela's own colour picker: a shade square, a hue bar, a hex box and a few quick colours, with
 * Cancel and Apply. Nothing is saved until Apply, so dragging around doesn't send a change per pixel
 * (which servers reject when it's too many, too fast). On phones it comes up from the bottom.
 */

type Open = { x: number; y: number; value: string; title?: string; apply(hex: string): void };
const [state, setState] = createSignal<Open | null>(null);

/** Opens the picker under `anchor`. `apply` gets the colour once you press Apply. */
export function openColorPicker(anchor: Element, value: string, apply: (hex: string) => void, title?: string) {
  const r = anchor.getBoundingClientRect();
  setState({ x: r.left, y: r.bottom + 6, value: /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#5865f2", title, apply });
}

const QUICK = ["#ef5b5b", "#f57731", "#f0b232", "#3fbf72", "#2bb3c0", "#5b8cf0", "#5865f2", "#a77bf3", "#e86fb4", "#9aa3b2", "#ffffff", "#1b1b1f"];

function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}
function hsvToHex(h: number, s: number, v: number) {
  const f = (k: number) => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return "#" + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
}

/** Put once near the app's root. */
export function ColorPickerHost() {
  return <Show when={state()} keyed>{(o) => <Picker o={o} />}</Show>;
}

function Picker(props: { o: Open }) {
  const [hsv, setHsv] = createSignal(hexToHsv(props.o.value));
  const [text, setText] = createSignal(props.o.value);
  const hex = () => hsvToHex(...hsv());
  const set = (h: number, s: number, v: number) => { setHsv([h, s, v]); setText(hsvToHex(h, s, v)); };
  const close = () => setState(null);
  const apply = () => { props.o.apply(hex()); close(); };
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ left: props.o.x, top: props.o.y });
  const sheet = matchMedia("(max-width: 700px)").matches;
  onMount(() => {
    if (sheet) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(innerWidth - r.width - 8, props.o.x)), top: props.o.y + r.height > innerHeight - 8 ? Math.max(8, props.o.y - r.height - 40) : props.o.y });
    el.querySelector<HTMLElement>(".cp-sv")?.focus();
  });
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); if (e.key === "Enter") apply(); };
  addEventListener("keydown", esc); onCleanup(() => removeEventListener("keydown", esc));

  // Drag on the shade square or the hue bar.
  const drag = (area: HTMLElement, onMove: (fx: number, fy: number) => void) => (e: PointerEvent) => {
    area.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent) => { const r = area.getBoundingClientRect(); onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))); };
    at(e);
    const mv = (ev: PointerEvent) => at(ev);
    const up = () => { area.removeEventListener("pointermove", mv); area.removeEventListener("pointerup", up); };
    area.addEventListener("pointermove", mv); area.addEventListener("pointerup", up);
  };
  let sv!: HTMLDivElement, hue!: HTMLDivElement;
  const keysSv = (e: KeyboardEvent) => {
    const [h, s, v] = hsv(), st = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") set(h, Math.max(0, s - st), v); else if (e.key === "ArrowRight") set(h, Math.min(1, s + st), v);
    else if (e.key === "ArrowUp") set(h, s, Math.min(1, v + st)); else if (e.key === "ArrowDown") set(h, s, Math.max(0, v - st)); else return;
    e.preventDefault();
  };

  return (
    <Portal>
      <div class="cp-scrim" classList={{ sheet }} onClick={close}>
        <div ref={el} class="cp panel" classList={{ "cp-sheet": sheet }} role="dialog" aria-label={props.o.title ?? "Pick a colour"} onClick={(e) => e.stopPropagation()}
          style={sheet ? {} : { left: `${pos().left}px`, top: `${pos().top}px` }}>
          <Show when={props.o.title}><h3 class="cp-title">{props.o.title}</h3></Show>
          <div ref={sv} class="cp-sv" tabIndex={0} role="slider" aria-label="Shade" aria-valuetext={hex()} style={{ "--h": String(hsv()[0]) }}
            onPointerDown={(e) => drag(sv, (fx, fy) => set(hsv()[0], fx, 1 - fy))(e)} onKeyDown={keysSv}>
            <i class="cp-knob" style={{ left: `${hsv()[1] * 100}%`, top: `${(1 - hsv()[2]) * 100}%`, background: hex() }} />
          </div>
          <div ref={hue} class="cp-hue" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(hsv()[0])}
            onPointerDown={(e) => drag(hue, (fx) => set(fx * 359, hsv()[1], hsv()[2]))(e)}
            onKeyDown={(e) => { const d = e.key === "ArrowLeft" ? -5 : e.key === "ArrowRight" ? 5 : 0; if (d) { e.preventDefault(); set((hsv()[0] + d + 360) % 360, hsv()[1], hsv()[2]); } }}>
            <i class="cp-knob" style={{ left: `${(hsv()[0] / 359) * 100}%`, background: `hsl(${hsv()[0]} 100% 50%)` }} />
          </div>
          <div class="cp-row">
            <span class="cp-now" style={{ background: hex() }} />
            <input class="text-input cp-hex" value={text()} maxLength={7} aria-label="Hex colour" spellcheck={false}
              onInput={(e) => { const v = e.currentTarget.value.trim(); setText(v); const m = /^#?([0-9a-f]{6})$/i.exec(v); if (m) setHsv(hexToHsv(`#${m[1]!.toLowerCase()}`)); }} />
          </div>
          <div class="cp-quick">
            <For each={QUICK}>{(c) => <button style={{ background: c }} aria-label={c} classList={{ on: hex() === c }} onClick={() => { setHsv(hexToHsv(c)); setText(c); }} />}</For>
          </div>
          <div class="cp-actions">
            <button class="btn small" onClick={close}>Cancel</button>
            <button class="btn small primary" onClick={apply}><Icon name="check" size={15} />Apply</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
