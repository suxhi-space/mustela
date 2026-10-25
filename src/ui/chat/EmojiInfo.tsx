import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { emojiName } from "../../lib/emoji";
import { backend } from "../store";

type Info = { x: number; y: number; big: { img?: string; char?: string }; name: string; from?: string; fromIcon?: string };

/**
 * Hover an emoji (in a message or a reaction) to see what it is: the emoji
 * large, its :name:, and for custom emoji which server it comes from.
 */
export function EmojiInfo() {
  const [info, setInfo] = createSignal<Info | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: Element | null = null;

  const describe = (el: HTMLElement): Omit<Info, "x" | "y"> | null => {
    const id = el.dataset.emojiId ?? (el.closest(".reaction")?.querySelector<HTMLElement>("[data-emoji-id]")?.dataset.emojiId);
    if (id) {
      const e = backend()?.emojis().find((x) => x.id === id);
      return { big: { img: backend()?.emojiUrl(id) }, name: `:${e?.name ?? "unknown"}:`, from: e?.serverName ? `From ${e.serverName}` : "From a server you're not in", fromIcon: e?.serverIcon };
    }
    const ch = el.dataset.emoji ?? el.closest(".reaction")?.querySelector<HTMLElement>("[data-emoji]")?.dataset.emoji;
    if (ch) { const n = emojiName(ch); return { big: { char: ch }, name: n ? `:${n}:` : ch }; }
    return null;
  };

  onMount(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".uemoji, .cemoji, .reaction:not(.add)") as HTMLElement | null;
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      if (!el) { setInfo(null); return; }
      timer = setTimeout(() => {
        const d = describe(el);
        if (!d || current !== el) return;
        const r = el.getBoundingClientRect();
        setInfo({ ...d, x: r.left + r.width / 2, y: r.top });
      }, 380);
    };
    const hide = () => { current = null; clearTimeout(timer); setInfo(null); };
    document.addEventListener("mouseover", over);
    addEventListener("scroll", hide, true);
    addEventListener("blur", hide);
    onCleanup(() => { document.removeEventListener("mouseover", over); removeEventListener("scroll", hide, true); removeEventListener("blur", hide); clearTimeout(timer); });
  });

  return (
    <Show when={info()}>{(i) => (
      <div class="emoji-info panel" role="tooltip" style={{ left: `${Math.max(120, Math.min(i().x, innerWidth - 120))}px`, top: `${i().y - 10}px` }}>
        <span class="ei-big">
          <Show when={i().big.img} fallback={<span>{i().big.char}</span>}><img src={i().big.img} alt="" /></Show>
        </span>
        <span class="ei-text">
          <strong>{i().name}</strong>
          <Show when={i().from}><small><Show when={i().fromIcon}><img src={i().fromIcon} alt="" /></Show>{i().from}</small></Show>
        </span>
      </div>
    )}</Show>
  );
}
