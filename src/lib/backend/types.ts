import type { ProfileConfig } from "../profile/model";
import type { MustelaSettings } from "../sync/settings";

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

export interface Embed {
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

export interface ChannelInfo {
  id: string;
  name: string;
  kind: "text" | "voice" | "dm" | "group";
  description?: string;
  /** Category title in a server; channels arrive ordered, grouped by category */
  category?: string;
  unread?: boolean;
  /** Unread mentions */
  mentions?: number;
  muted?: boolean;
  iconUrl?: string;
  /** For DMs: the other person */
  peer?: Person;
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
}

export type Presence = "online" | "idle" | "focus" | "busy" | "invisible";

export interface MeUpdate {
  displayName?: string;
  avatar?: File | null;
  bio?: string;
  status?: string;
  presence?: Presence;
}

export interface SendOptions {
  text: string;
  replies?: { id: string; mention: boolean }[];
  files?: File[];
}

export type ChatEvent =
  | { t: "message"; m: Msg }
  | { t: "update"; m: Msg }
  | { t: "delete"; channelId: string; id: string }
  | { t: "typing"; channelId: string; people: Person[] }
  /** Unread state, channel list, servers or friends may have changed */
  | { t: "activity" };

/** Which engine carries the call. `native` is Android's background-safe, voice-only one. */
export type VoiceEngine = "web" | "native";

export interface VoiceHandle {
  setMic(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setScreen(on: boolean): Promise<void>;
  leave(): Promise<void>;
  participants(): Person[];
  /** Ids of people talking right now. */
  speaking(): string[];
  /** A person's camera or screen-share track, if they have one on. */
  video(id: string): MediaStreamTrack | null;
  onChange(cb: () => void): () => void;
  /** Fires once if the call ends without you leaving (dropped, or left from a notification). */
  onEnd(cb: () => void): () => void;
}

export interface StoredSession {
  _id: string;
  token: string;
  user_id: string;
}

/** Everything the UI needs from a chat service. Stoat and the demo both implement it. */
export interface ChatBackend {
  readonly me: Person;
  /** Only real accounts have one; used to resume without a password. */
  session(): StoredSession | null;
  spaces(): Promise<Space[]>;
  members(spaceId: string): Promise<MemberGroup[]>;
  /** Newest page when `before` is omitted. Always oldest-first. */
  messages(channelId: string, before?: string): Promise<Msg[]>;
  /** One message, for reply previews. null if gone. */
  message(channelId: string, id: string): Promise<Msg | null>;
  send(channelId: string, opts: SendOptions): Promise<void>;
  edit(channelId: string, id: string, text: string): Promise<void>;
  remove(channelId: string, id: string): Promise<void>;
  react(channelId: string, id: string, emoji: string, on: boolean): Promise<void>;
  typing(channelId: string, on: boolean): void;
  /** Mark a channel read up to its newest message. */
  ack(channelId: string): void;
  onEvent(cb: (e: ChatEvent) => void): () => void;
  /** URL for a custom emoji id. */
  emojiUrl(id: string): string;
  friends(): Promise<Friends>;
  /** accept/add by id, add by "username#1234", remove/deny/cancel, block/unblock */
  friendAction(target: string, action: "add" | "accept" | "remove" | "block" | "unblock"): Promise<void>;
  /** Opens (or finds) a DM and returns its channel id. */
  openDM(userId: string): Promise<string>;
  /** Join a server by invite code or link. Returns the server id. */
  joinInvite(code: string): Promise<string>;
  /** Change my own account. Omitted fields are left alone. */
  updateMe(p: MeUpdate): Promise<void>;
  /** Never throws; resolves to an empty profile on any failure. */
  profileOf(userId: string): Promise<ProfileInfo>;
  /** Publish my profile so other Mustela users can see it. */
  publishProfile(cfg: ProfileConfig, banner?: Blob): Promise<void>;
  pullSettings(): Promise<MustelaSettings | null>;
  pushSettings(s: MustelaSettings): Promise<void>;
  /** Looks someone up by id for call participants and mentions. Never throws. */
  person(id: string): Person;
  /** Name for a channel id, for <#id> mentions. */
  channelName(id: string): string | undefined;
  joinVoice(channelId: string, engine?: VoiceEngine): Promise<VoiceHandle>;
  /** Close connections. Safe to call twice. */
  dispose(): void;
}
