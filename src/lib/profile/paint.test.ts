import { describe, expect, it } from "vitest";
import { PAINT_STATIC_T, paintFrame, paintPlate } from "./paint";
import { nameCss, readable } from "./nameStyle";
import { FRAME_PRESETS, PLATE_PRESETS } from "./presets";
import { contrast } from "../color";

/** A context that records calls and accepts anything, so we can run every code path without a canvas. */
function fakeCtx() {
  const calls: string[] = [];
  const grad = { addColorStop: () => {} };
  const target: any = {};
  return new Proxy(target, {
    get(_t, k: string) {
      if (k === "calls") return calls;
      if (k.startsWith("create")) return () => grad;
      return (...a: unknown[]) => { calls.push(k); void a; };
    },
    set() { return true; },
  }) as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe("painters", () => {
  it("every frame preset draws something, at any knob setting, without throwing", () => {
    for (const p of FRAME_PRESETS) for (const speed of [0, 15]) for (const intensity of [0, 15]) for (const t of [0, 1.7, 99]) {
      const ctx = fakeCtx();
      paintFrame(ctx, { preset: p.id, hue: 123, speed, intensity }, t, 320, 400);
      expect(ctx.calls.some((c) => c === "stroke" || c === "fill"), p.name).toBe(true);
    }
  });
  it("every plate preset fills the row", () => {
    for (const p of PLATE_PRESETS) for (const t of [0, PAINT_STATIC_T, 50]) {
      const ctx = fakeCtx();
      paintPlate(ctx, { preset: p.id, hue: 300, speed: 8, intensity: 8 }, t, 220, 36);
      expect(ctx.calls.filter((c) => c === "fillRect" || c === "fill" || c === "stroke").length, p.name).toBeGreaterThan(0);
    }
  });
  it("unknown presets and tiny sizes draw nothing and never throw", () => {
    const ctx = fakeCtx();
    paintFrame(ctx, { preset: 200, hue: 0, speed: 0, intensity: 0 }, 0, 4, 4);
    paintPlate(ctx, { preset: 0, hue: 0, speed: 0, intensity: 0 }, 0, 0, 0);
    paintFrame(ctx, { preset: 3, hue: 0, speed: 0, intensity: 0 }, 0, 2, 2);
  });
});

describe("name style", () => {
  const dark = 0x1b1b1f, light = 0xfdfbff;
  it("makes unreadable colors readable on the viewer's surface, both ways", () => {
    for (const [c, bg] of [[0x222222, dark], [0xffffff, light], [0x202030, dark], [0xf8f8f8, light]] as const) {
      expect(contrast(readable(c, bg), bg)).toBeGreaterThanOrEqual(3);
    }
  });
  it("leaves already-readable colors alone", () => expect(readable(0xff9cc2, dark)).toBe(0xff9cc2));
  it("produces CSS for each effect and nothing for no style", () => {
    expect(nameCss(null, dark)).toEqual({ style: {}, class: "" });
    expect(nameCss({ font: 0, effect: 1, c1: 0xff9cc2, c2: 0 }, dark).style.color).toBe("#ff9cc2");
    expect(nameCss({ font: 0, effect: 2, c1: 0xff9cc2, c2: 0xffe0ec }, dark).style["background-image"]).toContain("linear-gradient");
    expect(nameCss({ font: 0, effect: 4, c1: 0, c2: 0 }, dark).class).toBe("n-rainbow");
    expect(nameCss({ font: 3, effect: 3, c1: 0x7df9ff, c2: 0 }, dark).style["text-shadow"]).toContain("0 0 8px");
  });
});
