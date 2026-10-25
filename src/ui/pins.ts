import type { ChannelInfo } from "../lib/backend/types";
import type { PinGroup } from "../lib/sync/settings";
import { confirmDialog, promptDialog, type MenuItem } from "./menu";
import { settings, updateSettings } from "./store";

/**
 * Pinned conversations. Groups have a name and a color, live in the synced
 * settings, and follow you to every device.
 */

export const PIN_COLORS = ["#f0b232", "#ef5b5b", "#e86fb4", "#a77bf3", "#5b8cf0", "#2bb3c0", "#3fbf72", "#9aa3b2"];

const COLOR_NAMES = ["Amber", "Red", "Pink", "Violet", "Blue", "Teal", "Green", "Grey"];

export const pinOf =(channelId: string) => settings().pins.items.find((i) => i.channel === channelId)?.group;

function setPin(channel: string, group: string | null) {
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
