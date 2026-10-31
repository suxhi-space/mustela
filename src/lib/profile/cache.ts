import { sanitizeProfile, type ProfileConfig } from "./model";

/**
 * What other people's Stoat banners say (their Mustela look, read from the strip along the bottom), kept on this
 * device. Reading one costs a profile request and a banner download, and Stoat only allows so many requests at a
 * time, so a big server's member list could hold up everything else. Lists and chat use this copy for a day; opening
 * someone's card always reads it fresh (and updates it). About 100 bytes a person.
 */
export interface CachedBanner { at: number; config: ProfileConfig | null; banner?: string; bio?: string }

const KEY = "mustela:banner-profiles:v1";
const MAX = 4000;
export const BANNER_TTL = 24 * 3600_000;

let map: Map<string, CachedBanner> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function all(): Map<string, CachedBanner> {
  if (map) return map;
  map = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, CachedBanner>;
    for (const [id, e] of Object.entries(raw)) {
      if (!e || typeof e.at !== "number") continue;
      const config = e.config ? sanitizeProfile(e.config) : null; // stored data is checked like anything else read in
      map.set(id, { at: e.at, config, banner: typeof e.banner === "string" ? e.banner : undefined, bio: typeof e.bio === "string" ? e.bio.slice(0, 2000) : undefined });
    }
  } catch { /* nothing stored, or storage off */ }
  return map;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const m = all();
    // Oldest first out when it's full.
    if (m.size > MAX) for (const [id] of [...m].sort((a, b) => a[1].at - b[1].at).slice(0, m.size - MAX)) m.delete(id);
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(m))); } catch { /* full or off: it just isn't kept */ }
  }, 1500);
}

export function cachedBanner(userId: string, maxAge = BANNER_TTL): CachedBanner | undefined {
  const e = all().get(userId);
  return e && Date.now() - e.at < maxAge ? e : undefined;
}

export function rememberBanner(userId: string, e: Omit<CachedBanner, "at">) {
  all().set(userId, { ...e, at: Date.now() });
  save();
}

export function forgetBanners() {
  map = new Map();
  try { localStorage.removeItem(KEY); } catch { /* fine */ }
}
