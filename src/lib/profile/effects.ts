import type { SlotConfig } from "../decor/spec";
import { effectCount } from "./presets";

/**
 * Profile effect particles (petals, snow, embers, ...), drawn over a profile card.
 *
 * Every particle's position is a pure function of time `t`, so:
 *  - no per-frame state to update or leak,
 *  - a still frame is just drawEffect(..., t = const),
 *  - two devices draw the same thing for the same config.
 */

export interface Particle {
  x0: number; y0: number; v: number; ph: number; f: number; size: number; dh: number;
}

export const EFFECT_STATIC_T = 3.2;

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

export function makeParticles(cfg: SlotConfig): Particle[] {
  const r = rng(cfg.preset * 7919 + 17);
  return Array.from({ length: effectCount(cfg) }, () => ({
    x0: r(), y0: r(), v: 0.6 + r() * 0.8, ph: r() * Math.PI * 2, f: 0.6 + r() * 1.0, size: r(), dh: r() * 2 - 1,
  }));
}

const frac = (x: number) => x - Math.floor(x);
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${((Math.round(h) % 360) + 360) % 360},${s}%,${l}%,${Math.max(0, Math.min(1, a)).toFixed(3)})`;

export function drawEffect(ctx: CanvasRenderingContext2D, cfg: SlotConfig, parts: Particle[], t: number, W: number, H: number) {
  const sp = 0.25 + (cfg.speed / 15) * 1.75;
  const hue = cfg.hue;
  switch (cfg.preset) {
    case 1: // Petal Fall
      for (const p of parts) {
        const u = frac(p.y0 + t * 0.045 * sp * p.v);
        const y = u * (H + 40) - 20;
        const wrap = W + 40;
        const x = ((((p.x0 * W + u * W * 0.3 + Math.sin(t * p.f * sp + p.ph) * 18) % wrap) + wrap) % wrap) - 20;
        const s = 3.5 + p.size * 4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * p.f * sp * 0.8 + p.ph);
        ctx.scale(1, 0.55 + 0.45 * Math.cos(t * p.f * sp + p.ph));
        ctx.fillStyle = hsl(hue + p.dh * 14, 85, 80 + p.dh * 8, 0.9);
        ctx.beginPath();
        ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    case 2: // Snowfall
      ctx.fillStyle = hsl(hue, 45, 94, 0.85);
      for (const p of parts) {
        const u = frac(p.y0 + t * 0.03 * sp * p.v);
        const y = u * (H + 20) - 10;
        const x = p.x0 * W + Math.sin(t * p.f * sp * 0.7 + p.ph) * 12;
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + p.size * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 3: // Embers
      for (const p of parts) {
        const u = frac(p.y0 + t * 0.05 * sp * p.v);
        const y = H + 10 - u * (H + 20);
        const x = p.x0 * W + Math.sin(t * p.f * sp + p.ph) * 14;
        const a = Math.sin(u * Math.PI);
        const c = hue + p.dh * 18;
        ctx.fillStyle = hsl(c, 100, 55, a * 0.22);
        ctx.beginPath(); ctx.arc(x, y, 5 + p.size * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hsl(c, 100, 70, a * 0.95);
        ctx.beginPath(); ctx.arc(x, y, 1.1 + p.size * 1.3, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 4: // Fireflies
      for (const p of parts) {
        const x = p.x0 * W + Math.sin(t * p.f * 0.5 * sp + p.ph) * 24 + Math.sin(t * p.f * 0.23 + p.ph * 2) * 10;
        const y = p.y0 * H + Math.cos(t * p.f * 0.4 * sp + p.ph) * 18;
        const b = Math.max(0, Math.sin(t * p.f * sp + p.ph)) ** 2;
        if (b < 0.02) continue;
        ctx.fillStyle = hsl(hue + p.dh * 12, 90, 62, b * 0.28);
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hsl(hue + p.dh * 12, 95, 75, b);
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 5: // Starfield
      for (const p of parts) {
        const tw = 0.5 + 0.5 * Math.sin(t * p.f * sp * 1.4 + p.ph);
        const s = (0.7 + p.size * 1.6) * (0.5 + tw);
        const x = p.x0 * W, y = p.y0 * H;
        ctx.fillStyle = hsl(hue + p.dh * 20, 60, 90, 0.35 + 0.65 * tw);
        if (s > 1.7) {
          ctx.beginPath();
          ctx.moveTo(x, y - s * 2); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x, y + s * 2); ctx.lineTo(x - s * 0.6, y);
          ctx.closePath();
          ctx.moveTo(x - s * 2, y); ctx.lineTo(x, y + s * 0.6); ctx.lineTo(x + s * 2, y); ctx.lineTo(x, y - s * 0.6);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
        }
      }
      break;
    case 6: // Rain (one path, one stroke)
      ctx.strokeStyle = hsl(hue, 60, 82, 0.55);
      ctx.lineWidth = 1.1;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const p of parts) {
        const u = frac(p.y0 + t * 0.35 * sp * p.v);
        const y = u * (H + 30) - 15;
        const x = ((p.x0 * W - u * 24 + W) % W);
        ctx.moveTo(x, y); ctx.lineTo(x + 2.5, y + 9 + p.size * 6);
      }
      ctx.stroke();
      break;
    case 7: // Confetti (multi-color; hue knob unused)
      for (const p of parts) {
        const u = frac(p.y0 + t * 0.05 * sp * p.v);
        const y = u * (H + 30) - 15;
        const x = p.x0 * W + Math.sin(t * p.f * sp + p.ph) * 16;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * p.f * sp * 1.6 + p.ph);
        ctx.scale(1, Math.cos(t * p.f * sp * 2 + p.ph));
        ctx.fillStyle = hsl((p.dh + 1) * 180, 85, 62, 0.95);
        ctx.fillRect(-3.5, -2, 7, 4);
        ctx.restore();
      }
      break;
  }
}
