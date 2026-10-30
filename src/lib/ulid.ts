/** A ULID (time-sortable id), the format Stoat uses for every id, including channel categories. */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now = Date.now()): string {
  let t = "";
  for (let i = 0, n = now; i < 10; i++, n = Math.floor(n / 32)) t = B32[n % 32] + t;
  const r = crypto.getRandomValues(new Uint8Array(16));
  return t + Array.from(r, (x) => B32[x % 32]).join("");
}
