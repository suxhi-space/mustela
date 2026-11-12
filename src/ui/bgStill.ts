import { createEffect, createRoot, createSignal } from "solid-js";
import { device } from "./store";

/**
 * Performance > "Keep animating in the background" off, for everything that moves by itself, not only Mustela's own
 * animations: while another window is in front, looping GIF videos pause (here) and animated pictures (GIFs, animated
 * emoji, animated avatars) show their first frame (StillImg follows bgPaused); coming back plays them again. A video you're listening to (with
 * sound) keeps playing, so switching windows doesn't cut off what you're hearing.
 */
const [focused, setFocused] = createSignal(typeof document === "undefined" || document.hasFocus());
const [hidden, setHidden] = createSignal(typeof document !== "undefined" && document.hidden);
/** True while Mustela is behind another window and the setting says to hold still. */
export const bgPaused = () => !device().perf.background && (!focused() || hidden());
/** The desktop shell's own focus report (more reliable than the page's, e.g. with a game in front). */
export const setAppFocused = (f: boolean) => setFocused(f);

const pausedVideos = new Set<HTMLVideoElement>();
function hold() {
  for (const v of document.querySelectorAll("video")) {
    if (!v.paused && (v.muted || v.loop)) { v.pause(); pausedVideos.add(v); }
  }
}

function resume() {
  for (const v of pausedVideos) if (v.isConnected) void v.play().catch(() => {});
  pausedVideos.clear();
}

let started = false;
export function startBgStill() {
  if (started || typeof window === "undefined") return;
  started = true;
  addEventListener("focus", () => setFocused(true));
  addEventListener("blur", () => setFocused(false));
  addEventListener("pointerdown", () => setFocused(true), true);
  document.addEventListener("visibilitychange", () => setHidden(document.hidden));
  createRoot(() => createEffect(() => (bgPaused() ? hold() : resume())));
}
