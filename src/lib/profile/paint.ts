import type { SlotConfig } from "../decor/spec";

/**
 * Frames and nameplates, drawn procedurally (no image assets), so a preset is
 * a few lines of code and a few bytes on the wire. Like effects, every frame
 * is a pure function of time `t`, so a still image is just a fixed `t`.
 */

export const PAINT_STATIC_T = 2.4;

const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsla(${((Math.round(h) % 360) + 360) % 360},${s}%,${l}%,${Math.max(0, Math.min(1, a)).toFixed(3)})`;
const it = (c: SlotConfig) => 0.25 + (c.intensity / 15) * 0.75;
const sp = (c: SlotConfig) => 0.25 + (c.speed / 15) * 1.75;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Draws a frame around a W x H card. `radius` should match the card's corner radius. */
export function paintFrame(ctx: CanvasRenderingContext2D, cfg: SlotConfig, t: number, W: number, H: number, radius = 18) {
  const a = it(cfg);
  const hue = cfg.hue;
  ctx.save();
  switch (cfg.preset) {
    case 1: { // Neon Edge
      // A soft wide stroke under a thin bright one looks like a glow, without canvas blur (which is slow).
      roundRect(ctx, 3, 3, W - 6, H - 6, radius);
      ctx.lineWidth = 7;
      ctx.strokeStyle = hsl(hue, 100, 60, a * 0.22);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hsl(hue, 100, 70, a);
      ctx.stroke();
      break;
    }
    case 2: { // Gradient Ring
      const ang = t * sp(cfg) * 0.6;
      const g = ctx.createLinearGradient(W / 2 + Math.cos(ang) * W, H / 2 + Math.sin(ang) * H, W / 2 - Math.cos(ang) * W, H / 2 - Math.sin(ang) * H);
      g.addColorStop(0, hsl(hue, 90, 62, a));
      g.addColorStop(0.5, hsl(hue + 70, 90, 68, a));
      g.addColorStop(1, hsl(hue, 90, 62, a));
      roundRect(ctx, 2.5, 2.5, W - 5, H - 5, radius);
      ctx.lineWidth = 4;
      ctx.strokeStyle = g;
      ctx.stroke();
      break;
    }
    case 3: { // Double Line
      ctx.strokeStyle = hsl(hue, 70, 62, a);
      ctx.lineWidth = 1.5;
      roundRect(ctx, 2, 2, W - 4, H - 4, radius); ctx.stroke();
      ctx.lineWidth = 1;
      roundRect(ctx, 6, 6, W - 12, H - 12, Math.max(2, radius - 4)); ctx.stroke();
      break;
    }
    case 4: { // Stitched
      ctx.strokeStyle = hsl(hue, 60, 66, a * 0.55);
      ctx.lineWidth = 3;
      roundRect(ctx, 2, 2, W - 4, H - 4, radius); ctx.stroke();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = hsl(hue, 70, 82, a);
      ctx.lineWidth = 1.5;
      roundRect(ctx, 6, 6, W - 12, H - 12, Math.max(2, radius - 4)); ctx.stroke();
      break;
    }
    case 5: { // Corner Brackets
      const L = Math.min(W, H) * 0.14 + 8, o = 4;
      ctx.strokeStyle = hsl(hue, 85, 66, a);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]] as const) {
        ctx.moveTo(x + dx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * L);
      }
      ctx.stroke();
      break;
    }
    case 6: { // Ornate Corners
      const R = Math.min(W, H) * 0.12 + 8, o = 5;
      ctx.strokeStyle = hsl(hue, 70, 72, a);
      ctx.fillStyle = hsl(hue, 80, 80, a);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      for (const [x, y, sx, sy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, H - o, 1, -1], [W - o, H - o, -1, -1]] as const) {
        ctx.beginPath();
        ctx.moveTo(x + sx * R, y);
        ctx.quadraticCurveTo(x + sx * R * 0.2, y + sy * R * 0.2, x, y + sy * R);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + sx * R * 0.38, y + sy * R * 0.38, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

/** Draws a nameplate behind a W x H row (member list row, message header strip). */
export function paintPlate(ctx: CanvasRenderingContext2D, cfg: SlotConfig, t: number, W: number, H: number) {
  const a = it(cfg) * 0.8;
  const hue = cfg.hue;
  ctx.save();
  switch (cfg.preset) {
    case 1: { // Gradient
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, hsl(hue, 70, 45, a));
      g.addColorStop(1, hsl(hue + 40, 70, 40, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 2: { // Sakura
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, hsl(hue, 60, 38, a));
      g.addColorStop(1, hsl(hue + 20, 60, 30, a * 0.2));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = hsl(hue, 85, 82, a);
      for (let i = 0; i < 7; i++) {
        const x = W * (0.45 + 0.08 * i), y = H * (0.2 + 0.6 * ((i * 0.37) % 1)), s = 2.2 + (i % 3);
        ctx.save(); ctx.translate(x, y); ctx.rotate(i * 1.1);
        ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 3: { // Stripes
      ctx.fillStyle = hsl(hue, 50, 32, a * 0.7); ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = hsl(hue, 60, 55, a * 0.5);
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (let x = -H; x < W; x += 14) { ctx.moveTo(x, H); ctx.lineTo(x + H, 0); }
      ctx.stroke();
      break;
    }
    case 4: { // Aurora
      ctx.fillStyle = hsl(hue + 200, 40, 14, a * 0.9); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 3; i++) {
        const x = W * (0.5 + 0.4 * Math.sin(t * sp(cfg) * (0.5 + i * 0.3) + i * 2));
        const g = ctx.createRadialGradient(x, H / 2, 0, x, H / 2, W * 0.45);
        g.addColorStop(0, hsl(hue + i * 50, 85, 52, a * 0.7));
        g.addColorStop(1, hsl(hue + i * 50, 85, 52, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case 5: { // Shimmer
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, hsl(hue, 55, 36, a)); g.addColorStop(1, hsl(hue + 25, 55, 30, a));
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const x = (((t * sp(cfg) * 0.35) % 1.6) - 0.3) * W;
      const s = ctx.createLinearGradient(x - W * 0.2, 0, x + W * 0.2, 0);
      s.addColorStop(0, hsl(hue, 100, 90, 0)); s.addColorStop(0.5, hsl(hue, 100, 90, a * 0.45)); s.addColorStop(1, hsl(hue, 100, 90, 0));
      ctx.fillStyle = s; ctx.fillRect(0, 0, W, H);
      break;
    }
    case 6: { // Grid
      ctx.fillStyle = hsl(hue, 40, 14, a); ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = hsl(hue, 70, 50, a * 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < W; x += 12) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
      for (let y = 0; y < H; y += 12) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
