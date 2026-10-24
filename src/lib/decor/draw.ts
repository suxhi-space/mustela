import type { Layer } from "./spec";
import { createLoop } from "../render/loop";

/**
 * Canvas renderer. Framework-free so it can be reused anywhere.
 *
 * Geometry: the canvas is a square of side S. The avatar sits in the middle
 * and has radius S/3, leaving a ring of S/6 on every side for effects.
 *
 * Efficiency rules:
 *  - 30 fps cap; skipped frames cost nothing.
 *  - Pauses when offscreen (IntersectionObserver) or the tab is hidden.
 *  - Static frame when reduced motion is on, or the budget said no.
 *  - No per-frame allocation in the hot path except gradients.
 */

export interface RenderOptions {
  /** CSS pixel side length of the square canvas. */
  size: number;
  /** Draw one still frame instead of animating. */
  staticOnly?: boolean;
  /** Seed for deterministic particle layout. */
  seed?: number;
}

export type { Renderer } from "../render/loop";
import type { Renderer } from "../render/loop";

const STATIC_T = 1.35; // seconds; a pleasant-looking still moment

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;

interface Particle {
  angle: number;
  radius: number; // 0..1 across the effect band
  phase: number;
  size: number;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  layers: Layer[],
  t: number,
  S: number,
  particles: Map<Layer, Particle[]>,
) {
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  const r = S / 3; // avatar radius
  const band = S / 6;

  for (const l of layers) {
    const hue = l.hue + (l.cycle ? t * 40 * l.speed : 0);
    const a = l.intensity;
    switch (l.type) {
      case "glow": {
        const breathe = 0.85 + 0.15 * Math.sin(t * (0.8 + l.speed));
        const g = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r + band);
        g.addColorStop(0, hsl(hue, 90, 65, 0.75 * a * breathe));
        g.addColorStop(1, hsl(hue, 90, 65, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r + band, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "ring": {
        const w = Math.max(2.5, band * 0.36);
        const rr = r + w * 0.9;
        ctx.lineWidth = w;
        if (typeof ctx.createConicGradient === "function") {
          const g = ctx.createConicGradient(t * l.speed, cx, cy);
          g.addColorStop(0, hsl(hue, 90, 62, a));
          g.addColorStop(0.5, hsl(hue + 50, 90, 70, a));
          g.addColorStop(1, hsl(hue, 90, 62, a));
          ctx.strokeStyle = g;
        } else {
          ctx.strokeStyle = hsl(hue, 90, 65, a);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "pulse": {
        const p = (t * l.speed * 0.5) % 1;
        const rr = r + band * 0.3 + band * 0.7 * p;
        ctx.lineWidth = Math.max(1.5, band * 0.18);
        ctx.strokeStyle = hsl(hue, 90, 65, a * (1 - p));
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "sparkles": {
        let ps = particles.get(l);
        if (!ps) {
          const rand = rng(Math.round(l.hue * 31 + (l.count ?? 8)));
          ps = Array.from({ length: l.count ?? 8 }, () => ({
            angle: rand() * Math.PI * 2,
            radius: 0.15 + rand() * 0.85,
            phase: rand() * Math.PI * 2,
            size: 0.5 + rand() * 0.9,
          }));
          particles.set(l, ps);
        }
        for (const p of ps) {
          const tw = 0.5 + 0.5 * Math.sin(t * (1.5 + l.speed * 2) + p.phase);
          if (tw < 0.05) continue;
          const rr = r + band * 0.2 + band * 0.9 * p.radius;
          const x = cx + Math.cos(p.angle + t * 0.05 * l.speed) * rr;
          const y = cy + Math.sin(p.angle + t * 0.05 * l.speed) * rr;
          const s = band * 0.22 * p.size * (0.4 + tw);
          ctx.fillStyle = hsl(hue, 100, 80, a * tw);
          ctx.beginPath();
          ctx.moveTo(x, y - s);
          ctx.quadraticCurveTo(x, y, x + s, y);
          ctx.quadraticCurveTo(x, y, x, y + s);
          ctx.quadraticCurveTo(x, y, x - s, y);
          ctx.quadraticCurveTo(x, y, x, y - s);
          ctx.fill();
        }
        break;
      }
      case "orbit": {
        const n = l.count ?? 2;
        const rr = r + band * 0.55;
        for (let i = 0; i < n; i++) {
          const ang = t * l.speed * 1.2 + (i * Math.PI * 2) / n;
          const x = cx + Math.cos(ang) * rr;
          const y = cy + Math.sin(ang) * rr;
          const s = Math.max(2, band * 0.2);
          const g = ctx.createRadialGradient(x, y, 0, x, y, s * 2.2);
          g.addColorStop(0, hsl(hue + i * 25, 100, 80, a));
          g.addColorStop(1, hsl(hue + i * 25, 100, 70, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, s * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "petals": {
        const n = l.count ?? 6;
        const rr = r + band * 0.55;
        for (let i = 0; i < n; i++) {
          const ang = t * l.speed * 0.45 + (i * Math.PI * 2) / n;
          const x = cx + Math.cos(ang) * rr;
          const y = cy + Math.sin(ang) * rr;
          const sz = Math.max(2.5, band * 0.26);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(ang + Math.PI / 2 + Math.sin(t * 2 + i) * 0.5);
          ctx.fillStyle = hsl(hue + (i % 2) * 14, 85, 80, a);
          ctx.beginPath();
          ctx.ellipse(0, 0, sz * 0.5, sz, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      case "comet": {
        const n = l.count ?? 2;
        const rr = r + band * 0.55;
        ctx.lineCap = "round";
        for (let i = 0; i < n; i++) {
          const head = t * l.speed * 1.1 + (i * Math.PI * 2) / n;
          const tail = 0.9; // radians of trail
          for (let k = 0; k < 6; k++) {
            const f = k / 6;
            ctx.lineWidth = Math.max(1.2, band * 0.2 * (1 - f));
            ctx.strokeStyle = hsl(hue + i * 20, 100, 78, a * (1 - f) * 0.9);
            ctx.beginPath();
            ctx.arc(cx, cy, rr, head - tail * (f + 1 / 6), head - tail * f);
            ctx.stroke();
          }
          ctx.fillStyle = hsl(hue + i * 20, 100, 92, a);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(head) * rr, cy + Math.sin(head) * rr, Math.max(1.8, band * 0.16), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "aurora": {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i++) {
          const ang = t * l.speed * (0.5 + i * 0.25) + i * 2.1;
          const x = cx + Math.cos(ang) * band * 0.9;
          const y = cy + Math.sin(ang * 0.9) * band * 0.9;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r + band);
          g.addColorStop(0, hsl(hue + i * 55, 90, 60, 0.35 * a));
          g.addColorStop(1, hsl(hue + i * 55, 90, 60, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r + band, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
    }
  }
}

export function createRenderer(canvas: HTMLCanvasElement, layers: Layer[], opts: RenderOptions): Renderer {
  const particles = new Map<Layer, Particle[]>();
  return createLoop(canvas, {
    width: opts.size,
    height: opts.size,
    staticOnly: opts.staticOnly,
    staticT: STATIC_T,
    maxDpr: 2,
    draw: (ctx, t) => drawFrame(ctx, layers, t, opts.size, particles),
  });
}
