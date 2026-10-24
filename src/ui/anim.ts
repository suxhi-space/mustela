import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { ProfileConfig } from "../lib/profile/model";
import { slotCost, type SlotKind } from "../lib/profile/presets";
import { rateProfile } from "../lib/profile/rating";
import { budget, settings } from "./store";

const cache = new Map<string, ReturnType<typeof rateProfile>>();
/** Rating of a whole profile, cached by content so lists don't re-score identical profiles. */
export function ratingOf(c: ProfileConfig) {
  const k = JSON.stringify(c);
  let r = cache.get(k);
  if (!r) {
    if (cache.size > 300) cache.clear();
    r = rateProfile(c);
    cache.set(k, r);
  }
  return r;
}

/**
 * Whether this part of this profile may animate right now. Holds a share of
 * the global animation budget while it does, and gives it back on cleanup.
 * A profile rated worse than the viewer's limit never animates.
 */
export function createAnim(cfg: Accessor<ProfileConfig | null | undefined>, part: SlotKind): Accessor<boolean> {
  const [on, setOn] = createSignal(false);
  createEffect(() => {
    const c = cfg();
    settings().maxRating; // re-evaluate when the viewer changes their limit
    if (!c || !c[part].preset) { setOn(false); return; }
    const release = budget.tryAcquire(slotCost(part, c[part]), ratingOf(c).total.rating);
    setOn(!!release);
    onCleanup(() => release?.());
  });
  return on;
}
