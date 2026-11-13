/**
 * Merging synced settings part by part, so one device can never wipe what another saved.
 *
 * Both synced blocks ("mustela:settings" and "mustela:settings-ext") used to be "newest whole block wins". A device
 * running an older Mustela, or one that had just updated and still held an old copy, would save its whole block
 * (missing the parts it didn't know, like saved themes) and that copy would replace everyone's.
 *
 * Now every top-level part has its own "last changed" time (`stamps`), and two copies are merged part by part:
 *  - each part comes from whichever copy changed it last;
 *  - a part that's missing from a copy (an older build, or an old local copy) never erases it;
 *  - clearing a part on purpose is saved as `null` with a fresh time, so that still reaches every device;
 *  - parts this build doesn't know (from newer builds) are kept and passed on untouched.
 * Copies from builds without stamps count each part they have as changed at their `updatedAt`.
 */
export type Doc = Record<string, unknown>;

const has = (o: Doc, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const META = new Set(["stamps", "updatedAt"]);

/** When this part was last changed in this copy (-1: the copy doesn't have it at all). */
export function stampOf(o: Doc, k: string): number {
  if (!has(o, k)) return -1;
  const s = (o.stamps && typeof o.stamps === "object" ? (o.stamps as Record<string, unknown>)[k] : undefined);
  return typeof s === "number" && Number.isFinite(s) ? s : num(o.updatedAt);
}

/** A stored or downloaded copy, as a plain object (null: nothing usable). */
export function parseDoc(value: string | null | undefined): Doc | null {
  if (!value) return null;
  try { const v = JSON.parse(value); return v && typeof v === "object" && !Array.isArray(v) ? (v as Doc) : null; } catch { return null; }
}

/**
 * A local change: `next` is the cleaned settings after the change. Parts that changed get `now` as their time; a known
 * part that was there and is now gone is saved as null (cleared on purpose). Unknown parts from `prev` are kept.
 */
export function stampDoc(prev: Doc, next: object, known: readonly string[], now = Date.now()): Doc {
  const n = next as Doc;
  const stamps: Record<string, number> = { ...((prev.stamps as Record<string, number>) ?? {}) };
  const out: Doc = { ...prev };
  for (const k of known) {
    if (META.has(k)) continue;
    const before = has(prev, k) ? JSON.stringify(prev[k]) : undefined;
    if (has(n, k)) {
      const after = JSON.stringify(n[k]);
      out[k] = n[k];
      if (after !== before) stamps[k] = now;
    } else if (has(prev, k) && prev[k] !== null) {
      out[k] = null; // cleared on purpose
      stamps[k] = now;
    }
  }
  out.stamps = stamps;
  out.updatedAt = Math.max(num(prev.updatedAt), num(n.updatedAt), now);
  return out;
}

/** The two copies merged part by part. Ties keep `local`. */
export function mergeDocs(local: Doc, remote: Doc | null): Doc {
  if (!remote) return local;
  const out: Doc = {};
  const stamps: Record<string, number> = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)].filter((k) => !META.has(k)));
  for (const k of keys) {
    const a = stampOf(local, k), b = stampOf(remote, k);
    if (a < 0 && b < 0) continue;
    const from = b > a ? remote : local;
    out[k] = from[k];
    stamps[k] = Math.max(a, b, 0);
  }
  out.stamps = stamps;
  out.updatedAt = Math.max(num(local.updatedAt), num(remote.updatedAt));
  return out;
}

/** Same content (the order of keys doesn't matter). */
export function sameDoc(a: Doc | null, b: Doc | null): boolean {
  const canon = (o: unknown): unknown => (Array.isArray(o) ? o.map(canon) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, canon((o as Doc)[k])])) : o);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** The Stoat sync API calls, for a whole document under one key. */
export interface DocApi {
  post(path: "/sync/settings/fetch", body: { keys: string[] }): Promise<Record<string, [number, string]>>;
  post(path: "/sync/settings/set", body: Record<string, any>): Promise<unknown>;
}
export async function pullDoc(api: DocApi, key: string): Promise<Doc | null> {
  const res = await api.post("/sync/settings/fetch", { keys: [key] });
  return parseDoc(res?.[key]?.[1]);
}
export async function pushDoc(api: DocApi, key: string, doc: Doc): Promise<void> {
  await api.post("/sync/settings/set", { [key]: JSON.stringify(doc), timestamp: Math.max(num(doc.updatedAt), Date.now()) });
}
