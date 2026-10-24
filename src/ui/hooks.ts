import { createResource, createSignal, onCleanup, type Accessor } from "solid-js";
import type { ProfileInfo } from "../lib/backend/types";
import { backend, settings } from "./store";

/** True once the element has been on screen. Used to avoid fetching profiles for rows nobody sees. */
export function createSeen(): [Accessor<boolean>, (el: Element) => void] {
  const [seen, setSeen] = createSignal(typeof IntersectionObserver === "undefined");
  let io: IntersectionObserver | undefined;
  onCleanup(() => io?.disconnect());
  return [seen, (el) => {
    if (seen()) return;
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io?.disconnect(); } }, { rootMargin: "120px" });
    io.observe(el);
  }];
}

/** Live pixel size of an element. */
export function createSize(): [Accessor<{ w: number; h: number }>, (el: Element) => void] {
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  let ro: ResizeObserver | undefined;
  onCleanup(() => ro?.disconnect());
  return [size, (el) => {
    const read = () => { const r = el.getBoundingClientRect(); setSize({ w: Math.round(r.width), h: Math.round(r.height) }); };
    read();
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(read); ro.observe(el); }
  }];
}

/** Someone's published profile. Mine comes straight from settings, so edits show instantly. */
export function createProfileInfo(id: Accessor<string>, enabled: Accessor<boolean> = () => true): Accessor<ProfileInfo | undefined> {
  const [res] = createResource(
    () => (enabled() && backend() ? id() : null),
    async (uid) => backend()?.profileOf(uid),
  );
  return () => {
    const b = backend();
    if (b && id() === b.me.id) return { config: settings().profile, bio: res()?.bio, bannerUrl: res()?.bannerUrl };
    return res();
  };
}
