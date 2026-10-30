import { createEffect, createSignal, onCleanup } from "solid-js";
import { device } from "./store";

/**
 * For looping GIF videos: they play only while on screen, and with Performance >
 * "Play GIFs and animated emoji" off, only while you point at them. Call it in a
 * component and pass the result as the video's ref.
 */
export function useAutoplay() {
  const [seen, setSeen] = createSignal(false);
  const [hover, setHover] = createSignal(false);
  const [hidden, setHidden] = createSignal(typeof document !== "undefined" && document.hidden);
  let io: IntersectionObserver | undefined;
  const vis = () => setHidden(document.hidden);
  document.addEventListener("visibilitychange", vis);
  onCleanup(() => { io?.disconnect(); document.removeEventListener("visibilitychange", vis); });
  return (v: HTMLVideoElement) => {
    v.autoplay = false; v.muted = true; v.loop = true; v.playsInline = true;
    io = new IntersectionObserver((es) => setSeen(es.some((e) => e.isIntersecting)), { rootMargin: "100px" });
    io.observe(v);
    const host = v.parentElement ?? v;
    host.addEventListener("pointerenter", () => setHover(true));
    host.addEventListener("pointerleave", () => setHover(false));
    createEffect(() => {
      const play = seen() && !hidden() && (hover() || device().perf.gifs);
      if (play) void v.play().catch(() => {}); else v.pause();
    });
  };
}
