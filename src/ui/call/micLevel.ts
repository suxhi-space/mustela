import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { device } from "../store";

/** Loudness of an analyser's current window, in dB (-100 = silence). */
export const levelOf = (an: AnalyserNode, buf: Float32Array<ArrayBuffer>) => {
  an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x;
  return Math.max(-100, 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-8));
};

/**
 * Your mic level, live (the Voice page slider and the mic menu), like Discord's: nothing is played back and a call isn't touched.
 * Only when the microphone is already allowed, so opening Settings or a menu never asks for it by itself.
 */
export function createLiveLevel(run: () => boolean) {
  const [db, setDb] = createSignal(-100);
  const [allowed, setAllowed] = createSignal(false);
  void (async () => {
    try {
      const st = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (!st) return;
      setAllowed(st.state === "granted");
      st.onchange = () => setAllowed(st.state === "granted");
    } catch { /* this system can't say; the mic test still shows it */ }
  })();
  createEffect(on(() => [run() && allowed(), device().voice.inputDevice, device().voice.noiseSuppression, device().voice.autoGain] as const, ([go]) => {
    if (!go) return;
    let live = true, raf = 0, stream: MediaStream | null = null, ctx: AudioContext | null = null;
    const v = device().voice;
    void navigator.mediaDevices.getUserMedia({ audio: { deviceId: v.inputDevice || undefined, echoCancellation: v.echoCancellation, noiseSuppression: v.noiseSuppression, autoGainControl: v.autoGain } }).then((s) => {
      if (!live) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const tick = () => { setDb(levelOf(an, buf)); raf = requestAnimationFrame(tick); };
      tick();
    }, () => setAllowed(false));
    onCleanup(() => { live = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx?.close(); setDb(-100); });
  }));
  return { db, on: () => run() && allowed() };
}
