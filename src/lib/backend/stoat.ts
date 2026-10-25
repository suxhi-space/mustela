import { Client } from "stoat.js";
import type { VoicePresence, AccountApi, BotRow, MfaProof,
  Attachment, ChannelInfo, ChatBackend, ChatEvent, Embed, Friends, MemberGroup, Msg, Person, ProfileInfo, Reaction,
  BanRow, CustomEmoji, ServerFolder, GifCategory, InviteRow, NotifyLevel, Role, ServerInfo, GifResult, InviteInfo, MeUpdate, SendOptions, Space, StoredSession, VoiceEngine, VoiceHandle, VoicePrefs,
} from "./types";
import { sanitizeProfile, type ProfileConfig } from "../profile/model";
import { packProfile, unpackProfile } from "../profile/pack";
import { CANONICAL_HEIGHT, CANONICAL_WIDTH, decodeMarkerScaled, encodeMarker, markerHeight } from "../marker/codec";
import { pullSettings, pushSettings, type MustelaSettings, type SyncApi } from "../sync/settings";
import { fetchBytes } from "../net";
import { decodeImage } from "../imageData";
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



const READY_TIMEOUT_MS = 20_000;
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
    try {
      const r = await fetch(base + "/");
      if (!r.ok) throw new Error();
      config = await r.json();
    } catch {
      throw new Error("Couldn't reach the server. Check your connection.");
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
      const onError = () => done(new Error("The server rejected this session. Sign in again."));
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
  emojiUrl(id: string) { return `${(this.client.configuration as any)?.features?.autumn?.url ?? ""}/emojis/${id}`; }

  private channelInfo(c: any, category?: string): ChannelInfo {
    const dm = c.type === "DirectMessage";
    return {
      id: c.id,
      name: dm ? c.recipient?.displayName ?? "Unknown" : c.type === "SavedMessages" ? "Saved Notes" : c.name,
      kind: dm ? "dm" : c.type === "Group" ? "group" : c.isVoice ? "voice" : "text",
      description: c.description,
      category,
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
        cat.channels.filter(Boolean).map((c: any) => this.channelInfo(c, cat.id === "default" ? undefined : cat.title))),
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
    for (const f of files) {
      attachments.push(await this.upload("attachments", f, (sent) => opts.onProgress?.((done + sent) / total)));
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
      body.append("file", file);
      xhr.send(body);
    });
  }

  async edit(channelId: string, id: string, text: string) { await (await this.raw(channelId, id))?.edit({ content: text }); }
  async remove(channelId: string, id: string) { await (await this.raw(channelId, id))?.delete(); }
  async react(channelId: string, id: string, emoji: string, on: boolean) {
    const m = await this.raw(channelId, id);
    if (on) await m?.react(encodeURIComponent(emoji)); else await m?.unreact(encodeURIComponent(emoji));
  }
  typing(channelId: string, on: boolean) {
    const ch: any = this.client.channels.get(channelId);
    try { if (on) ch?.startTyping(); else ch?.stopTyping(); } catch { /* socket not ready */ }
  }
  ack(channelId: string) { const ch: any = this.client.channels.get(channelId); if (ch?.unread) void ch.ack().catch?.(() => {}); }

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
    const r: any[] = await this.wrap(() => ch.search({ query, sort: "Relevance", limit: 50 }), "search");
    return r.map((m) => this.toMsg(m));
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
  editChannel(cid: string, p: { name?: string; description?: string }) {
    return this.wrap(async () => {
      const data: any = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.description !== undefined) { if (p.description.trim()) data.description = p.description; else data.remove = ["Description"]; }
      await this.client.channels.get(cid)!.edit(data);
    }, "save the channel");
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

  profileOf(userId: string): Promise<ProfileInfo> {
    let p = this.profiles.get(userId);
    if (!p) {
      p = profileLimit(() => this.readProfile(userId)).catch((): ProfileInfo => ({ config: null }));
      this.profiles.set(userId, p);
    }
    return p;
  }

  private async readProfile(userId: string): Promise<ProfileInfo> {
    const fromCloud = this.cloud.fetchProfile(userId).catch(() => null);
    const info = await this.readStoatProfile(userId);
    // A sync server's copy wins over the banner strip: it's newer-capable and carries activity.
    const c = await fromCloud;
    if (c?.profile) info.config = c.profile;
    if (c) info.activity = c.activity;
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
      const px = await decodeImage(await fetchBytes(bannerUrl));
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
  async publishProfile(cfg: ProfileConfig, banner?: Blob, opts: { banner?: boolean } = {}) {
    const cloud = this.cloud.publishProfile(cfg);
    if (opts.banner === false) {
      const r = await cloud;
      if (!r.tried) throw new Error("Link a sync server first, or turn the banner copy back on.");
      if (r.failed === r.tried) throw new Error("None of your sync servers accepted the profile.");
      this.profiles.delete(this.sess.user_id);
      return;
    }
    const cv = new OffscreenCanvas(CANONICAL_WIDTH, CANONICAL_HEIGHT);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    let src: Blob | undefined = banner;
    if (!src) {
      const mine = await this.profileOf(this.sess.user_id).catch(() => null);
      if (mine?.bannerUrl) { try { src = new Blob([(await fetchBytes(mine.bannerUrl)) as BlobPart]); } catch { /* fall through to gradient */ } }
    }
    if (src) {
      // The marker strip owns the bottom rows, so the picture is fitted into the area above it.
      // If this banner was published by Mustela before, drop its old strip first so it can't pile up.
      const W = CANONICAL_WIDTH, H = CANONICAL_HEIGHT - markerHeight(CANONICAL_WIDTH);
      const px = await decodeImage(new Uint8Array(await src.arrayBuffer())).catch(() => null);
      const marked = !!px && decodeMarkerScaled(px.data, px.width, px.height) !== null;
      const bmp = await createImageBitmap(src);
      const sh = marked ? bmp.height * (H / CANONICAL_HEIGHT) : bmp.height;
      const s = Math.max(W / bmp.width, H / sh); // cover
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      ctx.drawImage(bmp, 0, 0, bmp.width, sh, (W - bmp.width * s) / 2, (H - sh * s) / 2, bmp.width * s, sh * s);
      ctx.restore();
    } else {
      const a = cfg.theme?.primary ?? hslToRgb(215, 55, 45), b = cfg.theme?.accent ?? hslToRgb(275, 45, 40);
      const g = ctx.createLinearGradient(0, 0, CANONICAL_WIDTH, CANONICAL_HEIGHT);
      g.addColorStop(0, hex(a)); g.addColorStop(1, hex(b));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CANONICAL_WIDTH, CANONICAL_HEIGHT);
    }
    const img = ctx.getImageData(0, 0, CANONICAL_WIDTH, CANONICAL_HEIGHT);
    encodeMarker(img.data, CANONICAL_WIDTH, CANONICAL_HEIGHT, packProfile(cfg));
    ctx.putImageData(img, 0, 0);
    const png = await cv.convertToBlob({ type: "image/png" }); // lossless: we add no loss of our own
    const id = await this.client.uploadFile("backgrounds", new File([png], "banner.png", { type: "image/png" }));
    await (this.client.api as any).patch("/users/@me", { profile: { background: id } });
    this.profiles.delete(this.sess.user_id);
  }

  private get syncApi(): SyncApi { return this.client.api as unknown as SyncApi; }
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
