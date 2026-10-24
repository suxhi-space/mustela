/**
 * Shared types for everything that animates around a profile.
 *
 * What gets shared between users is NOT drawing code but a tiny config
 * (see profile/pack.ts). Drawings are derived locally from presets.
 * Custom (user-authored) effects are intentionally not in v1; the wire format
 * has a version nibble so they can be added later without breaking presets.
 */

export type LayerType = "ring" | "glow" | "pulse" | "sparkles" | "orbit" | "aurora" | "petals" | "comet";

export interface Layer {
  type: LayerType;
  /** 0-359 */
  hue: number;
  /** Multiplier, 0 (still) to ~2 */
  speed: number;
  /** 0-1 */
  intensity: number;
  /** Particle / orb count where relevant */
  count?: number;
  /** Slowly rotate hue over time (rainbow effects) */
  cycle?: boolean;
}

/** One customizable slot: which preset, plus three knobs stored as small integers. */
export interface SlotConfig {
  /** Preset id within the slot's registry. 0 = none. */
  preset: number;
  /** 0-359 (quantized to 256 steps on the wire) */
  hue: number;
  /** 0-15 */
  speed: number;
  /** 0-15 */
  intensity: number;
}

export const NONE_SLOT: SlotConfig = { preset: 0, hue: 0, speed: 8, intensity: 8 };

export type Rating = "excellent" | "good" | "heavy" | "very-poor";

export interface RatingResult {
  /** Estimated relative per-frame cost. Lower is better. */
  score: number;
  rating: Rating;
  label: string;
  /** Human-readable reasons the rating isn't better. Empty for Excellent. */
  reasons: string[];
}

export const RATING_ORDER: Rating[] = ["excellent", "good", "heavy", "very-poor"];

export function ratingAtMost(r: Rating, max: Rating): boolean {
  return RATING_ORDER.indexOf(r) <= RATING_ORDER.indexOf(max);
}

