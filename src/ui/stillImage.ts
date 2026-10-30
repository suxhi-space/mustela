import { fetchBytes } from "../lib/net";

/**
 * The first frame of an animated picture (custom emoji, avatars) as a small PNG, so
 * "Play GIFs and animated emoji: off" can show it still until you point at it.
 * Made once per picture and kept for the session.
 */
const cache = new Map<string, Promise<string | null>>();
export function stillOf(url: string): Promise<string | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const bmp = await createImageBitmap(new Blob([(await fetchBytes(url)) as BlobPart]));
        const cv = document.createElement("canvas");
        cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext("2d")!.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/png"));
        return blob ? URL.createObjectURL(blob) : null;
      } catch { return null; }
    })();
    if (cache.size > 400) cache.clear();
    cache.set(url, p);
  }
  return p;
}
