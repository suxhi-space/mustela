import type { Msg } from "./backend/types";

/**
 * A small copy of your recent chats on this device, like Discord keeps, so opening one shows it straight away
 * while the newest messages load. Only the last 50 messages of the 20 chats you opened most recently, per account,
 * so it stays at a few megabytes at most. Kept in IndexedDB (not the settings storage, which is small).
 */
const DB = "mustela-cache", STORE = "chats", KEEP_CHATS = 20, KEEP_MSGS = 50;
type Entry = { key: string; account: string; channel: string; at: number; msgs: unknown[] };

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore(STORE, { keyPath: "key" }); s.createIndex("account", "account"); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

// Dates don't survive storage as Dates; these fields are put back.
const revive = (m: Record<string, unknown>): Msg => ({ ...m, at: new Date(m.at as string), editedAt: m.editedAt ? new Date(m.editedAt as string) : undefined } as Msg);
const strip = (m: Msg) => ({ ...m, pending: undefined, at: m.at.toISOString(), editedAt: m.editedAt?.toISOString() });

/** The saved copy of a chat (oldest first), or null. */
export async function cachedChat(account: string, channel: string): Promise<Msg[] | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction(STORE).objectStore(STORE).get(`${account}:${channel}`);
      r.onsuccess = () => { const e = r.result as Entry | undefined; resolve(e?.msgs?.length ? (e.msgs as Record<string, unknown>[]).map(revive) : null); };
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Save the newest messages of a chat (soon after it changes, not on every message), and forget older chats. */
export function saveChat(account: string, channel: string, msgs: Msg[]) {
  const key = `${account}:${channel}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    const list = msgs.filter((m) => !m.pending).slice(-KEEP_MSGS);
    if (!list.length) return;
    void db().then((d) => {
      if (!d) return;
      try {
        const tx = d.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.put({ key, account, channel, at: Date.now(), msgs: list.map(strip) } satisfies Entry);
        // Keep only this account's most recent chats.
        const all = store.index("account").getAll(account);
        all.onsuccess = () => {
          const old = (all.result as Entry[]).sort((a, b) => b.at - a.at).slice(KEEP_CHATS);
          for (const e of old) store.delete(e.key);
        };
      } catch { /* storage full or blocked: the cache is only a nicety */ }
    });
  }, 1500));
}

/** Forget everything saved (Settings > Advanced). */
export async function clearChatCache() {
  const d = await db();
  if (!d) return;
  try { d.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch { /* nothing to clear */ }
}
