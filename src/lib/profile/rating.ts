import type { RatingResult } from "../decor/spec";
import { layerReasons, ratingFromScore } from "../decor/rating";
import { layersFor } from "../decor/presets";
import type { ProfileConfig } from "./model";
import { getSlotPreset, nameEffect, slotCost, type SlotKind } from "./presets";

export type PartKey = SlotKind | "name";

export interface ProfileRating {
  total: RatingResult;
  parts: Record<PartKey, RatingResult>;
}

export function rateSlot(kind: SlotKind, c: ProfileConfig[SlotKind]): RatingResult {
  const score = slotCost(kind, c);
  const reasons: string[] = [];
  if (kind === "decor") reasons.push(...layerReasons(layersFor(c)));
  else {
    const r = getSlotPreset(kind, c.preset)?.reason?.(c);
    if (r) reasons.push(r);
  }
  return ratingFromScore(score, reasons);
}

export function rateProfile(p: ProfileConfig): ProfileRating {
  const parts = {
    decor: rateSlot("decor", p.decor),
    effect: rateSlot("effect", p.effect),
    frame: rateSlot("frame", p.frame),
    plate: rateSlot("plate", p.plate),
    name: ratingFromScore(p.name ? nameEffect(p.name.effect).cost : 0),
  };
  const score = Object.values(parts).reduce((a, r) => a + r.score, 0);
  const reasons: string[] = [];
  for (const [k, r] of Object.entries(parts)) {
    if (r.rating === "heavy" || r.rating === "very-poor") reasons.push(...(r.reasons.length ? r.reasons : [`${k} is expensive.`]));
  }
  const active = Object.values(parts).filter((r) => r.score > 0).length;
  if (active >= 4 && score > 28) reasons.push(`${active} effects stacked together.`);
  return { total: ratingFromScore(score, [...new Set(reasons)]), parts };
}
