import type { ProfileInfo } from "./backend/types";

/**
 * Computers keep the last profile seen for each person (their look, decorations, bio, banner address) on this device,
 * so cards and profiles open complete straight away after a restart, then refresh as usual. Not on phones and tablets,
 * to keep storage small there. At most 300 people per account; what they're playing is never kept.
 */
const DB = "mustela-profiles", STORE = "profiles", KEEP = 300;
type Entry = { key: string; account: string; at: number; info: ProfileInfo };

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("account", "account"); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch { resolve(null); }
  }));
}

const memo = new Map<string, ProfileInfo | null>();

export async function cachedProfile(account: string, user: string): Promise<ProfileInfo | null> {
  const key = `${account}:${user}`;
  if (memo.has(key)) return memo.get(key)!;
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => { const info = (r.result as Entry | undefined)?.info ?? null; memo.set(key, info); resolve(info); };
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

let saves = 0;
export function saveProfile(account: string, user: string, info: ProfileInfo) {
  const key = `${account}:${user}`;
  const keep: ProfileInfo = { ...info, activity: undefined };
  const json = JSON.stringify(keep);
  const had = memo.get(key);
  if (had && JSON.stringify(had) === json) return;
  memo.set(key, keep);
  void db().then((d) => {
    if (!d) return;
    try {
      const tx = d.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
      store.put({ key, account, at: Date.now(), info: JSON.parse(json) } satisfies Entry);
      // Now and then, forget the people seen longest ago.
      if (++saves % 20 === 0) {
        const all = store.index("account").getAll(account);
        all.onsuccess = () => { for (const e of (all.result as Entry[]).sort((a, b) => b.at - a.at).slice(KEEP)) store.delete(e.key); };
      }
    } catch { /* storage full or blocked: only a nicety */ }
  });
}

export async function clearProfileCache() {
  memo.clear();
  const d = await db();
  try { d?.transaction(STORE, "readwrite").objectStore(STORE).clear(); } catch { /* nothing to clear */ }
}
