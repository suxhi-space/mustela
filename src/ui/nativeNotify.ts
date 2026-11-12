import type { Space } from "../lib/backend/types";
import { inTauri } from "../lib/platform";
import { backend, look, platform } from "./store";

/**
 * Android: chat notifications go through Mustela's own native notifier (Notifier.kt), the same as while the app is
 * closed: one per conversation with the sender's picture, grouped, Reply and Mark as read, opens at the message.
 * Chats with a notification showing are remembered here, so reading one anywhere (this app or another device)
 * clears it.
 */
export const nativeNotifications = () => platform === "android" && inTauri();
const showing = new Set<string>();
const invoke = (cmd: string, payload: unknown) =>
  import("@tauri-apps/api/core").then(({ invoke }) => invoke(`plugin:mustela-native|${cmd}`, { payload })).catch(() => {});

const argb = (hex: string) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16); return Number.isFinite(n) ? (0xff000000 | n) | 0 : 0; };

export function nativeNotify(p: { channel: string; kind: "dm" | "group" | "server"; title?: string; id: string; author: string; authorId: string; avatar?: string; text: string; at: number }) {
  const info = backend()?.watchInfo?.();
  showing.add(p.channel);
  void invoke("notify_message", { ...p, title: p.title ?? "", avatar: p.avatar ?? "", api: info?.api ?? "", token: info?.token ?? "", accent: argb(look().seed) });
}

/** Chats read since (unread gone): their notifications go. Called whenever the channel list refreshes. */
export function clearRead(spaces: Space[] | undefined) {
  if (!showing.size || !spaces) return;
  for (const s of spaces) for (const c of s.channels) {
    if (showing.has(c.id) && !c.unread && !c.mentions) { showing.delete(c.id); void invoke("watch_clear", { channel: c.id }); }
  }
}
