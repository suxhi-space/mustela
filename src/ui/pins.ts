import type { ChannelInfo } from "../lib/backend/types";
import type { PinGroup } from "../lib/sync/settings";
import { confirmDialog, promptDialog, type MenuItem } from "./menu";
import { ext, settings, updateExt, updateSettings } from "./store";

/**
 * Pinned conversations. Groups have a name and a color, live in the synced
 * settings, and follow you to every device.
 */

export const PIN_COLORS = ["#f0b232", "#ef5b5b", "#e86fb4", "#a77bf3", "#5b8cf0", "#2bb3c0", "#3fbf72", "#9aa3b2"];

const COLOR_NAMES = ["Amber", "Red", "Pink", "Violet", "Blue", "Teal", "Green", "Grey"];

export const pinOf =(channelId: string) => settings().pins.items.find((i) => i.channel === channelId)?.group;

export function setPin(channel: string, group: string | null) {
  updateSettings((s) => ({ ...s, pins: { ...s.pins, items: [...s.pins.items.filter((i) => i.channel !== channel), ...(group ? [{ channel, group }] : [])] } }));
}

export async function newPinGroup(channel?: string) {
  const name = await promptDialog("New pin group", "Group name", "Create group", "", { placeholder: "Close friends", max: 40 });
  if (!name?.trim()) return;
  const used = new Set(settings().pins.groups.map((g) => g.color));
  const g: PinGroup = { id: `g${Date.now().toString(36)}`, name: name.trim(), color: PIN_COLORS.find((c) => !used.has(c)) ?? PIN_COLORS[0]! };
  updateSettings((s) => ({ ...s, pins: { groups: [...s.pins.groups, g], items: s.pins.items } }));
  if (channel) setPin(channel, g.id);
}

/** "Pin to…" for the conversation menu. */
export function pinItems(c: ChannelInfo): MenuItem[] {
  if (c.kind !== "dm" && c.kind !== "group") return [];
  const cur = pinOf(c.id), groups = settings().pins.groups;
  const items: MenuItem[] = [];
  if (groups.length === 1 && !cur) items.push({ label: "Pin conversation", icon: "pin", onSelect: () => setPin(c.id, groups[0]!.id) });
  else items.push({
    label: cur ? "Move pin" : "Pin to…", icon: "pin", sub: [
      ...groups.map((g): MenuItem => ({ label: g.name, checked: cur === g.id, onSelect: () => setPin(c.id, g.id) })),
      { sep: true },
      { label: "New group…", icon: "plus", onSelect: () => newPinGroup(c.id) },
    ],
  });
  if (groups.length === 1 && !cur) items.push({ label: "Pin to a new group…", icon: "plus", onSelect: () => newPinGroup(c.id) });
  if (cur) items.push({ label: "Unpin", icon: "close", onSelect: () => setPin(c.id, null) });
  return items;
}

/** Right-click a group heading. */
export function groupItems(g: PinGroup): MenuItem[] {
  const edit = (patch: Partial<PinGroup>) => updateSettings((s) => ({ ...s, pins: { ...s.pins, groups: s.pins.groups.map((x) => (x.id === g.id ? { ...x, ...patch } : x)) } }));
  return [
    { label: "Rename group", icon: "pencil", onSelect: async () => { const v = await promptDialog("Rename group", "Group name", "Save", g.name, { max: 40 }); if (v?.trim()) edit({ name: v.trim() }); } },
    { label: "Color", icon: "palette", sub: PIN_COLORS.map((c, i): MenuItem => ({ label: COLOR_NAMES[i]!, checked: g.color === c, onSelect: () => edit({ color: c }) })) },
    { label: "New group…", icon: "plus", onSelect: () => newPinGroup() },
    ...(g.id === "pinned" ? [] : [{ sep: true } as MenuItem, {
      label: "Delete group", icon: "trash", danger: true, onSelect: async () => {
        if (!(await confirmDialog(`Delete ${g.name}?`, "Its conversations go back to your direct messages.", "Delete group", true))) return;
        updateSettings((s) => ({ ...s, pins: { groups: s.pins.groups.filter((x) => x.id !== g.id), items: s.pins.items.filter((i) => i.group !== g.id) } }));
      },
    } as MenuItem]),
  ];
}

/* ---- server channels: pinned to the top of their server, or favourites on Home (synced, see lib/sync/ext.ts) ---- */

export const isChannelPinned = (id: string) => ext().channelPins.includes(id);
export const isFavourite = (id: string) => ext().favourites.includes(id);
const toggle = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));
export const setChannelPinned = (id: string, on: boolean) => updateExt((s) => ({ ...s, channelPins: toggle(s.channelPins, id, on) }));
export const setFavourite = (id: string, on: boolean) => updateExt((s) => ({ ...s, favourites: toggle(s.favourites, id, on) }));

/** Moves `id` to just before `before` (or the end) in one of the ordered lists. */
export function reorderPinned(key: "channelPins" | "favourites", id: string, before: string | null) {
  updateExt((s) => {
    const list = s[key].filter((x) => x !== id);
    const at = before ? list.indexOf(before) : -1;
    return { ...s, [key]: at < 0 ? [...list, id] : [...list.slice(0, at), id, ...list.slice(at)] };
  });
}

/** Moves a pinned conversation to just before another (possibly into its group), or to the end of a group. */
export function movePin(channel: string, group: string, before: string | null) {
  updateSettings((s) => {
    const items = s.pins.items.filter((i) => i.channel !== channel);
    const at = before ? items.findIndex((i) => i.channel === before) : -1;
    const item = { channel, group };
    return { ...s, pins: { ...s.pins, items: at < 0 ? [...items, item] : [...items.slice(0, at), item, ...items.slice(at)] } };
  });
}

/** "Pin to top" and "Add to Favourites" for a server channel's menu. */
export function channelPinItems(c: ChannelInfo): MenuItem[] {
  if (c.kind === "dm" || c.kind === "group") return [];
  const pinned = isChannelPinned(c.id), fav = isFavourite(c.id);
  return [
    { label: pinned ? "Unpin from top" : "Pin to top", icon: "pin", onSelect: () => setChannelPinned(c.id, !pinned) },
    { label: fav ? "Remove from Favourites" : "Add to Favourites", icon: "star", onSelect: () => setFavourite(c.id, !fav) },
  ];
}
