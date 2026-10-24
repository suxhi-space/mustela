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
