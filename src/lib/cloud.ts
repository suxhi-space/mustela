import type { ProfileConfig } from "./profile/model";
import { sanitizeProfile } from "./profile/model";

/**
 * Mustela sync servers ("cloud"): optional, self-hostable servers that hold the
 * parts of your profile Stoat itself has no place for (decorations, effects,
 * frames, theme) and your live activity ("Playing …").
 *
 * Reading is public: anyone's client asks your servers for your profile.
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
}

export interface CloudProfile { profile: ProfileConfig | null; activity: Activity | null; updatedAt: number }
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

  publishProfile(profile: ProfileConfig) {
    this.cache.delete(this.userId());
    return this.eachLinked((s, k) => call(`${s}/${PROTOCOL}/profile`, { method: "PUT", headers: { authorization: `Bearer ${k}` }, body: JSON.stringify({ profile }) }));
  }

  /** null clears it. Servers forget activity that isn't refreshed for a few minutes. */
  setActivity(activity: Activity | null) {
    return this.eachLinked((s, k) => call(`${s}/${PROTOCOL}/activity`, { method: "PUT", headers: { authorization: `Bearer ${k}` }, body: JSON.stringify({ activity }) }));
  }

  /** The newest copy of someone's profile across your servers, or null. Cached for a minute. */
  fetchProfile(userId: string): Promise<CloudProfile | null> {
    if (!this.servers.length) return Promise.resolve(null);
    let p = this.cache.get(userId);
    if (!p) {
      p = Promise.allSettled(this.servers.map((s) => call<{ profile?: unknown; activity?: Activity | null; updatedAt?: number }>(`${s}/${PROTOCOL}/profile/${encodeURIComponent(userId)}`)))
        .then((rs) => {
          let best: CloudProfile | null = null;
          for (const r of rs) {
            if (r.status !== "fulfilled") continue;
            const v = r.value;
            const at = typeof v.updatedAt === "number" ? v.updatedAt : 0;
            if (best && at <= best.updatedAt) continue;
            best = { profile: v.profile ? sanitizeProfile(v.profile) : null, activity: sanitizeActivity(v.activity), updatedAt: at };
          }
          return best;
        });
      this.cache.set(userId, p);
      setTimeout(() => this.cache.get(userId) === p && this.cache.delete(userId), 60_000);
    }
    return p;
  }
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
  };
}
