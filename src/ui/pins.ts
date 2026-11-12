import type { ChannelInfo } from "../lib/backend/types";
import { DEFAULT_PIN_GROUP, type PinGroup } from "../lib/sync/settings";
import type { FavGroup } from "../lib/sync/ext";
import { confirmDialog, promptDialog, type MenuItem } from "./menu";
import { ext, settings, updateExt, updateSettings } from "./store";
import { openColorPickerHere } from "./ColorPicker";

/**
 * Pinned conversations. Groups have a name and a color, live in the synced
 * settings, and follow you to every device.
 */

export const PIN_COLORS = ["#f0b232", "#ef5b5b", "#e86fb4", "#a77bf3", "#5b8cf0", "#2bb3c0", "#3fbf72", "#9aa3b2"];

const COLOR_NAMES = ["Amber", "Red", "Pink", "Violet", "Blue", "Teal", "Green", "Grey"];

export const pinOf =(channelId: string) => settings().pins.items.find((i) => i.channel === channelId)?.group;

export function setPin(channel: string, group: string | null) {
  updateSettings((s) => {
    // Pinning into "Pinned" after it was deleted brings it back.
    const groups = group && !s.pins.groups.some((g) => g.id === group) ? [...s.pins.groups, { ...DEFAULT_PIN_GROUP, id: group }] : s.pins.groups;
    return { ...s, pins: { groups, items: [...s.pins.items.filter((i) => i.channel !== channel), ...(group ? [{ channel, group }] : [])] } };
  });
}

export async function newPinGroup(channel?: string) {
  const name = await promptDialog("New pin group", "Group name", "Create group", "", { placeholder: "Close friends", max: 40 });
  if (!name?.trim()) return;
  // No colour until you pick one.
  const g: PinGroup = { id: `g${Date.now().toString(36)}`, name: name.trim(), color: "none" };
  updateSettings((s) => ({ ...s, pins: { groups: [...s.pins.groups, g], items: s.pins.items } }));
  if (channel) setPin(channel, g.id);
}

/** "Pin to…" for the conversation menu. */
export function pinItems(c: ChannelInfo): MenuItem[] {
  if (c.kind !== "dm" && c.kind !== "group") return [];
  const cur = pinOf(c.id), groups = settings().pins.groups;
  const items: MenuItem[] = [];
  if (!groups.length && !cur) items.push({ label: "Pin conversation", icon: "pin", onSelect: () => setPin(c.id, DEFAULT_PIN_GROUP.id) }, { label: "Pin to a new group…", icon: "plus", onSelect: () => newPinGroup(c.id) });
  else if (groups.length === 1 && !cur) items.push({ label: "Pin conversation", icon: "pin", onSelect: () => setPin(c.id, groups[0]!.id) });
  else if (groups.length) items.push({
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

/** Puts a pin group just before another (or last): dragging its heading, or Move up / Move down. */
export function movePinGroup(id: string, before: string | null) {
  updateSettings((s) => {
    const g = s.pins.groups.find((x) => x.id === id);
    if (!g || id === before) return s;
    const rest = s.pins.groups.filter((x) => x.id !== id), at = before ? rest.findIndex((x) => x.id === before) : -1;
    return { ...s, pins: { ...s.pins, groups: at < 0 ? [...rest, g] : [...rest.slice(0, at), g, ...rest.slice(at)] } };
  });
}
/** The same for favorites categories. */
export function moveFavGroup(id: string, before: string | null) {
  updateExt((s) => {
    const g = s.favGroups.find((x) => x.id === id);
    if (!g || id === before) return s;
    const rest = s.favGroups.filter((x) => x.id !== id), at = before ? rest.findIndex((x) => x.id === before) : -1;
    return { ...s, favGroups: at < 0 ? [...rest, g] : [...rest.slice(0, at), g, ...rest.slice(at)] };
  });
}

/** "Custom color…": any colour from Mustela's picker, ticked when the group already has one that isn't a preset. */
function customColor(current: string, apply: (hex: string) => void, name: string): MenuItem {
  const custom = current !== "none" && !PIN_COLORS.includes(current);
  return { label: "Custom color…", icon: "plus", checked: custom, onSelect: () => openColorPickerHere(custom ? current : undefined, apply, `${name} color`) };
}

/** Right-click a group heading. */
export function groupItems(g: PinGroup): MenuItem[] {
  const edit = (patch: Partial<PinGroup>) => updateSettings((s) => ({ ...s, pins: { ...s.pins, groups: s.pins.groups.map((x) => (x.id === g.id ? { ...x, ...patch } : x)) } }));
  const list = settings().pins.groups, i = list.findIndex((x) => x.id === g.id);
  return [
    { label: "Rename group", icon: "pencil", onSelect: async () => { const v = await promptDialog("Rename group", "Group name", "Save", g.name, { max: 40 }); if (v?.trim()) edit({ name: v.trim() }); } },
    { label: "Color", icon: "palette", sub: [
      { label: "No color", checked: g.color === "none", onSelect: () => edit({ color: "none" }) },
      { sep: true },
      ...PIN_COLORS.map((c, i): MenuItem => ({ label: COLOR_NAMES[i]!, checked: g.color === c, onSelect: () => edit({ color: c }) })),
      { sep: true },
      customColor(g.color, (color) => edit({ color }), g.name),
    ] },
    ...(i > 0 ? [{ label: "Move up", icon: "up", onSelect: () => movePinGroup(g.id, list[i - 1]!.id) } as MenuItem] : []),
    ...(i >= 0 && i < list.length - 1 ? [{ label: "Move down", icon: "down", onSelect: () => movePinGroup(g.id, list[i + 2]?.id ?? null) } as MenuItem] : []),
    { label: "New group…", icon: "plus", onSelect: () => newPinGroup() },
    { sep: true },
    { label: "Delete group", icon: "trash", danger: true, onSelect: async () => {
      if (!(await confirmDialog(`Delete ${g.name}?`, "Its conversations go back to your direct messages.", "Delete group", true))) return;
      updateSettings((s) => ({ ...s, pins: { groups: s.pins.groups.filter((x) => x.id !== g.id), items: s.pins.items.filter((i) => i.group !== g.id) } }));
    } },
  ];
}

/* ---- server channels: pinned to the top of their server, or favorites on Home (synced, see lib/sync/ext.ts) ---- */

export const isChannelPinned = (id: string) => ext().channelPins.includes(id);
export const isFavourite = (id: string) => ext().favourites.includes(id);
const toggle = (list: string[], id: string, on: boolean) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id));
export const setChannelPinned = (id: string, on: boolean) => updateExt((s) => ({ ...s, channelPins: toggle(s.channelPins, id, on) }));
export const setFavourite = (id: string, on: boolean) => updateExt((s) => {
  const favIn = { ...s.favIn };
  if (!on) delete favIn[id];
  return { ...s, favourites: toggle(s.favourites, id, on), favIn };
});

/* ---- favorite categories: your own headings for favorites (synced) ---- */
export const favGroupOf = (id: string) => ext().favIn[id];
export const setFavGroup = (channel: string, group: string | null) => updateExt((s) => {
  const favIn = { ...s.favIn };
  if (group) favIn[channel] = group; else delete favIn[channel];
  return { ...s, favourites: s.favourites.includes(channel) ? s.favourites : [...s.favourites, channel], favIn };
});
export async function newFavGroup(channel?: string) {
  const name = await promptDialog("New favorites category", "Category name", "Create category", "", { placeholder: "Gaming", max: 40 });
  if (!name?.trim()) return;
  const g: FavGroup = { id: `f${Date.now().toString(36)}`, name: name.trim(), color: "none" };
  updateExt((s) => ({ ...s, favGroups: [...s.favGroups, g] }));
  if (channel) setFavGroup(channel, g.id);
}
/** Right-click a favorites category heading. */
export function favGroupItems(g: FavGroup): MenuItem[] {
  const edit = (patch: Partial<FavGroup>) => updateExt((s) => ({ ...s, favGroups: s.favGroups.map((x) => (x.id === g.id ? { ...x, ...patch } : x)) }));
  const move = (d: -1 | 1) => updateExt((s) => {
    const l = [...s.favGroups], i = l.findIndex((x) => x.id === g.id), j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return s;
    [l[i], l[j]] = [l[j]!, l[i]!];
    return { ...s, favGroups: l };
  });
  return [
    { label: "Rename category", icon: "pencil", onSelect: async () => { const v = await promptDialog("Rename category", "Category name", "Save", g.name, { max: 40 }); if (v?.trim()) edit({ name: v.trim() }); } },
    { label: "Color", icon: "palette", sub: [
      { label: "No color", checked: g.color === "none", onSelect: () => edit({ color: "none" }) },
      { sep: true },
      ...PIN_COLORS.map((c, i): MenuItem => ({ label: COLOR_NAMES[i]!, checked: g.color === c, onSelect: () => edit({ color: c }) })),
      { sep: true },
      customColor(g.color, (color) => edit({ color }), g.name),
    ] },
    { label: "Move up", icon: "up", onSelect: () => move(-1) },
    { label: "Move down", icon: "down", onSelect: () => move(1) },
    { label: "New category…", icon: "plus", onSelect: () => newFavGroup() },
    { sep: true },
    { label: "Delete category", icon: "trash", danger: true, onSelect: async () => {
      if (!(await confirmDialog(`Delete ${g.name}?`, "Its channels stay in your favorites.", "Delete category", true))) return;
      updateExt((s) => ({ ...s, favGroups: s.favGroups.filter((x) => x.id !== g.id), favIn: Object.fromEntries(Object.entries(s.favIn).filter(([, v]) => v !== g.id)) }));
    } },
  ];
}

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

/** "Pin to top" and "Add to Favorites" for a server channel's menu. */
export function channelPinItems(c: ChannelInfo): MenuItem[] {
  if (c.kind === "dm" || c.kind === "group") return [];
  const pinned = isChannelPinned(c.id), fav = isFavourite(c.id);
  return [
    { label: pinned ? "Unpin from top" : "Pin to top", icon: "pin", onSelect: () => setChannelPinned(c.id, !pinned) },
    { label: fav ? "Remove from Favorites" : "Add to Favorites", icon: "star", onSelect: () => setFavourite(c.id, !fav) },
    ...(fav || ext().favGroups.length ? [{
      label: fav ? "Favorites category" : "Add to a favorites category", icon: "folder", sub: [
        { label: "Favorites", checked: fav && !favGroupOf(c.id), onSelect: () => setFavGroup(c.id, null) },
        ...ext().favGroups.map((g): MenuItem => ({ label: g.name, checked: favGroupOf(c.id) === g.id, onSelect: () => setFavGroup(c.id, g.id) })),
        { sep: true },
        { label: "New category…", icon: "plus", onSelect: () => newFavGroup(c.id) },
      ],
    } as MenuItem] : []),
  ];
}
