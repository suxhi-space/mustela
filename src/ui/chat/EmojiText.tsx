import { createMemo, For, Show } from "solid-js";
import { PACKED_EMOJI_RE } from "../../lib/emoji";
import { UEmoji } from "./UEmoji";

// Anything that could start an emoji (pictographs, symbols, keycaps, flags, Stoat's style markers). Text without
// one of these (most names) is shown as it is, with no extra work.
const MAYBE = /[©®‼-㊙\uD83C-\uDBFF-⃣]/;

/**
 * Plain text (a name, a status, a channel name) with its emoji drawn in your chosen style, like in messages.
 */
export function TextWithEmoji(props: { v: string }) {
  const parts = createMemo(() => {
    const v = props.v ?? "";
    if (!MAYBE.test(v)) return null;
    const out: { t: string; e?: boolean }[] = [];
    let last = 0;
    for (const m of v.matchAll(PACKED_EMOJI_RE)) {
      if (m.index! > last) out.push({ t: v.slice(last, m.index) });
      out.push({ t: m[0], e: true });
      last = m.index! + m[0].length;
    }
    if (last < v.length) out.push({ t: v.slice(last) });
    return out.some((p) => p.e) ? out : null;
  });
  return (
    <Show when={parts()} fallback={props.v}>{(ps) => (
      <For each={ps()}>{(p) => (p.e ? <span class="uemoji" data-emoji={p.t.replace(/^[-]/, "")}><UEmoji e={p.t} /></span> : p.t.replace(/[-]/g, ""))}</For>
    )}</Show>
  );
}
