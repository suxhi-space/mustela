import type { Rating } from "../decor/spec";
import { RATING_ORDER } from "../decor/spec";
import { parseHex } from "../color";
import { DEFAULT_PROFILE, sanitizeProfile, type ProfileConfig } from "../profile/model";
import { NONE_SLOT } from "../decor/spec";

/** The decoration v2 turned on for everyone by default (Halo). */
const DEFAULT_V2_DECOR = { preset: 1, hue: 210, speed: 6, intensity: 9 };
import { THEMES, DEFAULT_THEME } from "../theme/palette";

/** Synced through the user's own Stoat account. Follows you to every device. */
/** Material You scheme styles, the same family Stoat's official client offers. */
export const VARIANTS = ["tonal", "vibrant", "expressive", "fidelity", "content", "neutral", "monochrome", "rainbow", "fruit"] as const;
export type Variant = (typeof VARIANTS)[number];
export const CONTRASTS = [-1, 0, 0.5, 1] as const;

export interface FavGif { url: string; preview: string; still?: string; w?: number; h?: number }
/** A soundboard sound that came from a link: each device downloads and trims it the same way. */
export interface LinkedSound { id: string; name: string; emoji: string; url: string; start: number; end: number; volume: number }

export const EMOJI_PACKS = ["fluent-3d", "fluent-color", "fluent-flat", "mutant", "noto", "twemoji", "system"] as const;
export type EmojiPack = (typeof EMOJI_PACKS)[number];
export interface PinGroup { id: string; name: string; color: string }
export const DEFAULT_PIN_GROUP: PinGroup = { id: "pinned", name: "Pinned", color: "#f0b232" };

export interface MustelaSettings {
  v: 3;
  look: {
    /** A THEMES id, or "custom" to use `seed`. */
    theme: string;
    /** "#rrggbb", used when theme === "custom" */
    seed: string;
    mode: "auto" | "light" | "dark";
    amoled: boolean;
    /** How colorful the generated scheme is */
    variant: Variant;
    /** -1 reduced, 0 normal, 0.5 more, 1 high */
    contrast: number;
    /** Accent gradient: primary fills blend into a second color */
    gradient: { on: boolean; seed2: string; angle: number; /** 0-100: how much of the gradient tints windows and panels */ windows: number };
  };
  /** Starred GIFs (Gifbox links), newest first */
  favGifs: FavGif[];
  /** Soundboard sounds added from links (files you add stay on that device) */
  sounds: LinkedSound[];
  /** Time and date display */
  locale: { time: "auto" | "12" | "24"; date: "auto" | "us" | "eu" | "iso" };
  /** Mustela sync servers to publish to and read profiles from */
  /** Mustela sync servers to publish to and read profiles from; `banner` also hides the profile in your Stoat banner */
  cloud: { servers: string[]; banner: boolean };
  /** What I publish and what I see on myself. */
  profile: ProfileConfig;
  /** Don't animate other people's profiles rated worse than this. */
  maxRating: Rating;
  /** Pinned DMs, in named, colored groups. */
  pins: { groups: PinGroup[]; items: { channel: string; group: string }[] };
  /** How unicode emoji are drawn: a Stoat emoji pack, or the system font. */
  emojiPack: EmojiPack;
  /** ms since epoch of last local change; drives last-write-wins. */
  updatedAt: number;
}

export const DEFAULT_SETTINGS: MustelaSettings = {
  v: 3,
  look: { theme: DEFAULT_THEME, seed: "#6b7480", mode: "dark", amoled: false, variant: "neutral", contrast: 0, gradient: { on: false, seed2: "#a05cf0", angle: 135, windows: 35 } },
  favGifs: [],
  sounds: [],
  locale: { time: "auto", date: "auto" },
  cloud: { servers: [], banner: true },
  profile: DEFAULT_PROFILE,
  maxRating: "heavy",
  pins: { groups: [DEFAULT_PIN_GROUP], items: [] },
  emojiPack: "fluent-3d",
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
  const g = (l.gradient ?? {}) as Record<string, unknown>;
  const hexOr = (x: unknown, dflt: string) => (typeof x === "string" && parseHex(x) !== null ? x.toLowerCase().replace(/^([0-9a-f]{6})$/, "#$1") : dflt);
  const profile = sanitizeProfile(r.profile);
  // v2 shipped with a Halo decoration on by default. People didn't choose it, so it goes.
  if (r.v === 2 && profile.decor.preset === DEFAULT_V2_DECOR.preset && profile.decor.hue === DEFAULT_V2_DECOR.hue
    && profile.decor.speed === DEFAULT_V2_DECOR.speed && profile.decor.intensity === DEFAULT_V2_DECOR.intensity) profile.decor = { ...NONE_SLOT };
  const loc = (r.locale ?? {}) as Record<string, unknown>;
  const servers = Array.isArray(r.cloud?.servers) ? (r.cloud.servers as unknown[]).filter((x): x is string => typeof x === "string" && /^https?:\/\//.test(x) && x.length < 300).slice(0, 8) : [];
  return {
    v: 3,
    look: {
      theme: themeOk ? (l.theme as string) : d.look.theme,
      seed,
      mode: l.mode === "light" || l.mode === "dark" || l.mode === "auto" ? l.mode : d.look.mode,
      amoled: l.amoled === true,
      // Saved looks from before the gray default keep the old fallback, so nobody's colours shift.
      variant: (VARIANTS as readonly unknown[]).includes(l.variant) ? (l.variant as Variant) : Object.keys(l).length ? "vibrant" : d.look.variant,
      contrast: (CONTRASTS as readonly unknown[]).includes(l.contrast) ? (l.contrast as number) : d.look.contrast,
      gradient: { on: g.on === true, seed2: hexOr(g.seed2, d.look.gradient.seed2), angle: int(g.angle, 0, 360, d.look.gradient.angle), windows: int(g.windows, 0, 100, d.look.gradient.windows) },
    },
    favGifs: Array.isArray(r.favGifs) ? (r.favGifs as any[]).filter((f) => f && typeof f.url === "string" && /^https:\/\//.test(f.url) && typeof f.preview === "string" && /^(https:\/\/|data:image\/)/.test(f.preview))
      .slice(0, 100).map((f) => ({ url: f.url.slice(0, 500), preview: f.preview.slice(0, 4000), still: typeof f.still === "string" && /^https:\/\//.test(f.still) ? f.still.slice(0, 500) : undefined, w: int(f.w, 1, 4096, 0) || undefined, h: int(f.h, 1, 4096, 0) || undefined })) : [],
    sounds: Array.isArray(r.sounds) ? (r.sounds as any[]).filter((x) => x && typeof x.id === "string" && x.id.length < 64 && typeof x.url === "string" && /^https:\/\//.test(x.url) && x.url.length < 600)
      .slice(0, 60).map((x) => {
        const start = typeof x.start === "number" && Number.isFinite(x.start) ? Math.max(0, x.start) : 0;
        const end = typeof x.end === "number" && Number.isFinite(x.end) ? Math.min(start + 10, Math.max(start + 0.1, x.end)) : start + 10;
        return { id: x.id, url: x.url, name: typeof x.name === "string" ? x.name.slice(0, 32) : "Sound", emoji: typeof x.emoji === "string" ? x.emoji.slice(0, 8) : "🔊", start, end, volume: typeof x.volume === "number" ? Math.max(0, Math.min(1, x.volume)) : 0.8 };
      }) : [],
    locale: {
      time: loc.time === "12" || loc.time === "24" ? loc.time : "auto",
      date: loc.date === "us" || loc.date === "eu" || loc.date === "iso" ? loc.date : "auto",
    },
    cloud: { servers, banner: r.cloud?.banner !== false },
    profile,
    maxRating: RATING_ORDER.includes(r.maxRating) ? r.maxRating : d.maxRating,
    pins: sanitizePins(r.pins),
    emojiPack: (EMOJI_PACKS as readonly unknown[]).includes(r.emojiPack) ? r.emojiPack : d.emojiPack,
    updatedAt: int(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

function sanitizePins(raw: any): MustelaSettings["pins"] {
  const ok = (x: unknown, n: number) => typeof x === "string" && x.length > 0 && x.length <= n;
  const groups: PinGroup[] = Array.isArray(raw?.groups) ? (raw.groups as any[]).filter((g) => g && ok(g.id, 40) && ok(g.name, 40))
    .slice(0, 20).map((g) => ({ id: g.id, name: g.name, color: typeof g.color === "string" && parseHex(g.color) !== null ? g.color.toLowerCase() : DEFAULT_PIN_GROUP.color })) : [];
  if (!groups.some((g) => g.id === DEFAULT_PIN_GROUP.id)) groups.unshift({ ...DEFAULT_PIN_GROUP });
  const ids = new Set(groups.map((g) => g.id)), seen = new Set<string>();
  const items = Array.isArray(raw?.items) ? (raw.items as any[]).filter((i) => i && ok(i.channel, 40) && ids.has(i.group) && !seen.has(i.channel) && seen.add(i.channel))
    .slice(0, 200).map((i) => ({ channel: i.channel as string, group: i.group as string })) : [];
  return { groups, items };
}

export function parseRemote(value: string | undefined | null): MustelaSettings | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value);
    // Only accept our own current format. Older shapes fall back to defaults rather than being guessed at.
    if (!raw || typeof raw !== "object" || (raw.v !== 2 && raw.v !== 3)) return null;
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
