import type { Person } from "../lib/backend/types";
import { promptDialog, toast } from "./menu";
import { settings, updateSettings } from "./store";

/**
 * Friend nicknames, like Discord's: a name only you see for a friend, shown wherever their name is (messages, DMs,
 * the friends list). Kept in your synced settings, so every device you use has them.
 */
export const friendNick = (id: string | undefined): string | undefined => (id ? settings().friendNicks?.[id] : undefined);

/** Their name as you see it: your nickname for them, else their own. */
export const shownName = (p: Pick<Person, "id" | "name">) => friendNick(p.id) ?? p.name;

export function setFriendNick(id: string, nick: string | null) {
  updateSettings((s) => {
    const next = { ...(s.friendNicks ?? {}) };
    const v = (nick ?? "").trim().slice(0, 32);
    if (v) next[id] = v; else delete next[id];
    return { ...s, friendNicks: next };
  });
}

/** "Set friend nickname" (or change / remove it) for the right-click menus. */
export async function editFriendNick(p: Person) {
  const had = friendNick(p.id);
  const v = await promptDialog(had ? "Change friend nickname" : "Add friend nickname", "Nickname", "Save", had ?? "",
    { body: `Only you see this name for ${p.name}, wherever their name shows. Leave it empty to use their own name.`, placeholder: p.name, max: 32 });
  if (v === null) return;
  setFriendNick(p.id, v);
  toast(v.trim() ? `${p.name} is now “${v.trim()}” for you` : "Nickname removed");
}
