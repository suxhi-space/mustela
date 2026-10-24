import type { Rating } from "../decor/spec";
import { RATING_ORDER } from "../decor/spec";
import { parseHex } from "../color";
import { DEFAULT_PROFILE, sanitizeProfile, type ProfileConfig } from "../profile/model";
import { THEMES, DEFAULT_THEME } from "../theme/palette";

/** Synced through the user's own Stoat account. Follows you to every device. */
export interface MustelaSettings {
  v: 2;
  look: {
    /** A THEMES id, or "custom" to use `seed`. */
    theme: string;
    /** "#rrggbb", used when theme === "custom" */
    seed: string;
    mode: "auto" | "light" | "dark";
    amoled: boolean;
  };
  /** What I publish and what I see on myself. */
  profile: ProfileConfig;
  /** Don't animate other people's profiles rated worse than this. */
  maxRating: Rating;
  /** ms since epoch of last local change; drives last-write-wins. */
  updatedAt: number;
}

export const DEFAULT_SETTINGS: MustelaSettings = {
  v: 2,
  look: { theme: DEFAULT_THEME, seed: "#1a9bb0", mode: "auto", amoled: false },
  profile: DEFAULT_PROFILE,
  maxRating: "heavy",
  updatedAt: 0,
};

const int = (x: unknown, lo: number, hi: number, d: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d;

/**
 * Anything coming from outside (server, disk) goes through here. Never trust
 * the shape: a corrupted or hostile value must not be able to break the UI.
 */
export function sanitize(raw: unknown): MustelaSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== "object") return structuredClone(d);
  const r = raw as Record<string, any>;
  const l = (r.look ?? {}) as Record<string, unknown>;
  const themeOk = l.theme === "custom" || THEMES.some((t) => t.id === l.theme);
  const seed = typeof l.seed === "string" && parseHex(l.seed) !== null ? l.seed.toLowerCase().replace(/^([0-9a-f]{6})$/, "#$1") : d.look.seed;
  return {
    v: 2,
    look: {
      theme: themeOk ? (l.theme as string) : d.look.theme,
      seed,
      mode: l.mode === "light" || l.mode === "dark" || l.mode === "auto" ? l.mode : d.look.mode,
      amoled: l.amoled === true,
    },
    profile: sanitizeProfile(r.profile),
    maxRating: RATING_ORDER.includes(r.maxRating) ? r.maxRating : d.maxRating,
    updatedAt: int(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export function parseRemote(value: string | undefined | null): MustelaSettings | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value);
    // Only accept our own current format. Older shapes fall back to defaults rather than being guessed at.
    if (!raw || typeof raw !== "object" || raw.v !== 2) return null;
    return sanitize(raw);
  } catch {
    return null;
  }
}

/** Last write wins. Ties keep local so we don't churn the server. */
export function resolve(local: MustelaSettings, remote: MustelaSettings | null): { winner: MustelaSettings; push: boolean } {
  if (!remote) return { winner: local, push: local.updatedAt > 0 };
  if (remote.updatedAt > local.updatedAt) return { winner: remote, push: false };
  return { winner: local, push: local.updatedAt > remote.updatedAt };
}

export const SYNC_KEY = "mustela:settings";

/** Minimal surface of the Stoat API we need; the real client satisfies it structurally. */
export interface SyncApi {
  post(path: "/sync/settings/fetch", body: { keys: string[] }): Promise<Record<string, [number, string]>>;
  post(path: "/sync/settings/set", body: Record<string, any>): Promise<unknown>;
}

export async function pullSettings(api: SyncApi): Promise<MustelaSettings | null> {
  const res = await api.post("/sync/settings/fetch", { keys: [SYNC_KEY] });
  return parseRemote(res?.[SYNC_KEY]?.[1]);
}

export async function pushSettings(api: SyncApi, s: MustelaSettings): Promise<void> {
  await api.post("/sync/settings/set", { [SYNC_KEY]: JSON.stringify(s), timestamp: s.updatedAt });
}
