import { createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js";
import type { Activity } from "../lib/cloud";
import { inTauri } from "../lib/platform";
import { backend, device, platform } from "./store";

/**
 * Your activity ("Playing …"), kept apart from your status and status message
 * like Discord does. Two sources, both from the desktop app's Rust side:
 *  - game detection: running programs matched against Discord's public list
 *    of detectable games;
 *  - Rich Presence: games and apps that talk to Discord's local RPC socket
 *    talk to Mustela instead when Discord isn't running.
 * Rich Presence wins when both have something. Shared through your linked
 * sync servers, so other Mustela users see it on your profile.
 */
export interface DetectedGame { id: string; name: string; icon?: string; startedAt: number; exe?: string }

const [games, setGames] = createSignal<DetectedGame[]>([]);
const [rpc, setRpc] = createSignal<Activity | null>(null);
const [rpcApp, setRpcApp] = createSignal<string | null>(null);
const [status, setStatus] = createSignal<{ rpc: "off" | "listening" | "busy" | "unsupported"; detect: "off" | "on" | "unsupported" }>({ rpc: "unsupported", detect: "unsupported" });

export const desktopActivity = () => inTauri() && platform !== "android";

export const activity = {
  games, rpc, rpcApp, status,
  current: createRoot(() => createMemo<Activity | null>(() => {
    const hidden = new Set(device().activity.hidden);
    const r = rpc();
    if (r && device().activity.rpc && !hidden.has(r.name)) return r;
    const g = device().activity.detect ? games().find((x) => !hidden.has(x.name)) : undefined;
    return g ? { kind: "playing", name: g.name, startedAt: g.startedAt, image: g.icon, appId: g.id } : null;
  })),
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
      listen<{ app: string | null; activity: Activity | null }>("activity://rpc", (e) => { setRpc(e.payload?.activity ?? null); setRpcApp(e.payload?.app ?? null); }),
    ]);
    onCleanup(() => offs.forEach((f) => f()));

    // Tell the Rust side what to run; it answers with what actually started.
    const apply = async () => {
      const { detect, rpc: rpcOn } = device().activity;
      try { setStatus(await invoke("activity_config", { detect, rpc: rpcOn })); }
      catch { setStatus({ rpc: "unsupported", detect: "unsupported" }); }
    };
    createEffect(on(() => [device().activity.detect, device().activity.rpc] as const, () => void apply()));
    // While Discord holds the Rich Presence socket, try again now and then: it may be closed later.
    const retry = setInterval(() => { if (status().rpc === "busy") void apply(); }, 15_000);
    onCleanup(() => clearInterval(retry));

    // Share it: immediately on change, then a heartbeat so servers know it's still true.
    let timer: ReturnType<typeof setInterval> | undefined;
    createEffect(on(() => [activity.current(), device().activity.share, backend()] as const, ([a, share, b]) => {
      clearInterval(timer);
      if (!b) return;
      const send = () => void b.cloud.setActivity(share ? a : null).catch(() => {});
      send();
      if (share && a) timer = setInterval(send, 60_000);
    }));
    onCleanup(() => clearInterval(timer));
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
