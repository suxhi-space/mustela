import { from565, to565 } from "../color";
import type { SlotConfig } from "../decor/spec";
import { NAME_EFFECTS, NAME_FONTS, getSlotPreset, type SlotKind } from "./presets";
import { quantizeHue, type NameStyle, type ProfileConfig, type ProfileTheme } from "./model";

/**
 * Wire format v2. 13 to 22 bytes.
 *
 *   byte 0       vvvv ffff   version (=2) | flags: bit0 has theme, bit1 has name style, bits 2-3 reserved (0)
 *   bytes 1-12   4 slots x 3 bytes, in order: decor, effect, frame, plate
 *                  [preset] [hue, 256 steps] [speed<<4 | intensity]
 *   if theme:    primary RGB565 (2 bytes), accent RGB565 (2 bytes)
 *   if name:     [font<<4 | effect] [c1 RGB565] [c2 RGB565]
 *
 * Forward compatibility:
 *   - Unknown version  -> null (nothing is guessed).
 *   - Unknown preset   -> that one slot becomes "none", the rest still render.
 */

export const PACKED_MIN = 13;
export const PACKED_MAX = 22;
const VERSION = 2;
const KINDS: SlotKind[] = ["decor", "effect", "frame", "plate"];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function packSlot(c: SlotConfig, out: number[]) {
  const hue8 = Math.round((((c.hue % 360) + 360) % 360) * 256 / 360) % 256;
  out.push(clamp(Math.round(c.preset), 0, 255), hue8, (clamp(Math.round(c.speed), 0, 15) << 4) | clamp(Math.round(c.intensity), 0, 15));
}

export function packProfile(p: ProfileConfig): Uint8Array {
  const flags = (p.theme ? 1 : 0) | (p.name ? 2 : 0);
  const out: number[] = [(VERSION << 4) | flags];
  for (const k of KINDS) packSlot(p[k], out);
  if (p.theme) {
    const a = to565(p.theme.primary), b = to565(p.theme.accent);
    out.push(a >> 8, a & 255, b >> 8, b & 255);
  }
  if (p.name) {
    const a = to565(p.name.c1), b = to565(p.name.c2);
    out.push((p.name.font << 4) | p.name.effect, a >> 8, a & 255, b >> 8, b & 255);
  }
  return Uint8Array.from(out);
}

export function unpackProfile(b: Uint8Array): ProfileConfig | null {
  if (b.length < PACKED_MIN) return null;
  const b0 = b[0]!;
  if (b0 >> 4 !== VERSION) return null;
  const flags = b0 & 15;
  if (flags & 0b1100) return null; // reserved
  const hasTheme = !!(flags & 1), hasName = !!(flags & 2);
  if (b.length < PACKED_MIN + (hasTheme ? 4 : 0) + (hasName ? 5 : 0)) return null;

  const slots = KINDS.map((kind, i): SlotConfig => {
    const o = 1 + i * 3;
    const preset = b[o]!;
    if (preset !== 0 && !getSlotPreset(kind, preset)) return { preset: 0, hue: 0, speed: 8, intensity: 8 };
    return { preset, hue: quantizeHue((b[o + 1]! * 360) / 256), speed: b[o + 2]! >> 4, intensity: b[o + 2]! & 15 };
  });

  let o = 13;
  let theme: ProfileTheme | null = null;
  if (hasTheme) {
    theme = { primary: from565((b[o]! << 8) | b[o + 1]!), accent: from565((b[o + 2]! << 8) | b[o + 3]!) };
    o += 4;
  }
  let name: NameStyle | null = null;
  if (hasName) {
    const fe = b[o]!;
    const font = NAME_FONTS.some((f) => f.id === fe >> 4) ? fe >> 4 : 0;
    const effect = NAME_EFFECTS.some((e) => e.id === (fe & 15)) ? fe & 15 : 0;
    name = { font, effect, c1: from565((b[o + 1]! << 8) | b[o + 2]!), c2: from565((b[o + 3]! << 8) | b[o + 4]!) };
    if (font === 0 && effect === 0) name = null;
  }
  return { decor: slots[0]!, effect: slots[1]!, frame: slots[2]!, plate: slots[3]!, theme, name };
}
