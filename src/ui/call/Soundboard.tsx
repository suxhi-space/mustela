import { createEffect, createResource, createRoot, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { useBack } from "../back";
import { deleteSound, encodeWav, fetchSound, listSounds, MAX_SECONDS, peaks, saveSound, type Sound } from "../../lib/sounds";
import { backend, ext, settings, updateExt, updateSettings } from "../store";
import { Icon } from "../icons";
import { call, playSoundInCall } from "./state";
import { openSettings } from "../nav";
import { TextWithEmoji } from "../chat/Markdown";
import { openEmojiPicker } from "../chat/overlays";

/* One soundboard popover, anchored to whatever opened it, in that window (the main one or the call pop-out). */
const [anchor, setAnchor] = createSignal<{ x: number; y: number; doc: Document } | null>(null);
export const openSoundboard = (el: Element) => { const r = el.getBoundingClientRect(); setAnchor({ x: r.left + r.width / 2, y: r.top, doc: el.ownerDocument }); };

let previewCtx: AudioContext | undefined;
/** Hear a sound yourself only, never in the call. */
export async function preview(data: ArrayBuffer, volume: number) {
  previewCtx ??= new AudioContext();
  const buf = await previewCtx.decodeAudioData(data.slice(0));
  const src = previewCtx.createBufferSource();
  const g = previewCtx.createGain();
  g.gain.value = volume;
  src.buffer = buf; src.connect(g); g.connect(previewCtx.destination); src.start();
}

/** Pick start/end (at most 10 s) on a waveform, hear it, name it, save it. */
export function Trimmer(props: { file: File; source?: string; onDone(): void }) {
  const [buf] = createResource(async () => {
    previewCtx ??= new AudioContext();
    return previewCtx.decodeAudioData(await props.file.arrayBuffer());
  });
  const [start, setStart] = createSignal(0);
  const [end, setEnd] = createSignal(MAX_SECONDS);
  const [name, setName] = createSignal(props.file.name.replace(/\.[^.]+$/, "").slice(0, 32));
  const [emoji, setEmoji] = createSignal("🔊");
  const [err, setErr] = createSignal("");
  let canvas!: HTMLCanvasElement;
  const inPopout = () => !!canvas && canvas.ownerDocument !== document;

  const dur = () => buf()?.duration ?? 0;
  const clampEnd = (s: number, e: number) => Math.min(dur(), Math.max(s + 0.1, Math.min(e, s + MAX_SECONDS)));
  const draw = () => {
    const b = buf(); if (!b || !canvas) return;
    const W = canvas.width = canvas.clientWidth * devicePixelRatio, H = canvas.height = 64 * devicePixelRatio;
    const ctx = canvas.getContext("2d")!;
    const p = peaks(b, 160);
    const css = getComputedStyle(canvas);
    ctx.clearRect(0, 0, W, H);
    p.forEach((v, i) => {
      const x = (i / p.length) * W, t = (i / p.length) * dur();
      ctx.fillStyle = t >= start() && t <= end() ? css.getPropertyValue("--pri") || "#3cf" : "rgba(128,128,128,.45)";
      const h = Math.max(2, v * H);
      ctx.fillRect(x, (H - h) / 2, Math.max(1, W / p.length - 1), h);
    });
  };
  createEffect(on(buf, (b) => { if (b) { setEnd(clampEnd(0, MAX_SECONDS)); queueMicrotask(draw); } }));

  async function save() {
    const b = buf(); if (!b) return;
    try {
      const data = encodeWav(b, start(), end());
      const id = crypto.randomUUID(), nm = name().trim() || "Sound";
      await saveSound({ id, name: nm, emoji: emoji(), data, seconds: Math.min(MAX_SECONDS, end() - start()), volume: 0.8, createdAt: Date.now(), source: props.source, start: start(), end: end() });
      // Sounds from links sync: your other devices fetch the same link and trim it the same way.
      if (props.source) updateSettings((s) => ({ ...s, sounds: [...s.sounds, { id, name: nm, emoji: emoji(), url: props.source!, start: start(), end: end(), volume: 0.8 }] }));
      props.onDone();
    } catch { setErr("Couldn't save that sound."); }
  }

  return (
    <div class="trimmer">
      <Show when={!buf.error} fallback={<p class="err">That file isn't audio Mustela can read. Try MP3, WAV, OGG or M4A.</p>}>
        <Show when={buf()} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
          <canvas ref={canvas} class="wave" aria-hidden="true" />
          <div class="trim-row">
            <label>Start <input type="range" min={0} max={dur()} step={0.05} value={start()} onInput={(e) => { const s = +e.currentTarget.value; setStart(s); setEnd(clampEnd(s, Math.max(end(), s + 0.1))); draw(); }} /></label>
            <label>End <input type="range" min={0} max={dur()} step={0.05} value={end()} onInput={(e) => { setEnd(clampEnd(start(), +e.currentTarget.value)); draw(); }} /></label>
          </div>
          <p class="small muted">{start().toFixed(1)}s to {end().toFixed(1)}s ({(end() - start()).toFixed(1)}s of {MAX_SECONDS}s max)</p>
          <div class="trim-row">
            {/* The emoji picker (server emoji included) lives in the main window; the call pop-out types one instead. */}
            <Show when={!inPopout()} fallback={<input class="text-input emoji-in" value={emoji()} maxLength={4} onInput={(e) => setEmoji(e.currentTarget.value)} aria-label="Emoji" />}>
              <button class="emoji-btn sb-pick" aria-label="Pick an emoji" title="Pick an emoji" onClick={(e) => openEmojiPicker(e.currentTarget, (p) => setEmoji(p.text))}><SoundEmoji v={emoji()} /></button>
            </Show>
            <input class="text-input" value={name()} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} aria-label="Sound name" placeholder="Name" />
          </div>
          <Show when={err()}><p class="err">{err()}</p></Show>
          <div class="dialog-actions">
            <button class="btn small" onClick={() => void preview(encodeWav(buf()!, start(), end()), 0.8)}><Icon name="music" size={15} />Preview</button>
            <button class="btn small" onClick={props.onDone}>Cancel</button>
            <button class="btn small primary" onClick={() => void save()}>Save sound</button>
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * Your sounds, with names, emoji and volume from your synced settings where a sound came from a link (so a
 * rename on one device shows on the others).
 */
export async function loadSounds(): Promise<Sound[]> {
  const local = await listSounds();
  const linked = new Map(settings().sounds.map((x) => [x.id, x]));
  return local.map((l) => { const x = linked.get(l.id); return x ? { ...l, name: x.name, emoji: x.emoji, volume: x.volume } : l; });
}

/** Rename a sound, change its emoji or volume: saved here, and synced when it came from a link. */
export async function editSound(snd: Sound, p: Partial<Pick<Sound, "name" | "emoji" | "volume">>) {
  const next = { ...snd, ...p };
  await saveSound(next);
  if (settings().sounds.some((x) => x.id === snd.id)) updateSettings((st) => ({ ...st, sounds: st.sounds.map((x) => (x.id === snd.id ? { ...x, name: next.name, emoji: next.emoji, volume: next.volume } : x)) }));
  return next;
}

export async function removeSound(snd: Sound) {
  await deleteSound(snd.id);
  if (settings().sounds.some((x) => x.id === snd.id)) updateSettings((st) => ({ ...st, sounds: st.sounds.filter((x) => x.id !== snd.id) }));
  if (ext().favSounds.includes(snd.id)) updateExt((x) => ({ ...x, favSounds: x.favSounds.filter((k) => k !== snd.id) }));
}

/**
 * Put the sounds in this order (the board lists them by when they were added, so they take on the same times in the
 * new order). Sounds from links keep the new order on every device.
 */
export async function orderSounds(next: Sound[]) {
  const times = next.map((x) => x.createdAt).sort((a, b) => a - b);
  for (const [i, x] of next.entries()) if (x.createdAt !== times[i]) await saveSound({ ...x, createdAt: times[i]! });
  const rank = new Map(next.map((x, i) => [x.id, i]));
  updateSettings((st) => ({ ...st, sounds: [...st.sounds].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)) }));
}

export const toggleFavSound = (id: string) => updateExt((x) => ({ ...x, favSounds: x.favSounds.includes(id) ? x.favSounds.filter((k) => k !== id) : [...x.favSounds, id] }));

/** Bumped when sounds arrive from your other devices, so open soundboards and settings show them. */
export const [soundsVersion, setSoundsVersion] = createSignal(0);
let syncing: Promise<void> | null = null;
/** Bring down sounds your other devices added (from links), now rather than when the soundboard opens. */
export function syncSounds() {
  syncing ??= (async () => {
    try { if (await bringDown(await listSounds(), () => {})) setSoundsVersion((n) => n + 1); }
    catch { /* offline: next time */ }
    finally { syncing = null; }
  })();
  return syncing;
}
/** At start-up, and whenever your synced sound list changes (another device added one). Call once. */
let soundSyncStarted = false;
export function startSoundSync() {
  if (soundSyncStarted) return;
  soundSyncStarted = true;
  createRoot(() => createEffect(on(() => settings().sounds.map((x) => x.id).join(","), () => void syncSounds())));
}

/** Sounds added from a link on another device and not here yet: fetch and trim them the same way. */
async function bringDown(local: Sound[], progress: (left: number) => void) {
  const missing = settings().sounds.filter((x) => !local.some((l) => l.id === x.id));
  if (!missing.length) return false;
  progress(missing.length);
  for (const m of missing) {
    try {
      const f = await fetchSound(m.url);
      previewCtx ??= new AudioContext();
      const buf = await previewCtx.decodeAudioData(await f.arrayBuffer());
      await saveSound({ id: m.id, name: m.name, emoji: m.emoji, data: encodeWav(buf, m.start, m.end), seconds: Math.min(MAX_SECONDS, m.end - m.start), volume: m.volume, createdAt: Date.now(), source: m.url, start: m.start, end: m.end });
    } catch { /* that link is gone; it stays listed in settings so another device can try */ }
    progress(missing.length - 1 - missing.indexOf(m));
  }
  return true;
}

/** A sound's emoji: a standard one, or a server's custom emoji (":id:" from the emoji picker). */
export function SoundEmoji(props: { v: string }) {
  const custom = () => /^:([0-9A-HJKMNP-TV-Z]{26}):$/.exec(props.v)?.[1];
  return <Show when={custom()} fallback={<TextWithEmoji v={props.v} />}>{(id) => <img class="cemoji" src={backend()?.emojiUrl(id())} alt="" />}</Show>;
}

/** One sound on the board: click to play it into the call; point at it for preview (just you) and the star. */
function SoundTile(props: { s: Sound; play(s: Sound): void }) {
  const fav = () => ext().favSounds.includes(props.s.id);
  return (
    <div class="sb-item" classList={{ fav: fav() }}>
      <button class="sb-sound" onClick={() => props.play(props.s)} title={`${props.s.name} (${props.s.seconds.toFixed(1)}s)`}>
        <span class="sb-emoji"><SoundEmoji v={props.s.emoji} /></span><span class="sb-name">{props.s.name}</span>
      </button>
      <button class="sb-mini sb-hear" aria-label={`Preview ${props.s.name} (only you hear it)`} title="Preview (only you hear it)" onClick={() => void preview(props.s.data, props.s.volume)}><Icon name="volume" size={13} /></button>
      <button class="sb-mini sb-star" classList={{ on: fav() }} aria-pressed={fav()} aria-label={fav() ? `Unfavorite ${props.s.name}` : `Favorite ${props.s.name}`} onClick={() => toggleFavSound(props.s.id)}><Icon name="star" size={13} /></button>
    </div>
  );
}

/** `win`: draw it in this window (the call pop-out); the main window by default. */
export function Soundboard(props: { win?: Window }) {
  const w = () => props.win ?? window;
  return (
    <Show when={anchor()?.doc === w().document ? anchor() : null}>{(a) => {
      const { innerWidth, innerHeight } = w();
      useBack(() => setAnchor(null));
      const [sounds, { refetch }] = createResource(soundsVersion, loadSounds);
      const [adding, setAdding] = createSignal<{ file: File; source?: string } | null>(null);
      const [linkMode, setLinkMode] = createSignal(false);
      const [link, setLink] = createSignal("");
      const [linkErr, setLinkErr] = createSignal("");
      const [fetching, setFetching] = createSignal(false);
      const [syncing, setSyncing] = createSignal(0);
      const [q, setQ] = createSignal("");
      createEffect(on(sounds, async (local) => { if (local && await bringDown(local, setSyncing)) void refetch(); }, { defer: false }));
      async function getLink() {
        setFetching(true); setLinkErr("");
        try { const f = await fetchSound(link().trim()); setAdding({ file: f, source: link().trim() }); setLinkMode(false); setLink(""); }
        catch (e) { setLinkErr(e instanceof Error ? e.message : "Couldn't download that sound."); }
        finally { setFetching(false); }
      }
      let input!: HTMLInputElement, search!: HTMLInputElement;
      const close = () => setAnchor(null);
      const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
      onMount(() => { w().addEventListener("keydown", esc); if (!matchMedia("(pointer: coarse)").matches) search?.focus(); });
      onCleanup(() => w().removeEventListener("keydown", esc));
      const W = Math.min(420, innerWidth - 16);
      const play = (s: Sound) => (call.active() ? void playSoundInCall(s.data, s.volume) : void preview(s.data, s.volume));
      const shown = () => { const t = q().trim().toLowerCase(); return (sounds() ?? []).filter((s) => !t || s.name.toLowerCase().includes(t) || s.emoji.includes(t)); };
      const favs = () => { const f = ext().favSounds; return shown().filter((s) => f.includes(s.id)).sort((x, y) => f.indexOf(x.id) - f.indexOf(y.id)); };
      return (
        <div class="pop-scrim" onClick={close}>
          <div class="soundboard panel" role="dialog" aria-label="Soundboard" onClick={(e) => e.stopPropagation()}
            style={{ width: `${W}px`, left: `${Math.max(8, Math.min(a().x - W / 2, innerWidth - W - 8))}px`, ...(a().y > innerHeight / 2 ? { bottom: `${Math.max(8, innerHeight - a().y + 10)}px`, "max-height": `${a().y - 18}px` } : { top: `${a().y + 50}px`, "max-height": `${innerHeight - a().y - 60}px` }) }}>
            <Show when={adding()} fallback={
              <>
                <div class="sb-search">
                  <Icon name="search" size={15} />
                  <input ref={search} type="search" placeholder="Search sounds" value={q()} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Search sounds" />
                  <button class="icon-btn" classList={{ on: linkMode() }} aria-label="Add a sound from a link" title="Add from a link" onClick={() => setLinkMode(!linkMode())}><Icon name="link" size={16} /></button>
                  <button class="icon-btn" aria-label="Add a sound from a file" title="Add from a file" onClick={() => input.click()}><Icon name="plus" size={16} /></button>
                  <button class="icon-btn" aria-label="Soundboard settings" title="Soundboard settings" onClick={() => { close(); openSettings("soundboard"); }}><Icon name="gear" size={16} /></button>
                </div>
                <Show when={linkMode()}>
                  <form class="sb-link" onSubmit={(e) => { e.preventDefault(); if (link().trim()) void getLink(); }}>
                    <input class="text-input" type="url" placeholder="https://www.myinstants.com/…" value={link()} onInput={(e) => { setLink(e.currentTarget.value); setLinkErr(""); }} aria-label="Sound link" autofocus />
                    <button class="btn small primary" disabled={fetching() || !link().trim()}>{fetching() ? "Getting…" : "Get sound"}</button>
                  </form>
                  <p class="small muted sb-note">{linkErr() || "Paste a page from MyInstants, Soundboard Buttons or Sound Buttons World, or a direct audio link. Sounds from links show up on your other devices too."}</p>
                </Show>
                <div class="sb-scroll">
                  <Show when={!call.active() || syncing()}>
                    <p class="small muted sb-note">{!call.active() ? "Join a call to play these for everyone. For now they only play for you." : ""}{syncing() ? ` Getting ${syncing()} sound${syncing() > 1 ? "s" : ""} from your other devices…` : ""}</p>
                  </Show>
                  <Show when={favs().length}>
                    <h4 class="sb-sec"><Icon name="star" size={13} />Favorites</h4>
                    <div class="sb-grid"><For each={favs()}>{(s) => <SoundTile s={s} play={play} />}</For></div>
                  </Show>
                  <h4 class="sb-sec"><Icon name="music" size={13} />Your sounds</h4>
                  <div class="sb-grid">
                    <For each={shown()} fallback={<p class="small muted sb-empty">{q().trim() ? "No sounds match that." : sounds() ? "No sounds yet. Add one from a file or a link with the buttons up top." : ""}</p>}>{(s) => <SoundTile s={s} play={play} />}</For>
                  </div>
                </div>
                <input ref={input} type="file" accept="audio/*,video/*" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (f) setAdding({ file: f }); }} />
              </>
            }>
              {(f) => <Trimmer file={f().file} source={f().source} onDone={() => { setAdding(null); void refetch(); }} />}
            </Show>
          </div>
        </div>
      );
    }}</Show>
  );
}
