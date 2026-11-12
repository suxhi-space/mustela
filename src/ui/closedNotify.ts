import { createEffect, getOwner, on, onCleanup, runWithOwner } from "solid-js";
import { inTauri } from "../lib/platform";
import { call } from "./call/state";
import { openChannel, requestJump } from "./nav";
import { backend, device, platform } from "./store";

/**
 * Android: notifications while Mustela is closed, without looking online or draining the battery.
 *
 * While the app is open it handles notifications itself and tells the phone side so every ~20 s. After 30 s in the
 * background (and not in a call) it closes its live connection, so Stoat shows you offline like when the app is
 * closed, and pauses the page. From then on MessageWatch.kt checks Stoat over plain web requests now and then,
 * using what's handed over here: your session, which channels notify and how, and their names.
 */
export function startClosedNotify(current: () => string | undefined) {
  if (platform !== "android" || !inTauri()) return;
  const b = backend();
  if (!b?.watchInfo) return; // the demo has nothing to check
  // Tapping a notification works from the very first moment (it used to wait for the connection too, see below).
  listenForTaps();
  // Mustela opens straight away from what was on screen last time and connects meanwhile; until then there's no
  // session to hand over. This used to give up right there, so on most starts the phone side never heard from the
  // app (no "open"/"away", no fresh settings): notifications only came once you opened Mustela. Now it waits.
  if (b.watchInfo()) return void begin(b, current);
  // (Started later from an event, so it's run under Shell's owner: its effects and clean-up belong to Shell.)
  const owner = getOwner();
  let started = false;
  const off = b.onEvent((e) => {
    if (started || e.t !== "reconnected" || !b.watchInfo?.()) return;
    started = true; off();
    runWithOwner(owner, () => begin(b, current));
  });
  onCleanup(() => off());
}

/* ---------- tapping a notification opens its conversation, at the message ---------- */
function listenForTaps() {
  const w = window as unknown as { __mustelaLink?: string; __mustelaChat?: string };
  const take = (url: unknown) => {
    const id = typeof url === "string" ? /^mustela:\/\/channel\/([0-9A-Za-z]{1,40})/.exec(url)?.[1] : undefined;
    if (!id || url === w.__mustelaChat) return;
    w.__mustelaChat = url as string; // the phone sends a link a few times in case the page wasn't ready
    // At the message the notification was about, when it says which.
    const msg = /[?&]message=([0-9A-Za-z]{1,40})/.exec(url as string)?.[1];
    if (msg) requestJump(id, msg); else openChannel(id);
  };
  if (w.__mustelaLink) take(w.__mustelaLink);
  const onLink = (e: Event) => take((e as CustomEvent<string>).detail);
  addEventListener("mustela:open-link", onLink);
  onCleanup(() => removeEventListener("mustela:open-link", onLink));
}

function begin(b: NonNullable<ReturnType<typeof backend>>, current: () => string | undefined) {
  const invoke = (cmd: string, payload: unknown) =>
    import("@tauri-apps/api/core").then(({ invoke }) => invoke(`plugin:mustela-native|${cmd}`, { payload })).catch(() => {});

  const wanted = () => device().notifications && device().closedNotify;

  /** Everything the phone side needs, kept small: only channels that differ from the defaults get a level. */
  async function profile(): Promise<string | null> {
    const info = b!.watchInfo?.();
    if (!info) return null;
    const levels: Record<string, string> = {}, titles: Record<string, string> = {}, kinds: Record<string, string> = {};
    const watch: string[] = [];
    for (const s of await b!.spaces()) for (const c of s.channels) {
      const direct = c.kind === "dm" || c.kind === "group";
      if (s.home && !direct) continue; // Saved Notes: only you write there
      const muted = c.muted || (!s.home && b!.isMuted("server", s.id));
      const level = muted ? "none" : b!.notifyLevel("channel", c.id) ?? (!s.home ? b!.notifyLevel("server", s.id) : undefined) ?? (direct ? "all" : "mention");
      if (level !== (direct ? "all" : "mention")) levels[c.id] = level;
      kinds[c.id] = c.kind === "dm" ? "dm" : c.kind === "group" ? "group" : "server";
      if (c.kind === "group") titles[c.id] = c.name;
      else if (!direct) titles[c.id] = `#${c.name}, ${s.name}`;
      if (!direct && level === "all") watch.push(c.id);
    }
    const blocked = (await b!.friends().catch(() => null))?.blocked.map((p) => p.id) ?? [];
    const presence = b!.me.presence;
    return JSON.stringify({
      ...info, preview: device().notifyPreview, quiet: presence === "busy" ? "busy" : presence === "focus" ? "focus" : "",
      levels, titles, kinds, watch: watch.slice(0, 15), blocked,
    });
  }

  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const sync = (delay = 3000) => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      if (!wanted()) return void invoke("watch", { on: false });
      // (Permission to notify is asked by the "Don't miss a message" prompt; the phone side checks it before showing anything.)
      const p = await profile().catch(() => null);
      if (p) void invoke("watch", { on: true, profile: p });
    }, delay);
  };
  createEffect(on(() => [device().notifications, device().closedNotify, device().notifyPreview], () => sync(500)));
  // Mutes, levels, new DMs and groups: refreshed now and then while the app is open (it's only sent, not fetched).
  const refresh = setInterval(() => sync(0), 5 * 60_000);
  // (Not on every "activity": those come in storms on busy servers.)
  const off = b.onEvent((e) => { if (e.t === "reconnected") sync(); });

  /* ---------- open vs. in the background ---------- */
  let paused = false;
  let away: ReturnType<typeof setTimeout> | undefined;
  const alive = () => { if (!paused) void invoke("watch_alive", { alive: true }); };
  alive();
  const beat = setInterval(alive, 20_000);
  const letGo = () => {
    // Only when really away: still hidden now, and not in (or joining) a call, which needs the connection.
    if (!document.hidden) return;
    if (call.active() || call.busy()) { away = setTimeout(letGo, 60_000); return; }
    paused = true;
    b.pause?.();
    void invoke("watch_alive", { alive: false });
  };
  // Safety net: any touch or key while let go means you're here, so connect again straight away.
  const back = () => { if (paused) { clearTimeout(away); paused = false; b.resume?.(); alive(); } };
  for (const ev of ["pointerdown", "keydown", "focus"]) addEventListener(ev, back, true);
  const vis = () => {
    clearTimeout(away);
    if (document.hidden) { away = setTimeout(letGo, 30_000); return; }
    if (paused) { paused = false; b.resume?.(); }
    alive();
    const ch = current();
    if (ch) void invoke("watch_clear", { channel: ch });
  };
  document.addEventListener("visibilitychange", vis);
  createEffect(on(current, (ch) => { if (ch && !document.hidden) void invoke("watch_clear", { channel: ch }); }));

  onCleanup(() => {
    clearTimeout(syncTimer); clearTimeout(away); clearInterval(refresh); clearInterval(beat); off();
    document.removeEventListener("visibilitychange", vis);
    for (const ev of ["pointerdown", "keydown", "focus"]) removeEventListener(ev, back, true);
    // Signed out or switched accounts: forget this session on the phone side (the next account starts its own).
    void invoke("watch", { on: false });
  });
}
