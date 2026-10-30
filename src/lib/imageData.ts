export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/** Decode image bytes to RGBA without any color conversion (the banner marker is gray-level sensitive). */
export async function decodeImage(bytes: Uint8Array): Promise<Pixels> {
  const blob = new Blob([bytes as BlobPart]);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const { width, height } = bmp;
  const cv: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

/** Width and height from an image file's header (PNG, JPEG, GIF, WebP), without decoding it. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i]! << 8) | b[i + 1]!, u16le = (i: number) => b[i]! | (b[i + 1]! << 8);
  const u32be = (i: number) => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32be(16), height: u32be(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: u16le(6), height: u16le(8) };
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (kind === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    if (kind === "VP8 ") return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (kind === "VP8L") { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: u16be(i + 5), width: u16be(i + 7) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

/** The most pixels a banner may have before we refuse to decode it (about 4096 × 4096). */
export const MAX_PIXELS = 4096 * 4096;

/**
 * Decodes only the bottom `fraction` of an image (where the profile strip lives), after checking
 * its size from the header. A huge or malformed picture is refused instead of filling memory.
 */
export async function decodeBottom(bytes: Uint8Array, fraction = 0.25): Promise<Pixels> {
  const size = imageSize(bytes);
  if (!size || size.width < 1 || size.height < 1 || size.width * size.height > MAX_PIXELS) throw new Error("image refused");
  const blob = new Blob([bytes as BlobPart]);
  const h = Math.max(1, Math.ceil(size.height * fraction)), y = size.height - h;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, 0, y, size.width, h, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  } catch {
    bmp = await createImageBitmap(blob, 0, y, size.width, h);
  }
  const cv: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  const ctx = cv.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  const out = { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
  bmp.close?.();
  return out;
}
