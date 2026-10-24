import type { Person, VoiceHandle } from "../backend/types";

/**
 * Android-only call engine. The call itself runs in a native foreground
 * service (see src-tauri/plugins/mustela-native), so it survives the app being
 * swiped out of recents. This file is the WebView's remote control for it.
 * Voice only: camera and screen share need the web engine.
 */
interface NativeState {
  active: boolean; connected: boolean; mic: boolean;
  channelId?: string | null; channelName?: string | null;
  participants: string[]; speaking: string[]; error?: string | null;
}
const EMPTY: NativeState = { active: false, connected: false, mic: false, participants: [], speaking: [] };

async function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(`plugin:mustela-native|${name}`, args);
}

export async function nativeCallState(): Promise<NativeState> {
  try { return { ...EMPTY, ...(await cmd<NativeState>("call_state")) }; } catch { return EMPTY; }
}

function handleFor(me: Person, nameOf: (id: string) => Person, first: NativeState): VoiceHandle {
  let st = first;
  const subs = new Set<() => void>(), ends = new Set<() => void>();
  let over = false;
  const apply = (n: NativeState) => {
    const changed = JSON.stringify(n) !== JSON.stringify(st);
    st = n;
    if (!n.active && !over) { over = true; stop(); ends.forEach((f) => f()); }
    else if (changed) subs.forEach((f) => f());
  };
  const timer = setInterval(() => void nativeCallState().then(apply), 1000);
  const stop = () => clearInterval(timer);
  const reject = (what: string) => Promise.reject(new Error(`${what} isn't available in background-call mode. Switch the call engine to Web in Settings.`));
  return {
    setMic: async (on) => { apply(await cmd<NativeState>("set_mic", { payload: { on } })); },
    setCamera: () => reject("Camera"),
    setScreen: () => reject("Screen sharing"),
    leave: async () => { over = true; stop(); await cmd("end_call").catch(() => {}); },
    participants: () => (st.participants.length ? st.participants : [me.id]).map((id) => (id === me.id ? me : nameOf(id))),
    speaking: () => st.speaking,
    video: () => null,
    onChange: (cb) => (subs.add(cb), () => void subs.delete(cb)),
    onEnd: (cb) => (ends.add(cb), () => void ends.delete(cb)),
  };
}

export async function connectNative(url: string, token: string, channelId: string, channelName: string, me: Person, nameOf: (id: string) => Person): Promise<VoiceHandle> {
  const st = await cmd<NativeState>("start_call", { payload: { url, token, channelId, channelName } });
  return handleFor(me, nameOf, { ...EMPTY, ...st });
}

/** After the app is reopened mid-call: re-attach to the call that kept running. */
export async function resumeNative(me: Person, nameOf: (id: string) => Person): Promise<{ handle: VoiceHandle; channelId: string; channelName: string; mic: boolean } | null> {
  const st = await nativeCallState();
  if (!st.active || !st.channelId) return null;
  return { handle: handleFor(me, nameOf, st), channelId: st.channelId, channelName: st.channelName ?? "Voice", mic: st.mic };
}
