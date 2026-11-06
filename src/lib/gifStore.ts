import { inTauri } from "./platform";

/**
 * Favorite GIFs, kept on this device by the app (src-tauri/src/gif_store.rs) so the picker's Favorites show at once.
 * In a browser (the demo) the links are used as they are.
 */
const BASE = (() => {
  if (!inTauri()) return null;
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Windows|Android/i.test(ua) ? "http://gifs.localhost/" : "gifs://localhost/";
})();

/** Where to show a favorite GIF from: the saved copy (fetched the first time if needed). */
export const savedGif = (url: string) => (BASE && url.startsWith("https://") ? `${BASE}?u=${encodeURIComponent(url)}` : url);

let last = "";
/** Tell the app which GIFs are favorites: new ones are saved in the background, removed ones deleted. */
export function syncFavGifs(urls: string[]) {
  if (!BASE) return;
  const key = urls.join("\n");
  if (key === last) return;
  last = key;
  void import("@tauri-apps/api/core").then(({ invoke }) => invoke("warm_gifs", { urls })).catch(() => { last = ""; });
}
