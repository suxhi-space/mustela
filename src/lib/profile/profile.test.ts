import { describe, expect, it } from "vitest";
import { packProfile, unpackProfile, PACKED_MAX, PACKED_MIN } from "./pack";
import { DEFAULT_PROFILE, isPlain, quantizeHue, sanitizeProfile, type ProfileConfig } from "./model";
import { EFFECT_PRESETS, FRAME_PRESETS, NAME_EFFECTS, NAME_FONTS, PLATE_PRESETS, SLOT_PRESETS, slotFromPreset, type SlotKind } from "./presets";
import { rateProfile, rateSlot } from "./rating";

/** Tiny seeded RNG so "random" tests are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomProfile(r: () => number): ProfileConfig {
  const slot = (k: SlotKind) => {
    const list = SLOT_PRESETS[k];
    const pick = r() < 0.2 ? 0 : list[Math.floor(r() * list.length)]!.id;
    return { preset: pick, hue: Math.floor(r() * 360), speed: Math.floor(r() * 16), intensity: Math.floor(r() * 16) };
  };
  return sanitizeProfile({
    decor: slot("decor"), effect: slot("effect"), frame: slot("frame"), plate: slot("plate"),
    theme: r() < 0.5 ? { primary: Math.floor(r() * 0x1000000), accent: Math.floor(r() * 0x1000000) } : null,
    name: r() < 0.5 ? {
      font: NAME_FONTS[Math.floor(r() * NAME_FONTS.length)]!.id,
      effect: NAME_EFFECTS[Math.floor(r() * NAME_EFFECTS.length)]!.id,
      c1: Math.floor(r() * 0x1000000), c2: Math.floor(r() * 0x1000000),
    } : null,
  });
}

describe("wire format v2", () => {
  it("round-trips 2000 random profiles exactly, within size limits", () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const p = randomProfile(r);
      const b = packProfile(p);
      expect(b.length).toBeGreaterThanOrEqual(PACKED_MIN);
      expect(b.length).toBeLessThanOrEqual(PACKED_MAX);
      expect(unpackProfile(b)).toEqual(p);
    }
  });

  it("default profile is 13 bytes; maximum is 22", () => {
    expect(packProfile(DEFAULT_PROFILE).length).toBe(13);
    const full = sanitizeProfile({ theme: { primary: 1, accent: 2 }, name: { font: 1, effect: 2, c1: 3, c2: 4 } });
    expect(packProfile(full).length).toBe(22);
  });

  it("rejects unknown versions, reserved flag bits and truncation", () => {
    const good = packProfile(DEFAULT_PROFILE);
    const v3 = good.slice(); v3[0] = (3 << 4) | (v3[0]! & 15);
    const v1 = good.slice(); v1[0] = (1 << 4);
    const reserved = good.slice(); reserved[0] = reserved[0]! | 0b0100;
    const withTheme = packProfile(sanitizeProfile({ theme: { primary: 1, accent: 2 } }));
    for (const b of [v3, v1, reserved, good.slice(0, 12), withTheme.slice(0, 15), new Uint8Array(0)]) expect(unpackProfile(b)).toBeNull();
  });

  it("an unknown preset from a newer client degrades that slot only", () => {
    const b = packProfile(sanitizeProfile({ decor: slotFromPreset("decor", 2), effect: slotFromPreset("effect", 1), frame: slotFromPreset("frame", 1) }));
    b[1 + 3] = 200; // effect slot preset -> unknown
    const p = unpackProfile(b)!;
    expect(p.effect.preset).toBe(0);
    expect(p.decor.preset).toBe(2);
    expect(p.frame.preset).toBe(1);
  });

  it("junk bytes never throw", () => {
    const r = rng(99);
    for (let i = 0; i < 3000; i++) {
      const b = Uint8Array.from({ length: Math.floor(r() * 30) }, () => Math.floor(r() * 256));
      expect(() => unpackProfile(b)).not.toThrow();
    }
  });
});

describe("sanitize", () => {
  it("is idempotent", () => {
    const r = rng(3);
    for (let i = 0; i < 300; i++) {
      const p = randomProfile(r);
      expect(sanitizeProfile(p)).toEqual(p);
    }
  });
  it("hue quantization is stable", () => {
    for (let h = 0; h < 360; h++) expect(quantizeHue(quantizeHue(h))).toBe(quantizeHue(h));
    expect(quantizeHue(-10)).toBe(quantizeHue(350));
    expect(quantizeHue(360)).toBe(0);
  });
  it("garbage becomes the default", () => {
    for (const x of [null, 1, "x", []]) expect(sanitizeProfile(x)).toEqual(DEFAULT_PROFILE);
  });
  it("name style with font 0 and effect 0 collapses to null", () => {
    expect(sanitizeProfile({ name: { font: 0, effect: 0, c1: 1, c2: 2 } }).name).toBeNull();
  });
  it("isPlain", () => {
    expect(isPlain(sanitizeProfile({ decor: { preset: 0 } }))).toBe(true);
    expect(isPlain(DEFAULT_PROFILE)).toBe(false);
  });
});

describe("registries", () => {
  it("ids are unique and positive within each slot", () => {
    for (const k of Object.keys(SLOT_PRESETS) as SlotKind[]) {
      const ids = SLOT_PRESETS[k].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toBeGreaterThan(0);
    }
  });
  it("every preset's defaults give a non-negative cost and a rating", () => {
    for (const k of Object.keys(SLOT_PRESETS) as SlotKind[])
      for (const p of SLOT_PRESETS[k]) expect(rateSlot(k, slotFromPreset(k, p.id)).score).toBeGreaterThan(0);
  });
  it("fonts and effects are resolvable", () => {
    expect(NAME_FONTS.length).toBeGreaterThan(3);
    expect(EFFECT_PRESETS.length + FRAME_PRESETS.length + PLATE_PRESETS.length).toBeGreaterThan(15);
  });
});

describe("profile rating", () => {
  it("every single default preset is Excellent or Good", () => {
    for (const k of Object.keys(SLOT_PRESETS) as SlotKind[])
      for (const p of SLOT_PRESETS[k]) expect(["excellent", "good"]).toContain(rateSlot(k, slotFromPreset(k, p.id)).rating);
  });
  it("effect cost rises with intensity (more particles)", () => {
    for (const p of EFFECT_PRESETS) {
      let prev = -1;
      for (let i = 0; i <= 15; i++) {
        const s = rateSlot("effect", { ...slotFromPreset("effect", p.id), intensity: i }).score;
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
    }
  });
  it("a modest profile is Good, a maxed-out one is Heavy or worse, with reasons", () => {
    const modest = rateProfile(sanitizeProfile({ decor: slotFromPreset("decor", 1), effect: slotFromPreset("effect", 1), frame: slotFromPreset("frame", 3) }));
    expect(["excellent", "good"]).toContain(modest.total.rating);
    const max = (k: SlotKind, id: number) => ({ ...slotFromPreset(k, id), intensity: 15 });
    const loud = rateProfile(sanitizeProfile({
      decor: max("decor", 8), effect: max("effect", 3), frame: max("frame", 2), plate: max("plate", 4),
      name: { font: 1, effect: 4, c1: 0, c2: 0 },
    }));
    console.log("maxed profile:", loud.total.score, loud.total.rating, loud.total.reasons);
    expect(["heavy", "very-poor"]).toContain(loud.total.rating);
    expect(loud.total.reasons.length).toBeGreaterThan(0);
  });
  it("plain profile costs nothing", () => {
    expect(rateProfile(sanitizeProfile({ decor: { preset: 0 } })).total.score).toBe(0);
  });
});
