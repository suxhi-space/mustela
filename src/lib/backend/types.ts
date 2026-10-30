import type { ServerLooks } from "../profile/servers";
import type { Activity, Cloud } from "../cloud";
import type { ProfileConfig } from "../profile/model";
import type { MustelaSettings } from "../sync/settings";
import type { ExtSettings } from "../sync/ext";

export interface Person {
  id: string;
  /** Display name (server nickname where one applies) */
  name: string;
  username?: string;
  /** Stoat discriminator, shown as username#1234 */
  discriminator?: string;
  avatarUrl?: string;
  online?: boolean;
  /** online | idle | focus | busy | invisible */
  presence?: string;
  /** Custom status text */
  status?: string;
  badges?: string[];
  bot?: boolean;
  /** Role colour in the current server: a CSS colour or gradient */
  colour?: string;
  /** In a call: their microphone is off */
  muted?: boolean;
  /** Pronouns from Stoat (a server's own ones win, like Stoat's app) */
  pronouns?: string;
  /** My relationship with them */
  relation?: "friend" | "incoming" | "outgoing" | "blocked" | "none" | "self";
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  /** Smaller rendition for images/videos */
  previewUrl?: string;
  type: "image" | "video" | "audio" | "file";
  width?: number;
  height?: number;
  size?: number;
  spoiler?: boolean;
}

/** `preview` is a short looping video; `still` an image fallback for systems that can't play it. */
export interface GifResult { url: string; preview: string; still?: string; w?: number; h?: number }
export interface GifCategory { title: string; image: string }
/** A group of servers shown as one entry in the server list. Same shape as Stoat's. */
export interface ServerFolder { id: string; name: string; colour?: string; collapsed?: boolean; servers: string[] }

export interface InviteInfo {
  code: string; serverId: string; serverName: string; iconUrl?: string; bannerUrl?: string;
  memberCount?: number; channelName?: string; inviter?: string; joined: boolean;
}
export interface CustomEmoji { id: string; name: string; url: string; animated?: boolean; serverId?: string; serverName?: string; serverIcon?: string }

export interface VoicePresence { channelId: string; channelName: string; serverId?: string; serverName?: string; screen: boolean }
export type NotifyLevel = "all" | "mention" | "none";
export interface ServerPerms { manageServer: boolean; manageRoles: boolean; manageChannels: boolean; manageEmoji: boolean; kick: boolean; ban: boolean; invite: boolean; manageMessages: boolean }
export interface CategoryInfo { id: string; title: string; channels: string[] }
export interface Override { allow: number; deny: number }
/** Everything on a channel's settings pages. */
export interface ChannelDetails {
  id: string; name: string; kind: "text" | "voice"; serverId: string;
  description?: string; iconUrl?: string; slowmode: number; mature: boolean;
  /** Overrides for everyone ("default") and per role */
  defaultPerms: Override;
  rolePerms: Record<string, Override>;
  canManage: boolean; canManagePerms: boolean; canManageWebhooks: boolean;
}
export interface WebhookRow { id: string; name: string; avatarUrl?: string; url: string }
/** Server settings beyond the basics: system messages, Discover, permissions. */
export interface ServerDetails {
  systemMessages: { user_joined?: string; user_left?: string; user_kicked?: string; user_banned?: string };
  discoverable: boolean;
  /** Permissions everyone has (a bit field) */
  defaultPerms: number;
  rolePerms: Record<string, Override>;
  memberCount?: number;
}
export type DiscoverState = "none" | "pending" | "approved" | "rejected" | "unavailable";

/** Sending rules for one channel: permissions and Stoat's slowmode. */
export interface ChannelRules {
  canSend: boolean;
  canUpload: boolean;
  canReact: boolean;
  /** Delete and pin other people's messages */
  canManage: boolean;
  /** Seconds between messages, 0 when off or when I'm exempt */
  slowmode: number;
  /** ms timestamp when I may send again (slowmode), if I'm waiting */
  waitUntil?: number;
}
export interface ServerInfo { id: string; name: string; description?: string; iconUrl?: string; bannerUrl?: string; ownerId: string; isOwner: boolean; perms: ServerPerms }
export interface Role { id: string; name: string; colour?: string; hoist: boolean; rank: number }
export interface InviteRow { code: string; channelName?: string; creator?: Person }
export interface BanRow { person: Person; reason?: string }

export interface Embed {
  /** A GIF from Gifbox/Tenor/Giphy: shown as a looping clip, and the link text is hidden */
  gif?: boolean;
  /** Recognised players (YouTube, Twitch, Spotify…) */
  special?: { type: string; id?: string };
  kind: "website" | "image" | "video" | "text";
  url?: string;
  title?: string;
  description?: string;
  siteName?: string;
  iconUrl?: string;
  colour?: string;
  image?: { url: string; width?: number; height?: number };
  video?: { url: string; width?: number; height?: number };
}

export interface Reaction {
  /** A unicode emoji, or a custom emoji id */
  emoji: string;
  users: string[];
}

export interface Msg {
  id: string;
  channelId: string;
  author: Person;
  /** Raw Stoat markdown */
  text: string;
  at: Date;
  editedAt?: Date;
  attachments?: Attachment[];
  embeds?: Embed[];
  reactions?: Reaction[];
  replyIds?: string[];
  /** This message mentions me (or a role I have) */
  mentionsMe?: boolean;
  /** System message text ("Mika joined"), rendered without an author */
  system?: string;
  pinned?: boolean;
  /** Not yet confirmed by the server */
  pending?: boolean;
  failed?: boolean;
}

/** Someone in a voice channel, as Stoat reports it to everyone (not just people in the call). */
export interface VoiceMember extends Person {
  speaking?: boolean;
  muted?: boolean;
  deaf?: boolean;
  camera?: boolean;
  screen?: boolean;
}

export interface ChannelInfo {
  id: string;
  name: string;
  kind: "text" | "voice" | "dm" | "group";
  description?: string;
  /** Category title in a server; channels arrive ordered, grouped by category */
  category?: string;
  categoryId?: string;
  unread?: boolean;
  /** Unread mentions */
  mentions?: number;
  muted?: boolean;
  iconUrl?: string;
  /** For DMs: the other person */
  peer?: Person;
  /** Who's in this channel's call right now */
  voice?: VoiceMember[];
}

export interface Space {
  id: string;
  name: string;
  iconUrl?: string;
  bannerUrl?: string;
  description?: string;
  /** The "Home" pseudo-space: friends + direct messages */
  home?: boolean;
  channels: ChannelInfo[];
}

export interface MemberGroup {
  /** Role name, "Online" or "Offline" */
  title: string;
  people: Person[];
}

export interface Friends {
  friends: Person[];
  incoming: Person[];
  outgoing: Person[];
  blocked: Person[];
}

/** What we know about someone's public profile. */
export interface ProfileInfo {
  /** Decoded from their banner. null = no Mustela profile (or not decodable). */
  config: ProfileConfig | null;
  bannerUrl?: string;
  bio?: string;
  /** What they're playing/listening to, from a Mustela sync server */
  activity?: Activity | null;
  /** Their look per server (over this main one); `bannerAt` is set when that server has a banner of its own */
  servers?: Record<string, { config?: ProfileConfig; bio?: string; bannerAt?: number }>;
}

export type Presence = "online" | "idle" | "focus" | "busy" | "invisible";

export interface MeUpdate {
  displayName?: string;
  avatar?: File | null;
  /** Profile banner ("background" in Stoat's API) */
  banner?: File | null;
  bio?: string;
  /** Stoat's pronouns field; empty removes them */
  pronouns?: string;
  status?: string;
  presence?: Presence;
}

export interface SendOptions {
  text: string;
  replies?: { id: string; mention: boolean }[];
  files?: File[];
  /** Per file: send it as a spoiler (Stoat's SPOILER_ name prefix, so every client blurs it) */
  spoilers?: boolean[];
  /** Upload progress across all files, 0..1 */
  onProgress?(fraction: number): void;
}

export type ChatEvent =
  | { t: "message"; m: Msg }
  | { t: "update"; m: Msg }
  | { t: "delete"; channelId: string; id: string }
  | { t: "typing"; channelId: string; people: Person[] }
  /** Unread state, channel list, servers or friends may have changed */
  | { t: "activity" }
  /** The connection dropped and came back: anything sent meanwhile needs loading */
  | { t: "reconnected" };

/** Which engine carries the call. `native` is Android's background-safe, voice-only one. */
export type VoiceEngine = "web" | "native";

/** Device-local voice settings (Settings > Voice & Video). */
export interface VoicePrefs {
  inputDevice: string;
  outputDevice: string;
  videoDevice: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGain: boolean;
  /** 0-200 */
  outputVolume: number;
  screenQuality: "720p30" | "1080p30" | "1080p60";
  joinMuted: boolean;
  /** Join calls deafened (set from the user panel while not in a call) */
  joinDeafened: boolean;
  /** Input sensitivity: let the browser decide, or only send when louder than `threshold` dB */
  autoSensitivity: boolean;
  /** -100 (everything) to 0 (only shouting) */
  threshold: number;
  /** Soundboard volume 0-100, and the sound played for everyone when you join a call */
  soundboardVolume: number;
  entrySound: string;
}

export interface VoiceHandle {
  setMic(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  /** `native`: tracks from Mustela's own capture (desktop picker); otherwise the browser's picker. */
  setScreen(on: boolean, opts?: { quality?: VoicePrefs["screenQuality"]; audio?: boolean; native?: { video: MediaStreamTrack; audio?: MediaStreamTrack; stop(): void; onEnded(cb: () => void): void } }): Promise<void>;
  leave(): Promise<void>;
  participants(): VoiceMember[];
  /** Ids of people talking right now (measured locally, so it's immediate). */
  speaking(): string[];
  /** A person's camera or screen-share track, if they have one on (screen preferred unless `source` says). */
  video(id: string, source?: "camera" | "screen"): MediaStreamTrack | null;
  onChange(cb: () => void): () => void;
  /** Optional extras the web engine supports */
  setDeaf?(on: boolean): Promise<void>;
  setOutputVolume?(v: number): void;
  /** Input sensitivity: auto, or a gate at `threshold` dB */
  setSensitivity?(auto: boolean, threshold: number): void;
  state?(): { mic: boolean; cam: boolean; screen: boolean; deaf: boolean };
  /** Play an audio clip to everyone in the call (soundboard). */
  playSound?(data: ArrayBuffer, volume?: number): Promise<void>;
  /** Ids of people playing a soundboard sound right now (their ring changes colour) */
  soundboard?(): string[];
  /** Screen shares in the call, and whether you're watching each */
  streams?(): { id: string; watching: boolean; hasAudio: boolean }[];
  /** Start or stop receiving someone's screen share */
  watch?(id: string, on: boolean): void;
  /** Per-person volume (0-2, 1 = normal) and local mute, for their voice or their stream's audio */
  userAudio?(id: string, kind: "voice" | "stream"): { volume: number; muted: boolean };
  setUserAudio?(id: string, kind: "voice" | "stream", p: { volume?: number; muted?: boolean }): void;
  /** Floating emoji reactions in the call (Mustela clients see them) */
  react?(emoji: string): void;
  onReaction?(cb: (from: string, emoji: string) => void): () => void;
  /** LiveKit credentials, so the call can move to the pop-out window and back */
  auth?: { url: string; token: string };
  /** Fires once if the call ends without you leaving. "moved" = picked up by another window. */
  onEnd(cb: (reason?: "moved" | "dropped") => void): () => void;
}

export interface StoredSession {
  _id: string;
  token: string;
  user_id: string;
}

/** Everything the UI needs from a chat service. Stoat and the demo both implement it. */
export interface SessionRow { id: string; name: string; current: boolean; createdAt?: Date }
export interface BotRow { id: string; name: string; avatarUrl?: string; public: boolean; token: string; interactionsUrl?: string; createdAt?: Date }
export interface MfaState { authenticator: boolean; recovery: boolean }
/** Proof for sensitive account changes: your password, an authenticator code, or a recovery code. */
export type MfaProof = { password: string } | { totp_code: string } | { recovery_code: string };

/** Everything on Stoat's "My Account", "Sessions" and "My Bots" pages. All methods throw readable Errors. */
export interface AccountApi {
  email(): Promise<string>;
  changeUsername(username: string, password: string): Promise<void>;
  changeEmail(email: string, password: string): Promise<void>;
  changePassword(next: string, current: string): Promise<void>;
  mfa(): Promise<MfaState>;
  recoveryCodes(proof: MfaProof, regenerate: boolean): Promise<string[]>;
  /** Starts authenticator setup: returns the secret to show as a QR / text code */
  authenticatorSecret(proof: MfaProof): Promise<string>;
  enableAuthenticator(code: string): Promise<void>;
  disableAuthenticator(proof: MfaProof): Promise<void>;
  disableAccount(proof: MfaProof): Promise<void>;
  deleteAccount(proof: MfaProof): Promise<void>;
  sessions(): Promise<SessionRow[]>;
  renameSession(id: string, name: string): Promise<void>;
  logoutSession(id: string, proof: MfaProof): Promise<void>;
  logoutOtherSessions(proof: MfaProof): Promise<void>;
  bots(): Promise<BotRow[]>;
  createBot(name: string): Promise<BotRow>;
  editBot(id: string, p: { name?: string; public?: boolean; interactionsUrl?: string | null; resetToken?: boolean }): Promise<void>;
  deleteBot(id: string): Promise<void>;
}

export interface ChatBackend {
  /** Mustela sync servers (profiles and activity beyond what Stoat stores) */
  readonly cloud: Cloud;
  /** Stoat account management; absent for accounts that have none (demo has a pretend one). */
  readonly account: AccountApi;
  readonly me: Person;
  /** Only real accounts have one; used to resume without a password. */
  session(): StoredSession | null;
  spaces(): Promise<Space[]>;
  members(spaceId: string): Promise<MemberGroup[]>;
  /** Newest page when `before` is omitted. Always oldest-first. */
  messages(channelId: string, before?: string): Promise<Msg[]>;
  /** Messages after one (oldest-first), for reading forward from an old message. */
  messagesAfter(channelId: string, after: string): Promise<Msg[]>;
  /** A page centered on one message (oldest-first), for jumping to it. */
  messagesAround(channelId: string, id: string): Promise<Msg[]>;
  /** One message, for reply previews. null if gone. */
  message(channelId: string, id: string): Promise<Msg | null>;
  send(channelId: string, opts: SendOptions): Promise<void>;
  edit(channelId: string, id: string, text: string): Promise<void>;
  remove(channelId: string, id: string): Promise<void>;
  react(channelId: string, id: string, emoji: string, on: boolean): Promise<void>;
  typing(channelId: string, on: boolean): void;
  /** Mark a channel read up to its newest message. */
  ack(channelId: string): void;
  /** Mark a channel unread from this message on (the message itself included), like Stoat's "Mark as unread". */
  markUnread(channelId: string, messageId: string): void;
  /** The last message I've read in a channel (ids sort by time), for "new messages since" and jumping to unread. */
  lastRead(channelId: string): string | undefined;
  /** Unread messages that mention me (or my roles, @everyone, @online), by channel. */
  mentionIds(): { channelId: string; ids: string[] }[];
  onEvent(cb: (e: ChatEvent) => void): () => void;
  /** URL for a custom emoji id. */
  emojiUrl(id: string): string;
  friends(): Promise<Friends>;
  /** accept/add by id, add by "username#1234", remove/deny/cancel, block/unblock */
  friendAction(target: string, action: "add" | "accept" | "remove" | "block" | "unblock"): Promise<void>;
  /** Opens (or finds) a DM and returns its channel id. */
  openDM(userId: string): Promise<string>;
  /** Start a group conversation. Returns the channel id. */
  createGroup(userIds: string[], name?: string): Promise<string>;
  /** Add someone to a group conversation you're in. */
  addToGroup(channelId: string, userId: string): Promise<void>;
  /** Who's in a group conversation (or the other person in a DM). */
  recipients(channelId: string): Person[];
  /** Join a server by invite code or link. Returns the server id. */
  joinInvite(code: string): Promise<string>;
  /** Gifbox search; "trending" for the trending list. Empty when the instance has no GIF service. */
  gifs(query: string): Promise<GifResult[]>;
  gifCategories(): Promise<GifCategory[]>;
  /** A public bot, for "Add to server" from Discover. null if it isn't public. */
  publicBot(id: string): Promise<{ id: string; name: string; avatarUrl?: string; description?: string } | null>;
  /** Add a bot to a server you manage. */
  addBot(botId: string, serverId: string): Promise<void>;
  /** Details for an invite code, for invite cards. null if invalid. */
  invite(code: string): Promise<InviteInfo | null>;
  /** Custom emoji from every server I'm in */
  emojis(): CustomEmoji[];
  /* ---- servers & moderation (each throws a readable Error if not allowed) ---- */
  serverInfo(serverId: string): ServerInfo | null;
  editServer(serverId: string, p: { name?: string; description?: string; icon?: File | null; banner?: File | null }): Promise<void>;
  roles(serverId: string): Role[];
  createRole(serverId: string, name: string): Promise<void>;
  editRole(serverId: string, roleId: string, p: { name?: string; colour?: string | null; hoist?: boolean }): Promise<void>;
  deleteRole(serverId: string, roleId: string): Promise<void>;
  serverEmojis(serverId: string): CustomEmoji[];
  uploadEmoji(serverId: string, name: string, file: File): Promise<void>;
  deleteEmoji(emojiId: string): Promise<void>;
  invites(serverId: string): Promise<InviteRow[]>;
  createInvite(channelId: string): Promise<string>;
  deleteInvite(code: string): Promise<void>;
  bans(serverId: string): Promise<BanRow[]>;
  unban(serverId: string, userId: string): Promise<void>;
  kick(serverId: string, userId: string): Promise<void>;
  ban(serverId: string, userId: string, reason?: string): Promise<void>;
  createChannel(serverId: string, p: { name: string; kind: "text" | "voice"; description?: string }): Promise<string>;
  editChannel(channelId: string, p: { name?: string; description?: string; icon?: File | null; slowmode?: number; mature?: boolean }): Promise<void>;
  channelDetails(channelId: string): ChannelDetails | null;
  /** roleId "default" means everyone */
  setChannelPermissions(channelId: string, roleId: string, o: Override): Promise<void>;
  webhooks(channelId: string): Promise<WebhookRow[]>;
  createWebhook(channelId: string, name: string): Promise<WebhookRow>;
  deleteWebhook(channelId: string, id: string): Promise<void>;
  /** Stoat's channel categories, in order (channels outside any category aren't listed) */
  categories(serverId: string): CategoryInfo[];
  saveCategories(serverId: string, cats: CategoryInfo[]): Promise<void>;
  serverDetails(serverId: string): ServerDetails | null;
  editServerExtras(serverId: string, p: { systemMessages?: ServerDetails["systemMessages"] }): Promise<void>;
  /** roleId "default" sets what everyone may do (a plain bit field) */
  setServerPermissions(serverId: string, roleId: string, o: Override | number): Promise<void>;
  discoverState(serverId: string): Promise<DiscoverState>;
  requestDiscover(serverId: string): Promise<void>;
  /** Owner only: deletes the server for everyone */
  deleteServer(serverId: string): Promise<void>;
  /** When someone joined a server, for "Member since" */
  memberSince(serverId: string, userId: string): Promise<Date | undefined>;
  deleteChannel(channelId: string): Promise<void>;
  /** My nickname and avatar in one server */
  identity(serverId: string): Promise<{ nickname?: string; avatarUrl?: string }>;
  /** null removes the server nickname/avatar */
  editIdentity(serverId: string, p: { nickname?: string | null; avatar?: File | null }): Promise<void>;
  memberRoles(serverId: string, userId: string): Promise<string[]>;
  setMemberRoles(serverId: string, userId: string, roles: string[]): Promise<void>;
  leaveServer(serverId: string): Promise<void>;
  /** Hide a DM from the list (it comes back on the next message), or leave a group. */
  closeDM(channelId: string): Promise<void>;
  markRead(target: { channel?: string; server?: string }): void;
  createServer(name: string, description?: string): Promise<string>;
  /** Messages in a channel matching text; newest first */
  search(channelId: string, query: string): Promise<Msg[]>;
  pinned(channelId: string): Promise<Msg[]>;
  /** Friends and servers you share with someone */
  mutual(userId: string): Promise<{ friends: Person[]; servers: { id: string; name: string; iconUrl?: string }[] }>;
  /** Where someone is in a call right now (for profile cards), or null */
  voiceOf(userId: string): VoicePresence | null;
  /** Stoat's server folders (synced key "server-folders"), in no particular order. */
  folders(): ServerFolder[];
  /** Top-level rail order: server ids and folder ids, as Stoat's ordering.serverSidebar. */
  sidebar(): string[];
  /** Save folders and the top-level order together, the way Stoat writes them. */
  saveFolders(folders: ServerFolder[], sidebar: string[]): Promise<void>;
  /** Save the server list order (synced with Stoat's own "ordering" setting). */
  setServerOrder(ids: string[]): Promise<void>;
  /** Stoat's synced notification settings (same as the official client) */
  notifyLevel(kind: "server" | "channel", id: string): NotifyLevel | undefined;
  setNotifyLevel(kind: "server" | "channel", id: string, level: NotifyLevel | undefined): Promise<void>;
  isMuted(kind: "server" | "channel", id: string): boolean;
  /** until: ms timestamp, undefined = until I unmute, null = unmute now */
  setMuted(kind: "server" | "channel", id: string, until: number | undefined | null): Promise<void>;
  pin(channelId: string, messageId: string, on: boolean): Promise<void>;
  /** Shareable web link to a channel or message */
  linkFor(channelId: string, messageId?: string): string;
  /** Change my own account. Omitted fields are left alone. */
  updateMe(p: MeUpdate): Promise<void>;
  /** Never throws; resolves to an empty profile on any failure. `fresh` reads it again (opening a card). */
  profileOf(userId: string, fresh?: boolean): Promise<ProfileInfo>;
  /** Publish my profile so other Mustela users can see it. A non-public `privacy` keeps it out of the
   * banner (removing an old strip) and sends it only to sync servers that can keep it private. */
  publishProfile(cfg: ProfileConfig, banner?: Blob, opts?: { banner?: boolean; privacy?: ExtSettings["privacy"]; servers?: ServerLooks }): Promise<void>;
  /** Saves your look for one server to your sync servers. `banner`: a new picture, null to remove it, undefined to keep it. Returns when the banner changed (0 = none). */
  saveServerLook(serverId: string, look: { config?: ProfileConfig; bio?: string }, banner: Blob | null | undefined, all: { main: ProfileConfig; looks: ServerLooks; privacy: ExtSettings["privacy"] }): Promise<number | undefined>;
  /** Screen share qualities Stoat allows this account (like its own client: 720p always, 1080p if the server's limit allows; no 60 fps yet) */
  screenQualities(): VoicePrefs["screenQuality"][];
  /** Someone's banner for one server, as a picture link, or null */
  serverBanner(userId: string, serverId: string, at: number): Promise<string | null>;
  pullSettings(): Promise<MustelaSettings | null>;
  pushSettings(s: MustelaSettings): Promise<void>;
  pullExt(): Promise<ExtSettings | null>;
  pushExt(s: ExtSettings): Promise<void>;
  /** Looks someone up by id for call participants and mentions. Never throws. */
  person(id: string): Person;
  /** Name for a channel id, for <#id> mentions. */
  channelName(id: string): string | undefined;
  /** A server's channels (for #channel suggestions), in order. */
  channelsIn(serverId: string): { id: string; name: string; kind: "text" | "voice" }[];
  /** A role from any server I'm in, for <%id> mentions. */
  role(id: string): Role | undefined;
  /** What I may do in a channel right now. */
  channelRules(channelId: string): ChannelRules;
  joinVoice(channelId: string, engine?: VoiceEngine, prefs?: VoicePrefs): Promise<VoiceHandle>;
  /** Close connections. Safe to call twice. */
  dispose(): void;
}
