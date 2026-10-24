import { Client } from "stoat.js";
import type {
  Attachment, ChannelInfo, ChatBackend, ChatEvent, Embed, Friends, MemberGroup, Msg, Person, ProfileInfo, Reaction,
  MeUpdate, SendOptions, Space, StoredSession, VoiceEngine, VoiceHandle,
} from "./types";
import { sanitizeProfile, type ProfileConfig } from "../profile/model";
import { packProfile, unpackProfile } from "../profile/pack";
import { CANONICAL_HEIGHT, CANONICAL_WIDTH, decodeMarkerScaled, encodeMarker, markerHeight } from "../marker/codec";
import { pullSettings, pushSettings, type MustelaSettings, type SyncApi } from "../sync/settings";
import { fetchBytes } from "../net";
import { decodeImage } from "../imageData";
import { createLimiter } from "../limit";
import { DEFAULT_API } from "./login";
import { normalizeBase } from "../session/book";
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

export function embedOf(e: any): Embed | null {
  switch (e?.type) {
    case "Website":
      return {
        kind: "website", url: e.url ?? e.originalUrl, title: e.title, description: e.description, siteName: e.siteName,
        iconUrl: e.proxiedIconURL ?? e.iconUrl, colour: e.colour,
        image: e.image ? { url: e.image.proxiedURL ?? e.image.url, width: e.image.width, height: e.image.height } : undefined,
        video: e.video ? { url: e.video.proxiedURL ?? e.video.url, width: e.video.width, height: e.video.height } : undefined,
      };
    case "Image": return { kind: "image", url: e.url, image: { url: e.proxiedURL ?? e.url, width: e.width, height: e.height } };
    case "Video": return { kind: "video", url: e.url, video: { url: e.proxiedURL ?? e.url, width: e.width, height: e.height } };
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

const READY_TIMEOUT_MS = 20_000;
const profileLimit = createLimiter(3);

export class StoatBackend implements ChatBackend {
  private profiles = new Map<string, Promise<ProfileInfo>>();
  private disposed = false;

  private constructor(private client: SClient, private sess: StoredSession) {}

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
    const client = new Client({ baseURL: base, autoReconnect: true }, config);
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
    return new StoatBackend(client, session);
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
      unread: !!c.unread && !c.muted,
      mentions: c.mentions?.size || undefined,
      muted: !!c.muted,
      iconUrl: c.iconURL,
      peer: dm ? personOf(c.recipient) : undefined,
    };
  }

  async spaces(): Promise<Space[]> {
    const list = this.client.channels.toList() as any[];
    const saved = list.find((c) => c.type === "SavedMessages");
    const dms = list
      .filter((c) => (c.type === "DirectMessage" || c.type === "Group") && c.active !== false)
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
      .map((c) => this.channelInfo(c));
    const servers: Space[] = (this.client.servers.toList() as any[]).map((s) => ({
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
    const attachments: string[] = [];
    for (const f of opts.files ?? []) attachments.push(await this.client.uploadFile("attachments", f));
    await ch.sendMessage({
      content: opts.text || undefined,
      attachments: attachments.length ? attachments : undefined,
      replies: opts.replies?.length ? opts.replies : undefined,
    } as any);
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
    for (const [e, f] of h) c.on(e, f);
    return () => { clearTimeout(timer); for (const [e, f] of h) c.off(e, f); };
  }

  async updateMe(p: MeUpdate) {
    const body: any = {};
    const remove: string[] = [];
    if (p.displayName !== undefined) { if (p.displayName.trim()) body.display_name = p.displayName.trim(); else remove.push("DisplayName"); }
    if (p.avatar === null) remove.push("Avatar");
    else if (p.avatar) body.avatar = await this.client.uploadFile("avatars", p.avatar);
    if (p.bio !== undefined) { if (p.bio.trim()) body.profile = { content: p.bio }; else remove.push("ProfileContent"); }
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
  async publishProfile(cfg: ProfileConfig, banner?: Blob) {
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

  async joinVoice(channelId: string, engine: VoiceEngine = "web"): Promise<VoiceHandle> {
    const ch = this.client.channels.get(channelId);
    if (!ch) throw new Error("Unknown channel");
    const { url, token } = await ch.joinCall();
    if (engine === "native") {
      const { connectNative } = await import("../voice/native");
      return connectNative(url, token, channelId, (ch as any).name ?? "Voice", this.me, (id) => this.person(id));
    }
    const { connectVoice } = await import("../voice/room"); // LiveKit is large; load on first call
    return connectVoice(url, token, this.me, (id) => this.person(id));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.client.options.autoReconnect = false;
    try { this.client.events.disconnect(); } catch { /* already closed */ }
  }
}
