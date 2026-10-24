import type { Attachment, ChatBackend, ChatEvent, ChannelInfo, Friends, MeUpdate, MemberGroup, Msg, Person, ProfileInfo, SendOptions, Space, StoredSession, VoiceHandle } from "./types";
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
    { id: "c3", name: "Lounge", kind: "voice", category: "Voice" },
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
  async spaces() { return spacesFor().map((s) => ({ ...s, channels: s.channels.map((c) => (this.read.has(c.id) ? { ...c, unread: false, mentions: undefined } : c)) })); }
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
  emojiUrl() { return ""; }
  async updateMe(p: MeUpdate) {
    const me = this.me as Person;
    if (p.displayName !== undefined) me.name = p.displayName.trim() || me.username || "You";
    if (p.avatar === null) delete me.avatarUrl; else if (p.avatar) me.avatarUrl = URL.createObjectURL(p.avatar);
    if (p.status !== undefined) me.status = p.status.trim() || undefined;
    if (p.presence) { me.presence = p.presence; me.online = p.presence !== "invisible"; }
    if (p.bio !== undefined) bios[me.id] = p.bio;
    this.emit({ t: "activity" });
  }

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
  async joinInvite(): Promise<string> { throw new Error("Invites need a real Stoat account."); }
  async profileOf(id: string): Promise<ProfileInfo> {
    const raw = profiles[id];
    return { config: raw ? sanitizeProfile(raw) : null, bio: bios[id] };
  }
  async publishProfile() { /* nothing to publish to in demo mode */ }
  private get key() { return `mustela:demo-sync:${this.persona}`; }
  async pullSettings() { try { return parseRemote(localStorage.getItem(this.key)); } catch { return null; } }
  async pushSettings(s: MustelaSettings) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch { /* ignore */ } }
  person(id: string): Person { return id === this.me.id ? this.me : people.some((p) => p.id === id) ? P(id) : { id, name: "Someone" }; }
  channelName(id: string) { return spacesFor().flatMap((s) => s.channels).find((c) => c.id === id)?.name; }

  async joinVoice(): Promise<VoiceHandle> {
    const subs = new Set<() => void>();
    return {
      setMic: async () => {}, setCamera: async () => {}, setScreen: async () => {},
      leave: async () => {}, participants: () => [this.me, P("u1"), P("u2")], speaking: () => ["u1"], video: () => null, onEnd: () => () => {},
      onChange: (cb) => (subs.add(cb), () => void subs.delete(cb)),
    };
  }
  dispose() { clearTimeout(this.typingTimer); }
}
