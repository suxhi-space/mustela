import { contrast, hex, mix } from "../color";
import { nameEffect, nameFont } from "./presets";
import type { NameStyle } from "./model";

/**
 * Turns a NameStyle into CSS. People pick colors on their own screen, but we
 * render on someone else's, so every color is nudged until it is readable against the viewer's surface:
 * 4.5:1, the same as body text, by shading the color deeper or lighter while keeping its hue. Only how the name is
 * shown changes; the color people picked is kept as it is.
 */
const NAME_MIN = 4.5;

export interface NameCss {
  style: Record<string, string>;
  /** Extra class for effects that need a keyframe animation. */
  class: string;
}

export function readable(c: number, surface: number, min = 3): number {
  if (contrast(c, surface) >= min) return c;
  const darker = contrast(0xffffff, surface) < contrast(0x000000, surface);
  // Shade by lightness and keep the hue and saturation, so a pastel pink becomes a deeper pink. (Mixing with black or
  // white instead turns pastels grey: #ffd7f7 came out as a muddy mauve.)
  const [h, sat, l] = toHsl(c);
  for (let i = 1; i <= 40; i++) {
    const nl = darker ? l * (1 - i / 40) : l + (1 - l) * (i / 40);
    const m = fromHsl(h, sat, nl);
    if (contrast(m, surface) >= min) return m;
  }
  // Rare (a mid-grey surface): the old way, towards black or white.
  const target = darker ? 0x000000 : 0xffffff;
  for (let t = 0.05; t <= 1.0001; t += 0.05) { const m = mix(c, target, t); if (contrast(m, surface) >= min) return m; }
  return target;
}

function toHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function fromHsl(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** `fontOnly`: just the font, no colours or effects (chat messages and voice lists, where they get busy). */
export function nameCss(n: NameStyle | null, surface: number, fontOnly = false): NameCss {
  if (!n) return { style: {}, class: "" };
  const style: Record<string, string> = {};
  const f = nameFont(n.font);
  if (n.font) style["font-family"] = f.css;
  if (fontOnly) return { style, class: "" };
  const c1 = hex(readable(n.c1, surface, NAME_MIN));
  const c2 = hex(readable(n.c2, surface, NAME_MIN));
  // On a light background a glow in the (darkened) name color only blurs the letters. There the letters stay readable
  // and the halo uses the color as picked, so a pastel neon still looks like neon.
  const light = contrast(0x000000, surface) > contrast(0xffffff, surface);
  const halo = hex(n.c1);
  let cls = "";
  switch (nameEffect(n.effect).id) {
    case 1: style.color = c1; break;
    case 2:
      style["background-image"] = `linear-gradient(90deg, ${c1}, ${c2})`;
      style["-webkit-background-clip"] = "text"; style["background-clip"] = "text"; style.color = "transparent";
      break;
    case 3: style.color = c1; style["text-shadow"] = light ? `0 0 7px ${halo}` : `0 0 8px ${c1}99`; break;
    case 4: cls = "n-rainbow"; break;
    case 5: style.color = c1; style["text-shadow"] = light ? `0 0 2px ${halo}, 0 0 9px ${halo}` : `0 0 3px ${c1}, 0 0 9px ${c1}aa`; break;
  }
  return { style, class: cls };
}
