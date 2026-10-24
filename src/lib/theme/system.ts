/**
 * "Use system colors". Where the seed comes from:
 *  - Android 12+: a small native plugin reads the wallpaper-derived accent
 *    (android.R.color.system_accent1_*) and returns it. See src-tauri/plugins/mustela-native.
 *  - Windows / macOS: the OS accent color, via the CSS `AccentColor` keyword.
 *  - Anywhere else: null, and the UI says it isn't available.
 *
 * Everything fails soft: a missing plugin or unsupported keyword is just null.
 */
import { parseHex } from "../color";

const inTauri = () => "__TAURI_INTERNALS__" in globalThis;

export async function getSystemSeed(): Promise<string | null> {
  if (inTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ hex?: string }>("plugin:mustela-native|accent");
      if (r?.hex && parseHex(r.hex) !== null) return r.hex;
    } catch {
      /* no native plugin on this platform */
    }
  }
  return cssAccent();
}

function cssAccent(): string | null {
  try {
    if (typeof document === "undefined" || !CSS.supports("color", "AccentColor")) return null;
    const el = document.createElement("span");
    el.style.color = "AccentColor";
    el.style.display = "none";
    document.body.appendChild(el);
    const rgb = getComputedStyle(el).color;
    el.remove();
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
    if (!m) return null;
    const c = (+m[1]! << 16) | (+m[2]! << 8) | +m[3]!;
    // Chromium's default control blue on platforms with no real accent: not a user choice.
    if (c === 0x0075ff || c === 0x005fcc) return null;
    return "#" + c.toString(16).padStart(6, "0");
  } catch {
    return null;
  }
}
