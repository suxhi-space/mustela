import { createEffect, createMemo, createRoot, createSignal } from "solid-js";
import type { ChannelInfo, Person, VoiceHandle } from "../../lib/backend/types";
import { inTauri } from "../../lib/platform";
import { backend, device, platform } from "../store";
import { openBridge, type Cmd, type Snapshot } from "./bridge";

/**
 * The one call this window is in. It lives here, not in a component, so the
 * call keeps going when you switch channels and can be shown in a pop-out.
 */
const [handle, setHandle] = createSignal<VoiceHandle | null>(null);
const [channel, setChannel] = createSignal<ChannelInfo | null>(null);
const [on, setOn] = createSignal({ mic: false, cam: false, screen: false });
const [tick, setTick] = createSignal(0);
const [busy, setBusy] = createSignal(false);
const [err, setErr] = createSignal("");
const [popped, setPopped] = createSignal(false);

export const call = {
  channel, busy, error: err, popped, on,
  active: () => handle() !== null,
  handle,
  people: createMemo<Person[]>(() => (tick(), handle()?.participants() ?? [])),
  speaking: createMemo<string[]>(() => (tick(), handle()?.speaking() ?? [])),
  canPopOut: () => inTauri() && platform !== "android",
};

export async function joinCall(c: ChannelInfo) {
  if (handle() || busy()) { if (channel()?.id === c.id) return; await leaveCall(); }
  setErr(""); setBusy(true);
  try {
    const h = await backend()!.joinVoice(c.id, useNative() ? "native" : "web");
    attach(h, c); setOn({ mic: false, cam: false, screen: false }); setTick((t) => t + 1);
  } catch { setErr("Couldn't join voice. Check your connection and that you have permission."); }
  finally { setBusy(false); }
}

/** Android with the native engine chosen: the call lives in a service, not the WebView. */
const useNative = () => platform === "android" && inTauri() && device().callEngine === "native";

function attach(h: VoiceHandle, c: ChannelInfo) {
  h.onChange(() => setTick((t) => t + 1));
  h.onEnd(() => { if (handle() === h) void leaveCall(); }); // dropped, or left from the notification
  setChannel(c); setHandle(h);
}

/** After the app is reopened mid-call (Android swipe-away): pick the call back up. */
export async function resumeCall() {
  const b = backend();
  if (!b || handle() || !useNative()) return;
  const { resumeNative } = await import("../../lib/voice/native");
  const r = await resumeNative(b.me, (id) => b.person(id));
  if (!r || handle()) return;
  attach(r.handle, { id: r.channelId, name: r.channelName, kind: "voice" });
  setOn({ mic: r.mic, cam: false, screen: false });
  setTick((t) => t + 1);
}

export async function leaveCall() {
  const h = handle();
  setHandle(null); setChannel(null); setOn({ mic: false, cam: false, screen: false });
  if (popped()) void closePopout();
  await h?.leave().catch(() => {});
}

export async function toggleCall(k: "mic" | "cam" | "screen") {
  const h = handle(); if (!h) return;
  const next = !on()[k];
  try {
    await (k === "mic" ? h.setMic(next) : k === "cam" ? h.setCamera(next) : h.setScreen(next));
    setOn({ ...on(), [k]: next }); setErr(""); setTick((t) => t + 1);
  } catch {
    setErr(k === "screen" ? "Screen sharing isn't available on this device yet." : `Couldn't turn on your ${k === "mic" ? "microphone" : "camera"}. Check permissions.`);
  }
}

/* ---------- pop-out ---------- */
export async function openPopout() {
  if (!call.canPopOut()) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_popout");
    setPopped(true);
  } catch { setErr("Couldn't open the call window."); }
}
export async function closePopout() {
  setPopped(false);
  try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("close_popout"); } catch { /* already gone */ }
}

export const snapshot = createMemo<Snapshot>(() => ({
  active: handle() !== null,
  channelName: channel()?.name ?? "",
  ...on(),
  people: call.people().map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl })),
  speaking: call.speaking(),
  error: err(),
}));

/** Main window only: answers the pop-out's commands and keeps it up to date. */
export function startCallBridge() {
  createRoot(() => {
    const b = openBridge((m) => {
      if (m.t === "hello") b.send({ t: "state", s: snapshot() });
      else if (m.t === "cmd") void (m.c === "leave" ? leaveCall() : toggleCall(m.c as Exclude<Cmd, "leave">));
    });
    let last = backend();
    createEffect(() => { if (backend()) void resumeCall(); });
    createEffect(() => { const b = backend(); if (b !== last) { last = b; if (handle()) void leaveCall(); } }); // switching accounts ends the call
    createEffect(() => { const s = snapshot(); if (popped()) b.send({ t: "state", s }); });
    if (inTauri()) void import("@tauri-apps/api/event").then(({ listen }) => listen("mustela:popout-closed", () => setPopped(false)));
  });
}
