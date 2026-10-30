import { createEffect, createRoot, createSignal } from "solid-js";
import { setGates, setWindowFocused } from "../lib/render/loop";
import { inTauri } from "../lib/platform";
import { call } from "./call/state";
import { device } from "./store";

/**
 * Settings > Mustela > Performance, applied: the animation loop's speed and pauses,
 * blur, and whether GIFs play by themselves. Calls make everything lighter on their own,
 * so a stream or a game keeps the CPU and GPU.
 */
let started = false;
export function startPerf() {
  if (started) return;
  started = true;
  createRoot(() => {
    // The system's own "reduce motion" (Windows' animation effects, macOS and Android's settings), live.
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const [sysReduce, setSysReduce] = createSignal(mq.matches);
    mq.addEventListener("change", () => setSysReduce(mq.matches));
    createEffect(() => {
      const p = device().perf, rm = device().a11y.reduceMotion;
      const still = rm === "on" || (rm === "system" && sysReduce());
      const inCall = call.active();
      const streaming = inCall && (call.on().screen || call.streams().some((s) => s.watching));
      let fps = p.anim === "reduced" ? 15 : 30;
      if (p.lighterInCalls && inCall) fps = Math.min(fps, streaming ? 10 : 20);
      setGates({ mode: still ? "off" : p.anim, fps, background: p.background, maxDpr: p.anim === "reduced" || streaming ? 1 : 2, systemMotion: false });
      const root = document.documentElement;
      root.toggleAttribute("data-noblur", !p.blur);
      root.toggleAttribute("data-still-gifs", !p.gifs);
      root.dataset.anim = p.anim;
      root.toggleAttribute("data-reduce-motion", still);
    });
  });
  // The desktop shell knows reliably when the window loses focus (a game in front), even in a pop-out.
  if (inTauri()) {
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const w = getCurrentWindow();
      setWindowFocused(await w.isFocused().catch(() => true));
      await w.onFocusChanged(({ payload }) => setWindowFocused(payload));
    }).catch(() => {});
  }
}
