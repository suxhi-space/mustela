import type { Layer, LayerType, Rating, RatingResult, SlotConfig } from "./spec";
import { ratingAtMost } from "./spec";
import { layersFor } from "./presets";

/**
 * Performance rating, in the spirit of VRChat's avatar performance ranks.
 *
 * Costs are relative per-frame estimates calibrated by how expensive each
 * primitive is to rasterize (blended gradients with large overdraw cost more
 * than a stroked arc). They are deliberately simple: a stable, explainable
 * number computed from the config alone, with no server and no trust in the
 * author. Profile-wide rating lives in profile/rating.ts and uses the same scale.
 */

const BASE_COST: Record<LayerType, number> = {
  ring: 3, glow: 4, pulse: 3,
  sparkles: 0.8, // per particle
  orbit: 1.5, // per orb, plus a small base
  aurora: 14,
  petals: 1.0, // per petal (rotated ellipse)
  comet: 2.5, // per comet (head + trail)
};

export const THRESHOLDS: { max: number; rating: Rating; label: string }[] = [
  { max: 12, rating: "excellent", label: "Excellent" },
  { max: 28, rating: "good", label: "Good" },
  { max: 55, rating: "heavy", label: "Heavy" },
  { max: Infinity, rating: "very-poor", label: "Very Poor" },
];

export function ratingFromScore(score: number, reasons: string[] = []): RatingResult {
  const s = Math.round(score * 10) / 10;
  const t = THRESHOLDS.find((x) => s <= x.max)!;
  return { score: s, rating: t.rating, label: t.label, reasons: t.rating === "excellent" ? [] : reasons };
}


export function layerCost(l: Layer): number {
  const k = 0.6 + 0.4 * l.intensity;
  switch (l.type) {
    case "sparkles": return BASE_COST.sparkles * (l.count ?? 8) * k;
    case "orbit": return (2 + BASE_COST.orbit * (l.count ?? 2)) * k;
    case "petals": return BASE_COST.petals * (l.count ?? 6) * k;
    case "comet": return BASE_COST.comet * (l.count ?? 2) * k;
    default: return BASE_COST[l.type] * k;
  }
}

export function layerReasons(layers: Layer[]): string[] {
  const out: string[] = [];
  for (const l of layers) {
    if (l.type === "aurora") out.push("Aurora blends large gradients every frame.");
    if (l.type === "sparkles" && (l.count ?? 0) >= 16) out.push(`${l.count} sparkles animate at once.`);
  }
  if (layers.length > 3) out.push(`${layers.length} stacked layers.`);
  return out;
}

export const decorCost = (cfg: SlotConfig) => layersFor(cfg).reduce((a, l) => a + layerCost(l), 0);

export function rateLayers(layers: Layer[]): RatingResult {
  return ratingFromScore(layers.reduce((a, l) => a + layerCost(l), 0), layerReasons(layers));
}

export function rateConfig(cfg: SlotConfig): RatingResult {
  return rateLayers(layersFor(cfg));
}

/**
 * Per-viewer limits. Two layers of protection:
 *  1. maxRating: anything rated worse than this renders as a still image.
 *  2. AnimationBudget: total animated cost on screen is capped, so a member
 *     list full of "Good" decorations can't add up to a slideshow.
 */
export interface ViewerLimits {
  maxRating: Rating;
  /** Sum of scores allowed to animate at once. */
  budget: number;
}

export const DEFAULT_LIMITS: ViewerLimits = { maxRating: "heavy", budget: 260 };

export class AnimationBudget {
  private used = 0;
  private held = new Map<symbol, number>();
  constructor(private limits: ViewerLimits = DEFAULT_LIMITS) {}

  setLimits(l: ViewerLimits) { this.limits = l; }
  get maxRating() { return this.limits.maxRating; }

  /** `rating` is the rating of the WHOLE profile; `score` is this one piece's cost. */
  tryAcquire(score: number, rating: Rating): (() => void) | null {
    if (!ratingAtMost(rating, this.limits.maxRating)) return null;
    if (this.used + score > this.limits.budget) return null;
    const id = Symbol();
    this.held.set(id, score);
    this.used += score;
    return () => {
      const s = this.held.get(id);
      if (s === undefined) return;
      this.held.delete(id);
      this.used -= s;
    };
  }

  /** Returns a release handle if it may animate, else null (draw static). */
  acquire(r: RatingResult): (() => void) | null {
    return this.tryAcquire(r.score, r.rating);
  }

  get usage() { return { used: this.used, budget: this.limits.budget }; }
}

export { ratingAtMost };
