import type { ChannelRules, ChatBackend, Friends, Person, ServerFolder, Space, StoredSession } from "./types";

/**
 * Instant start: what the app shows before the connection is up.
 *
 * After every successful connection a small copy of what's on screen is kept on the device (your profile, the
 * server list and its channels with their unread marks, the sidebar order and folders). Next launch the app
 * appears straight away from that copy, together with the saved recent chats (chatCache.ts), while it connects
 * in the background. The app talks to a stand-in backend that answers from the copy; anything that needs the
 * server (sending, loading a chat, members, settings…) simply waits for the connection and then goes through.
 * Once connected the stand-in passes everything straight to the real backend and tells the app to refresh, so
 * nothing is torn down or redrawn from scratch (no flash).
 */
export interface Snapshot {
  v: 1;
  at: number;
  me: Person;
  spaces: Space[];
  sidebar: string[];
  folders: ServerFolder[];
  /** Friends, requests and blocked people, so the Friends page is full straight away too */
  friends?: Friends;
}

const KEY = (account: string) => `mustela:snapshot:${account}`;

export function loadSnapshot(account: string): Snapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY(account)) ?? "null") as Snapshot | null;
    // Older than a month: start fresh rather than show something long out of date.
    if (!s || s.v !== 1 || !s.me?.id || !Array.isArray(s.spaces) || Date.now() - s.at > 30 * 864e5) return null;
    return s;
  } catch { return null; }
}

export async function saveSnapshot(account: string, b: ChatBackend): Promise<void> {
  try {
    const spaces = await b.spaces();
    // Who's in a call changes all the time and isn't worth showing stale: left out.
    const lean = spaces.map((s) => ({ ...s, channels: s.channels.map(({ voice: _v, ...c }) => c) }));
    const friends = await b.friends().catch(() => undefined);
    const snap: Snapshot = { v: 1, at: Date.now(), me: { ...b.me }, spaces: lean, sidebar: b.sidebar(), folders: b.folders(), friends };
    localStorage.setItem(KEY(account), JSON.stringify(snap));
  } catch { /* storage full or the backend went away: next start just connects first */ }
}

export function clearSnapshot(account: string) {
  try { localStorage.removeItem(KEY(account)); } catch { /* fine */ }
}

/** The backend's methods that answer straight away (everything else returns a promise and can simply wait). */
const SYNC = new Set([
  "session", "typing", "ack", "markUnread", "lastRead", "unreadCount", "mentionIds", "onEvent", "emojiUrl", "recipients", "emojis",
  "serverInfo", "roles", "serverEmojis", "serverOfChannel", "channelDetails", "categories", "serverDetails", "markRead", "voiceOf",
  "folders", "sidebar", "notifyLevel", "isMuted", "linkFor", "screenQualities", "person", "channelName", "channelsIn", "role",
  "channelRules", "dispose", "pause", "resume", "watchInfo",
]);

type Listener = Parameters<ChatBackend["onEvent"]>[0];

/**
 * A backend that answers from `snap` until `real` resolves, then forwards everything to it. `onSwitch` runs once
 * connected (or with the error if the connection failed).
 */
export function snapshotBackend(snap: Snapshot, real: Promise<ChatBackend>, session: StoredSession | null = null): ChatBackend {
  let live: ChatBackend | null = null;
  let disposed = false;
  const listeners = new Map<Listener, () => void>();
  const channels = () => snap.spaces.flatMap((s) => s.channels.map((c) => ({ s, c })));
  const find = (id: string) => channels().find((x) => x.c.id === id);
  const people = new Map<string, Person>();
  for (const s of snap.spaces) for (const c of s.channels) if (c.peer) people.set(c.peer.id, c.peer);
  for (const list of Object.values(snap.friends ?? {})) for (const p of list as Person[]) people.set(p.id, p);
  people.set(snap.me.id, snap.me);
  // Things the app asked for that should still happen once connected (marking read, leaving a chat…).
  const later: ((b: ChatBackend) => void)[] = [];

  real.then((b) => {
    if (disposed) { b.dispose(); return; }
    live = b;
    for (const f of later.splice(0)) { try { f(b); } catch { /* best effort */ } }
    // Listeners move over to the real connection, then everything refreshes from it.
    for (const [cb] of listeners) listeners.set(cb, b.onEvent(cb));
    for (const [cb] of listeners) { try { cb({ t: "reconnected" } as never); cb({ t: "activity" } as never); } catch { /* a listener failing must not stop the others */ } }
  }, () => { /* the caller shows the error */ });

  const rules: ChannelRules = { canSend: true, canUpload: true, canReact: true, canManage: false, slowmode: 0 };
  const answers: Record<string, (...a: any[]) => unknown> = {
    // Signed in: the saved recent chats are used (they are kept for signed-in accounts only).
    session: () => session,
    // The server list (and Home with your DMs) comes from the copy straight away; everything else waits.
    spaces: async () => snap.spaces.map((sp) => ({ ...sp, channels: sp.channels.map((c) => ({ ...c })) })),
    ...(snap.friends ? { friends: async () => structuredClone(snap.friends!) } : {}),
    typing: () => undefined,
    ack: (...a) => { later.push((b) => (b.ack as any)(...a)); },
    markRead: (...a) => { later.push((b) => (b.markRead as any)(...a)); },
    markUnread: (...a) => { later.push((b) => (b.markUnread as any)(...a)); },
    lastRead: () => undefined,
    unreadCount: (id: string) => find(id)?.c.mentions ?? 0,
    mentionIds: () => [],
    onEvent: (cb: Listener) => {
      listeners.set(cb, () => {});
      return () => { listeners.get(cb)?.(); listeners.delete(cb); };
    },
    emojiUrl: () => "",
    recipients: () => [],
    emojis: () => [],
    serverInfo: () => null,
    roles: () => [],
    serverEmojis: () => [],
    serverOfChannel: (id: string) => { const x = find(id); return x && !x.s.home ? x.s.id : undefined; },
    channelDetails: () => null,
    categories: () => [],
    serverDetails: () => null,
    voiceOf: () => null,
    folders: () => snap.folders.map((f) => ({ ...f, servers: [...f.servers] })),
    sidebar: () => [...snap.sidebar],
    notifyLevel: () => undefined,
    isMuted: (kind: string, id: string) => (kind === "channel" ? !!find(id)?.c.muted : false),
    linkFor: () => "",
    screenQualities: () => [],
    person: (id: string) => people.get(id) ?? { id, name: "…" },
    channelName: (id: string) => find(id)?.c.name,
    channelsIn: (id: string) => (snap.spaces.find((s) => s.id === id)?.channels ?? [])
      .filter((c) => c.kind === "text" || c.kind === "voice").map((c) => ({ id: c.id, name: c.name, kind: c.kind as "text" | "voice" })),
    role: () => undefined,
    channelRules: () => rules,
    dispose: () => { disposed = true; live?.dispose(); },
    pause: () => undefined,
    resume: () => undefined,
    watchInfo: () => null,
  };

  // cloud and account: their calls wait for the connection too (a few cloud helpers answer straight away).
  const waiting = (pick: (b: ChatBackend) => any, syncDefaults: Record<string, unknown> = {}) => new Proxy({}, {
    get: (_t, prop: string) => {
      if (live) { const o = pick(live); const v = o[prop]; return typeof v === "function" ? v.bind(o) : v; }
      if (prop in syncDefaults) { const d = syncDefaults[prop]; return typeof d === "function" ? d : () => d; }
      if (prop === "then") return undefined; // not a promise itself
      return (...a: unknown[]) => real.then((b) => { const o = pick(b); return o[prop](...a); });
    },
  });
  const cloud = waiting((b) => b.cloud, {
    keyFor: undefined,
    setServers: (...a: unknown[]) => { later.push((b) => (b.cloud.setServers as any)(...a)); },
    setActivity: (...a: unknown[]) => { later.push((b) => (b.cloud.setActivity as any)(...a)); },
  });
  const account = waiting((b) => b.account);

  return new Proxy({} as ChatBackend, {
    get: (_t, prop: string) => {
      if (live) {
        const v = (live as any)[prop];
        return typeof v === "function" ? v.bind(live) : v;
      }
      if (prop === "me") return snap.me;
      if (prop === "cloud") return cloud;
      if (prop === "account") return account;
      if (prop === "then") return undefined;
      if (prop === "__snapshot") return true;
      if (prop in answers) return answers[prop];
      if (SYNC.has(prop)) return () => undefined;
      // Anything else returns a promise: it waits for the connection, then goes through.
      return (...a: unknown[]) => real.then((b) => (b as any)[prop](...a));
    },
    has: (_t, prop) => (live ? prop in live : prop in answers || prop === "me" || prop === "cloud" || prop === "account"),
  });
}
