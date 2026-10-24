/**
 * Shared animation loop for every canvas in the app.
 *
 * Efficiency rules (these are why decorations stay cheap):
 *  - 30 fps cap; skipped frames cost nothing.
 *  - Pauses when offscreen (IntersectionObserver) or the page is hidden.
 *  - Draws one still frame when reduced motion is on, or the budget said no.
 *  - DPR is capped so a 3x phone screen doesn't triple the fill rate.
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

const FRAME_MS = 1000 / 30;

export function createLoop(canvas: HTMLCanvasElement, o: LoopOptions): Renderer {
  const dpr = Math.min(o.maxDpr ?? 2, globalThis.devicePixelRatio || 1);
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

  let raf = 0, last = 0, t0 = 0, visible = true, running = false;
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const still = o.staticOnly || reduced;

  const frame = (now: number) => {
    raf = 0;
    if (!running) return;
    if (visible && !document.hidden && now - last >= FRAME_MS) {
      last = now;
      paint((now - t0) / 1000);
    }
    raf = requestAnimationFrame(frame);
  };

  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((entries) => { visible = entries.some((e) => e.isIntersecting); })
    : null;
  io?.observe(canvas);

  return {
    start() {
      if (still) { paint(o.staticT ?? 1.35); return; }
      if (running) return;
      running = true;
      t0 = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; },
    destroy() { this.stop(); io?.disconnect(); },
  };
}
