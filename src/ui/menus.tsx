import { For } from "solid-js";
import type { ChannelInfo, Msg, NotifyLevel, Person, Space } from "../lib/backend/types";
import { attempt, closeMenu, confirmDialog, copy, openMenu, promptDialog, toast, type MenuItem } from "./menu";
import { openChannel, setProfileOpen, setServerSettings } from "./nav";
import { openEmojiPicker } from "./chat/overlays";
import { backend } from "./store";
import { pinItems } from "./pins";

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

async function invite(channelId: string) {
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
    ...(firstText && (info?.perms.invite ?? true) ? [{ label: "Create invite", icon: "user-plus", onSelect: () => invite(firstText.id) } as MenuItem] : []),
    { label: "Edit your identity", icon: "user", onSelect: () => editIdentity(s) },
    { label: "Server settings", icon: "gear", onSelect: () => setServerSettings({ id: s.id }) },
    ...(info?.perms.manageChannels ? [{ label: "Create channel", icon: "plus", onSelect: () => createChannel(s.id) } as MenuItem] : []),
    { sep: true },
    { label: "Copy server ID", icon: "id", onSelect: () => copy(s.id, "ID copied") },
    ...(extra.length ? [{ sep: true } as MenuItem, ...extra] : []),
    ...(info && !info.isOwner ? [{ sep: true } as MenuItem, { label: "Leave server", icon: "door", danger: true, onSelect: () => leave(s) } as MenuItem] : []),
  ]);
}

async function leave(s: Space) {
  if (await confirmDialog(`Leave ${s.name}?`, "You'll need a new invite to come back.", "Leave server", true)) await attempt(() => b().leaveServer(s.id), "Left the server");
}

async function editIdentity(s: Space) {
  const cur = await b().identity(s.id).catch(() => ({ nickname: undefined }));
  const v = await promptDialog(`Your identity in ${s.name}`, "Nickname", "Save", cur.nickname ?? "",
    { body: "Only this server sees your nickname. Leave it empty to use your display name.", placeholder: b().me.name, max: 32 });
  if (v !== null) await attempt(() => b().editIdentity(s.id, { nickname: v.trim() || null }), "Saved");
}

export async function createChannel(serverId: string, kind: "text" | "voice" = "text") {
  const name = await promptDialog(kind === "voice" ? "Create voice channel" : "Create text channel", "Channel name", "Create channel", "", { placeholder: kind === "voice" ? "Lounge" : "new-channel", max: 32 });
  if (!name?.trim()) return;
  await attempt(async () => { const id = await b().createChannel(serverId, { name: name.trim(), kind }); openChannel(id); }, "Channel created");
}

/* ---------------------------------------------------------------- channels */

export function channelMenu(e: MouseEvent, c: ChannelInfo, serverId?: string) {
  const info = serverId ? b().serverInfo(serverId) : null;
  const direct = c.kind === "dm" || c.kind === "group";
  const items: MenuItem[] = [];
  if (c.kind === "dm" && c.peer) {
    items.push({ label: "Profile", icon: "user", onSelect: () => setProfileOpen(c.peer!) });
  }
  if (direct) items.push(...pinItems(c), { sep: true });
  items.push(
    { label: "Mark as read", icon: "check-all", disabled: !c.unread, onSelect: () => b().markRead({ channel: c.id }) },
    { sep: true },
    muteItems("channel", c.id),
    notifyItems("channel", c.id),
    { sep: true },
  );
  if (!direct && (info?.perms.invite ?? false)) items.push({ label: "Create invite", icon: "user-plus", onSelect: () => invite(c.id) });
  items.push({ label: "Copy link", icon: "link", onSelect: () => copy(b().linkFor(c.id), "Link copied") });
  if (info?.perms.manageChannels) {
    items.push(
      { sep: true },
      { label: "Rename channel", icon: "pencil", onSelect: () => renameChannel(c) },
      { label: "Edit description", icon: "note", onSelect: () => describeChannel(c) },
      { label: "Delete channel", icon: "trash", danger: true, onSelect: () => deleteChannel(c) },
    );
  }
  if (direct) {
    items.push({ sep: true }, { label: c.kind === "group" ? "Leave group" : "Close conversation", icon: "close", danger: true, onSelect: () => closeDM(c) });
  }
  items.push({ sep: true }, { label: "Copy channel ID", icon: "id", onSelect: () => copy(c.id, "ID copied") });
  if (c.kind === "dm" && c.peer) items.push(...friendItems(c.peer));
  openMenu(e, items);
}

async function renameChannel(c: ChannelInfo) {
  const v = await promptDialog("Rename channel", "Channel name", "Save", c.name, { max: 32 });
  if (v?.trim() && v.trim() !== c.name) await attempt(() => b().editChannel(c.id, { name: v.trim() }), "Saved");
}
async function describeChannel(c: ChannelInfo) {
  const v = await promptDialog("Channel description", "Description", "Save", c.description ?? "", { max: 1024 });
  if (v !== null) await attempt(() => b().editChannel(c.id, { description: v }), "Saved");
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
  const ta = document.querySelector(".composer textarea") as HTMLTextAreaElement | null;
  if (!ta) return;
  const add = `<@${p.id}> `;
  const at = ta.selectionStart ?? ta.value.length;
  ta.value = ta.value.slice(0, at) + (at && !/\s$/.test(ta.value.slice(0, at)) ? " " : "") + add + ta.value.slice(at);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
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
  const react = (k: string) => void b().react(m.channelId, m.id, k, true).catch(() => toast("Couldn't add that reaction.", true));
  const anchor = (t.closest(".msg") as HTMLElement | null) ?? t;
  const items: MenuItem[] = [
    { custom: () => (
      <div class="ctx-quick" role="group" aria-label="Quick reactions">
        <For each={QUICK}>{(q) => <button aria-label={`React ${q}`} onClick={() => { closeMenu(); react(q); }}>{q}</button>}</For>
      </div>
    ) },
    { label: "Add reaction", icon: "smile-plus", onSelect: () => openEmojiPicker(anchor.querySelector(".msg-body") ?? anchor, ({ key }) => react(key)) },
    { label: "Reply", icon: "reply", onSelect: () => act.reply(m) },
  ];
  if (mine && !m.system) items.push({ label: "Edit message", icon: "pencil", onSelect: () => act.edit(m) });
  if (canManage) items.push({ label: m.pinned ? "Unpin message" : "Pin message", icon: "pin", onSelect: () => attempt(() => b().pin(m.channelId, m.id, !m.pinned), m.pinned ? "Unpinned" : "Pinned") });
  items.push({ sep: true });
  if (sel.trim()) items.push({ label: "Copy selection", icon: "copy", onSelect: () => copy(sel) });
  if (m.text) items.push({ label: "Copy text", icon: "copy", onSelect: () => copy(m.text) });
  if (a && /^https?:/i.test(a.href)) items.push({ label: "Copy link address", icon: "link", onSelect: () => copy(a.href, "Link copied") });
  if (img?.src && /^https?:/i.test(img.src)) items.push({ label: "Copy image address", icon: "image", onSelect: () => copy(img.src, "Link copied") });
  items.push({ label: "Copy message link", icon: "link", onSelect: () => copy(b().linkFor(m.channelId, m.id), "Link copied") });
  items.push({ label: "Copy message ID", icon: "id", onSelect: () => copy(m.id, "ID copied") });
  if (canManage) items.push({ sep: true }, { label: "Delete message", icon: "trash", danger: true, onSelect: () => act.askDelete(m) });
  openMenu(e, items);
}
