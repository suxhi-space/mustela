import { backend } from "../store";

/**
 * Reacting feels alive, like Discord's: the emoji pops up from where you reacted (a double tap, a quick reaction from
 * the hold menu) and floats away. The reaction chip itself bumps too (ReactionChip). Nothing moves with reduced motion.
 */
const isCustom = (e: string) => /^[0-9A-Z]{26}$/.test(e);

export function reactBurst(x: number, y: number, emoji: string) {
  if (document.documentElement.hasAttribute("data-reduce-motion")) return;
  const el = document.createElement("div");
  el.className = "react-burst";
  el.style.left = `${x}px`; el.style.top = `${y}px`;
  if (isCustom(emoji)) { const img = document.createElement("img"); img.src = backend()?.emojiUrl(emoji) ?? ""; img.alt = ""; el.append(img); }
  else el.textContent = emoji;
  document.body.append(el);
  setTimeout(() => el.remove(), 900);
}

/** From the middle of an element (the message you reacted to). */
export function reactBurstOn(target: Element | null, emoji: string) {
  if (!target) return;
  const r = target.getBoundingClientRect();
  reactBurst(r.left + Math.min(r.width / 2, 160), r.top + r.height / 2, emoji);
}

/** Reactions you just added (so the chip that appears for them pops as it arrives). */
const recent = new Map<string, number>();
export function markReacted(messageId: string, emoji: string) { recent.set(`${messageId}:${emoji}`, Date.now()); if (recent.size > 50) recent.delete(recent.keys().next().value!); }
export const justReacted = (messageId: string, emoji: string) => Date.now() - (recent.get(`${messageId}:${emoji}`) ?? 0) < 3000;
