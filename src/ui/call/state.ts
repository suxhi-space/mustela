import { createEffect, createMemo, createRoot, createSignal, on as whenChanged } from "solid-js";
import type { ChannelInfo, VoiceHandle, VoiceMember } from "../../lib/backend/types";
import { inTauri } from "../../lib/platform";
import { playSfx } from "../../lib/sfx";
import { backend, device, platform, ext, updateDevice } from "../store";
import { pickScreen } from "./ScreenPicker";
import { openMenu } from "../menu";

/**
 * The one call this window is in. It lives here, not in a component, so the
 * call keeps going when you switch channels.
 *
 * The pop-out window (like Discord's) only shows the call: this window keeps it
 * and draws into the pop-out (see popout.tsx), so popping out and back in never
 * reconnects.
 */
const [handle, setHandle] = createSignal<VoiceHandle | null>(null);
const [channel, setChannel] = createSignal<ChannelInfo | null>(null);
const [on, setOn] = createSignal({ mic: false, cam: false, screen: false, deaf: false });
const [tick, setTick] = createSignal(0);
const [busy, setBusy] = createSignal(false);
const [err, setErr] = createSignal("");
/** The call is showing in the pop-out window right now. */
const [popped, setPopped] = createSignal(false);
export { setPopped };
/** Floating reactions: { id, from, emoji } that fade out on their own. */
const [reactions, setReactions] = createSignal<{ key: number; from: string; emoji: string }[]>([]);

export const call = {
  channel, busy, error: err, popped, on, reactions,
  active: () => handle() !== null,
  handle,
  // Someone switching devices drops out for a moment and comes straight back: they're held in the list meanwhile
  // (see attach), so their tile doesn't blink out and back.
  people: createMemo<VoiceMember[]>(() => {
    tick();
    const now = handle()?.participants() ?? [];
    const held = [...switching.values()].filter((m) => !now.some((p) => p.id === m.id));
    return held.length ? [...now, ...held] : now;
  }),
  speaking: createMemo<string[]>(() => (tick(), handle()?.speaking() ?? [])),
  streams: createMemo(() => (tick(), handle()?.streams?.() ?? [])),
  /** Streams you were watching that ended, until you close them */
  ended: createMemo(() => (tick(), handle()?.ended?.() ?? [])),
  /** People playing a soundboard sound right now: their ring takes another colour */
  soundboard: createMemo<string[]>(() => (tick(), handle()?.soundboard?.() ?? [])),
  canPopOut: () => platform !== "android" && !matchMedia("(pointer: coarse)").matches,
  /** Bumps whenever anything in the call changes (tracks, volumes…) */
  tick,
};
const OFF = { mic: false, cam: false, screen: false, deaf: false };

/** Your screen share quality, held to what Stoat allows this account (see ScreenPicker). */
const allowedQuality = () => {
  const ok = backend()?.screenQualities() ?? ["720p30"], want = device().voice.screenQuality;
  return ok.includes(want) ? want : ok[ok.length - 1]!;
};

/** Desktop apps capture the screen themselves (see src-tauri/src/screen.rs). */
const desktopCapture = () => inTauri() && (platform === "windows" || platform === "mac" || platform === "linux");

/**
 * The call runs outside the page: only on Linux whose WebKitGTK has no WebRTC (the call runs in Rust).
 * Android always runs the call in the page (camera, screen share and streams work there); a service keeps it going.
 */
const useNative = () => inTauri() && platform === "linux" && !("RTCPeerConnection" in globalThis);

/** `rejoin`: Mustela picking a dropped call back up by itself (no entry sound: you never really left). */
export async function joinCall(c: ChannelInfo, opts: { rejoin?: boolean } = {}) {
  if (call.active() || busy()) { if (channel()?.id === c.id) return; await leaveCall(); }
  // Stoat already has you in this call (on your other device): you're moving it here, not arriving.
  // (Asked live, so it works from anywhere you join, not just the voice channel's own screen.)
  const meId = backend()?.me.id ?? "";
  const moving = backend()?.voiceOf(meId)?.channelId === c.id || !!c.voice?.some((p) => p.id === meId);
  setErr(""); setBusy(true);
  // Android: into call mode before the call's sound exists. Its sound only plays at call volume (like a phone call)
  // when it starts with call mode already on and the mic open (room.ts); the soundboard preview, made later, always was.
  if (android()) await nativeCmd("call_audio", { payload: { on: true } });
  try {
    let h: VoiceHandle;
    try { h = await backend()!.joinVoice(c.id, useNative() ? "native" : "web", joinPrefs()); }
    catch (e) {
      // Stoat may still think we're in the call we just left (or dropped from); one retry clears that up.
      if (e instanceof Error && /already/i.test(e.message)) { await new Promise((r) => setTimeout(r, 1500)); h = await backend()!.joinVoice(c.id, useNative() ? "native" : "web", joinPrefs()); }
      else throw e;
    }
    attach(h, c);
    setCallBanner(null);
    rememberCall(c);
    if (device().voice.joinDeafened && h.setDeaf) { micBeforeDeaf = !device().voice.joinMuted; await h.setDeaf(true); setOn(h.state?.() ?? on()); }
    if (!moving && !opts.rejoin) void playEntrySound(h);
    // Always for a call taken over from another device of yours, so you know the switch worked.
    if (device().sounds.call || moving) playSfx("join");
  } catch (e) {
    setErr(e instanceof Error && e.message ? e.message : "Couldn't join voice. Check your connection and that you have permission.");
    if (android() && !handle()) void nativeCmd("call_audio", { payload: { on: false } });
  }
  finally { setBusy(false); }
}

/* ---------- banners (desktop): the call moved to another device, or Mustela was closed mid-call ---------- */
export type CallBanner = { kind: "moved" | "last"; channel: ChannelInfo };
export const [callBanner, setCallBanner] = createSignal<CallBanner | null>(null);
const LAST_KEY = "mustela:last-call";
/** Remembered while you're in a call and forgotten when you leave it, so it's only still there if Mustela closed mid-call. */
function rememberCall(c: ChannelInfo | null) {
  try { if (c) localStorage.setItem(LAST_KEY, JSON.stringify({ id: c.id, name: c.name, kind: c.kind, at: Date.now() })); else localStorage.removeItem(LAST_KEY); } catch { /* storage off */ }
}
/** At start-up: were you in a call when Mustela last closed? (Within the last day.) */
export function checkLastCall(find: (id: string) => ChannelInfo | undefined) {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return;
    localStorage.removeItem(LAST_KEY);
    const v = JSON.parse(raw) as { id?: string; at?: number };
    if (!v?.id || !v.at || Date.now() - v.at > 24 * 3600_000 || call.active()) return;
    const c = find(v.id);
    if (c) setCallBanner({ kind: "last", channel: c });
  } catch { /* nothing remembered */ }
}

/** Channels we've just rejoined after a drop (once a minute at most, so a broken call doesn't loop). */
const rejoined = new Set<string>();

/** People who just dropped out of the call, held for 2 s in case they're only switching devices (see attach). */
const switching = new Map<string, VoiceMember>();
const switchTimers = new Map<string, ReturnType<typeof setTimeout>>();

function attach(h: VoiceHandle, c: ChannelInfo) {
  for (const t of switchTimers.values()) clearTimeout(t);
  switching.clear(); switchTimers.clear();
  // Who's here and who's streaming, to play a sound when that changes (by id, so a swap still counts).
  const snap = () => { const ps = h.participants(); return { ids: new Set(ps.map((p) => p.id)), live: new Set(ps.filter((p) => p.screen).map((p) => p.id)) }; };
  let was = snap();
  let lastPeople = h.participants();
  h.onChange(() => {
    setTick((t) => t + 1); const s = h.state?.(); if (s) setOn(s);
    const now = snap();
    // Someone switching their call to another device leaves and is back within moments: that's not a leave and a
    // join, so it plays nothing and they stay in the list. A leave only counts once they've been gone 2 seconds.
    const back = [...now.ids].filter((id) => switching.has(id));
    for (const id of back) { clearTimeout(switchTimers.get(id)); switchTimers.delete(id); switching.delete(id); }
    const joined = [...now.ids].some((id) => !was.ids.has(id) && !back.includes(id));
    for (const id of [...was.ids].filter((x) => !now.ids.has(x))) {
      const m = lastPeople.find((p) => p.id === id);
      if (!m) continue;
      switching.set(id, m);
      switchTimers.set(id, setTimeout(() => {
        switching.delete(id); switchTimers.delete(id);
        if (handle() === h) { setTick((t) => t + 1); if (device().sounds.call) playSfx("leave"); }
      }, 2000));
    }
    lastPeople = h.participants();
    if (device().sounds.call && joined) playSfx("join");
    if (device().sounds.streams) {
      // Someone who just left took their stream with them; the leave sound covers that.
      if ([...now.live].some((id) => !was.live.has(id))) playSfx("streamStart");
      else if ([...was.live].some((id) => !now.live.has(id) && now.ids.has(id))) playSfx("streamStop");
    }
    was = now;
  });
  h.onEnd((reason) => {
    if (handle() !== h) return;
    // Joined from somewhere else with this account: let it go (no rejoining, which would kick the other device).
    // You answered on another device: this one says so with the leave sound (only you hear it; the call goes on).
    // Some call engines (Linux's own) don't say why a call ended: if Stoat still has you in this call, it carries on
    // on another of your devices, so it moved (rejoining here would pull it back from there).
    // (Only when there's no reason at all: right after a real drop Stoat can still list you, and that must rejoin.)
    if (reason === undefined && backend()?.voiceOf(backend()!.me.id)?.channelId === c.id) reason = "moved";
    if (reason === "moved") { setHandle(null); setTick((t) => t + 1); rememberCall(null); setCallBanner({ kind: "moved", channel: c }); playSfx("leave"); return; }
    dropped();
  });
  // A call can die quietly: a phone that slept or an app left in the background stops the connection without
  // anything saying so, and you'd look "in the call" while nobody hears you. Check it when you come back and
  // every few seconds; gone, or stuck reconnecting for 20 s, counts as dropped.
  let stuckSince = 0;
  const check = () => {
    if (handle() !== h) { clearInterval(watch); document.removeEventListener("visibilitychange", check); return; }
    const st = h.connection?.();
    if (st === "connected" || !st) { stuckSince = 0; return; }
    if (st === "reconnecting") { stuckSince ||= Date.now(); if (Date.now() - stuckSince < 20_000) return; }
    void h.leave().catch(() => {});
    dropped();
  };
  const watch = setInterval(check, 5000);
  document.addEventListener("visibilitychange", check);
  function dropped() {
    if (handle() !== h) return;
    // Dropped (the connection gave up after its own retries): rejoin once rather than end the call.
    if (!rejoined.has(c.id)) {
      rejoined.add(c.id);
      setTimeout(() => rejoined.delete(c.id), 60_000);
      setHandle(null);
      setErr("Connection lost. Reconnecting…");
      void joinCall(c, { rejoin: true }).then(() => { if (handle()) setErr(""); });
      return;
    }
    void leaveCall().then(() => setErr("The call dropped. Check your connection and join again."));
  }
  h.onReaction?.((from, emoji) => {
    const key = Math.random();
    setReactions([...reactions(), { key, from, emoji }].slice(-24));
    setTimeout(() => setReactions(reactions().filter((r) => r.key !== key)), 2600);
  });
  setChannel(c); setHandle(h);
  setOn(h.state?.() ?? OFF); setTick((t) => t + 1);
}

/** After the app is reopened mid-call (Android swipe-away): pick the call back up. */
export async function resumeCall() {
  const b = backend();
  if (!b || handle() || !useNative()) return;
  const { resumeNative } = await import("../../lib/voice/native");
  const r = await resumeNative(b.me, (id) => b.person(id));
  if (!r || handle()) return;
  attach(r.handle, { id: r.channelId, name: r.channelName, kind: "voice" });
  setOn({ mic: r.mic, cam: false, screen: false, deaf: false });
}

export async function leaveCall() {
  const h = handle();
  if (h && device().sounds.call) playSfx("leave");
  setHandle(null); setChannel(null); setOn(OFF);
  rememberCall(null);
  if (popped()) void closePopout();
  await h?.leave().catch(() => {});
}

/** A source already picked for "Change stream", used by the next start instead of asking again. */
let pendingChoice: Awaited<ReturnType<typeof pickScreen>> = null;

/** Switch what you're sharing: pick the new screen or window first (cancel keeps the current one), then swap. */
export async function changeScreen() {
  if (!handle() || !on().screen) return;
  if (desktopCapture()) { const c = await pickScreen(); if (!c) return; pendingChoice = c; }
  await toggleCall("screen"); // stop
  await toggleCall("screen"); // and start with the new one
}

/** The share button: start sharing, or while you're sharing, a menu to stop or change it. */
export function screenButton(anchor: Element) {
  if (!on().screen) return void toggleCall("screen");
  openMenu(anchor, [
    { label: "Stop streaming", icon: "screen", danger: true, onSelect: () => void toggleCall("screen") },
    { label: "Change stream", icon: "swap", onSelect: () => void changeScreen() },
  ]);
}

let micBeforeDeaf = false;
/** Joining deafened means joining muted too (without changing your own mute choice). */
const joinPrefs = () => { const v = device().voice; return { ...v, joinMuted: v.joinMuted || v.joinDeafened }; };
export async function toggleCall(k: "mic" | "cam" | "screen" | "deaf") {
  const h = handle(); if (!h) return;
  const next = !on()[k];
  try {
    if (device().sounds.toggles && (k === "mic" || k === "deaf")) playSfx(k === "mic" ? (next ? "unmute" : "mute") : next ? "deafen" : "undeafen");
    if (k === "deaf") {
      // Like Discord: deafening mutes you, and undeafening turns your microphone back on if it was on before.
      if (next) micBeforeDeaf = on().mic;
      await h.setDeaf?.(next);
      if (!next && micBeforeDeaf) {
        // Give the call a moment to reopen the sound before asking for the microphone again.
        let st = h.state?.() ?? on();
        for (let i = 0; i < 3 && !st.mic; i++) { await h.setMic(true).catch(() => {}); st = h.state?.() ?? on(); if (!st.mic) await new Promise((r) => setTimeout(r, 250)); }
      }
      if (!next) micBeforeDeaf = false;
    }
    else {
      // Unmuting while deafened undeafens too, like Discord and Stoat.
      if (k === "mic" && next && on().deaf) await h.setDeaf?.(false);
      if (k === "screen" && next && platform === "android" && inTauri()) {
        // Android: the system's own prompt picks what to share; frames come from a capture service.
        const { startAndroidCapture } = await import("../../lib/voice/capture");
        const native = await startAndroidCapture(allowedQuality());
        native.onEnded(() => { setOn(h.state?.() ?? { ...on(), screen: false }); setTick((t) => t + 1); });
        try { await h.setScreen(true, { quality: allowedQuality(), native }); } catch (e) { native.stop(); throw e; }
      } else if (k === "screen" && next && desktopCapture()) {
        // Desktop: Mustela's own picker and capture (no system picker or "is sharing" bar).
        const choice = pendingChoice ?? await pickScreen();
        pendingChoice = null;
        if (!choice) return;
        if (choice.source === "system") await h.setScreen(true, { quality: choice.quality });
        else {
          const { startNativeCapture } = await import("../../lib/voice/capture");
          const native = await startNativeCapture(choice.source, choice.quality, choice.audio);
          native.onEnded(() => { setOn(h.state?.() ?? { ...on(), screen: false }); setTick((t) => t + 1); });
          try { await h.setScreen(true, { quality: choice.quality, native }); } catch (e) { native.stop(); throw e; }
        }
      } else if (k === "mic") {
        // Windows can briefly report the microphone busy ("Could not start audio source"): try once more.
        try { await h.setMic(next); }
        catch (e) { if (!next || !/audio source|NotReadable/i.test(`${(e as Error)?.name} ${(e as Error)?.message}`)) throw e; await new Promise((r) => setTimeout(r, 600)); await h.setMic(true); }
      } else await (k === "cam" ? h.setCamera(next) : h.setScreen(next, { quality: allowedQuality() }));
    }
    setOn(h.state?.() ?? { ...on(), [k]: next }); setErr(""); setTick((t) => t + 1);
    if (k === "mic" || k === "deaf") {
      const v = device().voice, now = on();
      updateDevice({ voice: { ...v, joinDeafened: now.deaf, joinMuted: k === "mic" ? !now.mic : v.joinMuted } });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.name + " " + e.message : String(e);
    if (k === "screen" && /NotAllowed|Abort|cancel/i.test(msg) && !/Permission denied by system/i.test(msg)) { setErr(""); return; } // you closed the picker
    const why = /Permission|NotAllowed/i.test(msg) ? " Allow Mustela to record your screen in your system's privacy settings." : "";
    setErr(k === "screen"
      // Say why when we know (our own capture explains itself); a browser error stays generic.
      ? /NoDisplayMedia/.test(msg) ? "Screen sharing isn't available in this window system yet."
        : why ? `Couldn't start screen sharing.${why}` : `Couldn't start screen sharing${e instanceof Error && e.message ? `: ${e.message.replace(/\.$/, "")}` : ""}.`
      : `Couldn't turn on your ${k === "mic" ? "microphone" : k === "cam" ? "camera" : "audio"}.${why}`);
    setOn(h.state?.() ?? on());
  }
}

/**
 * While you test your mic in settings: deafen and mute you in the call (so nobody hears the test and you
 * hear only yourself). Returns a function that puts your mic and deafen back how they were.
 */
export async function holdCallForMicTest(): Promise<() => Promise<void>> {
  const h = handle();
  if (!h) return async () => {};
  const before = { ...on() };
  try {
    if (before.mic) await h.setMic(false);
    if (!before.deaf) await h.setDeaf?.(true);
  } catch { /* best effort */ }
  setOn(h.state?.() ?? { ...on(), mic: false, deaf: true }); setTick((t) => t + 1);
  return async () => {
    if (handle() !== h) return; // left the call meanwhile
    try {
      if (!before.deaf) await h.setDeaf?.(false);
      if (before.mic) await h.setMic(true);
    } catch { /* best effort */ }
    setOn(h.state?.() ?? { ...on(), mic: before.mic, deaf: before.deaf }); setTick((t) => t + 1);
  };
}

/** Plays a soundboard clip into the call, at the soundboard volume from Voice & Video settings. */
export async function playSoundInCall(data: ArrayBuffer, volume = 1) {
  const h = handle();
  if (!h?.playSound) { setErr("The soundboard needs the web call engine."); return; }
  try { await h.playSound(data, volume * device().voice.soundboardVolume / 100); } catch { setErr("Couldn't play that sound."); }
}

/** Your entry sound, played for everyone right after you join. */
async function playEntrySound(h: VoiceHandle) {
  const id = ext().entrySound ?? device().voice.entrySound; // synced; older builds kept it on the device
  if (!id || !h.playSound) return;
  const { listSounds } = await import("../../lib/sounds");
  const s = (await listSounds().catch(() => [])).find((x) => x.id === id);
  if (s && handle() === h) await h.playSound(s.data, s.volume * device().voice.soundboardVolume / 100).catch(() => {});
}

/** Applies Voice & Video changes to the call you're in without rejoining. */
export function applyVoicePrefs() {
  const h = handle(), v = device().voice;
  h?.setOutputVolume?.(v.outputVolume);
  h?.setSensitivity?.(v.autoSensitivity, v.threshold);
}

/* ---------- Android picture-in-picture (web engine) ---------- */
export const canPip = () => platform === "android" && inTauri() && !useNative();
/** The floating window's shape: wide while you watch a stream (or a camera), square while you're just talking. */
const pipWide = () => (tick(), call.streams().some((s) => s.watching) || call.people().some((p) => p.camera));
async function pip(enter: boolean, auto: boolean) {
  if (!canPip()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const wide = pipWide();
    const r = await invoke<{ supported: boolean }>("plugin:mustela-native|pip", { payload: { enter, auto, width: wide ? 16 : 1, height: wide ? 9 : 1 } });
    return r.supported;
  } catch { return false; }
}
/** Shrink the app into a floating window now. */
export const enterPip = () => pip(true, true);

/* ---------- Android: call volume and the voice bubble ---------- */
const android = () => platform === "android" && inTauri();
async function nativeCmd<T = void>(name: string, args?: Record<string, unknown>): Promise<T | undefined> {
  try { const { invoke } = await import("@tauri-apps/api/core"); return await invoke<T>(`plugin:mustela-native|${name}`, args); } catch { return undefined; }
}
/** Whether Mustela may show the bubble over other apps (Android asks you once, in Voice & Video). */
export const [overlayAllowed, setOverlayAllowed] = createSignal(false);
export async function checkOverlay() { setOverlayAllowed(!!(await nativeCmd<{ allowed: boolean }>("overlay_allowed"))?.allowed); }
export async function requestOverlay() { setOverlayAllowed(!!(await nativeCmd<{ allowed: boolean }>("request_overlay"))?.allowed); }
/** The bubble, when you've allowed it and want it; picture-in-picture otherwise. */
const bubble = () => overlayAllowed() && device().callOverlay !== "pip";

if (android()) {
  void checkOverlay();
  // Holding the bubble mutes or unmutes (the web engine; the native one mutes on its own side).
  void import("@tauri-apps/api/core").then(({ addPluginListener }) => addPluginListener("mustela-native", "bubble", (e: { action?: string }) => {
    if (e?.action === "mute" && handle()) void toggleCall("mic");
    if (e?.action === "leave" && handle()) void leaveCall(); // "Leave" in the call notification
  })).catch(() => {});
}
createRoot(() => {
  // In a call the phone treats Mustela as a call: the volume keys set call volume, not media volume.
  createEffect(() => { if (android()) void nativeCmd("call_audio", { payload: { on: handle() !== null } }); });
  // Leaving the app mid-call shows the bubble (if allowed), or floats the call in picture-in-picture.
  createEffect(() => {
    if (!android()) return;
    const inCall = handle() !== null;
    void nativeCmd("set_call_overlay", { payload: { on: inCall && bubble(), muted: !on().mic } });
  });
  // The floating window's settings only when they change (square or wide, on or off). Sending them on every call
  // update (several a second while people talk) made Android snap the window back, so it couldn't be resized.
  const pipShape = createMemo(() => (android() ? `${handle() !== null && !bubble()}:${pipWide()}` : ""));
  createEffect(whenChanged(pipShape, (k) => { if (k) void pip(false, handle() !== null && !bubble()); }));
});

/* ---------- pop-out (desktop) ---------- */
/** Shows the call in its own window. The call stays right here: nothing reconnects. */
export async function openPopout() {
  if (!call.canPopOut() || !handle()) return;
  try { await (await import("./popout")).showPopout(); setErr(""); }
  catch { setErr("Couldn't open the call window."); }
}

/** Brings the call back into the main window (closes the pop-out). */
export async function closePopout() {
  await (await import("./popout")).hidePopout();
}

/** Main window: picks a call back up after a reload, and ends it when you switch accounts. */
export function startCallBridge() {
  createRoot(() => {
    let last = backend();
    createEffect(() => { if (backend()) void resumeCall(); });
    createEffect(() => { const be = backend(); if (be !== last) { last = be; if (call.active()) void leaveCall(); } }); // switching accounts ends the call
  });
}
