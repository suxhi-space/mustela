/**
 * One shared animation loop for every canvas in the app (decorations, effects, frames, nameplates).
 *
 * Why shared: one requestAnimationFrame for everything, instead of one per canvas, and a single
 * place that decides whether anything may move at all.
 *
 * Rules (these are why decorations stay cheap, even on a 2019 laptop running a game):
 *  - At most MAX_ACTIVE canvases animate at once; the rest show a still frame.
 *  - 30 fps normally, 15 fps when reduced, lower again during calls (see setGates).
 *  - Nothing runs while the window is hidden, or (by default) while Mustela isn't the focused
 *    window, so games get the computer back. Each canvas keeps its last frame on screen.
 *  - Offscreen canvases don't draw (IntersectionObserver).
 *  - The loop stops completely when nothing needs to move.
 *  - Pixel density is capped, so a 3x phone screen doesn't triple the fill rate.
 */

export interface Renderer {
  start(): void;
  stop(): void;
  destroy(): void;
}

export interface LoopOptions {
  /** CSS pixels */
  width: number;
  height: number;
  /** Draw one still frame instead of animating. */
  staticOnly?: boolean;
  /** Time (seconds) used for the still frame. */
  staticT?: number;
  maxDpr?: number;
  /** Called with a context already scaled to CSS pixels. */
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

export interface Gates {
  /** "full" 30 fps, "reduced" 15 fps and lower resolution, "off" still frames only */
  mode: "full" | "reduced" | "off";
  /** Frames per second ceiling right now (calls lower it) */
  fps: number;
  /** Keep animating while another window is focused */
  background: boolean;
  /** Highest pixel density to draw at */
  maxDpr: number;
}

export const MAX_ACTIVE = 10;
const gates: Gates = { mode: "full", fps: 30, background: false, maxDpr: 2 };

interface Entry {
  draw(t: number): void;
  still(): void;
  visible: boolean;
  running: boolean;
  t0: number;
}
const entries = new Set<Entry>();
let raf = 0, last = 0, focused = true;
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** May anything move right now? */
function allowed() {
  if (gates.mode === "off" || reducedMotion()) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  return focused || gates.background;
}

function tick(now: number) {
  raf = 0;
  if (!allowed()) return; // stays stopped until something changes (focus, visibility, settings)
  const frameMs = 1000 / gates.fps;
  if (now - last >= frameMs - 2) {
    last = now;
    let n = 0;
    for (const e of entries) {
      if (!e.running || !e.visible) continue;
      if (++n > MAX_ACTIVE) break;
      e.draw((now - e.t0) / 1000);
    }
    if (n === 0) return; // nothing on screen wants to move: stop the loop entirely
  }
  raf = requestAnimationFrame(tick);
}
function wake() {
  if (!raf && allowed() && [...entries].some((e) => e.running && e.visible)) raf = requestAnimationFrame(tick);
}

if (typeof addEventListener === "function") {
  addEventListener("focus", () => { focused = true; wake(); });
  addEventListener("blur", () => { focused = false; });
  addEventListener("visibilitychange", () => wake());
}

/** Called by the app when settings, focus or call state change. */
export function setGates(g: Partial<Gates>) {
  Object.assign(gates, g);
  wake();
}
export const currentGates = (): Readonly<Gates> => gates;
/** The desktop shell reports window focus (more reliable than the page's own focus events). */
export function setWindowFocused(f: boolean) { focused = f; if (f) wake(); }

export function createLoop(canvas: HTMLCanvasElement, o: LoopOptions): Renderer {
  const dpr = Math.min(o.maxDpr ?? gates.maxDpr, gates.mode === "reduced" ? 1 : gates.maxDpr, globalThis.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(o.width * dpr));
  canvas.height = Math.max(1, Math.round(o.height * dpr));
  canvas.style.width = `${o.width}px`;
  canvas.style.height = `${o.height}px`;
  const ctx = canvas.getContext("2d")!;
  const paint = (t: number) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, o.width, o.height);
    o.draw(ctx, t);
  };
  const stillT = o.staticT ?? 1.35;
  const e: Entry = { draw: paint, still: () => paint(stillT), visible: true, running: false, t0: 0 };

  // The observer comes from the window the canvas ends up in (the call pop-out is a different one).
  let io: IntersectionObserver | null = null, gone = false;
  const watch = (tries = 0) => {
    if (gone) return;
    if (!canvas.isConnected) { if (tries < 20) setTimeout(() => watch(tries + 1), tries < 3 ? 0 : 50); return; }
    const view = (canvas.ownerDocument.defaultView ?? globalThis) as typeof globalThis;
    if (typeof view.IntersectionObserver === "undefined") return;
    io = new view.IntersectionObserver((list) => { e.visible = list.some((x) => x.isIntersecting); if (e.visible) wake(); });
    io.observe(canvas);
  };
  if (typeof queueMicrotask !== "undefined") queueMicrotask(() => watch()); else watch();

  return {
    start() {
      // Always show something straight away, so a paused or capped canvas still looks right.
      paint(stillT);
      if (o.staticOnly || e.running) return;
      e.running = true;
      e.t0 = performance.now() - stillT * 1000;
      entries.add(e);
      wake();
    },
    stop() { e.running = false; entries.delete(e); },
    destroy() { this.stop(); gone = true; io?.disconnect(); },
  };
}
