import { createRoot, createSignal } from "solid-js";
import { backend } from "./store";
import { toast } from "./menu";

/**
 * Scheduled messages. Stoat has no scheduled sending of its own, so they're kept on this device (per account) and
 * sent from here when their time comes, while Mustela is running (on a computer it keeps running in the tray). Any
 * that came due while Mustela was closed go out the next time it opens. Text only: attached files can't wait.
 */
export interface Scheduled { id: string; channelId: string; text: string; at: number; replyTo?: string; tries?: number }

const KEY = (uid: string) => `mustela.scheduled.${uid}`;
const [list, setList] = createSignal<Scheduled[]>([]);
let owner = "";

function load(uid: string): Scheduled[] {
  try { const v = JSON.parse(localStorage.getItem(KEY(uid)) ?? "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.text === "string" && typeof x.at === "number") : []; } catch { return []; }
}
function save() { try { if (owner) localStorage.setItem(KEY(owner), JSON.stringify(list())); } catch { /* full or blocked */ } }

/** The scheduled messages for one channel (or all), soonest first. */
export const scheduled = (channelId?: string) => list().filter((x) => !channelId || x.channelId === channelId).sort((a, b) => a.at - b.at);

export function schedule(channelId: string, text: string, at: number, replyTo?: string) {
  setList([...list(), { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, channelId, text, at, replyTo }]);
  save();
}
export function unschedule(id: string) { setList(list().filter((x) => x.id !== id)); save(); }

async function sendOne(s: Scheduled) {
  const b = backend();
  if (!b) return;
  try {
    await b.send(s.channelId, { text: s.text, replies: s.replyTo ? [{ id: s.replyTo, mention: false }] : undefined });
    unschedule(s.id);
  } catch {
    // Offline or not allowed any more: try again later, and give up after a few goes so it doesn't loop forever.
    const tries = (s.tries ?? 0) + 1;
    if (tries >= 5) { unschedule(s.id); toast("A scheduled message couldn't be sent and was removed.", true); return; }
    setList(list().map((x) => (x.id === s.id ? { ...x, tries } : x)));
    save();
  }
}
export const sendNow = (id: string) => { const s = list().find((x) => x.id === id); if (s) void sendOne(s); };

let busy = false;
async function tick() {
  const b = backend();
  if (!b || busy) return;
  if (b.me.id !== owner) { owner = b.me.id; setList(load(owner)); }
  const due = list().filter((x) => x.at <= Date.now());
  if (!due.length) return;
  busy = true;
  try { for (const s of due) await sendOne(s); } finally { busy = false; }
}

/** Start checking for due messages (every 15 seconds, and whenever the app comes back to the front). */
let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  createRoot(() => {
    setInterval(() => void tick(), 15_000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void tick(); });
    setTimeout(() => void tick(), 3000);
  });
}

/** Load this account's list (called when the account changes). */
export function refreshScheduled() { const b = backend(); if (b) { owner = b.me.id; setList(load(owner)); } }

export { quickTimes } from "../lib/scheduleTimes";
