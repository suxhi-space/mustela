import { activeAccount } from "../lib/session/book";
import { book } from "./store";

/**
 * Message drafts, one per channel and DM, like Stoat's client keeps them.
 * Text and the reply you were writing survive a restart (saved per account on this device).
 * Attached files stay with their channel for this session; a browser can't keep files across restarts.
 */
export interface Draft { text: string; reply?: { id: string; mention: boolean } }
export interface PendingFile { id: number; file: File; thumb?: string; spoiler: boolean }

const MAX_DRAFTS = 200;
const key = () => { const a = activeAccount(book()); return a ? `mustela:drafts:${a.id}` : null; };

let cache: { key: string; map: Record<string, Draft & { at: number }> } | null = null;
function load(): Record<string, Draft & { at: number }> {
  const k = key();
  if (!k) return {};
  if (cache?.key === k) return cache.map;
  let map: Record<string, Draft & { at: number }> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(k) ?? "{}");
    if (raw && typeof raw === "object") {
      for (const [cid, d] of Object.entries(raw as Record<string, any>)) {
        if (typeof d?.text !== "string" || cid.length > 40) continue;
        map[cid] = {
          text: d.text.slice(0, 4000), at: typeof d.at === "number" ? d.at : 0,
          reply: typeof d.reply?.id === "string" ? { id: d.reply.id.slice(0, 40), mention: d.reply.mention !== false } : undefined,
        };
      }
    }
  } catch { map = {}; }
  cache = { key: k, map };
  return map;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const k = key();
    if (!k || !cache || cache.key !== k) return;
    // Keep the newest ones if someone leaves drafts everywhere.
    const entries = Object.entries(cache.map).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DRAFTS);
    cache.map = Object.fromEntries(entries);
    try { localStorage.setItem(k, JSON.stringify(cache.map)); } catch { /* storage full or blocked: drafts stay in memory */ }
  }, 400);
}
if (typeof addEventListener === "function") addEventListener("beforeunload", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; const k = key(); if (k && cache?.key === k) try { localStorage.setItem(k, JSON.stringify(cache.map)); } catch { /* ignore */ } } });

export function getDraft(channelId: string): Draft {
  const d = load()[channelId];
  return d ? { text: d.text, reply: d.reply } : { text: "" };
}

export function setDraft(channelId: string, d: Draft) {
  const map = load();
  if (!d.text.trim() && !d.reply) { if (!(channelId in map)) return; delete map[channelId]; }
  else map[channelId] = { ...d, at: Date.now() };
  save();
}

/** Channels with a draft, for the little pencil in the channel list. */
export function hasDraft(channelId: string) { return !!load()[channelId]?.text.trim(); }

const files = new Map<string, PendingFile[]>();
export const getFiles = (channelId: string) => files.get(channelId) ?? [];
export function setFiles(channelId: string, list: PendingFile[]) { if (list.length) files.set(channelId, list); else files.delete(channelId); }
