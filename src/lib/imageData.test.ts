import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { imageSize } from "./imageData";

describe("imageSize reads dimensions without decoding", () => {
  const base = () => sharp({ create: { width: 321, height: 123, channels: 3, background: { r: 200, g: 50, b: 50 } } });
  for (const fmt of ["png", "jpeg", "webp", "gif"] as const) {
    it(fmt, async () => {
      const buf = await (fmt === "png" ? base().png() : fmt === "jpeg" ? base().jpeg() : fmt === "webp" ? base().webp() : base().gif()).toBuffer();
      expect(imageSize(new Uint8Array(buf))).toEqual({ width: 321, height: 123 });
    });
  }
  it("lossless WebP", async () => {
    const buf = await base().webp({ lossless: true }).toBuffer();
    expect(imageSize(new Uint8Array(buf))).toEqual({ width: 321, height: 123 });
  });
  it("returns null for junk", () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
  });
});
