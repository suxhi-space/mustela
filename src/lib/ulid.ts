/** A ULID (time-sortable id), the format Stoat uses for every id, including channel categories. */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now = Date.now()): string {
  let t = "";
  for (let i = 0, n = now; i < 10; i++, n = Math.floor(n / 32)) t = B32[n % 32] + t;
  const r = crypto.getRandomValues(new Uint8Array(16));
  return t + Array.from(r, (x) => B32[x % 32]).join("");
}

/** The smallest ULID one millisecond before `id` (ids are ULIDs: 10 characters of time, then 16 random). */
export function ulidBefore(id: string): string {
  let t = 0;
  for (const c of id.slice(0, 10).toUpperCase()) t = t * 32 + Math.max(0, B32.indexOf(c));
  t = Math.max(0, t - 1);
  let out = "";
  for (let i = 0; i < 10; i++) { out = B32[t % 32] + out; t = Math.floor(t / 32); }
  return out + "0".repeat(16);
}
