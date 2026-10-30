import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeMarker, decodeMarkerScaled, encodeMarker, markerHeight, MAX_PAYLOAD } from "./codec";
import { packProfile, unpackProfile } from "../profile/pack";
import { sanitizeProfile } from "../profile/model";

const W = 960;
const H = 320;

/** A banner with gradients and noise, so compression has something real to chew on. */
function makeBanner(): Uint8Array {
  const buf = new Uint8Array(W * H * 4);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      buf[i] = (x / W) * 255 * 0.8 + rnd() * 40;
      buf[i + 1] = (y / H) * 200 + rnd() * 40;
      buf[i + 2] = 120 + 80 * Math.sin(x / 40) + rnd() * 30;
      buf[i + 3] = 255;
    }
  }
  return buf;
}

async function roundTrip(
  rgba: Uint8Array,
  fmt: "jpeg" | "webp" | "png",
  quality: number,
  resizeTo?: number,
): Promise<{ data: Uint8Array; w: number; h: number }> {
  let img = sharp(Buffer.from(rgba), { raw: { width: W, height: H, channels: 4 } });
  const encoded = await (fmt === "jpeg"
    ? img.jpeg({ quality, chromaSubsampling: "4:2:0" })
    : fmt === "webp"
      ? img.webp({ quality })
      : img.png()
  ).toBuffer();
  let dec = sharp(encoded);
  if (resizeTo) dec = dec.resize(resizeTo);
  const { data, info } = await dec.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), w: info.width, h: info.height };
}

describe("marker codec", () => {
  // The largest payload we ever send (all slots + theme + name style = 22 bytes).
  const full = sanitizeProfile({
    decor: { preset: 4, hue: 317, speed: 11, intensity: 5 }, effect: { preset: 1, hue: 335, speed: 6, intensity: 9 },
    frame: { preset: 2, hue: 280, speed: 5, intensity: 9 }, plate: { preset: 4, hue: 170, speed: 5, intensity: 9 },
    theme: { primary: 0x3e6eb4, accent: 0xc94f7c }, name: { font: 5, effect: 2, c1: 0xff8800, c2: 0x8800ff },
  });
  const payload = packProfile(full);

  it("round-trips losslessly", () => {
    const img = makeBanner();
    encodeMarker(img, W, H, payload);
    expect(decodeMarker(img, W, H)).toEqual(payload);
  });

  it("returns null for banners with no marker, and never throws on junk", () => {
    expect(decodeMarker(makeBanner(), W, H)).toBeNull();
    expect(decodeMarker(new Uint8Array(10), W, H)).toBeNull();
    expect(decodeMarker(new Uint8Array(W * H * 4), W, H)).toBeNull();
  });

  it("rejects corrupted frames via CRC", () => {
    const img = makeBanner();
    const strip = markerHeight(W);
    encodeMarker(img, W, H, payload);
    // Flip every block of the first bytes of the payload in BOTH copies.
    const y0 = H - strip;
    for (let c = 0; c < 2; c++) {
      const copyY = y0 + c * (strip / 2);
      for (let b = 24; b < 32; b++) {
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const i = ((copyY + y) * W + b * 8 + x) * 4;
            img[i] = img[i + 1] = img[i + 2] = 255 - img[i]!;
          }
      }
    }
    expect(decodeMarker(img, W, H)).toBeNull();
  });

  it("rejects oversized payloads", () => {
    expect(() => encodeMarker(makeBanner(), W, H, new Uint8Array(MAX_PAYLOAD + 1))).toThrow();
  });

  it("payload is the full 22 bytes and survives the full pipeline", () => {
    expect(payload.length).toBe(22);
    const img = makeBanner();
    encodeMarker(img, W, H, payload);
    expect(unpackProfile(decodeMarker(img, W, H)!)).toEqual(full);
  });

  describe("survives lossy re-encoding", () => {
    // Quality floors are the point of this test: if Stoat re-encodes banners,
    // these are the settings that tell us how much margin we have.
    const cases: ["jpeg" | "webp", number][] = [
      ["jpeg", 90], ["jpeg", 75], ["jpeg", 60], ["jpeg", 40],
      ["webp", 90], ["webp", 75], ["webp", 60], ["webp", 40],
    ];
    for (const [fmt, q] of cases) {
      it(`${fmt} q${q}`, async () => {
        const img = makeBanner();
        encodeMarker(img, W, H, payload);
        const out = await roundTrip(img, fmt, q);
        expect(decodeMarker(out.data, out.w, out.h)).toEqual(payload);
      });
    }
  });

  it("PNG is lossless", async () => {
    const img = makeBanner();
    encodeMarker(img, W, H, payload);
    const out = await roundTrip(img, "png", 100);
    expect(decodeMarker(out.data, out.w, out.h)).toEqual(payload);
  });

  describe("survives server-side resizing via decodeMarkerScaled", () => {
    for (const w of [1920, 1280, 800, 640, 480]) {
      for (const [fmt, q] of [["jpeg", 85], ["webp", 70]] as const) {
        it(`${fmt} q${q} resized to ${w}px wide`, async () => {
          const img = makeBanner();
          encodeMarker(img, W, H, payload);
          const out = await roundTrip(img, fmt, q, w);
          expect(decodeMarkerScaled(out.data, out.w, out.h)).toEqual(payload);
        });
      }
    }
    it("returns null for unmarked resized banners", async () => {
      const out = await roundTrip(makeBanner(), "jpeg", 85, 640);
      expect(decodeMarkerScaled(out.data, out.w, out.h)).toBeNull();
    });
  });

  describe("taller 960×480 banners (the strip is out of view)", () => {
    const TH = 480;
    const tall = () => {
      const b = new Uint8Array(W * TH * 4);
      const top = makeBanner();
      b.set(top, 0);
      b.set(top.subarray(0, W * (TH - H) * 4), W * H * 4);
      return b;
    };
    const trip = async (rgba: Uint8Array, q: number, resizeTo?: number) => {
      let dec = sharp(await sharp(Buffer.from(rgba), { raw: { width: W, height: TH, channels: 4 } }).jpeg({ quality: q }).toBuffer());
      if (resizeTo) dec = dec.resize(resizeTo);
      const { data, info } = await dec.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return { data: new Uint8Array(data), w: info.width, h: info.height };
    };
    it("fits, and leaves the shown 3:1 band untouched", () => {
      const img = tall();
      const before = img.slice(0, W * H * 4);
      encodeMarker(img, W, TH, payload);
      expect(img.slice(0, W * H * 4)).toEqual(before);
      expect(markerHeight(W)).toBeLessThanOrEqual(TH - H);
    }, 20_000); // a big image: slow on a busy machine
    for (const w of [960, 1280, 640]) {
      it(`decodes after JPEG and resizing to ${w}px (as 0.1.0 would read it)`, async () => {
        const img = tall();
        encodeMarker(img, W, TH, payload);
        const out = await trip(img, 85, w === 960 ? undefined : w);
        expect(decodeMarkerScaled(out.data, out.w, out.h)).toEqual(payload);
      });
    }
  });
});

