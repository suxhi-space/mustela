import type { ProfileConfig } from "./profile/model";
import { sanitizeProfile } from "./profile/model";
import { sanitizeServerLooks, type ServerLooks } from "./profile/servers";

/**
 * Mustela sync servers ("cloud"): optional, self-hostable servers that hold the
 * parts of your profile Stoat itself has no place for (decorations, effects,
 * frames, theme) and your live activity ("Playing …").
 *
 * Reading is public unless you chose an audience (Settings > Sync & servers): then
 * only signed-in viewers on your list get it, everyone else sees no profile.
 * Writing needs a key the server hands out once it has confirmed who you are.
 * To confirm, the server asks your Stoat instance "who owns this session?" a
 * single time; it doesn't keep the session token. Only link servers you trust,
 * the same as any app you sign in to. The server code is in /server.
 */
export interface Activity {
  kind: "playing" | "listening" | "watching" | "streaming" | "competing";
  name: string;
  details?: string;
  state?: string;
  /** ms since epoch */
  startedAt?: number;
  /** https image, or a Discord asset resolved to https */
  image?: string;
  /** Discord application id, when it came from Rich Presence */
  appId?: string;
  /** ms since epoch: when the song or video ends (Rich Presence progress bar) */
  endsAt?: number;
  /** Hover text for the big picture */
  largeText?: string;
  /** The little badge on the corner of the picture, and its hover text */
  smallImage?: string;
  smallText?: string;
  /** Up to two links the game offers ("Join game", "Listen along"), https only */
  buttons?: { label: string; url: string }[];
}

/**
 * `servers`: their look per server; `images`: servers they have a banner for (with when it changed),
 * stored on `source`, the sync server this copy came from.
 */
export interface CloudProfile { profile: ProfileConfig | null; activity: Activity | null; updatedAt: number; servers?: ServerLooks; images?: Record<string, number>; source?: string }
export interface Health { ok: boolean; name?: string; version?: string; error?: string }

const KEYS = "mustela.cloud.keys";
const PROTOCOL = "v1";
const clean = (u: string) => u.trim().replace(/\/+$/, "");
const TIMEOUT = 6000;

export function validServerUrl(u: string): string | null {
  try {
    const url = new URL(clean(u));
    if (url.protocol !== "https:" && !(url.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) return null;
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch { return null; }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof body?.error === "string" ? body.error : `The server answered ${r.status}.`);
    return body as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("The server didn't answer in time.");
    if (e instanceof TypeError) throw new Error("Couldn't reach the server. Check the address.");
    throw e;
  } finally { clearTimeout(t); }
}

export class Cloud {
  private servers: string[] = [];
  private cache = new Map<string, Promise<CloudProfile | null>>();

  /** `api` is the Stoat API base, `token`/`userId` the signed-in session. */
  constructor(private api: string, private token: () => string | null, private userId: () => string) {}

  setServers(list: string[]) {
    const next = list.map(clean);
    if (next.join() !== this.servers.join()) { this.servers = next; this.cache.clear(); }
  }
  get list() { return this.servers; }

  private keys(): Record<string, string> { try { return JSON.parse(localStorage.getItem(KEYS) ?? "{}") ?? {}; } catch { return {}; } }
  private slot(server: string) { return `${clean(server)}|${this.userId()}`; }
  keyFor(server: string): string | undefined { return this.keys()[this.slot(server)]; }
  private saveKey(server: string, key: string | null) {
    const k = this.keys();
    if (key) k[this.slot(server)] = key; else delete k[this.slot(server)];
    try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch { /* storage full or blocked */ }
  }
  linked = (server: string) => !!this.keyFor(server);

  async health(server: string): Promise<Health> {
    try {
      const h = await call<{ name?: string; version?: string; protocol?: string }>(`${clean(server)}/${PROTOCOL}/health`);
      if (h.protocol && h.protocol !== PROTOCOL) return { ok: false, error: `This server speaks ${h.protocol}; Mustela needs ${PROTOCOL}.` };
      return { ok: true, name: h.name, version: h.version };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }

  /** Proves who you are to the server and keeps the write key it returns. */
  async link(server: string) {
    const token = this.token();
    if (!token) throw new Error("Sign in with a Stoat account to link a sync server.");
    const r = await call<{ key: string; userId: string }>(`${clean(server)}/${PROTOCOL}/link`, { method: "POST", body: JSON.stringify({ api: this.api, token }) });
    if (r.userId !== this.userId()) throw new Error("The server linked a different account.");
    this.saveKey(server, r.key);
  }

  async unlink(server: string) {
    const key = this.keyFor(server);
    this.saveKey(server, null);
    if (key) await call(`${clean(server)}/${PROTOCOL}/link`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } }).catch(() => {});
  }

  private async eachLinked(f: (server: string, key: string) => Promise<unknown>) {
    const jobs = this.servers.map((s) => [s, this.keyFor(s)] as const).filter((x): x is readonly [string, string] => !!x[1]);
    const res = await Promise.allSettled(jobs.map(([s, k]) => f(s, k)));
    return { tried: jobs.length, failed: res.filter((r) => r.status === "rejected").length };
  }

  /** `audience` limits who can read it (servers older than 1.1 ignore it and keep it public, so the
   * caller only sends private profiles to servers new enough; see publishPrivate). */
  publishProfile(profile: ProfileConfig, audience?: { mode: "friends" | "friends+servers"; allow: string[] }, servers?: ServerLooks) {
    this.cache.delete(this.userId());
    return this.eachLinked(async (s, k) => {
      if (audience) {
        // A server that can't keep it private gets nothing rather than a public copy.
        const h = await this.health(s);
        if (!h.ok || !h.version || compareVersions(h.version, "1.1.0") < 0) throw new Error("This server can't keep profiles private.");
      }
      return call(`${s}/${PROTOCOL}/profile`, { method: "PUT", headers: { authorization: `Bearer ${k}` }, body: JSON.stringify({ profile: servers && Object.keys(servers).length ? { ...profile, servers } : profile, ...(audience ? { audience } : {}) }) });
    });
  }

  /** A banner for one server (sync servers 1.2+), or null to remove it. Returns when it changed. */
  async setServerBanner(serverId: string, image: Blob | null): Promise<number> {
    this.cache.delete(this.userId());
    this.images.clear();
    let at = Date.now();
    const r = await this.eachLinked(async (s, k) => {
      const h = await this.health(s);
      if (!h.ok || !h.version || compareVersions(h.version, "1.2.0") < 0) throw new Error("This sync server is older than 1.2.");
      const res = await fetch(`${s}/${PROTOCOL}/image/${encodeURIComponent(serverId)}`, { method: image ? "PUT" : "DELETE", headers: { authorization: `Bearer ${k}`, ...(image ? { "content-type": image.type || "image/jpeg" } : {}) }, body: image ?? undefined });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The sync server answered ${res.status}.`);
      if (image) at = ((await res.json().catch(() => ({}))) as { at?: number }).at ?? at;
    });
    if (!r.tried) throw new Error("Server banners are kept on your sync server: link one in Mustela sync first.");
    if (r.failed === r.tried) throw new Error("None of your sync servers took the banner. They need version 1.2 or newer.");
    return image ? at : 0;
  }

  /** Someone's banner for one server, as a local picture link (private ones need our key, which an <img> can't send). */
  private images = new Map<string, Promise<string | null>>();
  serverBanner(source: string, userId: string, serverId: string, at: number): Promise<string | null> {
    const id = `${source}|${userId}|${serverId}|${at}`;
    let p = this.images.get(id);
    if (!p) {
      const k = this.keyFor(source);
      p = fetch(`${clean(source)}/${PROTOCOL}/image/${encodeURIComponent(userId)}/${encodeURIComponent(serverId)}`, k ? { headers: { authorization: `Bearer ${k}` } } : {})
        .then(async (r) => {
          if (!r.ok) return null;
          const b = await r.blob();
          return /^image\/(png|jpeg|webp|gif)$/.test(b.type) ? URL.createObjectURL(b) : null;
        }).catch(() => null);
      this.images.set(id, p);
      if (this.images.size > 200) { const first = this.images.keys().next().value; if (first) this.images.delete(first); }
    }
    return p;
  }

  /** null clears it. Servers forget activity that isn't refreshed for a few minutes. */
  setActivity(activity: Activity | null) {
    return this.eachLinked((s, k) => call(`${s}/${PROTOCOL}/activity`, { method: "PUT", headers: { authorization: `Bearer ${k}` }, body: JSON.stringify({ activity }) }));
  }

  /** The newest copy of someone's profile across your servers, or null. Cached for a minute. */
  fetchProfile(userId: string, fresh = false): Promise<CloudProfile | null> {
    if (!this.servers.length) return Promise.resolve(null);
    if (fresh) this.cache.delete(userId);
    let p = this.cache.get(userId);
    if (!p) {
      // Signed in where we're linked, so private profiles we're allowed to see come back too.
      const auth = (s: string): RequestInit => { const k = this.keyFor(s); return k ? { headers: { authorization: `Bearer ${k}` } } : {}; };
      p = Promise.allSettled(this.servers.map((s) => call<{ profile?: unknown; activity?: Activity | null; updatedAt?: number; images?: unknown }>(`${s}/${PROTOCOL}/profile/${encodeURIComponent(userId)}`, auth(s)).then((v) => ({ v, s }))))
        .then((rs) => {
          let best: CloudProfile | null = null;
          for (const r of rs) {
            if (r.status !== "fulfilled") continue;
            const { v, s } = r.value;
            const at = typeof v.updatedAt === "number" ? v.updatedAt : 0;
            if (best && at <= best.updatedAt) continue;
            const raw = v.profile && typeof v.profile === "object" ? (v.profile as { servers?: unknown }) : null;
            const images: Record<string, number> = {};
            if (v.images && typeof v.images === "object") for (const [k, t] of Object.entries(v.images as Record<string, unknown>)) if (typeof t === "number" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(k)) images[k] = t;
            best = { profile: v.profile ? sanitizeProfile(v.profile) : null, activity: sanitizeActivity(v.activity), updatedAt: at, servers: sanitizeServerLooks(raw?.servers), images, source: s };
          }
          return best;
        });
      this.cache.set(userId, p);
      setTimeout(() => this.cache.get(userId) === p && this.cache.delete(userId), 60_000);
    }
    return p;
  }
}

const https = (u: string | undefined) => (u && /^https:\/\//.test(u) ? u : undefined);
function cleanButtons(b: unknown): Activity["buttons"] {
  if (!Array.isArray(b)) return undefined;
  const out = b.flatMap((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 32) : "";
    const url = typeof r.url === "string" ? https(r.url.trim().slice(0, 512)) : undefined;
    return label && url ? [{ label, url }] : [];
  }).slice(0, 2);
  return out.length ? out : undefined;
}

export function sanitizeActivity(a: unknown): Activity | null {
  if (!a || typeof a !== "object") return null;
  const r = a as Record<string, unknown>;
  const str = (x: unknown, n: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : undefined);
  const name = str(r.name, 128);
  if (!name) return null;
  const kind = (["playing", "listening", "watching", "streaming", "competing"] as const).find((k) => k === r.kind) ?? "playing";
  const image = str(r.image, 512);
  return {
    kind, name, details: str(r.details, 128), state: str(r.state, 128),
    startedAt: typeof r.startedAt === "number" && Number.isFinite(r.startedAt) ? r.startedAt : undefined,
    image: image && /^https:\/\//.test(image) ? image : undefined,
    appId: str(r.appId, 32),
    endsAt: typeof r.endsAt === "number" && Number.isFinite(r.endsAt) ? r.endsAt : undefined,
    largeText: str(r.largeText, 128),
    smallImage: https(str(r.smallImage, 512)),
    smallText: str(r.smallText, 128),
    buttons: cleanButtons(r.buttons),
  };
}

/** -1, 0 or 1 for dotted version numbers ("1.10.0" > "1.9.2"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1; }
  return 0;
}
