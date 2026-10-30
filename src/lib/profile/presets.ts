import type { SlotConfig } from "../decor/spec";
import { DECOR_PRESETS } from "../decor/presets";
import { decorCost } from "../decor/rating";

export type SlotKind = "decor" | "effect" | "frame" | "plate";
export type Knob = "hue" | "speed" | "intensity";

export interface SlotPreset {
  id: number;
  name: string;
  defaults: Pick<SlotConfig, "hue" | "speed" | "intensity">;
  /** Which knobs do anything for this preset. */
  knobs: Knob[];
  /** Relative per-frame cost (same scale as decor/rating.ts). */
  cost(c: SlotConfig): number;
  /** Optional note shown when this makes the rating worse. */
  reason?(c: SlotConfig): string | null;
}

const ALL: Knob[] = ["hue", "speed", "intensity"];

/** Particles drawn for an effect: 8..32 depending on intensity. */
export const effectCount = (c: SlotConfig) => 8 + Math.round(c.intensity * 1.6);

const particles = (per: number) => (c: SlotConfig) => 1.5 + effectCount(c) * per;
const manyReason = (name: string) => (c: SlotConfig) => (effectCount(c) >= 28 ? `${effectCount(c)} ${name} on screen.` : null);

export const EFFECT_PRESETS: SlotPreset[] = [
  { id: 1, name: "Petal Fall", defaults: { hue: 335, speed: 6, intensity: 9 }, knobs: ALL, cost: particles(0.45), reason: manyReason("petals") },
  { id: 2, name: "Snowfall", defaults: { hue: 205, speed: 5, intensity: 8 }, knobs: ALL, cost: particles(0.3), reason: manyReason("flakes") },
  { id: 3, name: "Embers", defaults: { hue: 25, speed: 7, intensity: 9 }, knobs: ALL, cost: particles(0.5), reason: manyReason("embers") },
  { id: 4, name: "Fireflies", defaults: { hue: 75, speed: 5, intensity: 8 }, knobs: ALL, cost: particles(0.55), reason: manyReason("fireflies") },
  { id: 5, name: "Starfield", defaults: { hue: 220, speed: 4, intensity: 9 }, knobs: ALL, cost: particles(0.25), reason: manyReason("stars") },
  { id: 6, name: "Rain", defaults: { hue: 210, speed: 9, intensity: 9 }, knobs: ALL, cost: particles(0.2), reason: manyReason("drops") },
  { id: 7, name: "Confetti", defaults: { hue: 0, speed: 6, intensity: 8 }, knobs: ["speed", "intensity"], cost: particles(0.4), reason: manyReason("pieces") },
];

export const FRAME_PRESETS: SlotPreset[] = [
  { id: 1, name: "Neon Edge", defaults: { hue: 190, speed: 6, intensity: 10 }, knobs: ["hue", "intensity"], cost: () => 1.5 },
  { id: 2, name: "Gradient Ring", defaults: { hue: 280, speed: 5, intensity: 9 }, knobs: ALL, cost: (c) => 2 + (c.speed > 0 ? 2 : 0) },
  { id: 3, name: "Double Line", defaults: { hue: 40, speed: 0, intensity: 9 }, knobs: ["hue", "intensity"], cost: () => 0.5 },
  { id: 4, name: "Stitched", defaults: { hue: 30, speed: 0, intensity: 9 }, knobs: ["hue", "intensity"], cost: () => 0.5 },
  { id: 5, name: "Corner Brackets", defaults: { hue: 150, speed: 0, intensity: 10 }, knobs: ["hue", "intensity"], cost: () => 0.5 },
  { id: 6, name: "Ornate Corners", defaults: { hue: 340, speed: 0, intensity: 10 }, knobs: ["hue", "intensity"], cost: () => 1 },
];

export const PLATE_PRESETS: SlotPreset[] = [
  { id: 1, name: "Gradient", defaults: { hue: 210, speed: 0, intensity: 9 }, knobs: ["hue", "intensity"], cost: () => 0.5 },
  { id: 2, name: "Sakura", defaults: { hue: 335, speed: 0, intensity: 9 }, knobs: ["hue", "intensity"], cost: () => 1.5 },
  { id: 3, name: "Stripes", defaults: { hue: 160, speed: 0, intensity: 8 }, knobs: ["hue", "intensity"], cost: () => 1 },
  { id: 4, name: "Aurora", defaults: { hue: 170, speed: 5, intensity: 9 }, knobs: ALL, cost: () => 4, reason: () => "Animated gradients behind every row." },
  { id: 5, name: "Shimmer", defaults: { hue: 45, speed: 6, intensity: 9 }, knobs: ALL, cost: () => 2.5 },
  { id: 6, name: "Grid", defaults: { hue: 130, speed: 0, intensity: 8 }, knobs: ["hue", "intensity"], cost: () => 1 },
];

export const DECOR_AS_SLOT: SlotPreset[] = DECOR_PRESETS.map((p) => ({
  id: p.id, name: p.name, defaults: p.defaults, knobs: p.knobs, cost: decorCost,
}));

export const SLOT_PRESETS: Record<SlotKind, SlotPreset[]> = {
  decor: DECOR_AS_SLOT, effect: EFFECT_PRESETS, frame: FRAME_PRESETS, plate: PLATE_PRESETS,
};

export const SLOT_LABEL: Record<SlotKind, string> = {
  decor: "Avatar Decoration", effect: "Profile Effect", frame: "Profile Frame", plate: "Nameplate",
};

export const getSlotPreset = (kind: SlotKind, id: number) => SLOT_PRESETS[kind].find((p) => p.id === id);

export function slotFromPreset(kind: SlotKind, id: number): SlotConfig {
  const p = getSlotPreset(kind, id);
  return p ? { preset: id, ...p.defaults } : { preset: 0, hue: 0, speed: 8, intensity: 8 };
}

export function slotCost(kind: SlotKind, c: SlotConfig): number {
  return getSlotPreset(kind, c.preset)?.cost(c) ?? 0;
}

/* ---------- Display name style ---------- */

export const NAME_FONTS = [
  { id: 0, label: "Default", css: "inherit" },
  // Bundled fonts first, so a name looks the same on every computer and phone.
  { id: 1, label: "Serif", css: '"Lora Variable", Georgia, serif' },
  { id: 2, label: "Rounded", css: '"Nunito Variable", Nunito, system-ui, sans-serif' },
  { id: 3, label: "Mono", css: '"JetBrains Mono Variable", ui-monospace, monospace' },
  { id: 4, label: "Display", css: 'Righteous, "Trebuchet MS", sans-serif' },
  { id: 5, label: "Script", css: '"Dancing Script Variable", cursive' },
] as const;

export const NAME_EFFECTS = [
  { id: 0, label: "None", colors: 0, cost: 0 },
  { id: 1, label: "Solid", colors: 1, cost: 0 },
  { id: 2, label: "Gradient", colors: 2, cost: 0.3 },
  { id: 3, label: "Glow", colors: 1, cost: 0.8 },
  { id: 4, label: "Rainbow", colors: 0, cost: 2 },
  { id: 5, label: "Neon", colors: 1, cost: 1.2 },
] as const;

export const nameFont = (id: number) => NAME_FONTS.find((f) => f.id === id) ?? NAME_FONTS[0];
export const nameEffect = (id: number) => NAME_EFFECTS.find((f) => f.id === id) ?? NAME_EFFECTS[0];
