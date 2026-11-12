import { createEffect, onCleanup, Show, splitProps, type JSX } from "solid-js";
import { bgPaused } from "./bgStill";
import { device } from "./store";

/**
 * Whether moving pictures may move right now. GIFs and animated emoji: "Play GIFs and animated emoji" on, and Mustela
 * in front (or "Keep animating in the background" on). Anything else animated (avatars): just the second part.
 */
export const gifsMove = () => device().perf.gifs && !bgPaused();
export const motionOk = () => !bgPaused();

/**
 * A picture that holds still on its first frame when `still` is set: drawn by Mustela onto a canvas from the picture
 * itself (no second download, nothing to fail), with the same classes so it sits exactly where the picture was.
 * Without `still` it's an ordinary picture, moving as usual.
 */
export function StillImg(props: JSX.ImgHTMLAttributes<HTMLImageElement> & { src: string; still: boolean }) {
  const [own, rest] = splitProps(props, ["src", "still", "class", "classList", "style", "onError"]);
  return (
    <Show when={own.still} fallback={<img {...rest} src={own.src} class={own.class} classList={own.classList} style={own.style} onError={own.onError} />}>
      <canvas class={`${own.class ?? ""} still-frame`} classList={own.classList} style={own.style as JSX.CSSProperties}
        role={rest.alt ? "img" : undefined} aria-label={rest.alt || undefined} title={rest.title}
        data-emoji-id={(rest as Record<string, unknown>)["data-emoji-id"] as string | undefined}
        onPointerEnter={(e) => (rest.onPointerEnter as unknown as ((e: PointerEvent) => void) | undefined)?.(e)}
        onPointerLeave={(e) => (rest.onPointerLeave as unknown as ((e: PointerEvent) => void) | undefined)?.(e)}
        ref={(c) => {
          createEffect(() => {
            const src = own.src;
            const im = new Image();
            let live = true;
            im.decoding = "async";
            im.onload = () => {
              if (!live) return;
              // Drawn at the picture's own size (up to 512px); CSS scales the canvas like it scaled the picture.
              const s = Math.min(1, 512 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
              c.width = Math.max(1, Math.round((im.naturalWidth || 1) * s)); c.height = Math.max(1, Math.round((im.naturalHeight || 1) * s));
              c.getContext("2d")?.drawImage(im, 0, 0, c.width, c.height);
            };
            im.onerror = () => { if (live) (own.onError as ((e: Event) => void) | undefined)?.(new Event("error")); };
            im.src = src;
            onCleanup(() => { live = false; im.onload = null; im.onerror = null; });
          });
        }} />
    </Show>
  );
}
