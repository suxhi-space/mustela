export type Platform = "android" | "windows" | "mac" | "linux" | "web";

export const inTauri = () => typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;

export function detectPlatform(ua = typeof navigator !== "undefined" ? navigator.userAgent : "", tauri = inTauri()): Platform {
  if (/Android/i.test(ua)) return "android";
  if (!tauri) return "web";
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "web";
}
