import type { SlotConfig } from "../decor/spec";
import { NONE_SLOT } from "../decor/spec";
import { snap } from "../color";
import { getSlotPreset, NAME_EFFECTS, NAME_FONTS, slotFromPreset, type SlotKind } from "./presets";

export interface NameStyle {
  font: number;
  effect: number;
  /** 0xRRGGBB, snapped to RGB565 */
  c1: number;
  c2: number;
}

export interface ProfileTheme {
  primary: number;
  accent: number;
}

/** Everything a person can customize and share. Max 22 bytes on the wire. */
export interface ProfileConfig {
  decor: SlotConfig;
  effect: SlotConfig;
  frame: SlotConfig;
  plate: SlotConfig;
  theme: ProfileTheme | null;
  name: NameStyle | null;
}

export const DEFAULT_PROFILE: ProfileConfig = {
  decor: { ...NONE_SLOT },
  effect: { ...NONE_SLOT },
  frame: { ...NONE_SLOT },
  plate: { ...NONE_SLOT },
  theme: null,
  name: null,
};

const int = (x: unknown, lo: number, hi: number, d: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d;

/** The wire stores hue in 256 steps. Snapping here keeps "what I see" == "what others see". */
export const quantizeHue = (h: number) => {
  const k = Math.round((((h % 360) + 360) % 360) * 256 / 360) % 256;
  return Math.round((k * 360) / 256) % 360;
};

export function sanitizeSlot(kind: SlotKind, raw: unknown, fallback: SlotConfig = NONE_SLOT): SlotConfig {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const r = raw as Record<string, unknown>;
  const preset = int(r.preset, 0, 255, 0);
  if (preset !== 0 && !getSlotPreset(kind, preset)) return { ...NONE_SLOT };
  return {
    preset,
    hue: quantizeHue(int(r.hue, -100000, 100000, 0)),
    speed: int(r.speed, 0, 15, NONE_SLOT.speed),
    intensity: int(r.intensity, 0, 15, NONE_SLOT.intensity),
  };
}

export function sanitizeName(raw: unknown): NameStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const font = NAME_FONTS.some((f) => f.id === r.font) ? (r.font as number) : 0;
  const effect = NAME_EFFECTS.some((e) => e.id === r.effect) ? (r.effect as number) : 0;
  if (font === 0 && effect === 0) return null;
  return { font, effect, c1: snap(int(r.c1, 0, 0xffffff, 0xffffff)), c2: snap(int(r.c2, 0, 0xffffff, 0xffffff)) };
}

export function sanitizeTheme(raw: unknown): ProfileTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.primary !== "number" || typeof r.accent !== "number") return null;
  return { primary: snap(int(r.primary, 0, 0xffffff, 0)), accent: snap(int(r.accent, 0, 0xffffff, 0)) };
}

/** Anything from outside (server, disk, banner) goes through here. */
export function sanitizeProfile(raw: unknown): ProfileConfig {
  if (!raw || typeof raw !== "object") return structuredClone(DEFAULT_PROFILE);
  const r = raw as Record<string, unknown>;
  return {
    decor: sanitizeSlot("decor", r.decor, DEFAULT_PROFILE.decor),
    effect: sanitizeSlot("effect", r.effect),
    frame: sanitizeSlot("frame", r.frame),
    plate: sanitizeSlot("plate", r.plate),
    theme: sanitizeTheme(r.theme),
    name: sanitizeName(r.name),
  };
}

export const profilesEqual = (a: ProfileConfig, b: ProfileConfig) => JSON.stringify(a) === JSON.stringify(b);

/** True if the profile has anything worth fetching/rendering beyond defaults. */
export function isPlain(p: ProfileConfig): boolean {
  return !p.decor.preset && !p.effect.preset && !p.frame.preset && !p.plate.preset && !p.theme && !p.name;
}
