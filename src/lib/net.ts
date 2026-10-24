/**
 * Byte fetching. Inside Tauri this goes through a Rust command so it isn't
 * subject to browser CORS (file hosts don't always send CORS headers) and so
 * size/timeouts are enforced natively. In a plain browser it falls back to fetch.
 */
export async function fetchBytes(url: string): Promise<Uint8Array> {
  if (!/^https:\/\//i.test(url)) throw new Error("https only");
  if ("__TAURI_INTERNALS__" in globalThis) {
    const { invoke } = await import("@tauri-apps/api/core");
    return new Uint8Array(await invoke<ArrayBuffer>("fetch_image", { url }));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8 * 1024 * 1024) throw new Error("too large");
  return new Uint8Array(buf);
}
