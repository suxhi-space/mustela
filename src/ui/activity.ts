import { createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js";
import type { Activity } from "../lib/cloud";
import { inTauri } from "../lib/platform";
import { backend, device, platform, settings } from "./store";

/**
 * Your activity ("Playing …"), kept apart from your status and status message
 * like Discord does. Two sources, both from the desktop app's Rust side:
 *  - game detection: running programs matched against Discord's public list
 *    of detectable games;
 *  - Rich Presence: games and apps that talk to Discord's local RPC socket
 *    talk to Mustela instead when Discord isn't running.
 * Rich Presence wins when both have something. Shared through your linked
 * Mustela servers, so other Mustela users see it on your profile.
 */
export interface DetectedGame { id: string; name: string; icon?: string; startedAt: number; exe?: string; kind?: Activity["kind"] }
const [games, setGames] = createSignal<DetectedGame[]>([]);
/** Rich Presence from every app reporting it right now (a game and a music player at once), newest first. */
const [rpcs, setRpcs] = createSignal<{ key: number; app: string | null; activity: Activity }[]>([]);
const [status, setStatus] = createSignal<{ rpc: "off" | "listening" | "busy" | "unsupported"; detect: "off" | "on" | "unsupported" }>({ rpc: "unsupported", detect: "unsupported" });

export const desktopActivity = () => inTauri() && platform !== "android";
export const activity = {
  games, status,
  /** The newest Rich Presence (Settings shows which app it's from). */
  rpc: () => rpcs()[0]?.activity ?? null,
  rpcApp: () => rpcs()[0]?.app ?? null,
  /** Everything you're doing, like Discord: Rich Presence first (it says the most), then detected games and your own
   * programs, without the same game twice. */
  list: createRoot(() => createMemo<Activity[]>(() => {
    const hidden = new Set(device().activity.hidden);
    const out: Activity[] = [];
    if (device().activity.rpc) for (const r of rpcs()) if (!hidden.has(r.activity.name)) out.push(r.activity);
    if (device().activity.detect) for (const g of games()) {
      if (hidden.has(g.name) || out.some((a) => a.name === g.name || (a.appId && a.appId === g.id))) continue;
      out.push({ kind: g.kind ?? "playing", name: g.name, startedAt: g.startedAt, image: g.icon, appId: g.id.startsWith("custom:") ? undefined : g.id });
    }
    return out.slice(0, 5);
  })),
  /** The first of them (where there's room for one). */
  current: () => activity.list()[0] ?? null,
};

let started = false;
export function startActivity() {
  if (started || !desktopActivity()) return;
  started = true;
  createRoot(async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const { invoke } = await import("@tauri-apps/api/core");
    const offs = await Promise.all([
      listen<DetectedGame[]>("activity://games", (e) => setGames(Array.isArray(e.payload) ? e.payload : [])),
      listen<{ key?: number; app: string | null; activity: Activity | null }>("activity://rpc", (e) => {
        const key = e.payload?.key ?? 0, a = e.payload?.activity ?? null;
        setRpcs((list) => [...(a ? [{ key, app: e.payload?.app ?? null, activity: a }] : []), ...list.filter((x) => x.key !== key)]);
      }),
    ]);
    onCleanup(() => offs.forEach((f) => f()));

    // Tell the Rust side what to run; it answers with what actually started.
    const apply = async () => {
      const { detect, rpc: rpcOn } = device().activity;
      try { setStatus(await invoke("activity_config", { detect, rpc: rpcOn })); }
      catch { setStatus({ rpc: "unsupported", detect: "unsupported" }); }
    };
    createEffect(on(() => [device().activity.detect, device().activity.rpc] as const, () => void apply()));
    // Your own programs (Settings > Activity), for the detection to look for.
    createEffect(on(() => JSON.stringify(device().activity.custom), () => { void invoke("activity_custom", { list: device().activity.custom }).catch(() => {}); }));
    // While Discord holds the Rich Presence socket, try again now and then: it may be closed later.
    const retry = setInterval(() => { if (status().rpc === "busy") void apply(); }, 15_000);
    onCleanup(() => clearInterval(retry));

    // Share it: immediately on change, then a heartbeat so servers know it's still true. A device with nothing to
    // show only clears what it sent itself, so it never wipes what your other computer is sharing. A send that
    // didn't get through is tried again soon rather than at the next heartbeat.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sentSomething = false;
    createEffect(on(() => [JSON.stringify(activity.list()), device().activity.share, backend(), settings().cloud.servers.join()] as const, ([, share, b]) => {
      clearTimeout(timer);
      if (!b) return;
      const out = share ? activity.list() : [];
      if (!out.length && !sentSomething) return;
      const send = async () => {
        let ok = false;
        try { const r = await b.cloud.setActivity(out); ok = r.tried > 0 && r.failed < r.tried; } catch { /* retried below */ }
        if (ok) sentSomething = out.length > 0;
        if (out.length || !ok) timer = setTimeout(() => void send(), ok ? 60_000 : 15_000);
      };
      void send();
    }));
    onCleanup(() => clearTimeout(timer));
  });
}

/** "Playing", "Listening to", … */
export const verb = (k: Activity["kind"]) => ({ playing: "Playing", listening: "Listening to", watching: "Watching", streaming: "Streaming", competing: "Competing in" })[k];

export function elapsed(since?: number, now = Date.now()) {
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
