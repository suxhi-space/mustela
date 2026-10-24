import { describe, expect, it } from "vitest";
import { DECOR_PRESETS, layersFor } from "./presets";
import { AnimationBudget, rateConfig, rateLayers } from "./rating";
import type { RatingResult } from "./spec";
import { slotFromPreset } from "../profile/presets";

describe("avatar decoration rating", () => {
  it("defaults are Excellent or Good, never worse", () => {
    const r = Object.fromEntries(DECOR_PRESETS.map((p) => [p.name, rateConfig(slotFromPreset("decor", p.id)).rating]));
    console.log("default ratings:", JSON.stringify(r));
    for (const v of Object.values(r)) expect(["excellent", "good"]).toContain(v);
    expect(r["Soft Glow"]).toBe("excellent");
    expect(r["Aurora"]).not.toBe("excellent");
  });

  it("is monotonic: more intensity never lowers the score", () => {
    for (const p of DECOR_PRESETS) {
      let prev = -1;
      for (let i = 0; i <= 15; i++) {
        const s = rateConfig({ ...slotFromPreset("decor", p.id), intensity: i }).score;
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
    }
  });

  it("explains heavy ratings and stays quiet for excellent ones", () => {
    const heavy = rateLayers([
      { type: "aurora", hue: 0, speed: 1, intensity: 1 },
      { type: "aurora", hue: 90, speed: 1, intensity: 1 },
      { type: "sparkles", hue: 0, speed: 1, intensity: 1, count: 40 },
    ]);
    expect(heavy.rating).toBe("very-poor");
    expect(heavy.reasons.length).toBeGreaterThan(0);
    expect(rateConfig(slotFromPreset("decor", 2)).reasons).toEqual([]);
  });

  it("every preset produces layers; preset 0 produces none", () => {
    for (const p of DECOR_PRESETS) expect(layersFor(slotFromPreset("decor", p.id)).length).toBeGreaterThan(0);
    expect(layersFor({ preset: 0, hue: 0, speed: 0, intensity: 0 })).toEqual([]);
  });
});

describe("AnimationBudget", () => {
  const cheap: RatingResult = { score: 10, rating: "excellent", label: "Excellent", reasons: [] };
  const heavy: RatingResult = { score: 40, rating: "heavy", label: "Heavy", reasons: [] };
  const bad: RatingResult = { score: 90, rating: "very-poor", label: "Very Poor", reasons: [] };

  it("caps total animated cost and frees it on release", () => {
    const b = new AnimationBudget({ maxRating: "heavy", budget: 25 });
    const a = b.acquire(cheap), c = b.acquire(cheap), d = b.acquire(cheap);
    expect(a && c).toBeTruthy();
    expect(d).toBeNull();
    a!();
    expect(b.acquire(cheap)).toBeTruthy();
  });

  it("refuses anything rated worse than the viewer allows", () => {
    const b = new AnimationBudget({ maxRating: "good", budget: 1000 });
    expect(b.acquire(heavy)).toBeNull();
    expect(b.acquire(bad)).toBeNull();
    expect(b.acquire(cheap)).toBeTruthy();
  });

  it("a cheap piece of a heavy profile is still refused (rating is whole-profile)", () => {
    const b = new AnimationBudget({ maxRating: "good", budget: 1000 });
    expect(b.tryAcquire(1, "heavy")).toBeNull();
    expect(b.tryAcquire(1, "good")).toBeTruthy();
  });

  it("release is idempotent", () => {
    const b = new AnimationBudget({ maxRating: "heavy", budget: 100 });
    const r = b.acquire(cheap)!;
    r(); r();
    expect(b.usage.used).toBe(0);
  });
});
