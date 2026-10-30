import { createResource, createSignal, onCleanup, type Accessor } from "solid-js";
import type { ProfileInfo } from "../lib/backend/types";
import { backend, ext, settings } from "./store";
import { currentServer } from "./nav";

/** True once the element has been on screen. Used to avoid fetching profiles for rows nobody sees. */
/** One observer for every name and avatar on screen, instead of one each (chat can show hundreds). */
const watchers = new Map<Element, () => void>();
/** One per window: the call pop-out is drawn from this window, and an observer only sees its own window's screen. */
const shared = new WeakMap<Window, IntersectionObserver>();
const observerFor = (view: Window & typeof globalThis) => {
  let io = shared.get(view);
  if (!io) {
    const made: IntersectionObserver = new view.IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        watchers.get(e.target)?.();
        watchers.delete(e.target);
        made.unobserve(e.target);
      }
    }, { rootMargin: "120px" });
    shared.set(view, io = made);
  }
  return io;
};

/**
 * Calls back with the window an element ends up in. Elements are made before they're placed,
 * so this waits until it's in the page (a moment later) to know whether that's the pop-out.
 */
export function inPlace(el: Element, f: (view: Window & typeof globalThis) => void) {
  let tries = 0;
  const go = () => {
    if (el.isConnected) return f((el.ownerDocument.defaultView ?? window) as Window & typeof globalThis);
    if (++tries < 20) setTimeout(go, tries < 3 ? 0 : 50);
  };
  queueMicrotask(go);
}

/** Becomes true once the element has been near the screen, and stays true. */
export function createSeen(): [Accessor<boolean>, (el: Element) => void] {
  const [seen, setSeen] = createSignal(typeof IntersectionObserver === "undefined");
  let watched: Element | undefined;
  let io: IntersectionObserver | undefined;
  onCleanup(() => { if (watched) { watchers.delete(watched); io?.unobserve(watched); } });
  return [seen, (el) => {
    if (seen()) return;
    watched = el;
    watchers.set(el, () => setSeen(true));
    inPlace(el, (view) => { if (watchers.has(el)) (io = observerFor(view)).observe(el); });
  }];
}

/** Live pixel size of an element. */
export function createSize(): [Accessor<{ w: number; h: number }>, (el: Element) => void] {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  return [size, (el) => {
    // Layout size, not on-screen size: a card that's still in its opening animation is drawn
    // scaled down, and frames measured then came out too small.
    const read = () => {
      const h = el as HTMLElement;
      if (typeof h.offsetWidth === "number") return setSize({ w: h.offsetWidth, h: h.offsetHeight });
      const r = el.getBoundingClientRect(); setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    };
    read();
    inPlace(el, (view) => { read(); if (typeof view.ResizeObserver !== "undefined") { ro?.disconnect(); ro = new view.ResizeObserver(read); ro.observe(el); } });
  }];
}

/** Someone's published profile. Mine comes straight from settings, so edits show instantly. */
/** Bumped per person when their profile has been read again, so every place showing it updates. */
const [epochs, setEpochs] = createSignal<Record<string, number>>({});
/** Opening someone's card or full profile reads it again (not a background job), like the user asked. */
export async function refreshProfile(userId: string) {
  const b = backend();
  if (!b || userId === b.me.id) return;
  await b.profileOf(userId, true);
  setEpochs({ ...epochs(), [userId]: (epochs()[userId] ?? 0) + 1 });
}

/**
 * Someone's profile as seen from `server` (by default the server you're looking at): their look for that
 * server, where they made one, over their main profile. Pass `() => null` for the main profile only.
 */
export function createProfileInfo(id: Accessor<string>, enabled: Accessor<boolean> = () => true, server: Accessor<string | null | undefined> = currentServer): Accessor<ProfileInfo | undefined> {
  const [res] = createResource(
    () => (enabled() && backend() ? `${id()}:${epochs()[id()] ?? 0}` : null),
    async (key) => backend()?.profileOf(key.slice(0, key.lastIndexOf(":"))),
  );
  const base = (): ProfileInfo | undefined => {
    const b = backend();
    if (b && id() === b.me.id) {
      // Yours straight from settings, so edits show at once.
      const servers: NonNullable<ProfileInfo["servers"]> = {};
      for (const [sid, l] of Object.entries(ext().serverLooks)) servers[sid] = { config: l.config, bio: l.bio, bannerAt: l.banner };
      return { config: settings().profile, bio: res()?.bio, bannerUrl: res()?.bannerUrl, servers };
    }
    return res();
  };
  const look = () => { const s = server(); return s ? base()?.servers?.[s] : undefined; };
  const [banner] = createResource(
    () => { const s = server(), at = look()?.bannerAt; return s && at ? ([id(), s, at] as const) : null; },
    ([uid, sid, at]) => backend()?.serverBanner(uid, sid, at) ?? null,
  );
  return () => {
    const b = base(), l = look();
    if (!b || !l) return b;
    return { ...b, config: l.config ?? b.config, bio: l.bio ?? b.bio, bannerUrl: (l.bannerAt && banner()) || b.bannerUrl };
  };
}
