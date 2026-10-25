import { createEffect, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { deleteSound, encodeWav, fetchSound, listSounds, MAX_SECONDS, peaks, saveSound, type Sound } from "../../lib/sounds";
import { settings, updateSettings } from "../store";
import { Icon } from "../icons";
import { call, playSoundInCall } from "./state";

/* One soundboard popover for the window, anchored to whatever opened it. */
const [anchor, setAnchor] = createSignal<{ x: number; y: number } | null>(null);
export const openSoundboard = (el: Element) => { const r = el.getBoundingClientRect(); setAnchor({ x: r.left + r.width / 2, y: r.top }); };

let previewCtx: AudioContext | undefined;
async function preview(data: ArrayBuffer, volume: number) {
  previewCtx ??= new AudioContext();
  const buf = await previewCtx.decodeAudioData(data.slice(0));
  const src = previewCtx.createBufferSource();
  const g = previewCtx.createGain();
  g.gain.value = volume;
  src.buffer = buf; src.connect(g); g.connect(previewCtx.destination); src.start();
}

/** Pick start/end (at most 10 s) on a waveform, hear it, name it, save it. */
function Trimmer(props: { file: File; source?: string; onDone(): void }) {
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
            <input class="text-input emoji-in" value={emoji()} maxLength={4} onInput={(e) => setEmoji(e.currentTarget.value)} aria-label="Emoji" />
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

export function Soundboard() {
  return (
    <Show when={anchor()}>{(a) => {
      const [sounds, { refetch }] = createResource(listSounds);
      const [adding, setAdding] = createSignal<{ file: File; source?: string } | null>(null);
      const [linkMode, setLinkMode] = createSignal(false);
      const [link, setLink] = createSignal("");
      const [linkErr, setLinkErr] = createSignal("");
      const [fetching, setFetching] = createSignal(false);
      const [syncing, setSyncing] = createSignal(0);
      // Bring down sounds added from links on your other devices.
      createEffect(on(sounds, async (local) => {
        if (!local) return;
        const missing = settings().sounds.filter((x) => !local.some((l) => l.id === x.id));
        if (!missing.length) return;
        setSyncing(missing.length);
        for (const m of missing) {
          try {
            const f = await fetchSound(m.url);
            previewCtx ??= new AudioContext();
            const buf = await previewCtx.decodeAudioData(await f.arrayBuffer());
            await saveSound({ id: m.id, name: m.name, emoji: m.emoji, data: encodeWav(buf, m.start, m.end), seconds: Math.min(MAX_SECONDS, m.end - m.start), volume: m.volume, createdAt: Date.now(), source: m.url, start: m.start, end: m.end });
          } catch { /* that link is gone; it stays listed in settings so another device can try */ }
          setSyncing((n) => n - 1);
        }
        void refetch();
      }, { defer: false }));
      async function getLink() {
        setFetching(true); setLinkErr("");
        try { const f = await fetchSound(link().trim()); setAdding({ file: f, source: link().trim() }); setLinkMode(false); setLink(""); }
        catch (e) { setLinkErr(e instanceof Error ? e.message : "Couldn't download that sound."); }
        finally { setFetching(false); }
      }
      const remove = async (snd: Sound) => {
        await deleteSound(snd.id);
        if (settings().sounds.some((x) => x.id === snd.id)) updateSettings((st) => ({ ...st, sounds: st.sounds.filter((x) => x.id !== snd.id) }));
        void refetch();
      };
      const [editing, setEditing] = createSignal(false);
      let input!: HTMLInputElement;
      const close = () => setAnchor(null);
      const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
      onMount(() => addEventListener("keydown", esc));
      onCleanup(() => removeEventListener("keydown", esc));
      const W = 340;
      const play = (s: Sound) => (call.active() ? void playSoundInCall(s.data, s.volume) : void preview(s.data, s.volume));
      return (
        <div class="pop-scrim" onClick={close}>
          <div class="soundboard panel" role="dialog" aria-label="Soundboard" onClick={(e) => e.stopPropagation()}
            style={{ width: `${W}px`, left: `${Math.max(8, Math.min(a().x - W / 2, innerWidth - W - 8))}px`, ...(a().y > innerHeight / 2 ? { bottom: `${Math.max(8, innerHeight - a().y + 10)}px`, "max-height": `${a().y - 18}px` } : { top: `${a().y + 50}px`, "max-height": `${innerHeight - a().y - 60}px` }) }}>
            <header class="sb-head">
              <h3 class="label">Soundboard</h3>
              <span class="grow" />
              <Show when={sounds()?.length}><button class="link small" onClick={() => setEditing(!editing())}>{editing() ? "Done" : "Edit"}</button></Show>
            </header>
            <Show when={adding()} fallback={
              <>
                <p class="small muted sb-note">{call.active() ? "Everyone in the call hears these." : "Join a call to play these for everyone. For now they only play for you."}{syncing() ? ` Getting ${syncing()} sound${syncing() > 1 ? "s" : ""} from your other devices…` : ""}</p>
                <div class="sb-grid">
                  <For each={sounds()}>{(s) => (
                    <div class="sb-item">
                      <button class="sb-sound" onClick={() => play(s)} title={`${s.name} (${s.seconds.toFixed(1)}s)`}>
                        <span class="sb-emoji">{s.emoji}</span><span class="sb-name">{s.name}</span>
                      </button>
                      <Show when={editing()}>
                        <button class="sb-del" aria-label={`Delete ${s.name}`} onClick={() => void remove(s)}><Icon name="close" size={12} /></button>
                      </Show>
                    </div>
                  )}</For>
                  <button class="sb-sound add" onClick={() => input.click()}><Icon name="file" size={18} /><span class="sb-name">From a file</span></button>
                  <button class="sb-sound add" classList={{ on: linkMode() }} onClick={() => setLinkMode(!linkMode())}><Icon name="link" size={18} /><span class="sb-name">From a link</span></button>
                </div>
                <Show when={linkMode()}>
                  <form class="sb-link" onSubmit={(e) => { e.preventDefault(); if (link().trim()) void getLink(); }}>
                    <input class="text-input" type="url" placeholder="https://www.myinstants.com/…" value={link()} onInput={(e) => { setLink(e.currentTarget.value); setLinkErr(""); }} aria-label="Sound link" autofocus />
                    <button class="btn small primary" disabled={fetching() || !link().trim()}>{fetching() ? "Getting…" : "Get sound"}</button>
                  </form>
                  <p class="small muted sb-note">{linkErr() || "Paste a page from MyInstants, Soundboard Buttons or Sound Buttons World, or a direct audio link. Sounds from links show up on your other devices too."}</p>
                </Show>
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
