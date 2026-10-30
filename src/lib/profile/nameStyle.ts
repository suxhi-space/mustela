import { contrast, hex, mix } from "../color";
import { nameEffect, nameFont } from "./presets";
import type { NameStyle } from "./model";

/**
 * Turns a NameStyle into CSS. People pick colors on their own screen, but we
 * render on someone else's, so every color is nudged until it is readable
 * (contrast 3:1, the WCAG floor for large text) against the viewer's surface.
 */

export interface NameCss {
  style: Record<string, string>;
  /** Extra class for effects that need a keyframe animation. */
  class: string;
}

export function readable(c: number, surface: number, min = 3): number {
  if (contrast(c, surface) >= min) return c;
  const target = contrast(0xffffff, surface) >= contrast(0x000000, surface) ? 0xffffff : 0x000000;
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const m = mix(c, target, t);
    if (contrast(m, surface) >= min) return m;
  }
  return target;
}

/** `fontOnly`: just the font, no colours or effects (chat messages and voice lists, where they get busy). */
export function nameCss(n: NameStyle | null, surface: number, fontOnly = false): NameCss {
  if (!n) return { style: {}, class: "" };
  const style: Record<string, string> = {};
  const f = nameFont(n.font);
  if (n.font) style["font-family"] = f.css;
  if (fontOnly) return { style, class: "" };
  const c1 = hex(readable(n.c1, surface));
  const c2 = hex(readable(n.c2, surface));
  let cls = "";
  switch (nameEffect(n.effect).id) {
    case 1: style.color = c1; break;
    case 2:
      style["background-image"] = `linear-gradient(90deg, ${c1}, ${c2})`;
      style["-webkit-background-clip"] = "text"; style["background-clip"] = "text"; style.color = "transparent";
      break;
    case 3: style.color = c1; style["text-shadow"] = `0 0 8px ${c1}99`; break;
    case 4: cls = "n-rainbow"; break;
    case 5: style.color = c1; style["text-shadow"] = `0 0 3px ${c1}, 0 0 9px ${c1}aa`; break;
  }
  return { style, class: cls };
}
