import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { emojiName } from "../../lib/emoji";
import { backend } from "../store";
import { UEmoji } from "./UEmoji";

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
    // Touch screens send a "mouse over" for every tap and hold too: there, hovering never shows the card (it used to
    // open while holding a message and stay on top of the hold menu). A tap on the emoji itself shows it briefly.
    let touch = false, downAt = 0, linger: ReturnType<typeof setTimeout> | undefined;
    const hide = () => { current = null; clearTimeout(timer); clearTimeout(linger); setInfo(null); };
    const show = (el: HTMLElement) => {
      const d = describe(el);
      if (!d) return;
      const r = el.getBoundingClientRect();
      setInfo({ ...d, x: r.left + r.width / 2, y: r.top });
    };
    const target = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".uemoji, .cemoji, .reaction:not(.add)") as HTMLElement | null;
      // Only emoji in messages and reactions (and the pickers): not your status in the bar, names, lists or cards.
      return el && el.closest(".msg, .reactions, .emoji-pop, .rv-tabs") ? el : null;
    };
    const over = (e: MouseEvent) => {
      if (touch) return;
      const el = target(e);
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      if (!el) { setInfo(null); return; }
      timer = setTimeout(() => { if (current === el) show(el); }, 380);
    };
    const down = (e: PointerEvent) => { touch = e.pointerType !== "mouse"; downAt = Date.now(); if (touch) hide(); };
    // Touch: a tap on an emoji in a message's text (not a reaction, which a tap toggles, nor the pickers, where it picks).
    const tap = (e: MouseEvent) => {
      // A quick tap only: the end of a hold (which opens the message's menu) never counts.
      if (!touch || Date.now() - downAt > 400) return;
      const el = target(e);
      if (!el || el.closest(".reactions, .emoji-pop, .rv-tabs, a, button")) return;
      show(el); linger = setTimeout(hide, 2500);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("mouseover", over);
    document.addEventListener("click", tap);
    // A hold or right-click opens a menu: the card never stays over it.
    document.addEventListener("contextmenu", hide, true);
    addEventListener("scroll", hide, true);
    addEventListener("blur", hide);
    onCleanup(() => {
      document.removeEventListener("pointerdown", down, true); document.removeEventListener("mouseover", over); document.removeEventListener("click", tap);
      document.removeEventListener("contextmenu", hide, true); removeEventListener("scroll", hide, true); removeEventListener("blur", hide); hide();
    });
  });

  return (
    <Show when={info()}>{(i) => (
      <div class="emoji-info panel" role="tooltip" style={{ left: `${Math.max(120, Math.min(i().x, innerWidth - 120))}px`, top: `${i().y - 10}px` }}>
        <span class="ei-big">
          {/* In your emoji style, the same as in the message. */}
          <Show when={i().big.img} fallback={<UEmoji e={i().big.char ?? ""} />}><img src={i().big.img} alt="" /></Show>
        </span>
        <span class="ei-text">
          <strong>{i().name}</strong>
          <Show when={i().from}><small><Show when={i().fromIcon}><img src={i().fromIcon} alt="" /></Show>{i().from}</small></Show>
        </span>
      </div>
    )}</Show>
  );
}
