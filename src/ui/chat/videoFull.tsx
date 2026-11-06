import { createSignal, Show } from "solid-js";
import { Icon } from "../icons";
import { openGallery, type GalleryItem } from "./Gallery";

/**
 * Videos in the chat (sent ones, link-preview ones, YouTube) open big the same way pictures do: in Mustela's media
 * viewer, carrying on from where they were. From the viewer on a computer, the player's own button can still fill
 * the whole display. In the chat itself the player's full-screen button is hidden (styles.css / mobile.css), so
 * there's one full-screen button, and it does the same thing everywhere.
 */
export function VideoBox(props: { src: string; poster?: string; class?: string; preload?: "none" | "metadata"; onError?: () => void;
  /** Open in the viewer (the message's other pictures too); by default just this video. */
  open?: (start: number) => void; item?: Omit<GalleryItem, "url" | "video" | "start">;
  /** Link previews: a click on the picture opens the viewer (where it plays), like a picture; the controls still work. */
  clickOpens?: boolean }) {
  let v: HTMLVideoElement | undefined;
  const [playing, setPlaying] = createSignal(false);
  const open = () => {
    const start = v?.currentTime ?? 0;
    v?.pause();
    if (props.open) props.open(start);
    else openGallery([{ name: "Video", ...props.item, url: props.src, video: true, preview: props.poster, start }]);
  };
  return (
    <div class="vid-box">
      <video class={props.class ?? "em-video"} controls playsinline preload={props.preload ?? "metadata"} poster={props.poster} src={props.src}
        onError={() => props.onError?.()} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        ref={(el) => { v = el; el.setAttribute("referrerpolicy", "no-referrer"); el.setAttribute("controlslist", "nofullscreen"); }} />
      <Show when={props.clickOpens}><button type="button" class="vid-hit" aria-label="Play in the viewer" tabindex="-1" onClick={open} /></Show>
      <button type="button" class="vid-fs" classList={{ playing: playing() }} aria-label="Full screen" title="Full screen" onClick={open}>
        <Icon name="fullscreen" size={18} />
      </button>
    </div>
  );
}

/** YouTube's player address: without its own full-screen button in the chat; in the viewer only on computers. */
export const ytEmbed = (id: string, fs: boolean) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&fs=${fs ? 1 : 0}`;

