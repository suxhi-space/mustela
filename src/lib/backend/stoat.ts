import { ulidBefore } from "../ulid";
import type { ServerLooks } from "../profile/servers";
import { Client } from "stoat.js";
import type { VoicePresence, AccountApi, BotRow, MfaProof,
  Attachment, ChannelInfo, ChatBackend, ChatEvent, Embed, Friends, MemberGroup, Msg, Person, ProfileInfo, Reaction,
  BanRow, CategoryInfo, ChannelDetails, ChannelRules, CustomEmoji, DiscoverState, Override, ServerDetails, WebhookRow, ServerFolder, GifCategory, InviteRow, NotifyLevel, Role, ServerInfo, GifResult, InviteInfo, MeUpdate, SendOptions, Space, StoredSession, VoiceEngine, VoiceHandle, VoicePrefs,
} from "./types";
import { sanitizeProfile, type ProfileConfig } from "../profile/model";
import { packProfile, unpackProfile } from "../profile/pack";
import { BANNER_HEIGHT, CANONICAL_HEIGHT, CANONICAL_WIDTH, decodeMarkerScaled, encodeMarker, markerHeight } from "../marker/codec";
import { pullSettings, pushSettings, type MustelaSettings, type SyncApi } from "../sync/settings";
import { pullExt, pushExt, type ExtSettings } from "../sync/ext";
import { fetchBytes } from "../net";
import { decodeBottom, imageSize, MAX_PIXELS } from "../imageData";
import { createLimiter } from "../limit";
import { DEFAULT_API } from "./login";
import { DEFAULT_VOICE_PREFS } from "../device";
import { normalizeBase } from "../session/book";
import { Cloud } from "../cloud";
import { hslToRgb, hex } from "../color";

type SClient = InstanceType<typeof Client>;

const BADGES: [number, string][] = [
  [1, "Developer"], [2, "Translator"], [4, "Supporter"], [8, "Responsible Disclosure"], [16, "Founder"],
  [32, "Moderation"], [64, "Active Supporter"], [128, "Paw"], [256, "Early Adopter"],
];
export const badgeNames = (bits: number) => BADGES.filter(([b]) => (bits & b) !== 0).map(([, n]) => n);

/** A Stoat user (and, in a server, their member record) as the UI's Person. */
export function personOf(u: any, fallbackId = "?", member?: any): Person {
  if (!u) return { id: fallbackId, name: member?.nickname ?? "Unknown" };
  return {
    id: u.id,
    name: member?.nickname ?? u.displayName ?? u.username ?? "Unknown",
    username: u.username,
    discriminator: u.discriminator,
    avatarUrl: member?.avatarURL ?? u.avatarURL,
    online: !!u.online,
    presence: u.online ? (u.status?.presence ?? "Online").toLowerCase() : "offline",
    status: u.status?.text ?? undefined,
    badges: badgeNames(u.badges ?? 0),
    bot: !!u.bot,
    pronouns: (member?.pronouns || u.pronouns || undefined)?.slice(0, 32),
    colour: member?.roleColour ?? undefined,
    relation: ({ Friend: "friend", Incoming: "incoming", Outgoing: "outgoing", Blocked: "blocked", User: "self", BlockedOther: "none" } as const)[u.relationship as string] ?? "none",
  };
}

const FILE_TYPE: Record<string, Attachment["type"]> = { Image: "image", Video: "video", Audio: "audio" };

export function attachmentOf(f: any): Attachment {
  const type = FILE_TYPE[f.metadata?.type] ?? "file";
  return {
    id: f.id, name: f.filename ?? "file", url: f.originalUrl ?? f.createFileURL?.() ?? "",
    previewUrl: type === "image" || type === "video" ? f.createFileURL?.(true) ?? f.previewUrl : undefined,
    type, width: f.metadata?.width, height: f.metadata?.height, size: f.size, spoiler: !!f.isSpoiler,
  };
}

const GIF_ORIGINS = ["https://tenor.com", "https://giphy.com", "https://gifbox.me", "https://media.tenor.com", "https://media.giphy.com"];
const isGifUrl = (u?: string) => { try { return !!u && GIF_ORIGINS.includes(new URL(u).origin); } catch { return false; } };

export function embedOf(e: any): Embed | null {
  switch (e?.type) {
    case "Website":
      return {
        gif: e.specialContent?.type === "GIF" || isGifUrl(e.originalUrl ?? e.url),
        special: e.specialContent && e.specialContent.type !== "None" ? { type: e.specialContent.type, id: e.specialContent.id } : undefined,
        kind: "website", url: e.url ?? e.originalUrl, title: e.title, description: e.description, siteName: e.siteName,
        iconUrl: e.proxiedIconURL ?? e.iconUrl, colour: e.colour,
        image: e.image ? { url: e.image.proxiedURL ?? e.image.url, width: e.image.width, height: e.image.height } : undefined,
        video: e.video ? { url: e.video.proxiedURL ?? e.video.url, width: e.video.width, height: e.video.height } : undefined,
      };
    case "Image": return { kind: "image", gif: isGifUrl(e.url), url: e.url, image: { url: e.proxiedURL ?? e.url, width: e.width, height: e.height } };
    case "Video": return { kind: "video", gif: isGifUrl(e.url), url: e.url, video: { url: e.proxiedURL ?? e.url, width: e.width, height: e.height } };
    case "Text":
      return {
        kind: "text", url: e.url, title: e.title, description: e.description, colour: e.colour, iconUrl: e.proxiedIconURL ?? e.iconUrl,
        image: e.media ? { url: e.media.createFileURL?.() ?? "" } : undefined,
      };
    default: return null;
  }
}

/** Human text for Stoat system messages. */
export function systemText(sm: any, name: (id?: string) => string): string {
  switch (sm?.type) {
    case "text": return sm.content ?? "";
    case "user_added": return `${name(sm.userId)} was added by ${name(sm.byId)}`;
    case "user_remove": return `${name(sm.userId)} was removed by ${name(sm.byId)}`;
    case "user_joined": return `${name(sm.userId)} joined`;
    case "user_left": return `${name(sm.userId)} left`;
    case "user_kicked": return `${name(sm.userId)} was kicked`;
    case "user_banned": return `${name(sm.userId)} was banned`;
    case "channel_renamed": return `${name(sm.byId)} renamed the channel to ${sm.name}`;
    case "channel_description_changed": return `${name(sm.byId)} changed the channel description`;
    case "channel_icon_changed": return `${name(sm.byId)} changed the channel icon`;
    case "channel_ownership_changed": return `${name(sm.fromId)} gave ownership to ${name(sm.toId)}`;
    case "message_pinned": return `${name(sm.byId)} pinned a message`;
    case "message_unpinned": return `${name(sm.byId)} unpinned a message`;
    case "call_started": return `${name(sm.byId)} started a call`;
    default: return "System message";
  }
}

const RELATION: Record<string, keyof Friends> = { Friend: "friends", Incoming: "incoming", Outgoing: "outgoing", Blocked: "blocked" };

/** Invite links look like https://stt.gg/abc, https://stoat.chat/invite/abc, or just abc. */
export function inviteCode(input: string): string | null {
  const t = input.trim();
  const m = /(?:\/invite\/|\.gg\/|^)([A-Za-z0-9]{4,32})\/?$/.exec(t);
  return m ? m[1]! : null;
}

/** Stoat API errors carry a `type` (e.g. "MissingPermission"); turn the common ones into sentences. */
export function apiErrorText(e: unknown, fallback: string): string {
  const any = e as any;
  const type = any?.response?.data?.type ?? any?.data?.type ?? any?.type;
  const map: Record<string, string> = {
    MissingPermission: "You don't have permission to do that here.",
    NotFound: "That doesn't exist any more.",
    InvalidCredentials: "That password isn't right.",
    InvalidToken: "Your session expired. Sign in again.",
    UsernameTaken: "That username is taken.",
    EmailInUse: "That email is already in use.",
    TooManyAttachments: "Too many attachments.",
    PayloadTooLarge: "That file is too large.",
    LiveKitUnavailable: "Voice isn't available on this server right now.",
    NotAVoiceChannel: "That isn't a voice channel.",
    AlreadyConnected: "You're already in this call on another device.",
    InvalidOperation: "That isn't possible right now.",
    InvalidToken_MFA: "That code isn't right.",
    DisallowedMFAMethod: "Use a different way to confirm it's you.",
    InvalidUsername: "Usernames can use letters, numbers, dots, dashes and underscores.",
    ShortPassword: "That password is too short.",
    CompromisedPassword: "That password has appeared in a data breach. Pick another.",
    BlockedByOtherUser: "You can't do that with this person.",
  };
  if (typeof type === "string") return map[type] ?? `${fallback} (${type})`;
  const status = any?.response?.status ?? any?.status;
  if (status === 429) return "Slow down a little and try again.";
  if (status >= 500) return "The server had a problem. Try again shortly.";
  return any instanceof TypeError ? "Couldn't reach the server. Check your connection." : fallback;
}



const READY_TIMEOUT_MS = 30_000;
const profileLimit = createLimiter(3);

export class StoatBackend implements ChatBackend {
  private profiles = new Map<string, Promise<ProfileInfo>>();
  readonly cloud: Cloud;
  private disposed = false;

  private constructor(private client: SClient, private sess: StoredSession) {
    this.cloud = new Cloud(normalizeBase((client as any).options?.baseURL) ?? DEFAULT_API, () => this.sess.token, () => this.sess.user_id);
  }

  readonly account: AccountApi = (() => {
    const w = <T>(f: () => Promise<T>, what: string) => this.wrap(f, what);
    const c = () => this.client as any;
    const ticket = async (proof: MfaProof) => (await c().account.mfa()).createTicket(proof);
    const bot = (b: any): BotRow => ({ id: b.id, name: b.user?.username ?? "Bot", avatarUrl: b.user?.avatarURL, public: !!b.public, token: b.token, interactionsUrl: b.interactionsUrl, createdAt: b.createdAt });
    return {
      email: () => w(() => c().account.fetchEmail(), "load your email"),
      changeUsername: (u, pw) => w(async () => void (await c().user.changeUsername(u, pw)), "change your username"),
      changeEmail: (e, pw) => w(() => c().account.changeEmail(e, pw), "change your email"),
      changePassword: (n, cur) => w(() => c().account.changePassword(n, cur), "change your password"),
      mfa: () => w(async () => { const m = await c().account.mfa(); return { authenticator: m.authenticatorEnabled, recovery: m.recoveryEnabled }; }, "load two-factor settings"),
      recoveryCodes: (p, regen) => w(async () => { const t = await ticket(p); return regen ? t.generateRecoveryCodes() : t.fetchRecoveryCodes(); }, "load recovery codes"),
      authenticatorSecret: (p) => w(async () => (await ticket(p)).generateAuthenticatorSecret(), "set up the authenticator"),
      enableAuthenticator: (code) => w(async () => (await c().account.mfa()).enableAuthenticator(code.replace(/\s/g, "")), "turn on the authenticator"),
      disableAuthenticator: (p) => w(async () => (await ticket(p)).disableAuthenticator(), "turn off the authenticator"),
      disableAccount: (p) => w(async () => (await ticket(p)).disableAccount(), "disable your account"),
      deleteAccount: (p) => w(async () => (await ticket(p)).deleteAccount(), "delete your account"),
      sessions: () => w(async () => ((await c().sessions.fetch()) as any[]).map((x) => ({ id: x.id, name: x.name, current: x.current, createdAt: x.createdAt })), "load sessions"),
      renameSession: (id, name) => w(() => c().sessions.get(id).rename(name), "rename the session"),
      logoutSession: (id, p) => w(async () => c().sessions.get(id).delete(await ticket(p)), "log out that session"),
      logoutOtherSessions: (p) => w(async () => c().sessions.deleteAll(await ticket(p), false), "log out other sessions"),
      bots: () => w(async () => ((await c().bots.fetchOwned()) as any[]).map(bot), "load your bots"),
      createBot: (name) => w(async () => bot(await c().bots.createBot(name)), "create the bot"),
      editBot: (id, p) => w(async () => {
        const data: any = {}, remove: string[] = [];
        if (p.name !== undefined) data.name = p.name;
        if (p.public !== undefined) data.public = p.public;
        if (p.interactionsUrl === null || p.interactionsUrl === "") remove.push("InteractionsURL"); else if (p.interactionsUrl !== undefined) data.interactions_url = p.interactionsUrl;
        if (p.resetToken) remove.push("Token");
        if (remove.length) data.remove = remove;
        await (c().bots.get(id) ?? (await c().bots.fetch(id))).edit(data);
      }, "save the bot"),
      deleteBot: (id) => w(async () => (c().bots.get(id) ?? (await c().bots.fetch(id))).delete(), "delete the bot"),
    };
  })();

  /** Opens the live connection for an existing session. Throws a friendly Error on failure. */
  static async open(baseURL: string | undefined, session: StoredSession): Promise<StoatBackend> {
    const base = normalizeBase(baseURL) ?? DEFAULT_API;
    let config: any;
    // A flaky network (or a laptop just waking up) gets a few tries before we give up.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(base + "/");
        if (!r.ok) throw new Error();
        config = await r.json();
        break;
      } catch {
        if (attempt >= 3) throw new Error("Couldn't reach the server. Check your connection.");
        await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
      }
    }
    const client = new Client({ baseURL: base, autoReconnect: true, syncUnreads: true } as any, config);
    client.useExistingSession(session);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error("Timed out connecting. Try again.")), READY_TIMEOUT_MS);
      const done = (err?: Error) => {
        clearTimeout(timer);
        client.off("ready", onReady);
        client.off("error", onError);
        if (err) { client.options.autoReconnect = false; try { client.events.disconnect(); } catch { /* already closed */ } reject(err); } else resolve();
      };
      const onReady = () => done();
      // Only a real "this session is invalid" answer means signing in again. Socket hiccups are retried
      // by the SDK (autoReconnect) until the timeout, instead of showing "rejected" for a network blip.
      const onError = (err: any) => {
        const type = typeof err === "string" ? err : err?.type;
        if (type === "InvalidSession" || type === "NotAuthenticated" || type === "InvalidToken") done(new Error("The server rejected this session. Sign in again."));
      };
      client.on("ready", onReady);
      client.on("error", onError);
      client.connect(); // login() never connects on its own; this is what actually opens the socket
    });
    const b = new StoatBackend(client, session);
    await b.loadNotif();
    return b;
  }

  get me(): Person { return personOf(this.client.user, this.sess.user_id); }
  session() { return this.sess; }

  person(id: string): Person { return personOf(this.client.users.get(id), id); }
  channelName(id: string) { return this.client.channels.get(id)?.name; }
  channelsIn(serverId: string) {
    const s: any = this.client.servers.get(serverId);
    return ((s?.orderedChannels ?? []) as any[]).flatMap((cat) => cat.channels.filter(Boolean))
      .filter((c: any) => { try { return c.havePermission("ViewChannel"); } catch { return true; } })
      .map((c: any) => ({ id: c.id as string, name: c.name as string, kind: (c.isVoice ? "voice" : "text") as "text" | "voice" }));
  }
  role(id: string): Role | undefined {
    for (const s of this.client.servers.toList() as any[]) {
      const r = s.roles?.get?.(id);
      if (r) return { id, name: r.name, colour: r.colour ?? undefined, hoist: !!r.hoist, rank: r.rank ?? 0 };
    }
    return undefined;
  }
  channelRules(channelId: string): ChannelRules {
    const c: any = this.client.channels.get(channelId);
    if (!c) return { canSend: false, canUpload: false, canReact: false, canManage: false, slowmode: 0 };
    const has = (p: string) => { try { return !!c.havePermission(p); } catch { return true; } };
    const exempt = has("BypassSlowmode");
    const slow = exempt ? 0 : Number(c.slowmode ?? 0) || 0;
    const wait = slow ? c.userSlowmode?.() : undefined;
    return {
      canSend: has("SendMessage"), canUpload: has("UploadFiles"), canReact: has("React"), canManage: has("ManageMessages"), slowmode: slow,
      waitUntil: wait ? (wait.receivedAt ?? Date.now()) + wait.retry_after * 1000 : undefined,
    };
  }
  emojiUrl(id: string) { return `${(this.client.configuration as any)?.features?.autumn?.url ?? ""}/emojis/${id}`; }

  private channelInfo(c: any, category?: string, categoryId?: string): ChannelInfo {
    const dm = c.type === "DirectMessage";
    return {
      id: c.id,
      name: dm ? c.recipient?.displayName ?? "Unknown" : c.type === "SavedMessages" ? "Saved Notes" : c.name,
      kind: dm ? "dm" : c.type === "Group" ? "group" : c.isVoice ? "voice" : "text",
      description: c.description,
      category, categoryId,
      unread: !!c.unread && !this.isMuted("channel", c.id) && !(c.serverId && this.isMuted("server", c.serverId)),
      mentions: c.mentions?.size || undefined,
      muted: this.isMuted("channel", c.id) || this.notif.channel[c.id] === "none",
      iconUrl: c.iconURL,
      peer: dm ? personOf(c.recipient) : undefined,
      voice: c.voiceParticipants?.size ? [...c.voiceParticipants.values()].map((v: any) => ({
        ...this.person(v.userId),
        muted: !v.isPublishing?.(), deaf: !v.isReceiving?.(), camera: !!v.isCamera?.(), screen: !!v.isScreensharing?.(),
      })) : undefined,
    };
  }

  async spaces(): Promise<Space[]> {
    const list = this.client.channels.toList() as any[];
    const saved = list.find((c) => c.type === "SavedMessages");
    const dms = list
      .filter((c) => (c.type === "DirectMessage" || c.type === "Group") && c.active !== false)
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
      .map((c) => this.channelInfo(c));
    const order = this.serverOrder();
    const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    const servers: Space[] = (this.client.servers.toList() as any[]).map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.id) - rank(b.s.id) || a.i - b.i).map(({ s }) => ({
      id: s.id, name: s.name, iconUrl: s.iconURL, bannerUrl: s.bannerURL, description: s.description,
      channels: (s.orderedChannels as any[]).flatMap((cat) =>
        cat.channels.filter(Boolean).map((c: any) => this.channelInfo(c, cat.id === "default" ? undefined : cat.title, cat.id === "default" ? undefined : cat.id))),
    }));
    return [{ id: "home", name: "Home", home: true, channels: saved ? [this.channelInfo(saved), ...dms] : dms }, ...servers];
  }

  async members(spaceId: string): Promise<MemberGroup[]> {
    if (spaceId === "home") return [];
    const s: any = this.client.servers.get(spaceId);
    if (!s) return [];
    const { members, users } = await s.fetchMembers();
    const byId = new Map((users as any[]).map((u) => [u.id, u]));
    const hoisted = new Map<string, { title: string; rank: number; people: Person[] }>();
    const online: Person[] = [], offline: Person[] = [];
    for (const m of members as any[]) {
      const uid = m.id?.user ?? m.userId;
      const u = byId.get(uid) ?? m.user;
      const p = personOf(u, uid ?? "?", m);
      if (!p.online) { offline.push(p); continue; }
      const role = m.hoistedRole;
      if (role?.id && role.name) {
        const g = hoisted.get(role.id) ?? { title: role.name, rank: role.rank ?? 0, people: [] as Person[] };
        g.people.push(p);
        hoisted.set(role.id, g);
      } else online.push(p);
    }
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    // Cap per group so a 50k-member server can't flood the DOM.
    const cap = (ps: Person[]) => ps.sort(byName).slice(0, 300);
    return [
      ...[...hoisted.values()].sort((a, b) => a.rank - b.rank).map((g) => ({ title: g.title, people: cap(g.people) })),
      { title: "Online", people: cap(online) },
      { title: "Offline", people: cap(offline) },
    ].filter((g) => g.people.length);
  }

  private toMsg(m: any): Msg {
    const author = personOf(m.author, m.authorId ?? "?", m.member);
    if (m.masquerade?.name || m.webhook) author.name = m.username ?? author.name;
    if (m.masquerade?.avatar || m.webhook) author.avatarUrl = m.avatarURL ?? author.avatarUrl;
    if (m.roleColour) author.colour = m.roleColour;
    if (m.webhook) author.bot = true;
    const reactions: Reaction[] = [];
    m.reactions?.forEach?.((users: any, emoji: string) => { const u = [...users]; if (u.length) reactions.push({ emoji, users: u }); });
    return {
      id: m.id, channelId: m.channelId, author, text: m.content ?? "", at: m.createdAt, editedAt: m.editedAt,
      attachments: (m.attachments ?? []).map(attachmentOf),
      embeds: (m.embeds ?? []).map(embedOf).filter(Boolean) as Embed[],
      reactions, replyIds: m.replyIds, mentionsMe: !!m.mentioned, pinned: !!m.pinned,
      system: m.systemMessage ? systemText(m.systemMessage, (id) => (id ? this.person(id).name : "Someone")) : undefined,
    };
  }

  private async page(channelId: string, q: Record<string, unknown>): Promise<Msg[]> {
    const ch = this.client.channels.get(channelId);
    if (!ch) return [];
    const { messages } = await ch.fetchMessagesWithUsers({ limit: 50, ...q } as any);
    return messages.map((m) => this.toMsg(m)).sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  messagesAfter(channelId: string, after: string) { return this.page(channelId, { after, sort: "Oldest" }); }
  messagesAround(channelId: string, id: string) { return this.page(channelId, { nearby: id }); }

  async messages(channelId: string, before?: string): Promise<Msg[]> {
    const ch = this.client.channels.get(channelId);
    if (!ch) return [];
    const { messages } = await ch.fetchMessagesWithUsers({ limit: 50, ...(before ? { before } : {}) } as any);
    return messages.map((m) => this.toMsg(m)).sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private async raw(channelId: string, id: string): Promise<any> {
    return this.client.messages.get(id) ?? (await this.client.channels.get(channelId)?.fetchMessage(id));
  }

  async message(channelId: string, id: string): Promise<Msg | null> {
    try { const m = await this.raw(channelId, id); return m ? this.toMsg(m) : null; } catch { return null; }
  }

  async send(channelId: string, opts: SendOptions) {
    const ch = this.client.channels.get(channelId);
    if (!ch) throw new Error("Unknown channel");
    const files = opts.files ?? [];
    const total = files.reduce((n, f) => n + f.size, 0) || 1;
    let done = 0;
    const attachments: string[] = [];
    for (const [i, f] of files.entries()) {
      const named = opts.spoilers?.[i] && !f.name.startsWith("SPOILER_") ? new File([f], `SPOILER_${f.name}`, { type: f.type }) : f;
      attachments.push(await this.upload("attachments", named, (sent) => opts.onProgress?.((done + sent) / total)));
      done += f.size;
    }
    await ch.sendMessage({
      content: opts.text || undefined,
      attachments: attachments.length ? attachments : undefined,
      replies: opts.replies?.length ? opts.replies : undefined,
    } as any);
  }

  /** Uploads to Stoat's file server with progress (the SDK's fetch-based upload can't report any). */
  private upload(tag: string, file: File, onProgress?: (sentBytes: number) => void): Promise<string> {
    const base = (this.client.configuration as any)?.features?.autumn?.url;
    if (!base) return this.client.uploadFile(tag, file);
    const [key, value] = (this.client as any).authenticationHeader as [string, string];
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${base}/${tag}`);
      xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (e) => onProgress?.(e.loaded);
      xhr.onload = () => {
        try {
          const id = JSON.parse(xhr.responseText)?.id;
          if (xhr.status < 300 && id) resolve(id);
          else reject(new Error(xhr.status === 413 ? "That file is too large for the server." : `Upload failed (${xhr.status}).`));
        } catch { reject(new Error("Upload failed.")); }
      };
      xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
      const body = new FormData();
      body.append("file", file, file.name);
      xhr.send(body);
    });
  }

  edit(channelId: string, id: string, text: string) { return this.wrap(async () => { await (await this.raw(channelId, id))?.edit({ content: text }); }, "edit the message"); }
  remove(channelId: string, id: string) { return this.wrap(async () => { await (await this.raw(channelId, id))?.delete(); }, "delete the message"); }
  react(channelId: string, id: string, emoji: string, on: boolean) {
    return this.wrap(async () => {
      const m = await this.raw(channelId, id);
      if (on) await m?.react(encodeURIComponent(emoji)); else await m?.unreact(encodeURIComponent(emoji));
    }, on ? "add that reaction" : "remove that reaction");
  }
  typing(channelId: string, on: boolean) {
    const ch: any = this.client.channels.get(channelId);
    try { if (on) ch?.startTyping(); else ch?.stopTyping(); } catch { /* socket not ready */ }
  }
  lastRead(channelId: string) { return (this.client as any).channelUnreads?.get(channelId)?.lastMessageId as string | undefined; }
  unreadCount(channelId: string) {
    const ch: any = this.client.channels.get(channelId);
    if (!ch?.unread) return 0;
    const read = this.lastRead(channelId) ?? "";
    let n = 0;
    for (const m of (this.client.messages as any).toList() as any[]) if (m.channelId === channelId && m.id > read && m.authorId !== this.sess.user_id) n++;
    return Math.max(1, n);
  }
  mentionIds() {
    const out: { channelId: string; ids: string[] }[] = [];
    for (const c of this.client.channels.toList() as any[]) {
      const ids = c.mentions ? [...c.mentions] as string[] : [];
      if (ids.length && !this.isMuted("channel", c.id) && !(c.serverId && this.isMuted("server", c.serverId))) out.push({ channelId: c.id, ids: ids.sort() });
    }
    return out;
  }
  ack(channelId: string) { const ch: any = this.client.channels.get(channelId); if (ch?.unread) void ch.ack().catch?.(() => {}); }
  markUnread(channelId: string, messageId: string) {
    const ch: any = this.client.channels.get(channelId);
    // Read up to just before this message: the smallest id from one millisecond earlier. The last flag
    // stops the open conversation from marking it read again straight away (Stoat's own client does the same).
    if (ch) void Promise.resolve(ch.ack(ulidBefore(messageId), true, false, true)).catch(() => {});
  }

  onEvent(cb: (e: ChatEvent) => void) {
    const c: any = this.client;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const activity = () => { clearTimeout(timer); timer = setTimeout(() => cb({ t: "activity" }), 250); }; // presence storms
    const typing = (ch: any) => cb({ t: "typing", channelId: ch.id, people: (ch.typing ?? []).filter((u: any) => u.id !== this.sess.user_id).map((u: any) => personOf(u)) });
    const h: [string, (...a: any[]) => void][] = [
      ["messageCreate", (m) => { cb({ t: "message", m: this.toMsg(m) }); activity(); }],
      ["messageUpdate", (m) => cb({ t: "update", m: this.toMsg(m) })],
      ["messageDelete", (m) => cb({ t: "delete", channelId: m.channelId, id: m.id })],
      ["messageDeleteBulk", (ms: any[]) => ms.forEach((m) => cb({ t: "delete", channelId: m.channelId, id: m.id }))],
      ["messageReactionAdd", (m) => cb({ t: "update", m: this.toMsg(m) })],
      ["messageReactionRemove", (m) => cb({ t: "update", m: this.toMsg(m) })],
      ["messageReactionRemoveEmoji", (m) => cb({ t: "update", m: this.toMsg(m) })],
      ["channelStartTyping", typing], ["channelStopTyping", typing],
      ...["channelAcknowledged", "channelCreate", "channelDelete", "channelUpdate", "serverCreate", "serverDelete", "serverUpdate",
        "serverLeave", "userUpdate", "channelGroupJoin", "channelGroupLeave"].map((e): [string, () => void] => [e, activity]),
    ];
    h.push(["userSettingsUpdate", (_id: string, update: Record<string, [number, string]>) => {
      for (const [k, v] of Object.entries(update ?? {})) this.applySynced(k, v?.[1]);
      activity();
    }]);
    // "ready" fires again after every reconnect; the first one happened before anyone listened.
    h.push(["ready", () => { cb({ t: "reconnected" }); activity(); }]);
    for (const [e, f] of h) c.on(e, f);
    // Voice joins/leaves only update the SDK's maps; watch the raw socket for them.
    const raw = (ev: any) => { if (typeof ev?.type === "string" && /^(VoiceChannel|UserVoiceState|UserMoveVoiceChannel)/.test(ev.type)) activity(); };
    c.events?.on?.("event", raw);
    return () => { clearTimeout(timer); for (const [e, f] of h) c.off(e, f); c.events?.off?.("event", raw); };
  }

  /* ---------- Gifbox (Stoat's own GIF service, same as the official client) ---------- */
  private get gifbox(): string | null {
    const base = normalizeBase((this.client as any).options?.baseURL) ?? DEFAULT_API;
    // Only sessions from Stoat's own servers are accepted there.
    return base === DEFAULT_API || /^https:\/\/([\w-]+\.)*(stoat\.chat|revolt\.chat)(\/api)?$/.test(base) ? "https://api.gifbox.me" : null;
  }
  private async gifFetch(path: string): Promise<any> {
    const g = this.gifbox;
    if (!g) return null;
    const [k, v] = (this.client as any).authenticationHeader as [string, string];
    const r = await fetch(`${g}/${path}`, { headers: { [k]: v } });
    if (!r.ok) throw new Error(`Gifbox ${r.status}`);
    return r.json();
  }
  async gifs(query: string): Promise<GifResult[]> {
    const q = query.trim().toLowerCase();
    const res = await this.gifFetch(q === "trending" || !q ? "trending?locale=en_US" : `search?locale=en_US&query=${encodeURIComponent(q)}`);
    // Gifbox answers with a bare array (Stoat's picker reads it that way); older builds wrapped it in { results }.
    const list: any[] = Array.isArray(res) ? res : Array.isArray(res?.results) ? res.results : [];
    return list.map((r): GifResult | null => {
      const f = r?.media_formats ?? {}, v = f.tinywebm ?? f.webm ?? f.tinymp4 ?? f.mp4, img = f.tinygif ?? f.nanogif ?? f.gif ?? f.gifpreview;
      const pv = v?.url ?? img?.url;
      return r?.url && pv ? { url: r.url as string, preview: pv as string, still: img?.url as string | undefined, w: (v ?? img)?.dims?.[0], h: (v ?? img)?.dims?.[1] } : null;
    }).filter((x): x is GifResult => !!x);
  }
  async gifCategories(): Promise<GifCategory[]> {
    const res = await this.gifFetch("categories?locale=en_US");
    return Array.isArray(res) ? res.filter((c) => c?.title && c?.image).slice(0, 40) : [];
  }

  private fileUrl(f: any): string | undefined {
    const base = (this.client.configuration as any)?.features?.autumn?.url;
    return f?._id && base ? `${base}/${f.tag ?? "icons"}/${f._id}` : undefined;
  }
  async publicBot(id: string) {
    try {
      const r: any = await (this.client.api as any).get(`/bots/${encodeURIComponent(id)}/invite`);
      return r?._id ? { id: r._id as string, name: r.username as string, description: r.description as string | undefined, avatarUrl: r.avatar ? this.fileUrl({ ...r.avatar, tag: "avatars" }) : undefined } : null;
    } catch { return null; }
  }
  async addBot(botId: string, serverId: string) {
    await (this.client.api as any).post(`/bots/${encodeURIComponent(botId)}/invite`, { server: serverId });
  }
  async invite(code: string): Promise<InviteInfo | null> {
    try {
      const r: any = await (this.client.api as any).get(`/invites/${encodeURIComponent(code)}`);
      if (r?.type !== "Server") return null;
      return {
        code, serverId: r.server_id, serverName: r.server_name, iconUrl: this.fileUrl(r.server_icon), bannerUrl: this.fileUrl(r.server_banner),
        memberCount: r.member_count, channelName: r.channel_name, inviter: r.user_name, joined: !!this.client.servers.get(r.server_id),
      };
    } catch { return null; }
  }
  emojis(): CustomEmoji[] {
    const list = ((this.client as any).emojis?.toList?.() ?? []) as any[];
    return list.filter((e) => e?.id && e.parent?.type === "Server").map((e) => {
      const s: any = this.client.servers.get(e.parent.id);
      return { id: e.id, name: e.name, url: this.emojiUrl(e.id), animated: !!e.animated, serverId: e.parent.id, serverName: s?.name, serverIcon: s?.iconURL };
    }).filter((e) => e.serverName);
  }

  /* ---------- servers & moderation ---------- */
  private server(id: string): any { const s = this.client.servers.get(id); if (!s) throw new Error("You're not in that server any more."); return s; }
  private async uploadTagged(tag: string, f: File) { return this.upload(tag, f); }
  private wrap = async <T>(f: () => Promise<T>, what: string): Promise<T> => { try { return await f(); } catch (e) { throw new Error(apiErrorText(e, `Couldn't ${what}.`)); } };

  createServer(name: string, description?: string) { return this.wrap(async () => ((await (this.client as any).servers.createServer({ name, ...(description ? { description } : {}) })) as any).id as string, "create the server"); }
  async search(cid: string, query: string) {
    const ch: any = this.client.channels.get(cid);
    // Authors come in the same answer, so results don't wait on a lookup per person; newest first, like Discord.
    const r: any = await this.wrap(() => (ch.searchWithUsers ? ch.searchWithUsers({ query, sort: "Latest", limit: 50 }) : ch.search({ query, sort: "Latest", limit: 50 })), "search");
    return ((Array.isArray(r) ? r : r.messages) as any[]).map((m) => this.toMsg(m));
  }
  async pinned(cid: string) {
    const ch: any = this.client.channels.get(cid);
    const r: any[] = await this.wrap(() => ch.search({ pinned: true, sort: "Latest", limit: 100 }), "load pinned messages");
    return r.map((m) => this.toMsg(m));
  }

  serverInfo(id: string): ServerInfo | null {
    const s: any = this.client.servers.get(id);
    if (!s) return null;
    const has = (p: string) => { try { return !!s.havePermission(p); } catch { return false; } };
    return {
      id, name: s.name, description: s.description, iconUrl: s.iconURL, bannerUrl: s.bannerURL, ownerId: s.ownerId, isOwner: s.ownerId === this.sess.user_id,
      perms: { manageServer: has("ManageServer"), manageRoles: has("ManageRole"), manageChannels: has("ManageChannel"), manageEmoji: has("ManageCustomisation"),
        kick: has("KickMembers"), ban: has("BanMembers"), invite: has("InviteOthers"), manageMessages: has("ManageMessages") },
    };
  }
  editServer(id: string, p: { name?: string; description?: string; icon?: File | null; banner?: File | null }) {
    return this.wrap(async () => {
      const data: any = {}, remove: string[] = [];
      if (p.name !== undefined) data.name = p.name.trim();
      if (p.description !== undefined) { if (p.description.trim()) data.description = p.description; else remove.push("Description"); }
      if (p.icon === null) remove.push("Icon"); else if (p.icon) data.icon = await this.uploadTagged("icons", p.icon);
      if (p.banner === null) remove.push("Banner"); else if (p.banner) data.banner = await this.uploadTagged("banners", p.banner);
      if (remove.length) data.remove = remove;
      await this.server(id).edit(data);
    }, "save the server");
  }
  roles(id: string): Role[] {
    const s: any = this.client.servers.get(id);
    return ((s?.orderedRoles ?? []) as any[]).map((r) => ({ id: r.id, name: r.name, colour: r.colour ?? undefined, hoist: !!r.hoist, rank: r.rank ?? 0 }));
  }
  createRole(id: string, name: string) { return this.wrap(async () => void (await this.server(id).createRole(name)), "create the role"); }
  editRole(id: string, rid: string, p: { name?: string; colour?: string | null; hoist?: boolean }) {
    return this.wrap(async () => {
      const data: any = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.hoist !== undefined) data.hoist = p.hoist;
      if (p.colour === null) data.remove = ["Colour"]; else if (p.colour) data.colour = p.colour;
      await this.server(id).editRole(rid, data);
    }, "save the role");
  }
  deleteRole(id: string, rid: string) { return this.wrap(async () => void (await this.server(id).deleteRole(rid)), "delete the role"); }
  serverEmojis(id: string): CustomEmoji[] { return this.emojis().filter((e) => e.serverId === id); }
  uploadEmoji(id: string, name: string, file: File) {
    return this.wrap(async () => { const fid = await this.uploadTagged("emojis", file); await this.server(id).createEmoji(fid, { name }); }, "upload the emoji");
  }
  deleteEmoji(eid: string) { return this.wrap(async () => { const e: any = (this.client as any).emojis?.get?.(eid); await e?.delete(); }, "delete the emoji"); }
  invites(id: string) {
    return this.wrap(async () => ((await this.server(id).fetchInvites()) as any[]).map((i) => ({
      code: i.id ?? i._id ?? i.code, channelName: this.client.channels.get(i.channelId)?.name, creator: i.creatorId ? this.person(i.creatorId) : undefined,
    })), "load invites");
  }
  createInvite(cid: string) { return this.wrap(async () => { const inv: any = await this.client.channels.get(cid)!.createInvite(); return inv.id ?? inv._id; }, "create an invite"); }
  deleteInvite(code: string) { return this.wrap(async () => void (await (this.client.api as any).delete(`/invites/${encodeURIComponent(code)}`)), "delete the invite"); }
  bans(id: string) {
    return this.wrap(async () => ((await this.server(id).fetchBans()) as any[]).map((b) => ({ person: personOf(b.user, b.id?.user ?? b.userId ?? "?"), reason: b.reason ?? undefined })), "load bans");
  }
  unban(id: string, uid: string) { return this.wrap(async () => void (await this.server(id).unbanUser(uid)), "unban"); }
  kick(id: string, uid: string) { return this.wrap(async () => void (await this.server(id).kickUser(uid)), "kick them"); }
  ban(id: string, uid: string, reason?: string) { return this.wrap(async () => void (await this.server(id).banUser(uid, reason ? { reason } : {})), "ban them"); }
  createChannel(id: string, p: { name: string; kind: "text" | "voice"; description?: string }) {
    return this.wrap(async () => (await this.server(id).createChannel({ type: "Text", name: p.name, description: p.description || undefined, ...(p.kind === "voice" ? { voice: {} } : {}) })).id as string, "create the channel");
  }
  editChannel(cid: string, p: { name?: string; description?: string; icon?: File | null; slowmode?: number; mature?: boolean }) {
    return this.wrap(async () => {
      const data: any = {}, remove: string[] = [];
      if (p.name !== undefined) data.name = p.name;
      if (p.description !== undefined) { if (p.description.trim()) data.description = p.description; else remove.push("Description"); }
      if (p.icon === null) remove.push("Icon"); else if (p.icon) data.icon = await this.upload("icons", p.icon);
      if (p.slowmode !== undefined) data.slowmode = Math.max(0, Math.round(p.slowmode));
      if (p.mature !== undefined) data.nsfw = p.mature;
      if (remove.length) data.remove = remove;
      await this.client.channels.get(cid)!.edit(data);
    }, "save the channel");
  }
  channelDetails(cid: string): ChannelDetails | null {
    const c: any = this.client.channels.get(cid);
    if (!c?.serverId) return null;
    const has = (x: string) => { try { return !!c.havePermission(x); } catch { return false; } };
    const ov = (o: any): Override => ({ allow: Number(o?.a ?? o?.allow ?? 0), deny: Number(o?.d ?? o?.deny ?? 0) });
    return {
      id: c.id, name: c.name, kind: c.isVoice ? "voice" : "text", serverId: c.serverId, description: c.description, iconUrl: c.iconURL,
      slowmode: Number(c.slowmode ?? 0) || 0, mature: !!c.mature,
      defaultPerms: ov(c.defaultPermissions),
      rolePerms: Object.fromEntries(Object.entries(c.rolePermissions ?? {}).map(([k, v]) => [k, ov(v)])),
      canManage: has("ManageChannel"), canManagePerms: has("ManagePermissions"), canManageWebhooks: has("ManageWebhooks"),
    };
  }
  setChannelPermissions(cid: string, roleId: string, o: Override) {
    return this.wrap(async () => void (await (this.client.channels.get(cid) as any).setPermissions(roleId, { allow: o.allow, deny: o.deny })), "save the permissions");
  }
  private hookRow(w: any): WebhookRow {
    const base = normalizeBase((this.client as any).options?.baseURL) ?? DEFAULT_API;
    return { id: w.id, name: w.name, avatarUrl: w.avatarURL, url: `${base}/webhooks/${w.id}/${w.token}` };
  }
  webhooks(cid: string) { return this.wrap(async () => ((await (this.client.channels.get(cid) as any).fetchWebhooks()) as any[]).map((w) => this.hookRow(w)), "load webhooks"); }
  createWebhook(cid: string, name: string) { return this.wrap(async () => this.hookRow(await (this.client.channels.get(cid) as any).createWebhook(name)), "create the webhook"); }
  deleteWebhook(cid: string, id: string) {
    return this.wrap(async () => {
      const w: any = (this.client as any).channelWebhooks?.get?.(id) ?? ((await (this.client.channels.get(cid) as any).fetchWebhooks()) as any[]).find((x) => x.id === id);
      await w?.delete();
    }, "delete the webhook");
  }
  categories(sid: string): CategoryInfo[] {
    const s: any = this.client.servers.get(sid);
    return ((s?.categories ?? []) as any[]).map((c) => ({ id: c.id, title: c.title, channels: [...(c.channels ?? [])] }));
  }
  saveCategories(sid: string, cats: CategoryInfo[]) {
    return this.wrap(async () => void (await this.server(sid).edit({ categories: cats.map((c) => ({ id: c.id, title: c.title.slice(0, 32), channels: c.channels })) })), "save the categories");
  }
  serverDetails(sid: string): ServerDetails | null {
    const s: any = this.client.servers.get(sid);
    if (!s) return null;
    const roles: Record<string, Override> = {};
    for (const r of (s.orderedRoles ?? []) as any[]) roles[r.id] = { allow: Number(r.permissions?.a ?? 0), deny: Number(r.permissions?.d ?? 0) };
    return { systemMessages: { ...(s.systemMessages ?? {}) }, discoverable: !!s.discoverable, defaultPerms: Number(s.defaultPermissions ?? 0), rolePerms: roles, memberCount: s.approximateMemberCount || undefined };
  }
  editServerExtras(sid: string, p: { systemMessages?: ServerDetails["systemMessages"] }) {
    return this.wrap(async () => {
      const data: any = {};
      if (p.systemMessages) {
        const sm = Object.fromEntries(Object.entries(p.systemMessages).filter(([, v]) => !!v));
        if (Object.keys(sm).length) data.system_messages = sm; else data.remove = ["SystemMessages"];
      }
      await this.server(sid).edit(data);
    }, "save the server");
  }
  setServerPermissions(sid: string, roleId: string, o: Override | number) {
    return this.wrap(async () => void (await this.server(sid).setPermissions(roleId === "default" ? undefined : roleId, o as any)), "save the permissions");
  }
  async discoverState(sid: string): Promise<DiscoverState> {
    const s: any = this.client.servers.get(sid);
    if (!s?.discoverRequestStatus) return "unavailable";
    if (s.discoverable) return "approved";
    try {
      const r: any = await s.discoverRequestStatus();
      const st = String(r?.status ?? r?.state ?? "").toLowerCase();
      return st.includes("reject") || st.includes("deni") ? "rejected" : st.includes("approv") || st.includes("accept") ? "approved" : "pending";
    } catch (e: any) {
      const type = e?.type ?? (() => { try { return JSON.parse(e?.message ?? "{}").type; } catch { return undefined; } })();
      return type === "NotFound" || e?.response?.status === 404 ? "none" : "unavailable";
    }
  }
  requestDiscover(sid: string) { return this.wrap(async () => void (await this.server(sid).requestDiscover()), "send the Discover request"); }
  deleteServer(sid: string) { return this.wrap(async () => void (await this.server(sid).delete()), "delete the server"); }
  async memberSince(sid: string, uid: string) {
    const m: any = this.member(sid, uid) ?? (await this.client.servers.get(sid)?.fetchMember(uid).catch(() => null));
    const j = m?.joinedAt ?? m?.joined_at;
    const d = j instanceof Date ? j : typeof j === "string" || typeof j === "number" ? new Date(j) : undefined;
    return d && !Number.isNaN(d.getTime()) ? d : undefined;
  }
  deleteChannel(cid: string) { return this.wrap(async () => void (await this.client.channels.get(cid)!.delete()), "delete the channel"); }
  private member(sid: string, uid: string): any { return (this.client as any).serverMembers?.getByKey?.({ server: sid, user: uid }); }
  async identity(sid: string) {
    const m: any = this.member(sid, this.sess.user_id) ?? (await this.server(sid).fetchMember(this.sess.user_id).catch(() => null));
    return { nickname: m?.nickname ?? undefined, avatarUrl: m?.avatar ? m.avatarURL : undefined };
  }
  editIdentity(sid: string, p: { nickname?: string | null; avatar?: File | null }) {
    return this.wrap(async () => {
      const m: any = this.member(sid, this.sess.user_id) ?? (await this.server(sid).fetchMember(this.sess.user_id));
      const data: any = {}, remove: string[] = [];
      if (p.nickname === null || p.nickname === "") remove.push("Nickname"); else if (p.nickname !== undefined) data.nickname = p.nickname.trim();
      if (p.avatar === null) remove.push("Avatar"); else if (p.avatar) data.avatar = await this.upload("avatars", p.avatar);
      if (remove.length) data.remove = remove;
      await m.edit(data);
    }, "save your server profile");
  }
  async memberRoles(sid: string, uid: string) {
    const m: any = this.member(sid, uid) ?? (await this.server(sid).fetchMember(uid).catch(() => null));
    return (m?.roles ?? []) as string[];
  }
  setMemberRoles(sid: string, uid: string, roles: string[]) {
    return this.wrap(async () => {
      const m: any = this.member(sid, uid) ?? (await this.server(sid).fetchMember(uid));
      await m.edit(roles.length ? { roles } : { remove: ["Roles"] });
    }, "change their roles");
  }
  leaveServer(id: string) { return this.wrap(async () => void (await this.server(id).delete()), "leave the server"); }
  closeDM(cid: string) { return this.wrap(async () => void (await this.client.channels.get(cid)!.delete()), "close the conversation"); }
  markRead(t: { channel?: string; server?: string }) {
    try { if (t.channel) void (this.client.channels.get(t.channel) as any)?.ack(undefined, true); if (t.server) void (this.client.servers.get(t.server) as any)?.ack(); } catch { /* best effort */ }
  }
  pin(cid: string, mid: string, on: boolean) { return this.wrap(async () => { const m = await this.raw(cid, mid); await (on ? m.pin() : m.unpin()); }, on ? "pin the message" : "unpin the message"); }
  linkFor(cid: string, mid?: string) {
    const ch: any = this.client.channels.get(cid);
    const web = (normalizeBase((this.client as any).options?.baseURL) ?? DEFAULT_API).replace(/\/api$/, "");
    return `${web}${ch?.serverId ? `/server/${ch.serverId}` : ""}/channel/${cid}${mid ? `/${mid}` : ""}`;
  }

  /* ---------- Stoat's synced "notifications" key ---------- */
  private notif: { server: Record<string, NotifyLevel>; channel: Record<string, NotifyLevel>; server_mutes: Record<string, { until?: number }>; channel_mutes: Record<string, { until?: number }> } =
    { server: {}, channel: {}, server_mutes: {}, channel_mutes: {} };
  /** Stoat's synced server order: ordering.serverSidebar (servers and folder ids), folders from "server-folders". */
  private ordering: any = {};
  private folderList: ServerFolder[] = [];
  private applySynced(key: string, v: unknown) {
    if (typeof v !== "string") return;
    let j: any; try { j = JSON.parse(v); } catch { return; }
    if (key === "notifications") this.notif = { server: j.server ?? {}, channel: j.channel ?? {}, server_mutes: j.server_mutes ?? {}, channel_mutes: j.channel_mutes ?? {} };
    if (key === "ordering" && j && typeof j === "object") this.ordering = j;
    if (key === "server-folders" && Array.isArray(j?.folders)) {
      const seen = new Set<string>();
      this.folderList = j.folders.filter((f: any) => typeof f?.id === "string" && Array.isArray(f.servers)).map((f: any): ServerFolder => ({
        id: f.id, name: typeof f.name === "string" ? f.name.slice(0, 64) : "", colour: typeof f.colour === "string" ? f.colour.slice(0, 64) : undefined, collapsed: f.collapsed === true,
        servers: (f.servers as unknown[]).filter((x): x is string => typeof x === "string" && !seen.has(x) && !!seen.add(x)),
      }));
    }
  }
  private async loadNotif() {
    try {
      const r: any = await (this.client.api as any).post("/sync/settings/fetch", { keys: ["notifications", "ordering", "server-folders"] });
      for (const k of ["notifications", "ordering", "server-folders"]) this.applySynced(k, r?.[k]?.[1]);
    } catch { /* keep defaults */ }
  }
  /** Server ids in sidebar order, folders opened up in place. */
  private serverOrder(): string[] {
    const side: string[] = Array.isArray(this.ordering.serverSidebar) ? this.ordering.serverSidebar : Array.isArray(this.ordering.servers) ? this.ordering.servers : [];
    return side.flatMap((id) => this.folderList.find((f) => f.id === id)?.servers ?? [id]);
  }
  folders(): ServerFolder[] { return this.folderList.map((f) => ({ ...f, servers: [...f.servers] })); }
  sidebar(): string[] {
    const side: string[] = Array.isArray(this.ordering.serverSidebar) ? this.ordering.serverSidebar : Array.isArray(this.ordering.servers) ? this.ordering.servers : [];
    return side.filter((x) => typeof x === "string");
  }
  async saveFolders(folders: ServerFolder[], top: string[]) {
    this.folderList = folders.filter((f) => f.servers.length);
    const byId = new Map(this.folderList.map((f) => [f.id, f] as const));
    // Like Stoat: a folder's members trail its id, so clients without folders keep them in place.
    const side = top.flatMap((id) => (byId.has(id) ? [id, ...byId.get(id)!.servers] : id.startsWith("folder-") ? [] : [id]));
    this.ordering = { ...this.ordering, servers: side.filter((id) => !byId.has(id)), serverSidebar: side };
    const now = Date.now();
    await this.wrap(() => (this.client.api as any).post("/sync/settings/set", { "server-folders": JSON.stringify({ folders: this.folderList }), ordering: JSON.stringify(this.ordering), timestamp: now }), "save your folders");
  }
  async mutual(uid: string) {
    try {
      const r: any = await (this.client.users.get(uid) as any)?.fetchMutual();
      return {
        friends: ((r?.users ?? []) as string[]).map((id) => this.person(id)),
        servers: ((r?.servers ?? []) as string[]).map((id) => { const s: any = this.client.servers.get(id); return { id, name: s?.name ?? "Server", iconUrl: s?.iconURL }; }),
      };
    } catch { return { friends: [], servers: [] }; }
  }
  voiceOf(uid: string): VoicePresence | null {
    for (const c of this.client.channels.toList() as any[]) {
      const v = c.voiceParticipants?.get?.(uid);
      if (!v) continue;
      const dm = c.type === "DirectMessage" || c.type === "Group";
      return { channelId: c.id, channelName: dm ? (c.type === "Group" ? c.name : "a call") : c.name, serverId: c.serverId, serverName: c.server?.name, screen: !!v.isScreensharing?.() };
    }
    return null;
  }
  async setServerOrder(ids: string[]) {
    // Keep folders: a server inside a folder is written as its folder, at the first member's place.
    const folderOf = new Map(this.folderList.flatMap((f) => f.servers.map((s) => [s, f.id] as const)));
    const side: string[] = [];
    for (const id of ids) { const e = folderOf.get(id) ?? id; if (!side.includes(e)) side.push(e); }
    this.ordering = { ...this.ordering, servers: ids, serverSidebar: side };
    await this.wrap(() => (this.client.api as any).post("/sync/settings/set", { ordering: JSON.stringify(this.ordering), timestamp: Date.now() }), "save the server order");
  }
  private async saveNotif() {
    await (this.client.api as any).post("/sync/settings/set", { notifications: JSON.stringify(this.notif), timestamp: Date.now() });
  }
  notifyLevel(kind: "server" | "channel", id: string) { return this.notif[kind][id]; }
  async setNotifyLevel(kind: "server" | "channel", id: string, level: NotifyLevel | undefined) {
    if (level) this.notif[kind][id] = level; else delete this.notif[kind][id];
    await this.wrap(() => this.saveNotif(), "save notification settings");
  }
  isMuted(kind: "server" | "channel", id: string) {
    const m = this.notif[kind === "server" ? "server_mutes" : "channel_mutes"][id];
    return !!m && (m.until === undefined || m.until > Date.now());
  }
  async setMuted(kind: "server" | "channel", id: string, until: number | undefined | null) {
    const k = kind === "server" ? "server_mutes" : "channel_mutes";
    if (until === null) delete this.notif[k][id]; else this.notif[k][id] = until === undefined ? {} : { until };
    await this.wrap(() => this.saveNotif(), "save notification settings");
  }

  async updateMe(p: MeUpdate) {
    const body: any = {};
    const remove: string[] = [];
    if (p.displayName !== undefined) { if (p.displayName.trim()) body.display_name = p.displayName.trim(); else remove.push("DisplayName"); }
    if (p.avatar === null) remove.push("Avatar");
    else if (p.avatar) body.avatar = await this.client.uploadFile("avatars", p.avatar);
    if (p.bio !== undefined) { if (p.bio.trim()) body.profile = { ...body.profile, content: p.bio }; else remove.push("ProfileContent"); }
    if (p.pronouns !== undefined) { if (p.pronouns.trim()) body.pronouns = p.pronouns.trim().slice(0, 32); else remove.push("Pronouns"); }
    if (p.banner === null) remove.push("ProfileBackground");
    else if (p.banner) body.profile = { ...body.profile, background: await this.client.uploadFile("backgrounds", p.banner) };
    if (p.status !== undefined || p.presence !== undefined) {
      const cur: any = (this.client.user as any)?.status ?? {};
      const text = p.status !== undefined ? p.status.trim() : cur.text;
      const presence = p.presence ? p.presence[0]!.toUpperCase() + p.presence.slice(1) : cur.presence;
      body.status = { ...(text ? { text } : {}), ...(presence ? { presence } : {}) };
      if (p.status !== undefined && !text) remove.push("StatusText");
    }
    if (remove.length) body.remove = remove;
    await (this.client.api as any).patch("/users/@me", body);
    this.profiles.delete(this.sess.user_id);
  }

  async friends(): Promise<Friends> {
    const out: Friends = { friends: [], incoming: [], outgoing: [], blocked: [] };
    for (const u of this.client.users.toList() as any[]) {
      const k = RELATION[u.relationship];
      if (k) out[k].push(personOf(u));
    }
    for (const k of Object.keys(out) as (keyof Friends)[]) out[k].sort((a, b) => Number(!!b.online) - Number(!!a.online) || a.name.localeCompare(b.name));
    return out;
  }

  async friendAction(target: string, action: "add" | "accept" | "remove" | "block" | "unblock") {
    const api: any = this.client.api;
    if (action === "add" && !this.client.users.get(target)) { await api.post("/users/friend", { username: target.trim() }); return; }
    const u: any = this.client.users.get(target);
    if (!u) throw new Error("Unknown user");
    if (action === "add" || action === "accept") await u.addFriend();
    else if (action === "remove") await u.removeFriend();
    else if (action === "block") await u.blockUser();
    else await u.unblockUser();
  }

  async openDM(userId: string) {
    const u: any = this.client.users.get(userId) ?? (await (this.client.users as any).fetch(userId));
    return (await u.openDM()).id as string;
  }

  async createGroup(userIds: string[], name?: string) {
    const r: any = await (this.client.api as any).post("/channels/create", { name: (name?.trim() || userIds.map((id) => (this.client.users.get(id) as any)?.displayName ?? "").filter(Boolean).concat((this.client.user as any)?.displayName ?? "").join(", ")).slice(0, 32), users: userIds });
    return r._id as string;
  }
  async addToGroup(channelId: string, userId: string) {
    await (this.client.api as any).put(`/channels/${encodeURIComponent(channelId)}/recipients/${encodeURIComponent(userId)}`);
  }
  recipients(channelId: string): Person[] {
    const c: any = this.client.channels.get(channelId);
    const ids: string[] = c?.recipientIds ? [...c.recipientIds] : c?.recipients?.map?.((u: any) => u.id) ?? [];
    return ids.map((id) => this.client.users.get(id)).filter(Boolean).map((u: any) => personOf(u));
  }
  async joinInvite(input: string) {
    const code = inviteCode(input);
    if (!code) throw new Error("That doesn't look like an invite link.");
    const r: any = await (this.client.api as any).post(`/invites/${code}`);
    return (r?.server?._id ?? r?.server?.id ?? "") as string;
  }

  /** When each profile was read, and whether it failed (failures are retried after a minute). */
  private profileAt = new Map<string, { at: number; failed: boolean }>();
  profileOf(userId: string, fresh = false): Promise<ProfileInfo> {
    let p = this.profiles.get(userId);
    const meta = this.profileAt.get(userId);
    const stale = !meta || (meta.failed && Date.now() - meta.at > 60_000) || (fresh && Date.now() - meta.at > 5_000);
    if (!p || stale) {
      this.profileAt.set(userId, { at: Date.now(), failed: false });
      p = profileLimit(() => this.readProfile(userId, fresh)).catch((): ProfileInfo => {
        this.profileAt.set(userId, { at: Date.now(), failed: true });
        return { config: null };
      });
      this.profiles.set(userId, p);
    }
    return p;
  }


  private async readProfile(userId: string, fresh = false): Promise<ProfileInfo> {
    const fromCloud = this.cloud.fetchProfile(userId, fresh).catch(() => null);
    const info = await this.readStoatProfile(userId);
    // A sync server's copy wins over the banner strip: it's newer-capable and carries activity.
    const c = await fromCloud;
    if (c?.profile) info.config = c.profile;
    if (c) info.activity = c.activity;
    if (c && (Object.keys(c.servers ?? {}).length || Object.keys(c.images ?? {}).length)) {
      const servers: NonNullable<ProfileInfo["servers"]> = {};
      for (const [sid, l] of Object.entries(c.servers ?? {})) servers[sid] = { config: l.config, bio: l.bio };
      for (const [sid, at] of Object.entries(c.images ?? {})) servers[sid] = { ...servers[sid], bannerAt: at };
      info.servers = servers;
      this.bannerSource.set(userId, c.source ?? "");
    }
    return info;
  }

  private async readStoatProfile(userId: string): Promise<ProfileInfo> {
    const user = this.client.users.get(userId);
    if (!user) return { config: null };
    const profile = await user.fetchProfile();
    const bannerUrl = profile.bannerURL;
    const info: ProfileInfo = { config: null, bannerUrl, bio: profile.content ?? undefined };
    if (!bannerUrl) return info;
    try {
      // Only the bottom quarter is decoded, after a size check: the strip is data (≤ 24 bytes, CRC-checked)
      // and is never run, and a giant picture can't exhaust memory.
      const px = await decodeBottom(await fetchBytes(bannerUrl));
      const payload = decodeMarkerScaled(px.data, px.width, px.height);
      const cfg = payload ? unpackProfile(payload) : null;
      info.config = cfg ? sanitizeProfile(cfg) : null;
    } catch { /* unreadable banner just means "no Mustela profile" */ }
    return info;
  }

  /**
   * Re-uploads the banner at canonical size with the marker embedded.
   * Uses `banner` if given, else the current banner, else a gradient from the profile colors.
   */
  /** Everyone allowed to see a private profile: friends, plus members of the chosen servers. */
  private async audienceList(privacy: ExtSettings["privacy"]): Promise<string[]> {
    const ids = new Set<string>();
    for (const u of this.client.users.toList() as any[]) if (u.relationship === "Friend") ids.add(u.id);
    if (privacy.mode === "friends+servers") {
      for (const sid of privacy.servers) {
        const s: any = this.client.servers.get(sid);
        if (!s) continue;
        try { const { members } = await s.fetchMembers(); for (const m of members as any[]) { const id = m.id?.user ?? m.userId; if (id) ids.add(id); if (ids.size >= 5000) break; } } catch { /* skip that server */ }
      }
    }
    ids.delete(this.sess.user_id);
    return [...ids].slice(0, 5000);
  }

  screenQualities(): VoicePrefs["screenQuality"][] {
    // Same rule as Stoat's client: 720p 30 for everyone, 1080p 30 when the account's video limit allows it.
    const lim = ((this.client as any).limits?.video_resolution ?? [0, 0]) as [number, number];
    const hd = (lim[0] === 0 || lim[0] >= 1920) && (lim[1] === 0 || lim[1] >= 1080);
    return hd ? ["720p30", "1080p30"] : ["720p30"];
  }

  /** Which sync server each person's server banners live on (the one their profile came from). */
  private bannerSource = new Map<string, string>();
  serverBanner(userId: string, serverId: string, at: number) {
    const src = this.bannerSource.get(userId) ?? (userId === this.sess.user_id ? this.cloud.list.find((s) => this.cloud.linked(s)) : undefined);
    return src ? this.cloud.serverBanner(src, userId, serverId, at) : Promise.resolve(null);
  }

  async saveServerLook(serverId: string, look: { config?: ProfileConfig; bio?: string }, banner: Blob | null | undefined, all: { main: ProfileConfig; looks: ServerLooks; privacy: ExtSettings["privacy"] }) {
    const at = banner === undefined ? undefined : await this.cloud.setServerBanner(serverId, banner);
    const looks: ServerLooks = { ...all.looks, [serverId]: { ...look, ...(at === undefined ? (all.looks[serverId]?.banner ? { banner: all.looks[serverId]!.banner } : {}) : at ? { banner: at } : {}) } };
    const l = looks[serverId]!;
    if (!l.config && l.bio === undefined && !l.banner) delete looks[serverId]; // nothing left: the main profile again
    const priv = all.privacy.mode !== "everyone" ? all.privacy : null;
    const r = priv
      ? await this.audienceList(priv).then((allow) => this.cloud.publishProfile(all.main, { mode: priv.mode as "friends" | "friends+servers", allow }, looks))
      : await this.cloud.publishProfile(all.main, undefined, looks);
    if (!r.tried) throw new Error("Server looks are kept on your sync server: link one in Mustela sync first.");
    if (r.failed === r.tried) throw new Error("None of your sync servers took the change.");
    this.profiles.delete(this.sess.user_id);
    return at;
  }

  async publishProfile(cfg: ProfileConfig, banner?: Blob, opts: { banner?: boolean; privacy?: ExtSettings["privacy"]; servers?: ServerLooks } = {}) {
    const priv = opts.privacy && opts.privacy.mode !== "everyone" ? opts.privacy : null;
    const cloud = priv
      ? this.audienceList(priv).then((allow) => this.cloud.publishProfile(cfg, { mode: priv.mode as "friends" | "friends+servers", allow }, opts.servers))
      : this.cloud.publishProfile(cfg, undefined, opts.servers);
    if (priv) {
      // Private: nothing goes in the public banner. If it already carries a strip, put the picture back without one.
      const r = await cloud;
      await this.clearBannerStrip(banner);
      if (r.tried && r.failed === r.tried) throw new Error("None of your sync servers could keep your profile private. Update them, or choose Everyone.");
      this.profiles.delete(this.sess.user_id);
      return;
    }
    if (opts.banner === false) {
      const r = await cloud;
      if (!r.tried) throw new Error("Link a sync server first, or turn the banner copy back on.");
      if (r.failed === r.tried) throw new Error("None of your sync servers accepted the profile.");
      this.profiles.delete(this.sess.user_id);
      return;
    }
    // Published taller than shown (960×480): the picture fills the top 960×448 and the profile strip
    // the bottom rows. Stoat centres banners in a wide box and Mustela shows the picture's middle 3:1
    // band, so both see only picture (Stoat a bit more of it) and never the strip.
    // 0.1.0 still reads it (it decodes by width, from the bottom rows).
    const W = CANONICAL_WIDTH, H = BANNER_HEIGHT;
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    let src: Blob | undefined = banner;
    if (!src) {
      const mine = await this.profileOf(this.sess.user_id).catch(() => null);
      if (mine?.bannerUrl) { try { src = new Blob([(await fetchBytes(mine.bannerUrl)) as BlobPart]); } catch { /* fall through to gradient */ } }
    }
    if (src) {
      // A banner Mustela published before carries an old strip: use only its picture part.
      const bytes = new Uint8Array(await src.arrayBuffer());
      const dims = imageSize(bytes);
      if (dims && dims.width * dims.height > MAX_PIXELS) throw new Error("That picture is too big. Pick one under 4096 × 4096.");
      const px = await decodeBottom(bytes).catch(() => null);
      const marked = !!px && decodeMarkerScaled(px.data, px.width, px.height) !== null;
      const bmp = await createImageBitmap(src);
      const tall = bmp.height / bmp.width > 0.4;
      // Everything above an old strip: the whole picture of a tall banner, or a 0.1.0 banner's band.
      const sh = !marked ? bmp.height : bmp.height * ((tall ? H : CANONICAL_HEIGHT) - markerHeight(W)) / (tall ? H : CANONICAL_HEIGHT);
      const cover = (dw: number, dh: number) => {
        const s = Math.max(dw / bmp.width, dh / sh);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, dw, dh); ctx.clip();
        ctx.drawImage(bmp, 0, 0, bmp.width, sh, (dw - bmp.width * s) / 2, (dh - sh * s) / 2, bmp.width * s, sh * s);
        ctx.restore();
      };
      cover(W, H - markerHeight(W));
    } else {
      const a = cfg.theme?.primary ?? hslToRgb(215, 55, 45), b = cfg.theme?.accent ?? hslToRgb(275, 45, 40);
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, hex(a)); g.addColorStop(1, hex(b));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const img = ctx.getImageData(0, 0, W, H);
    encodeMarker(img.data, W, H, packProfile(cfg));
    ctx.putImageData(img, 0, 0);
    const png = await cv.convertToBlob({ type: "image/png" }); // lossless: we add no loss of our own
    const id = await this.client.uploadFile("backgrounds", new File([png], "banner.png", { type: "image/png" }));
    await (this.client.api as any).patch("/users/@me", { profile: { background: id } });
    this.profiles.delete(this.sess.user_id);
  }

  /** Re-uploads my banner without a profile strip (or the new picture as it is), if it had one. */
  private async clearBannerStrip(next?: Blob) {
    if (next) { const id = await this.upload("backgrounds", new File([next], "banner.png", { type: next.type || "image/png" })); await (this.client.api as any).patch("/users/@me", { profile: { background: id } }); return; }
    const mine = await this.readStoatProfile(this.sess.user_id).catch(() => null);
    if (!mine?.bannerUrl || !mine.config) return; // no strip to remove
    const bytes = await fetchBytes(mine.bannerUrl);
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
    const tall = bmp.height / bmp.width > 0.4;
    const band = tall ? bmp.width / 3 : bmp.height * ((CANONICAL_HEIGHT - markerHeight(CANONICAL_WIDTH)) / CANONICAL_HEIGHT);
    const cv = new OffscreenCanvas(bmp.width, Math.round(band));
    cv.getContext("2d")!.drawImage(bmp, 0, 0);
    const png = await cv.convertToBlob({ type: "image/png" });
    const id = await this.upload("backgrounds", new File([png], "banner.png", { type: "image/png" }));
    await (this.client.api as any).patch("/users/@me", { profile: { background: id } });
  }

  private get syncApi(): SyncApi { return this.client.api as unknown as SyncApi; }
  pullExt() { return pullExt(this.syncApi); }
  pushExt(s: ExtSettings) { return pushExt(this.syncApi, s); }
  pullSettings() { return pullSettings(this.syncApi); }
  pushSettings(s: MustelaSettings) { return pushSettings(this.syncApi, s); }

  /**
   * Stoat runs several voice servers ("nodes") and join_call needs one named.
   * Like the official client, ping each node and use whichever answers first.
   */
  private async pickVoiceNode(): Promise<string | undefined> {
    const nodes: { name: string; public_url: string }[] = (this.client.configuration as any)?.features?.livekit?.nodes ?? [];
    if (!nodes.length) return undefined;
    if (nodes.length === 1) return nodes[0]!.name;
    const ping = (n: { name: string; public_url: string }) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      return fetch(n.public_url.replace(/^ws/, "http"), { mode: "no-cors", signal: ctl.signal }).then(() => n.name).finally(() => clearTimeout(t));
    };
    try { return await Promise.any(nodes.map(ping)); } catch { return nodes[0]!.name; }
  }

  async joinVoice(channelId: string, engine: VoiceEngine = "web", prefs?: VoicePrefs): Promise<VoiceHandle> {
    const ch = this.client.channels.get(channelId);
    if (!ch) throw new Error("Unknown channel");
    if ((this.client.configuration as any)?.features?.livekit?.enabled === false) throw new Error("Voice is turned off on this server.");
    let auth: { url: string; token: string };
    try { auth = await ch.joinCall(await this.pickVoiceNode(), true); }
    catch (e) { throw new Error(apiErrorText(e, "The server didn't let you join this call.")); }
    const { url, token } = auth;
    if (engine === "native") {
      const { connectNative } = await import("../voice/native");
      return connectNative(url, token, channelId, (ch as any).name ?? "Voice", this.me, (id) => this.person(id));
    }
    const { connectVoice } = await import("../voice/room"); // LiveKit is large; load on first call
    try { return await connectVoice(url, token, this.me, (id) => this.person(id), prefs ?? DEFAULT_VOICE_PREFS); }
    catch (e) { throw new Error(`Couldn't connect to the voice server${e instanceof Error && e.message ? `: ${e.message}` : "."}`); }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.client.options.autoReconnect = false;
    try { this.client.events.disconnect(); } catch { /* already closed */ }
  }
}
