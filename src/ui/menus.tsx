import { ulid } from "../lib/ulid";
import { openReactions } from "./chat/Reactions";
import { isFav, toggleFav } from "./chat/overlays";
import { composer } from "./chat/Composer";
import { For } from "solid-js";
import type { ChannelInfo, Msg, NotifyLevel, Person, Space } from "../lib/backend/types";
import { attempt, closeMenu, confirmDialog, copy, openMenu, promptDialog, toast, type MenuItem } from "./menu";
import { openChannel, setChannelSettings, setProfileOpen, setServerSettings } from "./nav";
import { openEmojiPicker } from "./chat/overlays";
import { backend, ext } from "./store";
import { channelPinItems, favGroupOf, newFavGroup, pinItems, setFavGroup, setFavourite } from "./pins";
import { UEmoji } from "./chat/UEmoji";

/**
 * The right-click menus, matching what Stoat's own client offers for each
 * thing you can click. Items you can't use are left out rather than greyed,
 * so the menus stay short.
 */

const b = () => backend()!;
const QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

/** Same choices as Stoat: 15 min, 1 h, 3 h, 8 h, 24 h, until I turn it back on. */
function muteItems(kind: "server" | "channel", id: string): MenuItem {
  const what = kind === "server" ? "server" : "channel";
  if (b().isMuted(kind, id)) return { label: `Unmute ${what}`, icon: "bell", onSelect: () => attempt(() => b().setMuted(kind, id, null), "Unmuted") };
  const at = (min: number) => () => attempt(() => b().setMuted(kind, id, Date.now() + min * 60_000), "Muted");
  return {
    label: `Mute ${what}`, icon: "bell-off", sub: [
      { label: "For 15 minutes", onSelect: at(15) },
      { label: "For 1 hour", onSelect: at(60) },
      { label: "For 3 hours", onSelect: at(180) },
      { label: "For 8 hours", onSelect: at(480) },
      { label: "For 24 hours", onSelect: at(1440) },
      { label: "Until I turn it back on", onSelect: () => attempt(() => b().setMuted(kind, id, undefined), "Muted") },
    ],
  };
}

function notifyItems(kind: "server" | "channel", id: string): MenuItem {
  const cur = b().notifyLevel(kind, id);
  const set = (l: NotifyLevel | undefined) => () => attempt(() => b().setNotifyLevel(kind, id, l));
  return {
    label: "Notifications", icon: "bell", sub: [
      { label: kind === "server" ? "Default" : "Use server default", checked: cur === undefined, onSelect: set(undefined) },
      { label: "All messages", checked: cur === "all", onSelect: set("all") },
      { label: "Mentions only", checked: cur === "mention", onSelect: set("mention") },
      { label: "Nothing", checked: cur === "none", onSelect: set("none") },
    ],
  };
}

export async function inviteTo(channelId: string) {
  await attempt(async () => {
    const code = await b().createInvite(channelId);
    const base = b().linkFor(channelId).replace(/\/(server|channel)\/.*$/, "");
    await copy(`${base}/invite/${code}`, "Invite link copied");
  });
}

/* ---------------------------------------------------------------- servers */

export function serverMenu(e: MouseEvent, s: Space, extra: MenuItem[] = []) {
  if (s.home) return;
  const info = b().serverInfo(s.id);
  const firstText = s.channels.find((c) => c.kind === "text");
  const unread = s.channels.some((c) => c.unread);
  openMenu(e, [
    { label: "Mark as read", icon: "check-all", disabled: !unread, onSelect: () => b().markRead({ server: s.id }) },
    { sep: true },
    muteItems("server", s.id),
    notifyItems("server", s.id),
    { sep: true },
    ...(firstText && (info?.perms.invite ?? true) ? [{ label: "Create invite", icon: "user-plus", onSelect: () => inviteTo(firstText.id) } as MenuItem] : []),
    { label: "Your profile in this server", icon: "user", onSelect: () => setServerSettings({ id: s.id, tab: "identity" }) },
    { label: "Server settings", icon: "gear", onSelect: () => setServerSettings({ id: s.id }) },
    ...(info?.perms.manageChannels ? createItems(s.id) : []),
    { sep: true },
    { label: "Copy server ID", icon: "id", onSelect: () => copy(s.id, "ID copied") },
    ...(extra.length ? [{ sep: true } as MenuItem, ...extra] : []),
    ...(info && !info.isOwner ? [{ sep: true } as MenuItem, { label: "Leave server", icon: "door", danger: true, onSelect: () => leave(s) } as MenuItem] : []),
  ]);
}

async function leave(s: Space) {
  if (await confirmDialog(`Leave ${s.name}?`, "You'll need a new invite to come back.", "Leave server", true)) await attempt(() => b().leaveServer(s.id), "Left the server");
}

/** Creates a channel (Stoat asks text or voice in one dialog; we ask the kind from the menu), optionally inside a category. */
export async function createChannel(serverId: string, kind: "text" | "voice" = "text", categoryId?: string) {
  const name = await promptDialog(kind === "voice" ? "Create voice channel" : "Create text channel", "Channel name", "Create channel", "", { placeholder: kind === "voice" ? "Lounge" : "new-channel", max: 32 });
  if (!name?.trim()) return;
  await attempt(async () => {
    const id = await b().createChannel(serverId, { name: name.trim(), kind });
    if (categoryId) {
      const cats = b().categories(serverId).map((c) => (c.id === categoryId ? { ...c, channels: [...c.channels.filter((x) => x !== id), id] } : { ...c, channels: c.channels.filter((x) => x !== id) }));
      await b().saveCategories(serverId, cats);
    }
    openChannel(id);
  }, "Channel created");
}

export async function createCategory(serverId: string) {
  const title = await promptDialog("Create category", "Category name", "Create category", "", { placeholder: "Text channels", max: 32 });
  if (!title?.trim()) return;
  await attempt(() => b().saveCategories(serverId, [...b().categories(serverId), { id: ulid(), title: title.trim(), channels: [] }]), "Category created");
}

const createItems = (serverId: string, categoryId?: string): MenuItem[] => [
  { label: "Create channel", icon: "plus", sub: [
    { label: "Text channel", icon: "hash", onSelect: () => createChannel(serverId, "text", categoryId) },
    { label: "Voice channel", icon: "speaker", onSelect: () => createChannel(serverId, "voice", categoryId) },
  ] },
  { label: "Create category", icon: "folder", onSelect: () => createCategory(serverId) },
];

/** Right-click on empty space in a server's channel list. */
export function channelListMenu(e: MouseEvent, serverId: string) {
  if (!b().serverInfo(serverId)?.perms.manageChannels) return;
  openMenu(e, createItems(serverId));
}

/** Right-click on a category header: like Stoat's. */
export function categoryMenu(e: MouseEvent, serverId: string, categoryId: string | undefined, title: string, channels: ChannelInfo[]) {
  const can = !!b().serverInfo(serverId)?.perms.manageChannels;
  const unread = channels.some((c) => c.unread);
  const items: MenuItem[] = [{ label: "Mark as read", icon: "check-all", disabled: !unread, onSelect: () => channels.forEach((c) => b().markRead({ channel: c.id })) }];
  if (can) items.push({ sep: true }, ...createItems(serverId, categoryId));
  if (can && categoryId) {
    items.push(
      { sep: true },
      { label: "Rename category", icon: "pencil", onSelect: async () => {
        const v = await promptDialog("Rename category", "Category name", "Save", title, { max: 32 });
        if (v?.trim() && v.trim() !== title) await attempt(() => b().saveCategories(serverId, b().categories(serverId).map((c) => (c.id === categoryId ? { ...c, title: v.trim() } : c))), "Saved");
      } },
      { label: "Delete category", icon: "trash", danger: true, onSelect: async () => {
        if (await confirmDialog(`Delete ${title}?`, "Its channels aren't deleted. They move out of the category.", "Delete category", true)) await attempt(() => b().saveCategories(serverId, b().categories(serverId).filter((c) => c.id !== categoryId)), "Category deleted");
      } },
    );
  }
  if (categoryId) items.push({ sep: true }, { label: "Copy category ID", icon: "id", onSelect: () => copy(categoryId, "ID copied") });
  openMenu(e, items);
}

/* ---------------------------------------------------------------- channels */

export function channelMenu(e: MouseEvent, c: ChannelInfo, serverId?: string) {
  const info = serverId ? b().serverInfo(serverId) : null;
  const direct = c.kind === "dm" || c.kind === "group";
  const items: MenuItem[] = [];
  if (c.kind === "dm" && c.peer) items.push({ label: "Profile", icon: "user", onSelect: () => setProfileOpen(c.peer!) });
  if (direct) items.push(...pinItems(c), { sep: true });
  else items.push(...channelPinItems(c), { sep: true });
  // Same order as Stoat: read, invite, then notifications, then managing.
  if (c.unread || c.mentions) items.push({ label: "Mark as read", icon: "check-all", onSelect: () => b().markRead({ channel: c.id }) });
  if (!direct && (info?.perms.invite ?? false)) items.push({ label: "Create invite", icon: "user-plus", onSelect: () => inviteTo(c.id) });
  items.push({ sep: true }, muteItems("channel", c.id), notifyItems("channel", c.id));
  if (serverId && info?.perms.manageChannels) {
    items.push(
      { sep: true },
      ...createItems(serverId, c.categoryId),
      { label: "Channel settings", icon: "gear", onSelect: () => setChannelSettings({ id: c.id }) },
      { label: "Delete channel", icon: "trash", danger: true, onSelect: () => deleteChannel(c) },
    );
  } else if (serverId) {
    items.push({ sep: true }, { label: "Channel settings", icon: "gear", onSelect: () => setChannelSettings({ id: c.id }) });
  }
  if (direct) items.push({ sep: true }, { label: c.kind === "group" ? "Leave group" : "Close conversation", icon: "close", danger: true, onSelect: () => closeDM(c) });
  items.push({ sep: true }, { label: "Copy link", icon: "link", onSelect: () => copy(b().linkFor(c.id), "Link copied") }, { label: "Copy channel ID", icon: "id", onSelect: () => copy(c.id, "ID copied") });
  if (c.kind === "dm" && c.peer) items.push(...friendItems(c.peer));
  openMenu(e, items);
}

/**
 * Right-click a favorite (on Home or in Favorites): about the favorite itself, plus reading and notifications.
 * Server things like pinning it to the top or editing the channel stay in the server's own list.
 */
export function favoriteMenu(e: MouseEvent, c: ChannelInfo, openInServer: () => void) {
  const cur = favGroupOf(c.id), groups = ext().favGroups;
  const items: MenuItem[] = [];
  if (c.unread || c.mentions) items.push({ label: "Mark as read", icon: "check-all", onSelect: () => b().markRead({ channel: c.id }) });
  items.push(
    { label: "Move to category", icon: "folder", sub: [
      { label: "No category", checked: !cur, onSelect: () => setFavGroup(c.id, null) },
      ...groups.map((g): MenuItem => ({ label: g.name, checked: cur === g.id, onSelect: () => setFavGroup(c.id, g.id) })),
      { sep: true },
      { label: "New category…", icon: "plus", onSelect: () => newFavGroup(c.id) },
    ] },
    { label: "Remove from Favorites", icon: "star", onSelect: () => setFavourite(c.id, false) },
    { sep: true }, muteItems("channel", c.id), notifyItems("channel", c.id),
    { sep: true },
    { label: "Open in its server", icon: "arrow-in", onSelect: openInServer },
    { label: "Copy link", icon: "link", onSelect: () => copy(b().linkFor(c.id), "Link copied") },
  );
  openMenu(e, items);
}

async function deleteChannel(c: ChannelInfo) {
  if (await confirmDialog(`Delete #${c.name}?`, "Every message in it is deleted too. This can't be undone.", "Delete channel", true)) await attempt(() => b().deleteChannel(c.id), "Channel deleted");
}
async function closeDM(c: ChannelInfo) {
  const group = c.kind === "group";
  if (!group || (await confirmDialog(`Leave ${c.name}?`, "You won't get its messages unless someone adds you back.", "Leave group", true))) await attempt(() => b().closeDM(c.id));
}

/* ---------------------------------------------------------------- people */

function friendItems(p: Person): MenuItem[] {
  const rel = p.relation ?? "none";
  if (rel === "self" || p.bot) return [];
  const act = (a: "add" | "accept" | "remove" | "block" | "unblock", done: string) => () => attempt(() => b().friendAction(p.id, a), done);
  const out: MenuItem[] = [{ sep: true }];
  if (rel === "none") out.push({ label: "Add friend", icon: "user-plus", onSelect: act("add", "Friend request sent") });
  if (rel === "incoming") out.push({ label: "Accept friend request", icon: "user-plus", onSelect: act("accept", "You're now friends") });
  if (rel === "outgoing") out.push({ label: "Cancel friend request", icon: "user-x", onSelect: act("remove", "Request cancelled") });
  if (rel === "friend") out.push({ label: "Remove friend", icon: "user-x", danger: true, onSelect: async () => { if (await confirmDialog(`Remove ${p.name}?`, "You can add them again later.", "Remove friend", true)) await act("remove", "Removed")(); } });
  out.push(rel === "blocked"
    ? { label: "Unblock", icon: "ban", onSelect: act("unblock", "Unblocked") }
    : { label: "Block", icon: "ban", danger: true, onSelect: async () => { if (await confirmDialog(`Block ${p.name}?`, "They won't be able to message you, and their messages are hidden.", "Block", true)) await act("block", "Blocked")(); } });
  return out;
}

/** Puts @mention into the message box, like clicking "Mention" in Stoat. */
function mention(p: Person) {
  composer.insert(`<@${p.id}> `);
}

export function userMenu(e: MouseEvent, p: Person, serverId?: string) {
  const me = p.id === b().me.id;
  const info = serverId ? b().serverInfo(serverId) : null;
  const items: MenuItem[] = [
    { label: "Profile", icon: "user", onSelect: () => setProfileOpen(p) },
    { label: "Mention", icon: "at", onSelect: () => mention(p) },
  ];
  if (!me) items.push({ label: "Message", icon: "chat", onSelect: () => attempt(async () => openChannel(await b().openDM(p.id))) });
  items.push(...friendItems(p));
  if (serverId && !me && info && (info.perms.kick || info.perms.ban) && p.id !== info.ownerId) {
    items.push({ sep: true });
    if (info.perms.kick) items.push({ label: `Kick ${p.name}`, icon: "door", danger: true, onSelect: async () => { if (await confirmDialog(`Kick ${p.name}?`, "They can rejoin with an invite.", "Kick", true)) await attempt(() => b().kick(serverId, p.id), "Kicked"); } });
    if (info.perms.ban) items.push({ label: `Ban ${p.name}`, icon: "ban", danger: true, onSelect: async () => {
      const reason = await promptDialog(`Ban ${p.name}?`, "Reason (optional)", "Ban", "", { body: "They're removed and can't rejoin until unbanned.", danger: true, max: 1024 });
      if (reason !== null) await attempt(() => b().ban(serverId, p.id, reason.trim() || undefined), "Banned");
    } });
  }
  items.push({ sep: true });
  if (p.username) items.push({ label: "Copy username", icon: "copy", onSelect: () => copy(p.discriminator ? `${p.username}#${p.discriminator}` : p.username!, "Username copied") });
  items.push({ label: "Copy user ID", icon: "id", onSelect: () => copy(p.id, "ID copied") });
  openMenu(e, items);
}

/* ---------------------------------------------------------------- messages */

export interface MsgMenuActions { reply(m: Msg): void; edit(m: Msg): void; askDelete(m: Msg): void }

export function messageMenu(e: MouseEvent, m: Msg, act: MsgMenuActions, serverId?: string) {
  const t = e.target instanceof HTMLElement ? e.target : document.getElementById(`msg-${m.id}`) ?? document.body;
  // Right-clicking a link, image or name gets that thing's menu instead.
  const a = t.closest("a[href]") as HTMLAnchorElement | null;
  const img = t.closest(".media img, .em-img, .embed-img") as HTMLImageElement | null;
  if (t.closest(".msg-name, .msg-av")) return userMenu(e, m.author, serverId);
  const mine = m.author.id === b().me.id;
  const info = serverId ? b().serverInfo(serverId) : null;
  const canManage = mine || !serverId || !!info?.perms.manageMessages;
  const sel = getSelection()?.toString() ?? "";
  const react = (k: string) => void b().react(m.channelId, m.id, k, true).catch((e) => toast((e as Error)?.message || "Couldn't add that reaction.", true));
  const anchor = (t.closest(".msg") as HTMLElement | null) ?? t;
  const items: MenuItem[] = [
    { custom: () => (
      <div class="ctx-quick" role="group" aria-label="Quick reactions">
        <For each={QUICK}>{(q) => <button aria-label={`React ${q}`} onClick={() => { closeMenu(); react(q); }}><UEmoji e={q} /></button>}</For>
      </div>
    ) },
    { label: "Add reaction", icon: "smile-plus", onSelect: () => openEmojiPicker(anchor.querySelector(".msg-body") ?? anchor, ({ key }) => react(key)) },
    { label: "Reply", icon: "reply", onSelect: () => act.reply(m) },
  ];
  if (mine && !m.system) items.push({ label: "Edit message", icon: "pencil", onSelect: () => act.edit(m) });
  if (canManage) items.push({ label: m.pinned ? "Unpin message" : "Pin message", icon: "pin", onSelect: () => attempt(() => b().pin(m.channelId, m.id, !m.pinned), m.pinned ? "Unpinned" : "Pinned") });
  items.push({ sep: true });
  if (sel.trim()) items.push({ label: "Copy selection", icon: "copy", onSelect: () => copy(sel) });
  if (m.reactions?.length) items.push({ label: "View reactions", icon: "smile-plus", onSelect: () => openReactions(m) });
  // A GIF in the message: star it from here (on phones the star on the GIF itself is hidden).
  const gif = m.embeds?.find((x) => x.gif);
  if (gif) {
    const src = gif.video?.url ?? gif.image?.url ?? "";
    const g = { url: gif.url ?? src, preview: src, w: gif.video?.width ?? gif.image?.width, h: gif.video?.height ?? gif.image?.height };
    items.push({ label: isFav(g.url) ? "Remove GIF from favorites" : "Add GIF to favorites", icon: "star", onSelect: () => toggleFav(g) });
  }
  if (m.text) items.push({ label: "Copy text", icon: "copy", onSelect: () => copy(m.text) });
  if (a && /^https?:/i.test(a.href)) items.push({ label: "Copy link address", icon: "link", onSelect: () => copy(a.href, "Link copied") });
  if (img?.src && /^https?:/i.test(img.src)) items.push({ label: "Copy image address", icon: "image", onSelect: () => copy(img.src, "Link copied") });
  items.push({ label: "Mark as unread", icon: "eye-off", onSelect: () => { b().markUnread(m.channelId, m.id); dispatchEvent(new CustomEvent("mustela:mark-unread", { detail: { channelId: m.channelId, messageId: m.id } })); toast("Marked as unread from here"); } });
  items.push({ label: "Copy message link", icon: "link", onSelect: () => copy(b().linkFor(m.channelId, m.id), "Link copied") });
  items.push({ label: "Copy message ID", icon: "id", onSelect: () => copy(m.id, "ID copied") });
  if (canManage) items.push({ sep: true }, { label: "Delete message", icon: "trash", danger: true, onSelect: () => act.askDelete(m) });
  openMenu(e, items);
}
