/**
 * Local soundboard storage. Sounds live in this device's IndexedDB as small
 * WAV clips (at most 10 seconds), so nothing is uploaded anywhere: playing one
 * in a call streams it live, like your microphone.
 */
export const MAX_SECONDS = 10;

export interface Sound {
  id: string;
  name: string;
  emoji: string;
  /** WAV bytes */
  data: ArrayBuffer;
  seconds: number;
  volume: number; // 0..1
  createdAt: number;
  /** Where it came from, when added from a link (then it syncs to your other devices) */
  source?: string;
  start?: number;
  end?: number;
}

/** Downloads a clip from a direct audio link or a soundboard page (MyInstants and similar). */
export async function fetchSound(url: string): Promise<File> {
  if (!/^https:\/\//i.test(url)) throw new Error("Use an https:// link.");
  let bytes: ArrayBuffer;
  if ("__TAURI_INTERNALS__" in globalThis) {
    const { invoke } = await import("@tauri-apps/api/core");
    try { bytes = await invoke<ArrayBuffer>("fetch_audio", { url }); }
    catch (e) { throw new Error(String(e).includes("no sound") ? "That page doesn't have a sound Mustela can find. Try the direct link to the MP3." : "Couldn't download that sound."); }
  } else {
    // Browsers only allow this when the site permits it (most soundboard sites don't).
    const r = await fetch(url).catch(() => null);
    if (!r?.ok || !/audio|video|octet/.test(r.headers.get("content-type") ?? "")) throw new Error("This site doesn't let browsers download its sounds. Use the desktop app, or download the file and add it.");
    bytes = await r.arrayBuffer();
  }
  const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "sound").replace(/[-_]+/g, " ").replace(/\.[a-z0-9]+$/i, "").slice(0, 32) || "sound";
  return new File([bytes], name, { type: "audio/mpeg" });
}

const DB = "mustela-sounds", STORE = "sounds";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const listSounds = async () => ((await tx<Sound[]>("readonly", (s) => s.getAll() as IDBRequest<Sound[]>)) ?? []).sort((a, b) => a.createdAt - b.createdAt);
export const saveSound = (s: Sound) => tx("readwrite", (st) => st.put(s));
export const deleteSound = (id: string) => tx("readwrite", (st) => st.delete(id));

/** Encodes a slice of decoded audio as 16-bit PCM WAV (mono or stereo, original sample rate). */
export function encodeWav(buf: AudioBuffer, start: number, end: number): ArrayBuffer {
  const rate = buf.sampleRate;
  const from = Math.max(0, Math.floor(start * rate));
  const to = Math.min(buf.length, Math.floor(Math.min(end, start + MAX_SECONDS) * rate));
  const frames = Math.max(0, to - from);
  const ch = Math.min(2, buf.numberOfChannels);
  const out = new ArrayBuffer(44 + frames * ch * 2);
  const v = new DataView(out);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + frames * ch * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, frames * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = from; i < to; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, data[c]![i]!));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  }
  return out;
}

/** Peak levels for drawing a waveform: `bins` values in 0..1. */
export function peaks(buf: AudioBuffer, bins: number): number[] {
  const d = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / bins));
  const out: number[] = [];
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = b * step, end = Math.min(d.length, i + step); i < end; i += 4) m = Math.max(m, Math.abs(d[i]!));
    out.push(m);
  }
  return out;
}
