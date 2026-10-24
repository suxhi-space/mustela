/** Small color helpers. Colors are 0xRRGGBB integers unless noted. */

export const hex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");

export function parseHex(s: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? parseInt(m[1]!, 16) : null;
}

/** RGB565 round trip. Used on the wire; apply `snap` to any color the user picks so stored == published. */
export const to565 = (c: number) => (((c >> 19) & 0x1f) << 11) | (((c >> 10) & 0x3f) << 5) | ((c >> 3) & 0x1f);
export function from565(v: number): number {
  const r5 = (v >> 11) & 0x1f, g6 = (v >> 5) & 0x3f, b5 = v & 0x1f;
  // Replicate high bits into low bits so 0x1f -> 0xff exactly.
  const r = (r5 << 3) | (r5 >> 2), g = (g6 << 2) | (g6 >> 4), b = (b5 << 3) | (b5 >> 2);
  return (r << 16) | (g << 8) | b;
}
export const snap = (c: number) => from565(to565(c & 0xffffff));

/** WCAG relative luminance, 0..1 */
export function luminance(c: number): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((c >> 16) & 255) + 0.7152 * ch((c >> 8) & 255) + 0.0722 * ch(c & 255);
}

export function contrast(a: number, b: number): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export const textOn = (bg: number) => (contrast(bg, 0xffffff) >= contrast(bg, 0x000000) ? 0xffffff : 0x000000);

export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export function hslToRgb(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}
