import { createEffect, createSignal, on, Show } from "solid-js";
import { emojiReady, emojiRetry, emojiUrl, loadEmoji, PACK_PUA } from "../../lib/emoji";
import { settings } from "../store";

/**
 * A unicode emoji drawn in your chosen style (Settings > Appearance; Fluent 3D by default, like Stoat). A style
 * marker in the text wins, the same as Stoat.
 *
 * Nothing waits on a download: the system's own emoji shows at once and the styled picture replaces it as soon as
 * it's loaded. Pictures are loaded once and shared (lib/emoji.ts), so the second time an emoji appears anywhere it
 * is drawn straight away. If the style doesn't have that emoji, the system one stays.
 */
export function UEmoji(props: { e: string; class?: string; pack?: string }) {
  const forced = () => PACK_PUA[props.e[0]!];
  const char = () => (forced() ? props.e.slice(1) : props.e);
  const pack = () => props.pack ?? forced() ?? settings().emojiPack;
  // A few files are named without the variation selector: try that one if the first doesn't exist.
  const urls = () => { const a = emojiUrl(pack(), char()), b = emojiUrl(pack(), char().replace(/️/g, "")); return a === b ? [a] : [a, b]; };
  const firstReady = () => urls().find(emojiReady) ?? null;
  const [src, setSrc] = createSignal<string | null>(pack() === "system" ? null : firstReady());
  createEffect(on([pack, char, emojiRetry], () => {
    if (pack() === "system") { setSrc(null); return; }
    const now = firstReady();
    setSrc(now);
    if (now) return;
    const want = urls();
    void (async () => {
      for (const u of want) if (await loadEmoji(u)) { if (urls()[0] === want[0]) setSrc(u); return; }
    })();
  }));
  return (
    <Show when={src()} fallback={<span class={`ue-glyph ${props.class ?? ""}`}>{char()}</span>}>
      {(s) => <img class={`uemoji-img ${props.class ?? ""}`} src={s()} alt={char()} draggable={false} />}
    </Show>
  );
}
