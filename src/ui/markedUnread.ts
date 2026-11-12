import { createSignal } from "solid-js";
import type { ChannelInfo } from "../lib/backend/types";
import { backend } from "./store";

/**
 * Chats you marked unread yourself (on this device).
 *
 * "Mark as unread" picks a message; Stoat only keeps "read up to just before it". The message is remembered here so
 * opening the chat again puts the New line on it, your own messages included. The badge on the chat (its row and
 * its picture under Home) shows just a dot, not a number: how many messages are after the one you picked is only
 * known for the ones Mustela has loaded, so a count was often wrong (3 for 13). Once someone writes again, it counts
 * only what came in after you marked it.
 */
type Mark = { mid: string; base: number };
const KEY = "mustela:marked-unread";

function load(): Record<string, Mark> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
    // (Older versions kept just the message id.)
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? { mid: v, base: Infinity } : v as Mark]));
  } catch { return {}; }
}
const [marks, setMarks] = createSignal<Record<string, Mark>>(load());
function save(m: Record<string, Mark>) {
  const kept = Object.fromEntries(Object.entries(m).slice(-50));
  setMarks(kept);
  try { localStorage.setItem(KEY, JSON.stringify(kept, (_k, v) => (v === Infinity ? 1e9 : v))); } catch { /* storage off */ }
}

/** How many unread messages the chat counts right now (what's after the one you picked, as far as is loaded). */
const countNow = (channelId: string) => backend()?.unreadCount(channelId) ?? 0;

/** Remember a chat marked unread at `messageId`. What it counts at that moment is the baseline (settles shortly). */
export function rememberMarked(channelId: string, messageId: string) {
  save({ ...marks(), [channelId]: { mid: messageId, base: 0 } });
  // Stoat takes a moment to apply it: take the baseline once it has.
  for (const ms of [0, 400, 1500]) setTimeout(() => {
    const m = marks()[channelId];
    if (m?.mid === messageId) save({ ...marks(), [channelId]: { ...m, base: Math.max(m.base, countNow(channelId)) } });
  }, ms);
}

/** The message you marked unread in this chat, if it's still unread (read elsewhere since = forgotten). Taken once. */
export function takeMarked(channelId: string, lastRead: string | undefined): string | null {
  const all = { ...marks() }, m = all[channelId];
  if (!m) return null;
  delete all[channelId]; save(all);
  return lastRead !== undefined && lastRead < m.mid ? m.mid : null;
}

/**
 * The badge for a DM or group: a number, or "dot" for one you marked unread with nothing new since, or 0 for none.
 */
export function unreadBadge(c: ChannelInfo): number | "dot" {
  if (!c.unread || c.muted) return c.mentions ?? 0;
  const n = Math.max(c.mentions ?? 0, countNow(c.id));
  const m = marks()[c.id];
  if (!m) return n;
  const fresh = n - (Number.isFinite(m.base) ? m.base : n);
  return fresh > 0 ? fresh : "dot";
}
