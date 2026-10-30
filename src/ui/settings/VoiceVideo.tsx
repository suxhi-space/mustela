import { createResource, createSignal, onCleanup, Show } from "solid-js";
import type { VoicePrefs } from "../../lib/backend/types";
import { inTauri } from "../../lib/platform";
import { listSounds } from "../../lib/sounds";
import { applyVoicePrefs, overlayAllowed, requestOverlay } from "../call/state";
import { Group, Row, Seg, Select, Slider, Switch } from "../controls";
import { backend, device, platform, updateDevice } from "../store";
import { QUALITIES, qualityHint } from "../call/ScreenPicker";

async function devices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const pick = (k: MediaDeviceKind) => all.filter((d) => d.kind === k && d.deviceId !== "default" && d.deviceId !== "communications");
    return { input: pick("audioinput"), output: pick("audiooutput"), video: pick("videoinput") };
  } catch { return { input: [], output: [], video: [] }; }
}

/** Live microphone level in dB, for the sensitivity slider. */
function createMicTest() {
  const [db, setDb] = createSignal(-100);
  const [on, setOn] = createSignal(false);
  const [err, setErr] = createSignal("");
  let stop = () => {};
  async function start() {
    stop();
    const v = device().voice;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: v.inputDevice || undefined, echoCancellation: v.echoCancellation, noiseSuppression: v.noiseSuppression, autoGainControl: v.autoGain } });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      const src = ctx.createMediaStreamSource(stream); src.connect(an);
      // Hear yourself back, quietly, so you can judge the processing.
      const loop = ctx.createGain(); loop.gain.value = 0.6; src.connect(loop); loop.connect(ctx.destination);
      const buf = new Float32Array(an.fftSize);
      let raf = 0;
      const tick = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; setDb(Math.max(-100, 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-8))); raf = requestAnimationFrame(tick); };
      tick();
      setOn(true); setErr("");
      stop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); void ctx.close(); setOn(false); setDb(-100); stop = () => {}; };
    } catch { setErr("Couldn't open the microphone. Allow Mustela to use it in your system's privacy settings."); }
  }
  onCleanup(() => stop());
  return { db, on, err, start, stop: () => stop() };
}

/** Stoat's "Voice & Video" plus Mustela's soundboard and input sensitivity. */
export function VoiceVideo() {
  const [list, { refetch }] = createResource(devices);
  const [sounds] = createResource(listSounds);
  const v = () => device().voice;
  const set = (p: Partial<VoicePrefs>) => { updateDevice({ voice: { ...v(), ...p } }); applyVoicePrefs(); };
  const mic = createMicTest();
  const [cam, setCam] = createSignal<MediaStream | null>(null);
  onCleanup(() => cam()?.getTracks().forEach((t) => t.stop()));
  const toggleCam = async () => {
    if (cam()) { cam()!.getTracks().forEach((t) => t.stop()); setCam(null); return; }
    try { setCam(await navigator.mediaDevices.getUserMedia({ video: { deviceId: v().videoDevice || undefined } })); void refetch(); } catch { /* no camera */ }
  };
  const opts = (l: MediaDeviceInfo[] | undefined, what: string) => [{ v: "", label: "System default" }, ...(l ?? []).map((d, i) => ({ v: d.deviceId, label: d.label || `${what} ${i + 1}` }))];
  /** Threshold as a share of the meter, -100 dB → 0%, 0 dB → 100% */
  const pct = (db: number) => `${Math.max(0, Math.min(100, db + 100))}%`;

  return (
    <div class="page">
      <Group title="Microphone">
        <Row icon="mic" label="Input device"><Select label="Input device" value={v().inputDevice} options={opts(list()?.input, "Microphone")} onChange={(inputDevice) => { set({ inputDevice }); if (mic.on()) void mic.start(); }} /></Row>
        <Row label="Mic test" hint={mic.err() || (mic.on() ? "Talk normally. You'll hear yourself back." : "Check your level and processing.")}>
          <button class="btn small" classList={{ on: mic.on() }} onClick={() => (mic.on() ? mic.stop() : void mic.start().then(refetch))}>{mic.on() ? "Stop" : "Let's check"}</button>
        </Row>
        <div class="row col">
          <div class="sens-head"><span>Input sensitivity</span><span class="grow" />
            <label class="inline-switch">Decide for me <Switch label="Decide sensitivity automatically" on={v().autoSensitivity} onChange={(autoSensitivity) => set({ autoSensitivity })} /></label>
          </div>
          <div class="meter" classList={{ manual: !v().autoSensitivity }} aria-hidden="true">
            <div class="meter-fill" classList={{ open: !v().autoSensitivity && mic.db() > v().threshold }} style={{ width: pct(mic.db()) }} />
            <Show when={!v().autoSensitivity}><div class="meter-mark" style={{ left: pct(v().threshold) }} /></Show>
          </div>
          <Show when={!v().autoSensitivity}>
            <input class="sens-range" type="range" min={-100} max={0} value={v().threshold} aria-label="Sensitivity threshold" onInput={(e) => set({ threshold: +e.currentTarget.value })} />
            <small class="muted">Your mic only sends sound louder than the marker ({v().threshold} dB). The bar turns green when it would.</small>
          </Show>
        </div>
        <Row label="Join calls muted"><Switch label="Join calls muted" on={v().joinMuted} onChange={(joinMuted) => set({ joinMuted })} /></Row>
      </Group>

      <Group title="Voice processing" hint="Changes apply the next time your microphone turns on.">
        <Row label="Echo cancellation"><Switch label="Echo cancellation" on={v().echoCancellation} onChange={(echoCancellation) => set({ echoCancellation })} /></Row>
        <Row label="Noise suppression" hint="Cuts steady background noise like fans"><Switch label="Noise suppression" on={v().noiseSuppression} onChange={(noiseSuppression) => set({ noiseSuppression })} /></Row>
        <Row label="Automatic gain" hint="Evens out your volume"><Switch label="Automatic gain" on={v().autoGain} onChange={(autoGain) => set({ autoGain })} /></Row>
      </Group>

      <Group title="Output">
        <Show when={list()?.output.length} fallback={<Row icon="headphones" label="Output device" hint="This system picks the output device itself." />}>
          <Row icon="headphones" label="Output device"><Select label="Output device" value={v().outputDevice} options={opts(list()?.output, "Speaker")} onChange={(outputDevice) => set({ outputDevice })} /></Row>
        </Show>
        <Row label="Call volume"><Slider label="Call volume" min={0} max={200} value={v().outputVolume} suffix="%" onChange={(outputVolume) => set({ outputVolume })} /></Row>
      </Group>

      <Group title="Video">
        <Row icon="video" label="Camera"><Select label="Camera" value={v().videoDevice} options={opts(list()?.video, "Camera")} onChange={(videoDevice) => { set({ videoDevice }); if (cam()) { void toggleCam().then(toggleCam); } }} /></Row>
        <Row label="Preview"><button class="btn small" classList={{ on: !!cam() }} onClick={() => void toggleCam()}>{cam() ? "Stop preview" : "Test camera"}</button></Row>
        <Show when={cam()}>{(s) => <video class="cam-preview" autoplay muted playsinline ref={(el) => { el.srcObject = s(); }} />}</Show>
        <Row icon="screen" label="Screen share quality" hint={qualityHint()}>
          <Seg label="Screen share quality" value={v().screenQuality} onChange={(screenQuality) => set({ screenQuality })}
            options={QUALITIES.map((o) => ({ ...o, disabled: !(backend()?.screenQualities() ?? ["720p30"]).includes(o.v) }))} />
        </Row>
      </Group>

      <Group title="Soundboard" hint="Sounds live on this device. Add them from the soundboard button in a call.">
        <Row icon="music" label="Soundboard volume"><Slider label="Soundboard volume" min={0} max={100} value={v().soundboardVolume} suffix="%" onChange={(soundboardVolume) => set({ soundboardVolume })} /></Row>
        <Row label="Entry sound" hint="Plays for everyone when you join a call">
          <Select label="Entry sound" value={v().entrySound} onChange={(entrySound) => set({ entrySound })}
            options={[{ v: "", label: "None" }, ...(sounds() ?? []).map((s) => ({ v: s.id, label: `${s.emoji} ${s.name}` }))]} />
        </Row>
      </Group>

      <Show when={platform === "android" && inTauri()}>
        <Group title="Android" hint="Background calls keep going when you leave the app, but are voice only. The web engine adds camera and screen share. In a call, the volume keys set call volume.">
          <Row label="Call engine"><Seg label="Call engine" value={device().callEngine} onChange={(callEngine) => updateDevice({ callEngine })}
            options={[{ v: "native", label: "Background (voice)" }, { v: "web", label: "Web (video)" }]} /></Row>
          <Row label="When you leave the app in a call" hint={overlayAllowed() ? "The bubble floats over other apps: tap it to come back, hold it to mute." : "The bubble needs \"Display over other apps\". Without it, the call floats in picture-in-picture."}>
            <Show when={overlayAllowed()} fallback={<button class="btn small" onClick={() => void requestOverlay()}>Allow the bubble</button>}>
              <Seg label="When you leave the app in a call" value={device().callOverlay} onChange={(callOverlay) => updateDevice({ callOverlay })}
                options={[{ v: "bubble", label: "Bubble" }, { v: "pip", label: "Picture-in-picture" }]} />
            </Show>
          </Row>
        </Group>
      </Show>
    </div>
  );
}
