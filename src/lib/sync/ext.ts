import type { SyncApi } from "./settings";
import { sanitizeServerLooks, type ServerLooks } from "../profile/servers";

/**
 * Settings that Mustela 0.1.0 doesn't know about live under their own Stoat sync key.
 * 0.1.0 rewrites "mustela:settings" with only the fields it knows (last write wins), so
 * anything new kept there would be wiped whenever someone also uses 0.1.0. Here it's safe.
 */
export const EXT_KEY = "mustela:settings-ext";

export type Audience = "everyone" | "friends" | "friends+servers";
export interface ExtSettings {
  v: 1;
  /** Who can see my Mustela profile (decorations, effects, theme) */
  privacy: { mode: Audience; servers: string[] };
  /** Server channels pinned to the top of their server's channel list, in order */
  channelPins: string[];
  /** Favourite channels from any server, listed on Home, in order */
  favourites: string[];
  /** Your look per server (decorations, colours, about me, banner), over your main profile */
  serverLooks: ServerLooks;
  /** ms since epoch of the last local change; last write wins */
  updatedAt: number;
}

export const DEFAULT_EXT: ExtSettings = { v: 1, privacy: { mode: "everyone", servers: [] }, channelPins: [], favourites: [], serverLooks: {}, updatedAt: 0 };

/** A list of ids: strings only, no repeats, capped. */
const ids = (v: unknown, max = 200) => (Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, max) : []);

export function sanitizeExt(raw: unknown): ExtSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const p = r.privacy ?? {};
  const mode: Audience = p.mode === "friends" || p.mode === "friends+servers" ? p.mode : "everyone";
  const servers = Array.isArray(p.servers) ? (p.servers as unknown[]).filter((x): x is string => typeof x === "string" && x.length <= 40).slice(0, 50) : [];
  return { v: 1, privacy: { mode, servers }, channelPins: ids(r.channelPins), favourites: ids(r.favourites, 100), serverLooks: sanitizeServerLooks(r.serverLooks), updatedAt: typeof r.updatedAt === "number" && r.updatedAt >= 0 ? r.updatedAt : 0 };
}

export function parseExt(value: string | undefined | null): ExtSettings | null {
  if (!value) return null;
  try { const raw = JSON.parse(value); return raw?.v === 1 ? sanitizeExt(raw) : null; } catch { return null; }
}

export async function pullExt(api: SyncApi): Promise<ExtSettings | null> {
  const res = await api.post("/sync/settings/fetch", { keys: [EXT_KEY] });
  return parseExt(res?.[EXT_KEY]?.[1]);
}

export async function pushExt(api: SyncApi, s: ExtSettings): Promise<void> {
  await api.post("/sync/settings/set", { [EXT_KEY]: JSON.stringify(s), timestamp: s.updatedAt });
}
