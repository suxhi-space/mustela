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
  /** Favorite channels from any server, listed on Home, in order */
  favourites: string[];
  /** Your own categories for favorites, in order */
  favGroups: FavGroup[];
  /** Which category each favorite is in (missing: the plain Favorites list) */
  favIn: Record<string, string>;
  /** Show Favorites as its own button under Home on the server list, like a server */
  favRail: boolean;
  /** Favorite emoji, in order: unicode characters, or custom emoji ids */
  favEmoji: string[];
  /** The soundboard sound played when you join a call ("" for none); follows you to every device */
  entrySound?: string;
  /** Your look per server (decorations, colours, about me, banner), over your main profile */
  serverLooks: ServerLooks;
  /** ms since epoch of the last local change; last write wins */
  updatedAt: number;
}

export interface FavGroup { id: string; name: string; color: string }

export const DEFAULT_EXT: ExtSettings = { v: 1, privacy: { mode: "everyone", servers: [] }, channelPins: [], favourites: [], favGroups: [], favIn: {}, favRail: false, favEmoji: [], serverLooks: {}, updatedAt: 0 };

const HEX = /^#[0-9a-f]{6}$/i;
function favGroupsOf(v: unknown): FavGroup[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return (v as any[]).flatMap((g) => {
    if (!g || typeof g.id !== "string" || !g.id || g.id.length > 40 || seen.has(g.id)) return [];
    seen.add(g.id);
    const name = typeof g.name === "string" && g.name.trim() ? g.name.trim().slice(0, 40) : "Category";
    return [{ id: g.id, name, color: g.color === "none" ? "none" : typeof g.color === "string" && HEX.test(g.color) ? g.color.toLowerCase() : "#f0b232" }];
  }).slice(0, 30);
}

/** A list of ids: strings only, no repeats, capped. */
const ids = (v: unknown, max = 200) => (Array.isArray(v) ? [...new Set((v as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, max) : []);

export function sanitizeExt(raw: unknown): ExtSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const p = r.privacy ?? {};
  const mode: Audience = p.mode === "friends" || p.mode === "friends+servers" ? p.mode : "everyone";
  const servers = Array.isArray(p.servers) ? (p.servers as unknown[]).filter((x): x is string => typeof x === "string" && x.length <= 40).slice(0, 50) : [];
  const favourites = ids(r.favourites, 100), favGroups = favGroupsOf(r.favGroups);
  const groupIds = new Set(favGroups.map((g) => g.id));
  const favIn: Record<string, string> = {};
  if (r.favIn && typeof r.favIn === "object") for (const [k, g] of Object.entries(r.favIn as Record<string, unknown>)) if (favourites.includes(k) && typeof g === "string" && groupIds.has(g)) favIn[k] = g;
  return { v: 1, privacy: { mode, servers }, channelPins: ids(r.channelPins), favourites, favGroups, favIn, favRail: r.favRail === true, entrySound: typeof r.entrySound === "string" && r.entrySound.length <= 64 ? r.entrySound : undefined, favEmoji: Array.isArray(r.favEmoji) ? [...new Set((r.favEmoji as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, 100) : [], serverLooks: sanitizeServerLooks(r.serverLooks), updatedAt: typeof r.updatedAt === "number" && r.updatedAt >= 0 ? r.updatedAt : 0 };
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
