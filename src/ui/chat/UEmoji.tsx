import { createSignal, Show } from "solid-js";
import { emojiUrl, PACK_PUA } from "../../lib/emoji";
import { settings } from "../store";

/**
 * A unicode emoji drawn in your chosen Stoat pack (Fluent 3D by default, like
 * Stoat). A pack prefix in the text wins, the same as Stoat. Falls back to
 * the system font if the pack doesn't have it.
 */
export function UEmoji(props: { e: string; class?: string; pack?: string }) {
  const [broken, setBroken] = createSignal<string | null>(null);
  const forced = () => PACK_PUA[props.e[0]!];
  const char = () => (forced() ? props.e.slice(1) : props.e);
  const pack = () => props.pack ?? forced() ?? settings().emojiPack;
  const src = () => emojiUrl(pack(), char());
  // A few files are named without the variation selector, so try that once before giving up.
  const alt = () => emojiUrl(pack(), char().replace(/️/g, ""));
  const [tried, setTried] = createSignal(false);
  return (
    <Show when={pack() !== "system" && broken() !== props.e} fallback={<span class={props.class}>{char()}</span>}>
      <img class={`uemoji-img ${props.class ?? ""}`} src={tried() ? alt() : src()} alt={char()} draggable={false} loading="lazy"
        onError={() => (!tried() && alt() !== src() ? setTried(true) : setBroken(props.e))} />
    </Show>
  );
}
