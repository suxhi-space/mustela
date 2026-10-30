/**
 * Stoat's permission bits, with the names and descriptions people see in Stoat's
 * own settings. Values go past 32 bits, so they're handled as BigInt here and only
 * turned into numbers when sent (all fit in a safe integer).
 */
export interface PermissionDef { key: string; bit: bigint; label: string; description: string; channel: boolean }

const P = (key: string, n: number, label: string, description: string, channel = true): PermissionDef => ({ key, bit: 1n << BigInt(n), label, description, channel });

export const PERMISSIONS: { group: string; list: PermissionDef[] }[] = [
  {
    group: "General",
    list: [
      P("ViewChannel", 20, "View channel", "See this channel and read its name."),
      P("ManageChannel", 0, "Manage channels", "Edit, create and delete channels."),
      P("ManageServer", 1, "Manage server", "Change the server's name, icon, banner and settings.", false),
      P("ManagePermissions", 2, "Manage permissions", "Change permissions for roles and channels."),
      P("ManageRole", 3, "Manage roles", "Create, edit and delete roles below their own.", false),
      P("ManageCustomisation", 4, "Manage emoji", "Upload and delete custom emoji.", false),
      P("ViewAuditLogs", 40, "View audit log", "See who changed what in the server.", false),
    ],
  },
  {
    group: "Members",
    list: [
      P("KickMembers", 6, "Kick members", "Remove people from the server. They can rejoin with an invite.", false),
      P("BanMembers", 7, "Ban members", "Remove people and stop them coming back.", false),
      P("TimeoutMembers", 8, "Time out members", "Stop someone talking for a while.", false),
      P("AssignRoles", 9, "Assign roles", "Give and take roles below their own.", false),
      P("ChangeNickname", 10, "Change nickname", "Change their own nickname in this server.", false),
      P("ManageNicknames", 11, "Manage nicknames", "Change other people's nicknames.", false),
      P("ChangeAvatar", 12, "Change server avatar", "Use a different avatar in this server.", false),
      P("RemoveAvatars", 13, "Remove avatars", "Remove other people's server avatars.", false),
    ],
  },
  {
    group: "Messages",
    list: [
      P("ReadMessageHistory", 21, "Read message history", "See messages sent before they opened the channel."),
      P("SendMessage", 22, "Send messages", "Write in text channels."),
      P("ManageMessages", 23, "Manage messages", "Delete and pin other people's messages."),
      P("ManageWebhooks", 24, "Manage webhooks", "Create and delete webhooks."),
      P("InviteOthers", 25, "Create invites", "Make invite links."),
      P("SendEmbeds", 26, "Send embeds", "Show link previews for links they send."),
      P("UploadFiles", 27, "Upload files", "Attach files and pictures."),
      P("Masquerade", 28, "Masquerade", "Send messages with a different name and avatar (bots)."),
      P("React", 29, "Add reactions", "React to messages with emoji."),
      P("MentionEveryone", 37, "Mention @everyone and @online", "Notify everyone in the channel at once."),
      P("MentionRoles", 38, "Mention roles", "Notify everyone with a role."),
      P("UseExternalEmojis", 41, "Use emoji from other servers", "Send custom emoji from other servers."),
      P("BypassSlowmode", 39, "Skip slowmode", "Send without waiting for slowmode."),
    ],
  },
  {
    group: "Voice",
    list: [
      P("Connect", 30, "Connect", "Join voice channels."),
      P("Speak", 31, "Speak", "Talk in voice channels."),
      P("Video", 32, "Video and screen share", "Turn on their camera or share their screen."),
      P("Listen", 36, "Listen", "Hear others in voice channels."),
      P("MuteMembers", 33, "Mute members", "Mute other people for everyone."),
      P("DeafenMembers", 34, "Deafen members", "Deafen other people for everyone."),
      P("MoveMembers", 35, "Move members", "Move people between voice channels."),
    ],
  },
];

export type Tri = "allow" | "deny" | "inherit";

/** What an override says about one permission. */
export function triOf(o: { allow: number; deny: number }, bit: bigint): Tri {
  if (BigInt(o.allow) & bit) return "allow";
  if (BigInt(o.deny) & bit) return "deny";
  return "inherit";
}

/** Sets one permission in an override, keeping allow and deny exclusive. */
export function setTri(o: { allow: number; deny: number }, bit: bigint, t: Tri): { allow: number; deny: number } {
  let a = BigInt(o.allow) & ~bit, d = BigInt(o.deny) & ~bit;
  if (t === "allow") a |= bit;
  if (t === "deny") d |= bit;
  return { allow: Number(a), deny: Number(d) };
}

export const hasBit = (perms: number, bit: bigint) => (BigInt(perms) & bit) !== 0n;
export const withBit = (perms: number, bit: bigint, on: boolean) => Number(on ? BigInt(perms) | bit : BigInt(perms) & ~bit);
