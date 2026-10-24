import { describe, expect, it } from "vitest";
import { buildRoles, THEMES, TEXT_PAIRS, toCssVars, getTheme } from "./palette";
import { contrast, hslToRgb, mix, parseHex, snap, textOn, from565, to565, hex } from "../color";

const c = (s: string) => parseHex(s)!;

describe("every theme x mode keeps text readable (WCAG AA 4.5:1)", () => {
  for (const t of THEMES) {
    for (const mode of ["light", "dark"] as const) {
      for (const amoled of mode === "dark" ? [false, true] : [false]) {
        it(`${t.id} ${mode}${amoled ? " amoled" : ""}`, () => {
          const roles = buildRoles(t.seed, mode, { neutral: t.neutral, amoled });
          for (const [fg, bg] of TEXT_PAIRS) {
            const ratio = contrast(c(roles[fg]!), c(roles[bg]!));
            expect(ratio, `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
          }
        });
      }
    }
  }
});

describe("roles", () => {
  it("light is light and dark is dark", () => {
    const l = buildRoles("#3E6EB4", "light"), d = buildRoles("#3E6EB4", "dark");
    expect(contrast(c(l.surface!), 0xffffff)).toBeLessThan(1.2);
    expect(contrast(c(d.surface!), 0x000000)).toBeLessThan(1.5);
  });
  it("amoled is true black", () => {
    expect(buildRoles("#3E6EB4", "dark", { amoled: true }).surface).toBe("#000000");
    expect(buildRoles("#3E6EB4", "light", { amoled: true }).surface).not.toBe("#000000");
  });
  it("different seeds give different primaries", () => {
    const set = new Set(THEMES.map((t) => buildRoles(t.seed, "dark", { neutral: t.neutral }).primary));
    expect(set.size).toBe(THEMES.length);
  });
  it("neutral themes are low-chroma", () => {
    const g = buildRoles("#6B7480", "dark", { neutral: true }).surfaceContainer!;
    const n = c(g);
    expect(Math.max(n >> 16, (n >> 8) & 255, n & 255) - Math.min(n >> 16, (n >> 8) & 255, n & 255)).toBeLessThan(14);
  });
  it("css vars are kebab-cased and prefixed", () => {
    const v = toCssVars(buildRoles("#3E6EB4", "light"));
    expect(v["--md-on-primary-container"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(v["--md-surface-container-high"]).toBeTruthy();
  });
  it("unknown theme id falls back", () => expect(getTheme("nope").id).toBe("lagoon"));
});

describe("color helpers", () => {
  it("565 snapping is idempotent and keeps extremes exact", () => {
    for (const x of [0x000000, 0xffffff, 0x123456, 0xfe0080, 0x7f7f7f]) {
      expect(snap(snap(x))).toBe(snap(x));
    }
    expect(snap(0xffffff)).toBe(0xffffff);
    expect(snap(0)).toBe(0);
    expect(from565(to565(0xff0000))).toBe(0xff0000);
  });
  it("snap error is small", () => {
    for (const x of [0x123456, 0xabcdef, 0x808080]) {
      const s = snap(x);
      for (const sh of [16, 8, 0]) expect(Math.abs(((s >> sh) & 255) - ((x >> sh) & 255))).toBeLessThanOrEqual(8);
    }
  });
  it("textOn picks a readable color", () => {
    expect(textOn(0x000000)).toBe(0xffffff);
    expect(textOn(0xffffff)).toBe(0x000000);
    for (const bg of [0x3e6eb4, 0xc94f7c, 0xf5e663, 0x20c997]) expect(contrast(bg, textOn(bg))).toBeGreaterThan(4);
  });
  it("hex/parse/mix/hsl", () => {
    expect(hex(0x00ff7f)).toBe("#00ff7f");
    expect(parseHex("nope")).toBeNull();
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(hslToRgb(0, 100, 50)).toBe(0xff0000);
    expect(hslToRgb(120, 100, 50)).toBe(0x00ff00);
  });
});
