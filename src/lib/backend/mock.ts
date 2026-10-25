import { Cloud } from "../cloud";
import type { AccountApi, BotRow, SessionRow, Attachment, BanRow, InviteRow, NotifyLevel, Role, ServerInfo, CustomEmoji, GifCategory, GifResult, InviteInfo, ChatBackend, ChatEvent, ChannelInfo, Friends, MeUpdate, MemberGroup, Msg, Person, ProfileInfo, SendOptions, Space, StoredSession, VoiceHandle, ServerFolder } from "./types";
import { sanitizeProfile } from "../profile/model";
import { parseRemote, type MustelaSettings } from "../sync/settings";

/** Offline demo so the whole app can be explored without an account. */

const PERSONAS: Person[] = [
  { id: "me", name: "You", username: "you", online: true, status: "Trying out Mustela", badges: ["Early Adopter"] },
  { id: "me2", name: "Moonbeam", username: "moonbeam", online: true, status: "second account", badges: [] },
];

const people: Person[] = [
  { id: "u1", name: "Mika", username: "mika", online: true, status: "pressing flowers", badges: ["Supporter"] },
  { id: "u2", name: "Otto", username: "otto", online: true, status: "compiling…", badges: ["Developer"] },
  { id: "u3", name: "Sol", username: "sol", online: false, badges: [] },
  { id: "u4", name: "Wren", username: "wren", online: true, status: "writing a song", badges: ["Translator", "Founder"] },
  { id: "u5", name: "Juniper", username: "juniper", online: true, badges: [] },
  { id: "u6", name: "Ash", username: "ash", online: false, badges: [] },
  { id: "u7", name: "Ferret Bot", username: "ferretbot", online: true, bot: true, status: "type !help", badges: [] },
];

const banners: Record<string, string> = {};
const bios: Record<string, string> = {
  u1: "Pressing flowers between pages. Mod of Glass Garden.\nAsk me about tea.",
  u2: "Rust, rain, and 4am deploys.",
  u3: "gone fishing",
  u4: "Cozy creature thing. Writing songs about the moon.",
};

const profiles: Record<string, unknown> = {
  u1: {
    decor: { preset: 9, hue: 335, speed: 5, intensity: 9 }, effect: { preset: 1, hue: 335, speed: 6, intensity: 9 },
    frame: { preset: 4, hue: 30, speed: 0, intensity: 9 }, plate: { preset: 2, hue: 335, speed: 0, intensity: 9 },
    theme: { primary: 0x6a2a4c, accent: 0xd0749e }, name: { font: 2, effect: 2, c1: 0xff9cc2, c2: 0xffe0ec },
  },
  u2: {
    decor: { preset: 7, hue: 170, speed: 5, intensity: 10 }, effect: { preset: 5, hue: 220, speed: 4, intensity: 9 },
    frame: { preset: 1, hue: 190, speed: 6, intensity: 10 }, plate: { preset: 4, hue: 190, speed: 5, intensity: 9 },
    theme: { primary: 0x0d2c44, accent: 0x2a8f9d }, name: { font: 3, effect: 5, c1: 0x7df9ff, c2: 0 },
  },
  u3: {
    decor: { preset: 2, hue: 205, speed: 4, intensity: 8 }, effect: { preset: 2, hue: 205, speed: 5, intensity: 8 },
    frame: { preset: 3, hue: 40, speed: 0, intensity: 9 }, plate: { preset: 0 },
    theme: { primary: 0x2c3a50, accent: 0x7a8fb0 }, name: { font: 1, effect: 1, c1: 0xcfd8e8, c2: 0 },
  },
  u4: {
    decor: { preset: 10, hue: 205, speed: 7, intensity: 9 }, effect: { preset: 4, hue: 75, speed: 5, intensity: 9 },
    frame: { preset: 6, hue: 340, speed: 0, intensity: 10 }, plate: { preset: 1, hue: 150, speed: 0, intensity: 9 },
    theme: { primary: 0x23402a, accent: 0x9bb04a }, name: { font: 5, effect: 3, c1: 0xd7ff9a, c2: 0 },
  },
  u5: { decor: { preset: 4, hue: 45, speed: 8, intensity: 9 }, plate: { preset: 5, hue: 45, speed: 6, intensity: 9 } },
};


const ROLE: Record<string, { title: string; colour: string }> = {
  u1: { title: "Gardeners", colour: "#e58fb5" },
  u4: { title: "Gardeners", colour: "#e58fb5" },
  u2: { title: "Builders", colour: "linear-gradient(90deg, #5ad1e6, #7d8cff)" },
};

/** A small landscape drawn as SVG, so the demo has real images without shipping any. */
const scene = (h1: number, h2: number, w = 640, h = 400) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 640 400">` +
  `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h1} 70% 62%)"/><stop offset="1" stop-color="hsl(${h2} 65% 80%)"/></linearGradient></defs>` +
  `<rect width="640" height="400" fill="url(#s)"/><circle cx="470" cy="120" r="46" fill="hsl(${h2} 90% 92%)"/>` +
  `<path d="M0 300 L120 210 L230 290 L350 180 L470 280 L640 200 V400 H0Z" fill="hsl(${h1} 35% 32%)"/>` +
  `<path d="M0 340 L160 280 L300 350 L460 300 L640 330 V400 H0Z" fill="hsl(${h1} 30% 22%)"/></svg>`);

const IMG: Attachment = { id: "a1", name: "meadow.png", url: scene(200, 40), previewUrl: scene(200, 40), type: "image", width: 640, height: 400, size: 48211 };
const IMG2: Attachment = { id: "a2", name: "dusk.png", url: scene(280, 330), previewUrl: scene(280, 330), type: "image", width: 640, height: 400, size: 51022 };
const FILE: Attachment = { id: "a3", name: "profile-presets.json", url: "data:application/json,%7B%7D", type: "file", size: 2380 };

let serverOrder: string[] = [];
let folderList: ServerFolder[] = [];
let sidebarOrder: string[] = [];
const extraServers: Space[] = [];
const ordered = (list: Space[]) => list.map((s, i) => ({ s, i, r: s.home ? -1 : serverOrder.indexOf(s.id) < 0 ? 1e9 : serverOrder.indexOf(s.id) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.s);
const spacesFor = (): Space[] => [
  { id: "home", name: "Home", home: true, channels: [
    { id: "saved", name: "Saved Notes", kind: "text" },
    { id: "d1", name: "Mika", kind: "dm", unread: true, mentions: 1, peer: people[0] },
    { id: "d2", name: "Otto", kind: "dm", peer: people[1] },
    { id: "d3", name: "Weekend plans", kind: "group" },
  ] },
  { id: "s1", name: "Glass Garden", bannerUrl: scene(160, 50, 960, 320), description: "A cozy server about pressed flowers and pretty profiles.", channels: [
    { id: "c1", name: "general", kind: "text", category: "Text channels", unread: true, mentions: 1, description: "Say hi! Be kind." },
    { id: "c2", name: "show-and-tell", kind: "text", category: "Text channels", description: "Share your profile setups" },
    { id: "c2b", name: "music", kind: "text", category: "Text channels", muted: true },
    { id: "c3", name: "Lounge", kind: "voice", category: "Voice", voice: [{ ...P("u1"), muted: false }, { ...P("u2"), muted: true, screen: true }] },
    { id: "c3b", name: "Study hall", kind: "voice", category: "Voice" },
  ] },
  { id: "s2", name: "Night Owls", channels: [
    { id: "c4", name: "chat", kind: "text", unread: true },
    { id: "c5", name: "Late Talk", kind: "voice" },
  ] },
  { id: "s3", name: "Rust Den", channels: [{ id: "c6", name: "help", kind: "text" }, { id: "c7", name: "crates", kind: "text" }] },
];

const t = (m: number) => new Date(Date.now() - m * 60_000);
const P = (id: string): Person => { const p = people.find((x) => x.id === id)!; return ROLE[id] ? { ...p, colour: ROLE[id]!.colour } : p; };
let n = 0;
const seed = (ch: string, a: string, text: string, m: number, me: Person, extra: Partial<Msg> = {}): Msg =>
  ({ id: `m${++n}`, channelId: ch, author: a === "me" ? me : P(a), text, at: t(m), ...extra });

export class DemoBackend implements ChatBackend {
  readonly me: Person;
  private listeners = new Set<(e: ChatEvent) => void>();
  private store: Record<string, Msg[]>;
  private rel: Record<string, keyof Friends> = { u1: "friends", u2: "friends", u4: "friends", u5: "incoming", u3: "outgoing" };
  private typingTimer?: ReturnType<typeof setTimeout>;

  /** A pretend account: sessions and bots work in memory; password-protected changes explain they're demo-only. */
  readonly cloud = new Cloud("demo", () => null, () => this.me.id);
  readonly account: AccountApi = (() => {
    const no = async (): Promise<never> => { throw new Error("That needs a real Stoat account. Sign in to change it."); };
    const check = async (p: { password?: string } | object) => { if ("password" in p && p.password !== "demo") throw new Error("In the demo, the password is “demo”."); };
    let mfa = { authenticator: false, recovery: false };
    let sessions: SessionRow[] = [
      { id: "s1", name: "Mustela on this device", current: true, createdAt: new Date(Date.now() - 3_600_000) },
      { id: "s2", name: "Firefox on Linux", current: false, createdAt: new Date(Date.now() - 86_400_000 * 3) },
      { id: "s3", name: "Stoat for Android", current: false, createdAt: new Date(Date.now() - 86_400_000 * 20) },
    ];
    let bots: BotRow[] = [{ id: "b1", name: "ferret", public: false, token: "demo-token-not-real-0123456789", createdAt: new Date(Date.now() - 86_400_000 * 40) }];
    const codes = () => Array.from({ length: 10 }, () => Math.random().toString(36).slice(2, 7) + "-" + Math.random().toString(36).slice(2, 7));
    return {
      email: async () => "you@example.com",
      changeUsername: no, changeEmail: no, changePassword: no, disableAccount: no, deleteAccount: no,
      mfa: async () => ({ ...mfa }),
      recoveryCodes: async (p) => { await check(p); mfa.recovery = true; return codes(); },
      authenticatorSecret: async (p) => { await check(p); return "JBSWY3DPEHPK3PXP"; },
      enableAuthenticator: async (code) => { if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) throw new Error("Enter the 6-digit code from your app."); mfa.authenticator = true; },
      disableAuthenticator: async (p) => { await check(p); mfa.authenticator = false; },
      sessions: async () => sessions.map((x) => ({ ...x })),
      renameSession: async (id, name) => { sessions = sessions.map((x) => (x.id === id ? { ...x, name } : x)); },
      logoutSession: async (id, p) => { await check(p); sessions = sessions.filter((x) => x.id !== id); },
      logoutOtherSessions: async (p) => { await check(p); sessions = sessions.filter((x) => x.current); },
      bots: async () => bots.map((x) => ({ ...x })),
      createBot: async (name) => { const b: BotRow = { id: `b${Date.now()}`, name, public: false, token: Math.random().toString(36).slice(2).repeat(3), createdAt: new Date() }; bots = [...bots, b]; return b; },
      editBot: async (id, p) => { bots = bots.map((x) => (x.id !== id ? x : { ...x, name: p.name ?? x.name, public: p.public ?? x.public, interactionsUrl: p.interactionsUrl === null ? undefined : p.interactionsUrl ?? x.interactionsUrl, token: p.resetToken ? Math.random().toString(36).slice(2).repeat(3) : x.token })); },
      deleteBot: async (id) => { bots = bots.filter((x) => x.id !== id); },
    };
  })();

  constructor(private persona = 0) {
    this.me = PERSONAS[persona % PERSONAS.length]!;
    const me = this.me;
    n = 0;
    const welcome = seed("c1", "u1", "Welcome to **Mustela**! Click my avatar to see the full profile card. 🌸", 64, me, { reactions: [{ emoji: "🌸", users: ["u2", "u4", "me"] }, { emoji: "👋", users: ["u5"] }] });
    this.store = {
      c1: [
        seed("c1", "u7", "", 70, me, { system: "Juniper joined" }),
        welcome,
        seed("c1", "u1", "The petals are a *profile effect*. Frames and nameplates are separate slots, and everything is drawn on your device.", 63, me),
        seed("c1", "u2", "Everything has a performance rating, so a profile can't turn your phone into a slideshow. Code for the curious:\n```ts\nconst rating = rateProfile(profile).total.label; // \"Good\"\n```", 41, me, { reactions: [{ emoji: "🔥", users: ["u1", "u4"] }] }),
        seed("c1", "u4", "Settings sync across your devices through your Stoat account. Here's the meadow from this morning:", 22, me, { attachments: [IMG] }),
        seed("c1", "u4", "> Settings sync across your devices\nincluding your theme, not just your profile ✨", 21, me),
        seed("c1", "me", "Compact mode is nice for the phone. ||the dark theme is better though||", 9, me, { replyIds: ["m5"], editedAt: t(8) }),
        seed("c1", "u7", "Tip: type `:fire:` for 🔥, or hover a message to react. Docs: https://developers.stoat.chat", 6, me),
        seed("c1", "u5", "Try switching accounts from the bottom-left menu, <@me>!", 4, me, { mentionsMe: true }),
        seed("c1", "u4", "https://gifbox.me/view/demo-wave", 3, me, { embeds: [{ kind: "image", gif: true, url: "https://gifbox.me/view/demo-wave", image: { url: scene(200, 320, 320, 200), width: 320, height: 200 } }] }),
        seed("c1", "u1", "Invite your friends: https://stt.gg/garden", 2, me),
      ],
      c2: [
        seed("c2", "u2", "Post your best profile setups here. # of the day:", 90, me, { attachments: [IMG2, FILE] }),
        seed("c2", "u1", "Mine is **Sakura** nameplate + **Petal Fall** + **Ornate Corners** frame.", 80, me, { reactions: [{ emoji: "😍", users: ["u2"] }] }),
      ],
      c4: [seed("c4", "u3", "gm", 300, me), seed("c4", "u6", "it's 3am but sure, gm", 290, me)],
      d1: [seed("d1", "u1", "hey! did you see the new frames?", 12, me), seed("d1", "me", "Not yet, checking now.", 10, me), seed("d1", "u1", "the **Neon Edge** one is so good with dark mode", 2, me, { mentionsMe: true })],
      d2: [seed("d2", "u2", "build is green ✅", 200, me)],
      saved: [seed("saved", "me", "Notes to self:\n- try the Classic look\n- publish profile", 500, me)],
    };
    // Older history so scrolling back has something to load.
    const old: Msg[] = [];
    for (let i = 0; i < 40; i++) old.push(seed("c1", ["u1", "u2", "u4", "u5"][i % 4]!, ["earlier chatter", "older message", "scroll-back works", "history page"][i % 4] + ` #${40 - i}`, 2000 - i * 20, me));
    this.store.c1 = [...old, ...this.store.c1!];
  }

  private emit(e: ChatEvent) { this.listeners.forEach((l) => l(e)); }
  private find(ch: string, id: string) { return (this.store[ch] ?? []).find((m) => m.id === id); }

  session(): StoredSession | null { return null; }
  private read = new Set<string>();
  async spaces() { return ordered([...spacesFor(), ...extraServers]).map((s) => ({ ...s, channels: s.channels.map((c) => ({ ...(this.read.has(c.id) ? { ...c, unread: false, mentions: undefined } : c), muted: c.muted || this.isMuted("channel", c.id) || this.isMuted("server", s.id) })) })); }
  async members(spaceId: string): Promise<MemberGroup[]> {
    if (spaceId === "home") return [];
    const all = [this.me, ...people.map((p) => P(p.id))];
    const groups = new Map<string, Person[]>();
    for (const p of all.filter((x) => x.online)) {
      const title = ROLE[p.id]?.title ?? (p.bot ? "Bots" : "Online");
      groups.set(title, [...(groups.get(title) ?? []), p]);
    }
    return [...groups].map(([title, ps]) => ({ title, people: ps }))
      .sort((a, b) => Number(a.title === "Online") - Number(b.title === "Online"))
      .concat([{ title: "Offline", people: all.filter((x) => !x.online) }]);
  }
  async messages(id: string, before?: string) {
    const all = this.store[id] ?? [];
    const end = before ? all.findIndex((m) => m.id === before) : all.length;
    return all.slice(Math.max(0, end - 30), end < 0 ? 0 : end);
  }
  async messagesAfter(id: string, after: string) {
    const all = this.store[id] ?? [];
    const i = all.findIndex((m) => m.id === after);
    return i < 0 ? [] : all.slice(i + 1, i + 31);
  }
  async messagesAround(id: string, mid: string) {
    const all = this.store[id] ?? [];
    const i = all.findIndex((m) => m.id === mid);
    return i < 0 ? [] : all.slice(Math.max(0, i - 15), i + 15);
  }
  async message(ch: string, id: string) { return this.find(ch, id) ?? null; }
  async send(channelId: string, o: SendOptions) {
    const atts: Attachment[] = (o.files ?? []).map((f, i) => ({
      id: `up${Date.now()}${i}`, name: f.name, url: URL.createObjectURL(f), previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
      type: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file", size: f.size,
    }));
    const m: Msg = { id: crypto.randomUUID(), channelId, author: this.me, text: o.text, at: new Date(), attachments: atts, replyIds: o.replies?.map((r) => r.id) };
    (this.store[channelId] ??= []).push(m);
    this.emit({ t: "message", m });
    if (channelId === "d1" || channelId === "c1") this.fakeReply(channelId);
  }
  /** A friendly reply after a moment, with a typing indicator first. */
  private fakeReply(ch: string) {
    clearTimeout(this.typingTimer);
    const who = P(ch === "d1" ? "u1" : "u2");
    this.typingTimer = setTimeout(() => {
      this.emit({ t: "typing", channelId: ch, people: [who] });
      this.typingTimer = setTimeout(() => {
        this.emit({ t: "typing", channelId: ch, people: [] });
        const m: Msg = { id: crypto.randomUUID(), channelId: ch, author: who, text: ["nice 😄", "ooh, agreed", "**love** that"][Math.floor(Math.random() * 3)]!, at: new Date() };
        (this.store[ch] ??= []).push(m);
        this.emit({ t: "message", m });
      }, 1800);
    }, 700);
  }
  async edit(ch: string, id: string, text: string) { const m = this.find(ch, id); if (m) { m.text = text; m.editedAt = new Date(); this.emit({ t: "update", m: { ...m } }); } }
  async remove(ch: string, id: string) { this.store[ch] = (this.store[ch] ?? []).filter((m) => m.id !== id); this.emit({ t: "delete", channelId: ch, id }); }
  async react(ch: string, id: string, emoji: string, on: boolean) {
    const m = this.find(ch, id); if (!m) return;
    const rs = (m.reactions ??= []);
    let r = rs.find((x) => x.emoji === emoji);
    if (on && !r) rs.push((r = { emoji, users: [] }));
    if (r) r.users = on ? [...new Set([...r.users, this.me.id])] : r.users.filter((u) => u !== this.me.id);
    m.reactions = rs.filter((x) => x.users.length);
    this.emit({ t: "update", m: { ...m } });
  }
  typing() {}
  ack(channelId: string) { if (!this.read.has(channelId)) { this.read.add(channelId); this.emit({ t: "activity" }); } }
  onEvent(cb: (e: ChatEvent) => void) { this.listeners.add(cb); return () => void this.listeners.delete(cb); }
  async updateMe(p: MeUpdate) {
    const me = this.me as Person;
    if (p.displayName !== undefined) me.name = p.displayName.trim() || me.username || "You";
    if (p.avatar === null) delete me.avatarUrl; else if (p.avatar) me.avatarUrl = URL.createObjectURL(p.avatar);
    if (p.status !== undefined) me.status = p.status.trim() || undefined;
    if (p.presence) { me.presence = p.presence; me.online = p.presence !== "invisible"; }
    if (p.bio !== undefined) bios[me.id] = p.bio;
    if (p.banner === null) delete banners[me.id]; else if (p.banner) banners[me.id] = URL.createObjectURL(p.banner);
    this.emit({ t: "activity" });
  }

  async gifs(q: string): Promise<GifResult[]> {
    const hues = [20, 60, 110, 170, 220, 280, 320, 350];
    return hues.map((h, i) => ({ url: `https://gifbox.me/view/demo-${q || "trending"}-${i}`, preview: scene(h, (h + 140) % 360, 320, 200), w: 320, h: 200 }));
  }
  async gifCategories(): Promise<GifCategory[]> {
    return ["happy", "wave", "cat", "dance", "thumbs up", "facepalm"].map((title, i) => ({ title, image: scene(i * 55, i * 55 + 120, 320, 200) }));
  }
  async publicBot(id: string) { return { id, name: "Ferret Bot", description: "Reminders, polls and dice." }; }
  async addBot() { await new Promise((r) => setTimeout(r, 300)); }
  async invite(code: string): Promise<InviteInfo | null> {
    return code === "garden" ? { code, serverId: "s1", serverName: "Glass Garden", memberCount: 8, channelName: "general", inviter: "Mika", joined: true, bannerUrl: scene(160, 50, 960, 320) } : null;
  }
  emojis(): CustomEmoji[] {
    const dot = (h: number) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="hsl(${h} 70% 55%)"/><circle cx="11" cy="13" r="2.5" fill="#fff"/><circle cx="21" cy="13" r="2.5" fill="#fff"/><path d="M10 20q6 6 12 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`);
    return [["01HZDEMOEMOJIAAAAAAAAAAAAA", "garden_smile", 140], ["01HZDEMOEMOJIBBBBBBBBBBBBB", "petal_happy", 330], ["01HZDEMOEMOJICCCCCCCCCCCCC", "sky_grin", 205]]
      .map(([id, name, h]) => ({ id: id as string, name: name as string, url: dot(h as number), serverId: "s1", serverName: "Glass Garden" }));
  }
  emojiUrl(id: string) { return this.emojis().find((e) => e.id === id)?.url ?? ""; }

  /* ---- servers & moderation: a small in-memory model so every screen can be tried ---- */
  private roleList: Role[] = [{ id: "r1", name: "Gardeners", colour: "#e58fb5", hoist: true, rank: 1 }, { id: "r2", name: "Builders", colour: "linear-gradient(90deg, #5ad1e6, #7d8cff)", hoist: true, rank: 2 }];
  private banList: BanRow[] = [{ person: { id: "u9", name: "Spammy McSpamface", username: "spam" }, reason: "Posting links in every channel" }];
  private inviteList: InviteRow[] = [{ code: "garden", channelName: "general", creator: undefined }];
  private notifs: Record<string, NotifyLevel> = {};
  private mutes: Record<string, number | undefined> = {};
  serverInfo(id: string): ServerInfo | null {
    const s = spacesFor().find((x) => x.id === id && !x.home);
    return s ? { id, name: s.name, description: s.description, bannerUrl: s.bannerUrl, ownerId: "me", isOwner: id === "s1",
      perms: { manageServer: true, manageRoles: true, manageChannels: true, manageEmoji: true, kick: true, ban: true, invite: true, manageMessages: true } } : null;
  }
  async editServer() {}
  roles() { return [...this.roleList]; }
  async createRole(_s: string, name: string) { this.roleList.push({ id: crypto.randomUUID(), name, hoist: false, rank: this.roleList.length + 1 }); }
  async editRole(_s: string, rid: string, p: { name?: string; colour?: string | null; hoist?: boolean }) {
    this.roleList = this.roleList.map((r) => (r.id === rid ? { ...r, ...(p.name !== undefined ? { name: p.name } : {}), ...(p.hoist !== undefined ? { hoist: p.hoist } : {}), ...(p.colour !== undefined ? { colour: p.colour ?? undefined } : {}) } : r));
  }
  async deleteRole(_s: string, rid: string) { this.roleList = this.roleList.filter((r) => r.id !== rid); }
  serverEmojis(sid: string) { return this.emojis().filter((e) => e.serverId === sid); }
  async uploadEmoji() { throw new Error("Uploading emoji needs a real Stoat account."); }
  async deleteEmoji() { throw new Error("Deleting emoji needs a real Stoat account."); }
  async invites() { return [...this.inviteList.map((i) => ({ ...i, creator: P("u1") }))]; }
  async createInvite() { const code = Math.random().toString(36).slice(2, 10); this.inviteList.push({ code, channelName: "general" }); return code; }
  async deleteInvite(code: string) { this.inviteList = this.inviteList.filter((i) => i.code !== code); }
  async bans() { return [...this.banList]; }
  async unban(_s: string, uid: string) { this.banList = this.banList.filter((b) => b.person.id !== uid); }
  async kick() { throw new Error("Kicking needs a real Stoat account."); }
  async ban() { throw new Error("Banning needs a real Stoat account."); }
  async createChannel(): Promise<string> { throw new Error("Creating channels needs a real Stoat account."); }
  async editChannel() {}
  async deleteChannel() { throw new Error("Deleting channels needs a real Stoat account."); }
  private nick: Record<string, string> = {};
  private memberRoleMap: Record<string, string[]> = { u1: ["r1"], u2: ["r2"] };
  async identity(sid: string) { return { nickname: this.nick[sid] }; }
  async editIdentity(sid: string, p: { nickname?: string | null }) { if (p.nickname) this.nick[sid] = p.nickname; else if (p.nickname !== undefined) delete this.nick[sid]; }
  async memberRoles(_s: string, uid: string) { return [...(this.memberRoleMap[uid] ?? [])]; }
  async setMemberRoles(_s: string, uid: string, roles: string[]) { this.memberRoleMap[uid] = roles; }
  async leaveServer() { throw new Error("You can't leave the demo servers."); }
  async closeDM() { throw new Error("Demo conversations stay open."); }
  async createServer(name: string) { const id = `s${Date.now()}`; extraServers.push({ id, name, channels: [{ id: `${id}-general`, name: "general", kind: "text" }] }); this.store[`${id}-general`] = []; this.emit({ t: "activity" }); return id; }
  async search(cid: string, q: string) { const t = q.toLowerCase(); return (this.store[cid] ?? []).filter((m) => !m.system && m.text.toLowerCase().includes(t)).slice().reverse().slice(0, 50); }
  async pinned(cid: string) { return (this.store[cid] ?? []).filter((m) => m.pinned).slice().reverse(); }
  async mutual(uid: string) { return uid === this.me.id ? { friends: [], servers: [] } : { friends: ["u1", "u2", "u4"].filter((x) => x !== uid).map((x) => this.person(x)), servers: [{ id: "s1", name: "Glass Garden" }] }; }
  voiceOf(uid: string) { return uid === "u1" || uid === "u2" ? { channelId: "c3", channelName: "Lounge", serverId: "s1", serverName: "Glass Garden", screen: uid === "u2" } : null; }
  async setServerOrder(ids: string[]) { serverOrder = ids; this.emit({ t: "activity" }); }
  folders(): ServerFolder[] { return folderList.map((f) => ({ ...f, servers: [...f.servers] })); }
  sidebar(): string[] { return [...sidebarOrder]; }
  async saveFolders(folders: ServerFolder[], top: string[]) {
    folderList = folders.filter((f) => f.servers.length);
    const byId = new Map(folderList.map((f) => [f.id, f] as const));
    sidebarOrder = top.flatMap((id) => (byId.has(id) ? [id, ...byId.get(id)!.servers] : [id]));
    serverOrder = sidebarOrder.filter((id) => !byId.has(id));
    this.emit({ t: "activity" });
  }
  markRead(t: { channel?: string; server?: string }) { if (t.channel) this.ack(t.channel); if (t.server) spacesFor().find((s) => s.id === t.server)?.channels.forEach((c) => this.read.add(c.id)); this.emit({ t: "activity" }); }
  notifyLevel(kind: string, id: string) { return this.notifs[`${kind}:${id}`]; }
  async setNotifyLevel(kind: string, id: string, l: NotifyLevel | undefined) { if (l) this.notifs[`${kind}:${id}`] = l; else delete this.notifs[`${kind}:${id}`]; this.emit({ t: "activity" }); }
  isMuted(kind: string, id: string) { const k = `${kind}:${id}`; return k in this.mutes && (this.mutes[k] === undefined || this.mutes[k]! > Date.now()); }
  async setMuted(kind: string, id: string, until: number | undefined | null) { const k = `${kind}:${id}`; if (until === null) delete this.mutes[k]; else this.mutes[k] = until; this.emit({ t: "activity" }); }
  async pin(ch: string, id: string, on: boolean) { const m = this.find(ch, id); if (m) { m.pinned = on; this.emit({ t: "update", m: { ...m } }); } }
  linkFor(cid: string, mid?: string) { return `https://stoat.chat/channel/${cid}${mid ? `/${mid}` : ""}`; }

  async friends(): Promise<Friends> {
    const f: Friends = { friends: [], incoming: [], outgoing: [], blocked: [] };
    for (const [id, k] of Object.entries(this.rel)) f[k].push(P(id));
    return f;
  }
  async friendAction(target: string, action: "add" | "accept" | "remove" | "block" | "unblock") {
    const id = people.find((p) => p.id === target || p.username === target.split("#")[0])?.id;
    if (!id) throw new Error("No one with that username in the demo. Try “sol”.");
    if (action === "remove" || action === "unblock") delete this.rel[id];
    else if (action === "block") this.rel[id] = "blocked";
    else this.rel[id] = action === "accept" ? "friends" : this.rel[id] === "incoming" ? "friends" : "outgoing";
    this.emit({ t: "activity" });
  }
  async openDM(userId: string) { return userId === "u2" ? "d2" : "d1"; }
  async createGroup(): Promise<string> { throw new Error("Groups need a real Stoat account."); }
  async addToGroup(): Promise<void> { throw new Error("Groups need a real Stoat account."); }
  recipients(channelId: string): Person[] { return (channelId === "d2" ? ["u2"] : channelId === "d1" ? ["u1"] : channelId === "d3" ? ["u1", "u2", "u3"] : []).map((id) => this.person(id)); }
  async joinInvite(): Promise<string> { throw new Error("Invites need a real Stoat account."); }
  async profileOf(id: string): Promise<ProfileInfo> {
    const raw = profiles[id];
    return { config: raw ? sanitizeProfile(raw) : null, bio: bios[id], bannerUrl: banners[id], activity: id === "u2" ? { kind: "playing", name: "Stardew Valley", details: "Year 2, Summer", state: "Fishing at the beach", startedAt: Date.now() - 47 * 60_000 } : null };
  }
  async publishProfile() { /* nothing to publish to in demo mode */ }
  private get key() { return `mustela:demo-sync:${this.persona}`; }
  async pullSettings() { try { return parseRemote(localStorage.getItem(this.key)); } catch { return null; } }
  async pushSettings(s: MustelaSettings) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch { /* ignore */ } }
  person(id: string): Person {
    if (id === this.me.id) return { ...this.me, relation: "self" };
    if (!people.some((p) => p.id === id)) return { id, name: "Someone" };
    const r = this.rel[id];
    return { ...P(id), relation: r === "friends" ? "friend" : r === "blocked" ? "blocked" : r === "incoming" ? "incoming" : r === "outgoing" ? "outgoing" : "none" };
  }
  channelName(id: string) { return spacesFor().flatMap((s) => s.channels).find((c) => c.id === id)?.name; }

  /** A pretend call: two friends, one sharing a screen (drawn on a canvas), talking in turns. */
  async joinVoice(): Promise<VoiceHandle> {
    const subs = new Set<() => void>();
    const reactSubs = new Set<(from: string, e: string) => void>();
    const ping = () => subs.forEach((f) => f());
    const st = { mic: true, cam: false, screen: false, deaf: false };
    const audio: Record<string, { volume: number; muted: boolean }> = {};
    let watching = false, talk = 0, gone = false;
    const timer = setInterval(() => { talk = (talk + 1) % 6; ping(); }, 1200);
    // a moving "screen" so the stream tile has real video
    const cv = document.createElement("canvas"); cv.width = 640; cv.height = 360;
    const g = cv.getContext("2d")!;
    let f = 0;
    const draw = setInterval(() => {
      f++; const grd = g.createLinearGradient(0, 0, 640, 360); grd.addColorStop(0, "#1f3b57"); grd.addColorStop(1, "#4b2a5c");
      g.fillStyle = grd; g.fillRect(0, 0, 640, 360);
      g.fillStyle = "#ffd36e"; g.beginPath(); g.arc(320 + Math.sin(f / 12) * 180, 180 + Math.cos(f / 15) * 90, 40, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.font = "bold 28px sans-serif"; g.fillText("Otto's screen", 24, 44);
    }, 50);
    const stream = (cv as HTMLCanvasElement & { captureStream?(fps: number): MediaStream }).captureStream?.(20);
    const people = () => [
      { ...this.me, muted: !st.mic, deaf: st.deaf, camera: st.cam, screen: st.screen },
      { ...P("u1"), muted: false }, { ...P("u2"), muted: true, screen: true },
    ];
    return {
      auth: { url: "wss://demo", token: "demo" },
      setMic: async (on) => { st.mic = on; ping(); }, setCamera: async (on) => { st.cam = on; ping(); }, setScreen: async (on) => { st.screen = on; ping(); },
      setDeaf: async (on) => { st.deaf = on; if (on) st.mic = false; ping(); },
      state: () => ({ ...st }),
      leave: async () => { gone = true; clearInterval(timer); clearInterval(draw); },
      participants: people,
      speaking: () => (gone ? [] : talk < 2 ? ["u1"] : talk < 4 && st.mic ? [this.me.id] : []),
      video: (id, source) => (id === "u2" && source !== "camera" && watching ? stream?.getVideoTracks()[0] ?? null : null),
      streams: () => [{ id: "u2", watching, hasAudio: true }],
      watch: (_id, on) => { watching = on; ping(); },
      userAudio: (id) => audio[id] ?? { volume: 1, muted: false },
      setUserAudio: (id, _k, p) => { audio[id] = { ...(audio[id] ?? { volume: 1, muted: false }), ...p }; ping(); },
      react: (e) => reactSubs.forEach((cb) => cb(this.me.id, e)),
      onReaction: (cb) => (reactSubs.add(cb), () => void reactSubs.delete(cb)),
      onEnd: () => () => {},
      onChange: (cb) => (subs.add(cb), () => void subs.delete(cb)),
    };
  }
  dispose() { clearTimeout(this.typingTimer); }
}
