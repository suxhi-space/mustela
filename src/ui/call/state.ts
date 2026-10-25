import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import type { ChannelInfo, Person, VoiceHandle, VoiceMember } from "../../lib/backend/types";
import { inTauri } from "../../lib/platform";
import { playSfx } from "../../lib/sfx";
import { backend, device, platform } from "../store";
import { openBridge, type Cmd, type Handoff, type Snapshot, type Wire } from "./bridge";

/**
 * The one call this window is in. It lives here, not in a component, so the
 * call keeps going when you switch channels.
 *
 * The call can move into the pop-out window (like Discord's). The pop-out
 * then holds the call itself, video and all; this window shows its state and
 * sends it button presses. Closing the pop-out brings the call back.
 */
const [handle, setHandle] = createSignal<VoiceHandle | null>(null);
const [channel, setChannel] = createSignal<ChannelInfo | null>(null);
const [on, setOn] = createSignal({ mic: false, cam: false, screen: false, deaf: false });
const [tick, setTick] = createSignal(0);
const [busy, setBusy] = createSignal(false);
const [err, setErr] = createSignal("");
/** The call is running in the pop-out window right now. */
const [popped, setPopped] = createSignal(false);
/** What the pop-out last reported (only while popped). */
const [remote, setRemote] = createSignal<Snapshot | null>(null);
/** Floating reactions: { id, from, emoji } that fade out on their own. */
const [reactions, setReactions] = createSignal<{ key: number; from: string; emoji: string }[]>([]);

export const isPopoutWindow = typeof location !== "undefined" && new URLSearchParams(location.search).has("popout");

export const call = {
  channel, busy, error: err, popped, on, reactions,
  active: () => handle() !== null || (popped() && !!remote()?.active),
  handle,
  people: createMemo<VoiceMember[]>(() => (tick(), popped() ? remote()?.people ?? [] : handle()?.participants() ?? [])),
  speaking: createMemo<string[]>(() => (tick(), popped() ? remote()?.speaking ?? [] : handle()?.speaking() ?? [])),
  streams: createMemo(() => (tick(), handle()?.streams?.() ?? [])),
  canPopOut: () => inTauri() && platform !== "android" && !isPopoutWindow,
  /** Bumps whenever anything in the call changes (tracks, volumes…) */
  tick,
};
const OFF = { mic: false, cam: false, screen: false, deaf: false };

/** Android with the native engine chosen: the call lives in a service, not the WebView. */
const useNative = () => platform === "android" && inTauri() && device().callEngine === "native";

export async function joinCall(c: ChannelInfo) {
  if (call.active() || busy()) { if (channel()?.id === c.id) return; await leaveCall(); }
  setErr(""); setBusy(true);
  try {
    let h: VoiceHandle;
    try { h = await backend()!.joinVoice(c.id, useNative() ? "native" : "web", device().voice); }
    catch (e) {
      // Stoat may still think we're in the call we just left (or dropped from); one retry clears that up.
      if (e instanceof Error && /already/i.test(e.message)) { await new Promise((r) => setTimeout(r, 1500)); h = await backend()!.joinVoice(c.id, useNative() ? "native" : "web", device().voice); }
      else throw e;
    }
    attach(h, c);
    if (device().voice.joinDeafened && h.setDeaf) { await h.setDeaf(true); setOn(h.state?.() ?? on()); }
    void playEntrySound(h);
    if (device().sounds.call) playSfx("join");
  } catch (e) { setErr(e instanceof Error && e.message ? e.message : "Couldn't join voice. Check your connection and that you have permission."); }
  finally { setBusy(false); }
}

function attach(h: VoiceHandle, c: ChannelInfo) {
  let count = h.participants().length;
  h.onChange(() => {
    setTick((t) => t + 1); const s = h.state?.(); if (s) setOn(s);
    const n = h.participants().length;
    if (n !== count && device().sounds.call) playSfx(n > count ? "join" : "leave");
    count = n;
  });
  h.onEnd((reason) => {
    if (handle() !== h) return;
    if (reason === "moved") { setHandle(null); setTick((t) => t + 1); return; } // the pop-out (or another window) took the call over
    void leaveCall();
  });
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
  if (popped()) { bridge()?.send({ t: "cmd", c: "leave" }); }
  const h = handle();
  if ((h || popped()) && device().sounds.call) playSfx("leave");
  setHandle(null); setChannel(null); setOn(OFF); setPopped(false); setRemote(null);
  if (isPopoutWindow) void closeThisWindow();
  await h?.leave().catch(() => {});
}

export async function toggleCall(k: "mic" | "cam" | "screen" | "deaf") {
  if (popped()) { bridge()?.send({ t: "cmd", c: k }); return; }
  const h = handle(); if (!h) return;
  const next = !on()[k];
  try {
    if (device().sounds.toggles && (k === "mic" || k === "deaf")) playSfx(k === "mic" ? (next ? "unmute" : "mute") : next ? "deafen" : "undeafen");
    if (k === "deaf") { await h.setDeaf?.(next); }
    else {
      // Unmuting while deafened undeafens too, like Discord and Stoat.
      if (k === "mic" && next && on().deaf) await h.setDeaf?.(false);
      await (k === "mic" ? h.setMic(next) : k === "cam" ? h.setCamera(next) : h.setScreen(next, { quality: device().voice.screenQuality }));
    }
    setOn(h.state?.() ?? { ...on(), [k]: next }); setErr(""); setTick((t) => t + 1);
  } catch (e) {
    const msg = e instanceof Error ? e.name + " " + e.message : String(e);
    if (k === "screen" && /NotAllowed|Abort|cancel/i.test(msg) && !/Permission denied by system/i.test(msg)) { setErr(""); return; } // you closed the picker
    const why = /Permission|NotAllowed/i.test(msg) ? " Allow Mustela to record your screen in your system's privacy settings." : "";
    setErr(k === "screen"
      ? /NoDisplayMedia/.test(msg) ? "Screen sharing isn't available in this window system yet." : `Couldn't start screen sharing.${why}`
      : `Couldn't turn on your ${k === "mic" ? "microphone" : k === "cam" ? "camera" : "audio"}.${why}`);
    setOn(h.state?.() ?? on());
  }
}

/** Plays a soundboard clip into the call, at the soundboard volume from Voice & Video settings. */
export async function playSoundInCall(data: ArrayBuffer, volume = 1) {
  const h = handle();
  if (!h?.playSound) { setErr(popped() ? "Use the soundboard in the call window." : "The soundboard needs the web call engine."); return; }
  try { await h.playSound(data, volume * device().voice.soundboardVolume / 100); } catch { setErr("Couldn't play that sound."); }
}

export function sendReaction(emoji: string) {
  if (popped()) bridge()?.send({ t: "react", emoji });
  else handle()?.react?.(emoji);
}

/** Your entry sound, played for everyone right after you join. */
async function playEntrySound(h: VoiceHandle) {
  const id = device().voice.entrySound;
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
async function pip(enter: boolean, auto: boolean) {
  if (!canPip()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke<{ supported: boolean }>("plugin:mustela-native|pip", { payload: { enter, auto, width: 16, height: 9 } });
    return r.supported;
  } catch { return false; }
}
/** Shrink the app into a floating window now. */
export const enterPip = () => pip(true, true);
// While a call is on, leaving the app (home button, swipe up) floats it instead of pausing it.
createRoot(() => createEffect(() => { void pip(false, handle() !== null); }));

/* ---------- pop-out (desktop) ---------- */
const HANDOFF = "mustela:call-handoff";
let bridgeRef: ReturnType<typeof openBridge> | null = null;
const bridge = () => bridgeRef;

const snapshot = createMemo<Snapshot>(() => ({
  active: handle() !== null,
  channel: channel() ? { id: channel()!.id, name: channel()!.name } : null,
  ...on(),
  people: (tick(), handle()?.participants() ?? []).map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, muted: p.muted, deaf: p.deaf, camera: p.camera, screen: p.screen })),
  speaking: call.speaking(),
  error: err(),
}));

/** Moves the call into its own window. */
export async function openPopout() {
  const h = handle(), c = channel(), b = backend();
  if (!call.canPopOut() || !h?.auth || !c || !b) return;
  const people: Record<string, Pick<Person, "id" | "name" | "avatarUrl">> = {};
  for (const p of h.participants()) people[p.id] = { id: p.id, name: p.name, avatarUrl: p.avatarUrl };
  const handoff: Handoff = { auth: h.auth, channel: { id: c.id, name: c.name, kind: c.kind }, me: b.me, people, at: Date.now() };
  try { localStorage.setItem(HANDOFF, JSON.stringify(handoff)); } catch { setErr("Couldn't open the call window."); return; }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_popout");
    setPopped(true);
  } catch { setErr("Couldn't open the call window."); }
}

/** Brings the call back from the pop-out (or closes the pop-out if it has no call). */
export async function closePopout() {
  bridge()?.send({ t: "return-request" });
}

/** The pop-out handed the call back: reconnect here with the same credentials. */
async function takeBack(h: Handoff) {
  const b = backend();
  setPopped(false); setRemote(null);
  if (!b) return;
  const c: ChannelInfo = { id: h.channel.id, name: h.channel.name, kind: h.channel.kind as ChannelInfo["kind"] };
  setBusy(true);
  try {
    const { connectVoice } = await import("../../lib/voice/room");
    attach(await connectVoice(h.auth.url, h.auth.token, b.me, (id) => b.person(id), device().voice), c);
  } catch {
    await joinCall(c); // the token may have expired; ask Stoat for a new one
  } finally { setBusy(false); }
}

async function closeThisWindow() {
  try { const { getCurrentWindow } = await import("@tauri-apps/api/window"); await getCurrentWindow().destroy(); } catch { window.close(); }
}

/** Main window: keeps the pop-out informed and listens for it. */
export function startCallBridge() {
  if (isPopoutWindow) return;
  createRoot(() => {
    const b = openBridge((m: Wire) => {
      if (m.t === "state" && popped()) { setRemote(m.s); setOn({ mic: m.s.mic, cam: m.s.cam, screen: m.s.screen, deaf: !!m.s.deaf }); setTick((t) => t + 1); }
      else if (m.t === "taken") { setPopped(true); }
      else if (m.t === "failed") { setPopped(false); setRemote(null); setErr(m.error); }
      else if (m.t === "returned") { void takeBack(m.handoff); }
      else if (m.t === "left") { setPopped(false); setRemote(null); setChannel(null); setOn(OFF); }
      else if (m.t === "who") {
        const be = backend();
        if (be) b.send({ t: "names", people: Object.fromEntries(m.ids.map((id) => { const p = be.person(id); return [id, { id, name: p.name, avatarUrl: p.avatarUrl }]; })) });
      }
    });
    bridgeRef = b;
    let last = backend();
    createEffect(() => { if (backend()) void resumeCall(); });
    createEffect(() => { const be = backend(); if (be !== last) { last = be; if (call.active()) void leaveCall(); } }); // switching accounts ends the call
    if (inTauri()) void import("@tauri-apps/api/event").then(({ listen }) => listen("mustela:popout-closed", () => {
      // closed without handing back (crashed or killed): the call went with it
      if (popped()) { setPopped(false); setRemote(null); setChannel(null); setOn(OFF); }
    }));
  });
}

/** Pop-out window: picks the call up from the handoff and runs it here. */
export async function startPopout(me: (p: Person) => void, names: (m: Record<string, Pick<Person, "id" | "name" | "avatarUrl">>) => void) {
  let h: Handoff | null = null;
  try { h = JSON.parse(localStorage.getItem(HANDOFF) ?? "null"); localStorage.removeItem(HANDOFF); } catch { /* nothing to pick up */ }
  const b = openBridge((m: Wire) => {
    if (m.t === "cmd") void (m.c === "leave" ? leaveHere() : toggleCall(m.c as Exclude<Cmd, "leave">));
    else if (m.t === "react") sendReaction(m.emoji);
    else if (m.t === "names") names(m.people);
    else if (m.t === "return-request") void handBack();
  });
  bridgeRef = b;
  if (!h || Date.now() - h.at > 60_000) { b.send({ t: "failed", error: "The call window opened without a call." }); await closeThisWindow(); return; }
  me(h.me); names(h.people);
  const known = h.people;
  try {
    const { connectVoice } = await import("../../lib/voice/room");
    const handle = await connectVoice(h.auth.url, h.auth.token, h.me, (id) => {
      if (!known[id]) { known[id] = { id, name: "…" }; b.send({ t: "who", ids: [id] }); }
      return known[id] as Person;
    }, device().voice);
    attach(handle, { id: h.channel.id, name: h.channel.name, kind: h.channel.kind as ChannelInfo["kind"] });
    b.send({ t: "taken" });
    createRoot(() => createEffect(() => b.send({ t: "state", s: snapshot() })));
  } catch (e) {
    b.send({ t: "failed", error: e instanceof Error ? e.message : "Couldn't move the call." });
    await closeThisWindow();
  }
  // Closing the pop-out with its X hands the call back instead of dropping it.
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().onCloseRequested(async (e) => { e.preventDefault(); await handBack(); });

  async function handBack() {
    const cur = handle(), c = channel();
    if (cur?.auth && c) {
      b.send({ t: "returned", handoff: { auth: cur.auth, channel: { id: c.id, name: c.name, kind: c.kind }, me: h!.me, people: {}, at: Date.now() } });
      // Wait for the main window to pick it up (we get bumped off), so others don't see you leave and rejoin.
      const t0 = Date.now();
      while (handle() === cur && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 100));
      if (handle() === cur) { setHandle(null); await cur.leave().catch(() => {}); }
    }
    await closeThisWindow();
  }
  async function leaveHere() {
    b.send({ t: "left" });
    await leaveCall();
  }
}
