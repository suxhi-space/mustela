import { inTauri } from "../../lib/platform";

/** What the pop-out window needs to draw. Plain data, so it can cross windows. */
export interface Snapshot {
  active: boolean;
  channelName: string;
  mic: boolean; cam: boolean; screen: boolean;
  people: { id: string; name: string; avatarUrl?: string }[];
  speaking: string[];
  error: string;
}
export type Cmd = "mic" | "cam" | "screen" | "leave";
export type Wire = { t: "state"; s: Snapshot } | { t: "cmd"; c: Cmd } | { t: "hello" };

const EVENT = "mustela:call";

/**
 * A tiny two-way pipe between the main window and the pop-out. Tauri events
 * when running as the app; BroadcastChannel in a plain browser (dev, tests).
 * Messages are tagged with a sender id so a window never reacts to its own.
 */
export function openBridge(onMsg: (m: Wire) => void): { send(m: Wire): void; close(): void } {
  const me = Math.random().toString(36).slice(2); // per bridge, so two on one page still hear each other
  const accept = (raw: unknown) => {
    const r = raw as { from?: string; m?: Wire } | null;
    if (r && r.from !== me && r.m && typeof r.m === "object") onMsg(r.m);
  };
  if (inTauri()) {
    let unlisten: (() => void) | undefined, closed = false;
    const ready = import("@tauri-apps/api/event").then(async (ev) => {
      const off = await ev.listen(EVENT, (e) => accept(e.payload));
      if (closed) off(); else unlisten = off;
      return ev;
    });
    return {
      send: (m) => void ready.then((ev) => ev.emit(EVENT, { from: me, m })).catch(() => {}),
      close: () => { closed = true; unlisten?.(); },
    };
  }
  const ch = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(EVENT);
  if (ch) ch.onmessage = (e) => accept(e.data);
  return { send: (m) => ch?.postMessage({ from: me, m }), close: () => ch?.close() };
}
