import { describe, expect, it } from "vitest";
import { drawEffect, makeParticles } from "./effects";
import { EFFECT_PRESETS, effectCount, slotFromPreset } from "./presets";

/** A canvas context that records every numeric argument so we can assert none are NaN/Infinity. */
function recordingCtx() {
  const nums: number[] = [];
  let calls = 0;
  const target: any = { calls: () => calls, nums };
  const ctx = new Proxy(target, {
    get(t, k: string) {
      if (k in t) return t[k];
      return (...args: unknown[]) => { calls++; for (const a of args) if (typeof a === "number") nums.push(a); };
    },
    set() { return true; },
  });
  return ctx as unknown as CanvasRenderingContext2D & { calls(): number; nums: number[] };
}

describe("profile effects", () => {
  for (const p of EFFECT_PRESETS) {
    it(`${p.name}: draws something, with finite numbers, at many times and extreme settings`, () => {
      for (const knobs of [{}, { intensity: 0, speed: 0 }, { intensity: 15, speed: 15 }]) {
        const cfg = { ...slotFromPreset("effect", p.id), ...knobs };
        const parts = makeParticles(cfg);
        expect(parts.length).toBe(effectCount(cfg));
        for (const t of [0, 0.016, 1, 3.2, 59.9, 3600, 86400]) {
          const ctx = recordingCtx();
          drawEffect(ctx, cfg, parts, t, 340, 520);
          expect(ctx.calls()).toBeGreaterThan(0);
          expect(ctx.nums.every(Number.isFinite)).toBe(true);
        }
      }
    });
  }

  it("is deterministic: same config gives the same particles", () => {
    const cfg = slotFromPreset("effect", 1);
    expect(makeParticles(cfg)).toEqual(makeParticles({ ...cfg }));
  });

  it("particle count scales with intensity and stays in 8..32", () => {
    const base = slotFromPreset("effect", 2);
    expect(effectCount({ ...base, intensity: 0 })).toBe(8);
    expect(effectCount({ ...base, intensity: 15 })).toBe(32);
  });

  it("stays on screen: positions never leave a padded canvas", () => {
    const cfg = { ...slotFromPreset("effect", 1), intensity: 15 };
    const parts = makeParticles(cfg);
    for (let t = 0; t < 200; t += 7.3) {
      const ctx = recordingCtx();
      drawEffect(ctx, cfg, parts, t, 340, 520);
      expect(ctx.nums.every((n) => Math.abs(n) < 2000)).toBe(true);
    }
  });
});
