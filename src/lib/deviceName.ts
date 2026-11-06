import { inTauri } from "./platform";

/**
 * What this device is called in your list of sessions, like Stoat does it: "Mustela for Windows (DESKTOP-4F2)",
 * "Mustela for Android (Pixel 8)", "Mustela for Web (Firefox)".
 */
export async function sessionName(): Promise<string> {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "macOS" : /Linux|X11/i.test(ua) ? "Linux" : "";
  let device = "";
  if (os === "Android") device = /Android [\d.]+; ([^;)]+?)(?: Build\/|\))/.exec(ua)?.[1]?.trim() ?? "";
  else if (inTauri()) {
    try { const { invoke } = await import("@tauri-apps/api/core"); device = (await invoke<string>("device_name")).trim(); } catch { /* no name: just the system */ }
  }
  if (!inTauri()) {
    const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
    return `Mustela for Web${browser || os ? ` (${[browser, os].filter(Boolean).join(" on ")})` : ""}`;
  }
  device = device.replace(/[^\p{L}\p{N} ._'()-]/gu, "").slice(0, 40);
  return `Mustela for ${os || "Desktop"}${device ? ` (${device})` : ""}`;
}
