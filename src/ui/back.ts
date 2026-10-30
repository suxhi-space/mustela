import { onCleanup } from "solid-js";
import { inTauri } from "../lib/platform";

/**
 * Android's back button, the way Android apps behave: it closes whatever is on top
 * (a menu, a dialog, settings, a profile), then steps back through the screens
 * (channel → channel list), and only on the first screen sends Mustela to the
 * background, where a call keeps going.
 *
 * Anything that opens on top calls useBack(close) while it's open. The newest one
 * closes first.
 */
const stack: { close(): void }[] = [];
let screens: (() => boolean) | null = null;

export function useBack(close: () => void) {
  const entry = { close };
  stack.push(entry);
  onCleanup(() => { const i = stack.lastIndexOf(entry); if (i >= 0) stack.splice(i, 1); });
}

/** The shell's own step back between screens; returns false when there's nowhere left to go. */
export function setScreenBack(f: (() => boolean) | null) { screens = f; }

/** One press of Back. Exported so it can be tested and used by a phone's back gesture in a browser. */
export function goBack(): boolean {
  const top = stack[stack.length - 1];
  if (top) { top.close(); return true; }
  return screens?.() ?? false;
}

let started = false;
export async function startBackButton(platform: string) {
  if (started || platform !== "android" || !inTauri()) return;
  started = true;
  const { onBackButtonPress } = await import("@tauri-apps/api/app");
  await onBackButtonPress(() => {
    if (goBack()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("plugin:mustela-native|background")).catch(() => {});
  });
}
