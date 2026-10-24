/**
 * Banner marker: hides a tiny payload (a packed decoration config) in the
 * bottom rows of a banner image, as a strip of 8x8 black/white-ish blocks.
 *
 * Why blocks: lossy compression (JPEG/WebP) wrecks per-pixel tricks like LSB
 * steganography but keeps coarse luminance. 8x8 matches JPEG's DCT grid, so
 * each block survives as one clean DC level.
 *
 * Trade-offs, stated plainly:
 *  - The strip is VISIBLE in other apps (it is a thin gray bar). In this
 *    client the strip is cropped out of the displayed banner.
 *  - It survives lossy re-encoding (tested in codec.test.ts) but NOT
 *    resizing/cropping that breaks the block grid. Whether Stoat's file
 *    server resizes banners must be confirmed against a real instance.
 *  - Payload max is 24 bytes: enough for presets, not for custom code.
 *
 * Works on raw RGBA buffers so the same code runs in a browser canvas and in
 * Node tests.
 */

import { crc16 } from "./crc";

export const BLOCK = 8;
/** Banners are always authored at this width, so decoders can undo server-side resizing. */
export const CANONICAL_WIDTH = 960;
export const CANONICAL_HEIGHT = 320;
export const COPIES = 2;
export const MAX_PAYLOAD = 24;
const MAGIC = [0xa7, 0x5c];
const HEADER = MAGIC.length + 1; // magic + length
const MAX_BITS = (HEADER + MAX_PAYLOAD + 2) * 8;
const MID = 128;

export interface EncodeOptions {
  /** Luma distance from mid-gray per bit. Bigger = sturdier, more visible. */
  delta?: number;
}

function layout(width: number) {
  const perRow = Math.floor(width / BLOCK);
  const rowsPerCopy = Math.ceil(MAX_BITS / perRow);
  return { perRow, rowsPerCopy, stripHeight: rowsPerCopy * COPIES * BLOCK };
}

/** Pixels at the bottom of the banner that hold the marker (hide these when displaying). */
export function markerHeight(width: number): number {
  return layout(width).stripHeight;
}

export function canFit(width: number, height: number): boolean {
  const { perRow, stripHeight } = layout(width);
  return perRow >= 24 && stripHeight <= height / 3;
}

function frameBits(payload: Uint8Array): number[] {
  const body = new Uint8Array(HEADER + payload.length);
  body.set(MAGIC, 0);
  body[2] = payload.length;
  body.set(payload, HEADER);
  const c = crc16(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body, 0);
  frame[body.length] = c >> 8;
  frame[body.length + 1] = c & 0xff;
  const bits: number[] = [];
  for (const byte of frame) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  return bits;
}

/** Writes the marker into `rgba` (in place). Returns the strip height in px. */
export function encodeMarker(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  payload: Uint8Array,
  opts: EncodeOptions = {},
): number {
  if (payload.length > MAX_PAYLOAD) throw new Error(`Payload too large (${payload.length} > ${MAX_PAYLOAD})`);
  if (!canFit(width, height)) throw new Error("Banner is too small to carry a marker");
  const delta = opts.delta ?? 32;
  const { perRow, rowsPerCopy, stripHeight } = layout(width);
  const bits = frameBits(payload);
  const y0 = height - stripHeight;

  // Fill the whole strip with mid-gray first so unused blocks are neutral.
  for (let y = y0; y < height; y++) {
    for (let x = 0; x < width; x++) put(rgba, (y * width + x) * 4, MID);
  }
  for (let c = 0; c < COPIES; c++) {
    const copyY = y0 + c * rowsPerCopy * BLOCK;
    for (let i = 0; i < bits.length; i++) {
      const bx = (i % perRow) * BLOCK;
      const by = copyY + Math.floor(i / perRow) * BLOCK;
      const v = MID + (bits[i] ? delta : -delta);
      for (let y = 0; y < BLOCK; y++) for (let x = 0; x < BLOCK; x++) put(rgba, ((by + y) * width + bx + x) * 4, v);
    }
  }
  return stripHeight;
}

function put(rgba: Uint8ClampedArray | Uint8Array, i: number, v: number) {
  rgba[i] = v;
  rgba[i + 1] = v;
  rgba[i + 2] = v;
  rgba[i + 3] = 255;
}

/** Average luma of the inner 4x4 core of a block (edges bleed under compression). */
function blockLuma(rgba: Uint8ClampedArray | Uint8Array, width: number, bx: number, by: number): number {
  let s = 0;
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      const i = ((by + y) * width + bx + x) * 4;
      s += 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
    }
  }
  return s / 16;
}

/** Returns the payload, or null if no valid marker is present. Never throws on junk input. */
export function decodeMarker(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array | null {
  if (!canFit(width, height) || rgba.length < width * height * 4) return null;
  const { perRow, rowsPerCopy, stripHeight } = layout(width);
  const y0 = height - stripHeight;

  const copies: number[][] = [];
  for (let c = 0; c < COPIES; c++) {
    const copyY = y0 + c * rowsPerCopy * BLOCK;
    const lumas: number[] = [];
    for (let i = 0; i < MAX_BITS; i++) {
      const bx = (i % perRow) * BLOCK;
      const by = copyY + Math.floor(i / perRow) * BLOCK;
      lumas.push(blockLuma(rgba, width, bx, by));
    }
    copies.push(lumas);
  }

  // Calibrate the 0/1 threshold from the known magic bits of each copy.
  const magicBits: number[] = [];
  for (const m of MAGIC) for (let i = 7; i >= 0; i--) magicBits.push((m >> i) & 1);
  const soft = copies.map((lumas) => {
    let s1 = 0, n1 = 0, s0 = 0, n0 = 0;
    magicBits.forEach((b, i) => (b ? ((s1 += lumas[i]!), n1++) : ((s0 += lumas[i]!), n0++)));
    const thr = (s1 / n1 + s0 / n0) / 2;
    return lumas.map((v) => v - thr);
  });

  const summed = soft[0]!.map((_, i) => soft.reduce((a, s) => a + s[i]!, 0));
  // Try combined first (most robust), then each copy alone.
  for (const s of [summed, ...soft]) {
    const out = tryParse(s);
    if (out) return out;
  }
  return null;
}

function tryParse(soft: number[]): Uint8Array | null {
  const bits = soft.map((v) => (v > 0 ? 1 : 0));
  const byteAt = (n: number) => {
    let v = 0;
    for (let i = 0; i < 8; i++) v = (v << 1) | bits[n * 8 + i]!;
    return v;
  };
  if (byteAt(0) !== MAGIC[0] || byteAt(1) !== MAGIC[1]) return null;
  const len = byteAt(2);
  if (len > MAX_PAYLOAD) return null;
  const body = new Uint8Array(HEADER + len);
  for (let i = 0; i < body.length; i++) body[i] = byteAt(i);
  const crc = (byteAt(body.length) << 8) | byteAt(body.length + 1);
  if (crc16(body) !== crc) return null;
  return body.slice(HEADER);
}

/**
 * Decode from an image of ANY size that was originally authored at
 * CANONICAL_WIDTH (aspect ratio preserved when resized). Box-filters the
 * bottom strip back to canonical scale, then decodes normally. Only the strip
 * is resampled, so cost is tiny regardless of the banner's size.
 */
export function decodeMarkerScaled(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Uint8Array | null {
  if (width === CANONICAL_WIDTH) return decodeMarker(rgba, width, height);
  if (width < 240 || rgba.length < width * height * 4) return null;
  const W = CANONICAL_WIDTH;
  const stripH = markerHeight(W);
  const scale = width / W;
  const out = new Uint8Array(W * stripH * 3 * 4); // strip sits at the bottom of a taller blank canvas
  const outH = stripH * 3;
  for (let dy = 0; dy < stripH; dy++) {
    const sy0 = height - (stripH - dy) * scale;
    const sy1 = sy0 + scale;
    for (let dx = 0; dx < W; dx++) {
      const sx0 = dx * scale;
      const sx1 = sx0 + scale;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let y = Math.max(0, Math.floor(sy0)); y < Math.min(height, Math.ceil(sy1)); y++) {
        const wy = Math.min(y + 1, sy1) - Math.max(y, sy0);
        for (let x = Math.floor(sx0); x < Math.min(width, Math.ceil(sx1)); x++) {
          const w = wy * (Math.min(x + 1, sx1) - Math.max(x, sx0));
          const i = (y * width + x) * 4;
          r += rgba[i]! * w; g += rgba[i + 1]! * w; b += rgba[i + 2]! * w; wsum += w;
        }
      }
      const o = ((outH - stripH + dy) * W + dx) * 4;
      if (wsum > 0) { out[o] = r / wsum; out[o + 1] = g / wsum; out[o + 2] = b / wsum; }
      out[o + 3] = 255;
    }
  }
  return decodeMarker(out, W, outH);
}
