import type { Layer, SlotConfig } from "./spec";

export interface DecorPreset {
  id: number;
  name: string;
  /** Default knobs when the user first picks this preset. */
  defaults: Pick<SlotConfig, "hue" | "speed" | "intensity">;
  /** Which knobs do anything for this preset. */
  knobs: ("hue" | "speed" | "intensity")[];
  build(cfg: SlotConfig): Layer[];
}

const sp = (n: number) => 0.15 + (n / 15) * 1.85; // 0..15 -> 0.15..2
const it = (n: number) => 0.15 + (n / 15) * 0.85; // 0..15 -> 0.15..1
const ALL = ["hue", "speed", "intensity"] as const;

export const DECOR_PRESETS: DecorPreset[] = [
  { id: 1, name: "Halo", defaults: { hue: 210, speed: 6, intensity: 9 }, knobs: [...ALL],
    build: (c) => [
      { type: "glow", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.8 },
      { type: "ring", hue: c.hue, speed: sp(c.speed) * 0.5, intensity: it(c.intensity) },
    ] },
  { id: 2, name: "Soft Glow", defaults: { hue: 330, speed: 4, intensity: 8 }, knobs: [...ALL],
    build: (c) => [{ type: "glow", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity) }] },
  { id: 3, name: "Pulse", defaults: { hue: 150, speed: 7, intensity: 8 }, knobs: [...ALL],
    build: (c) => [
      { type: "ring", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.7 },
      { type: "pulse", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity) },
    ] },
  { id: 4, name: "Sparkle", defaults: { hue: 45, speed: 8, intensity: 9 }, knobs: [...ALL],
    build: (c) => [
      { type: "ring", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.5 },
      { type: "sparkles", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity), count: 10 },
    ] },
  { id: 5, name: "Orbit", defaults: { hue: 270, speed: 8, intensity: 9 }, knobs: [...ALL],
    build: (c) => [
      { type: "ring", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.45 },
      { type: "orbit", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity), count: 3 },
    ] },
  { id: 6, name: "Rainbow", defaults: { hue: 0, speed: 7, intensity: 10 }, knobs: ["speed", "intensity"],
    build: (c) => [{ type: "ring", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity), cycle: true }] },
  { id: 7, name: "Aurora", defaults: { hue: 170, speed: 5, intensity: 10 }, knobs: [...ALL],
    build: (c) => [
      { type: "aurora", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity) },
      { type: "ring", hue: c.hue + 40, speed: sp(c.speed) * 0.4, intensity: it(c.intensity) * 0.6 },
    ] },
  { id: 8, name: "Stardust", defaults: { hue: 200, speed: 7, intensity: 10 }, knobs: [...ALL],
    build: (c) => [
      { type: "glow", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.6 },
      { type: "sparkles", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity), count: 18 },
      { type: "orbit", hue: c.hue + 30, speed: sp(c.speed) * 0.8, intensity: it(c.intensity), count: 2 },
    ] },
  { id: 9, name: "Petal Ring", defaults: { hue: 335, speed: 5, intensity: 9 }, knobs: [...ALL],
    build: (c) => [
      { type: "ring", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.4 },
      { type: "petals", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity), count: 7 },
    ] },
  { id: 10, name: "Comets", defaults: { hue: 205, speed: 7, intensity: 9 }, knobs: [...ALL],
    build: (c) => [
      { type: "ring", hue: c.hue, speed: 0, intensity: it(c.intensity) * 0.35 },
      { type: "comet", hue: c.hue, speed: sp(c.speed), intensity: it(c.intensity), count: 2 },
    ] },
];

const BY_ID = new Map(DECOR_PRESETS.map((p) => [p.id, p]));
export const getDecorPreset = (id: number) => BY_ID.get(id);

/** Derive drawable layers from a slot config. Unknown preset => no layers. */
export function layersFor(cfg: SlotConfig): Layer[] {
  return getDecorPreset(cfg.preset)?.build(cfg) ?? [];
}

