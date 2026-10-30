import { sanitizeProfile, type ProfileConfig } from "./model";

/**
 * Your look in one server, over your main profile: decorations and colours, an about-me, and whether a
 * banner of its own is on your sync servers. Anything left out falls back to the main profile.
 * Synced with your settings and published with your profile (older clients ignore it).
 */
export interface ServerLook { config?: ProfileConfig; bio?: string; banner?: number }
export type ServerLooks = Record<string, ServerLook>;

// Stoat ids (and the demo's short ones); the sync server checks real ids itself.
const ID_RE = /^[0-9A-Za-z_-]{1,32}$/;
export const MAX_SERVER_LOOKS = 50;

export function sanitizeServerLooks(raw: unknown): ServerLooks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ServerLooks = {};
  for (const [sid, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_SERVER_LOOKS) break;
    if (!ID_RE.test(sid) || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const look: ServerLook = {};
    if (r.config && typeof r.config === "object") look.config = sanitizeProfile(r.config);
    if (typeof r.bio === "string") look.bio = r.bio.slice(0, 2000);
    if (typeof r.banner === "number" && Number.isFinite(r.banner) && r.banner > 0) look.banner = r.banner;
    if (look.config || look.bio !== undefined || look.banner) out[sid] = look;
  }
  return out;
}
