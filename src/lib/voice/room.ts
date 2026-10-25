import {
  DisconnectReason, LocalAudioTrack, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room, RoomEvent,
  ScreenSharePresets, Track, VideoPresets,
} from "livekit-client";
import type { Person, VoiceHandle, VoiceMember, VoicePrefs } from "../backend/types";

/**
 * Voice, camera and screen share over LiveKit. Stoat's join_call hands back a
 * LiveKit URL and token; everything after that is plain livekit-client,
 * set up the way Stoat's own client does it (same screen-share presets and
 * capture options), plus:
 *  - audio is mixed through Web Audio, so a person can be boosted to 200%;
 *  - who's talking is measured here from the audio itself (no server
 *    round trip), so the ring lights up as they start;
 *  - the soundboard is its own published track;
 *  - reactions travel on LiveKit's data channel (other Mustela clients show them);
 *  - the call can be handed to another window (the pop-out) with the same token.
 */
const SCREEN = {
  "720p30": { resolution: ScreenSharePresets.h720fps30.resolution, encoding: ScreenSharePresets.h720fps30.encoding, contentHint: "motion" as const },
  "1080p30": { resolution: ScreenSharePresets.h1080fps30.resolution, encoding: ScreenSharePresets.h1080fps30.encoding, contentHint: "motion" as const },
  "1080p60": { resolution: { ...ScreenSharePresets.h1080fps30.resolution, frameRate: 60 }, encoding: { maxBitrate: 6_000_000, maxFramerate: 60 }, contentHint: "motion" as const },
};

/** Per-person volume and mute, remembered across calls like Discord. */
type UserAudio = { v: number; m: boolean; sv: number; sm: boolean };
const UA_KEY = "mustela:user-audio";
const loadUA = (): Record<string, UserAudio> => { try { return JSON.parse(localStorage.getItem(UA_KEY) ?? "{}") ?? {}; } catch { return {}; } };
const saveUA = (x: Record<string, UserAudio>) => { try { localStorage.setItem(UA_KEY, JSON.stringify(x)); } catch { /* fine */ } };

const SPEAK_DB = -48;    // louder than this counts as talking
const SPEAK_HOLD = 300;  // ms the ring stays on after they stop

export async function connectVoice(url: string, token: string, me: Person, nameOf: (id: string) => Person, prefs: VoicePrefs): Promise<VoiceHandle> {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: true,
    audioCaptureDefaults: {
      deviceId: prefs.inputDevice || undefined,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGain,
    },
    audioOutput: { deviceId: prefs.outputDevice || undefined },
    videoCaptureDefaults: { deviceId: prefs.videoDevice || undefined, resolution: VideoPresets.h720.resolution },
    publishDefaults: {
      videoEncoding: VideoPresets.h720.encoding,
      screenShareEncoding: (SCREEN[prefs.screenQuality] ?? SCREEN["720p30"]).encoding,
      dtx: true,
    },
  });
  const subs = new Set<() => void>();
  let pingQueued = false;
  const ping = () => { if (pingQueued) return; pingQueued = true; queueMicrotask(() => { pingQueued = false; subs.forEach((s) => s()); }); };

  /* ---- audio out: every remote audio track attached, volumes through Web Audio ---- */
  const sink = document.createElement("div");
  sink.hidden = true;
  document.body.appendChild(sink);
  const ua = loadUA();
  const audioOf = (id: string): UserAudio => ua[id] ?? { v: 1, m: false, sv: 1, sm: false };
  let deaf = false;
  let outVolume = prefs.outputVolume / 100;
  const applyVolume = (p: RemoteParticipant) => {
    const a = audioOf(p.identity);
    p.setVolume(deaf || a.m ? 0 : outVolume * a.v, Track.Source.Microphone);
    p.setVolume(deaf || a.sm ? 0 : outVolume * a.sv, Track.Source.ScreenShareAudio);
    for (const pub of p.audioTrackPublications.values()) if (pub.source === Track.Source.Unknown) (pub as RemoteTrackPublication).audioTrack && ((pub as RemoteTrackPublication).track as any)?.setVolume?.(deaf ? 0 : outVolume); // soundboards
  };
  const applyAll = () => room.remoteParticipants.forEach(applyVolume);

  /* ---- who's talking: measured locally from each audio stream ---- */
  const ctx = new AudioContext();
  const meters = new Map<string, { an: AnalyserNode; src: MediaStreamAudioSourceNode; last: number }>();
  const meter = (id: string, t: MediaStreamTrack) => {
    meters.get(id)?.src.disconnect();
    try {
      const src = ctx.createMediaStreamSource(new MediaStream([t]));
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      meters.set(id, { an, src, last: 0 });
    } catch { /* this browser can't analyse that track; fall back to LiveKit's speaker list */ }
  };
  const unmeter = (id: string) => { meters.get(id)?.src.disconnect(); meters.delete(id); };
  const speakingNow = new Set<string>();
  const buf = new Float32Array(512);
  const tick = window.setInterval(() => {
    const now = performance.now();
    let changed = false;
    for (const [id, m] of meters) {
      m.an.getFloatTimeDomainData(buf);
      let s = 0; for (const x of buf) s += x * x;
      const db = 20 * Math.log10(Math.sqrt(s / buf.length) || 1e-8);
      const muted = id === me.id ? !room.localParticipant.isMicrophoneEnabled : !room.remoteParticipants.get(id)?.isMicrophoneEnabled;
      if (db > SPEAK_DB && !muted) m.last = now;
      const on = now - m.last < SPEAK_HOLD;
      if (on !== speakingNow.has(id)) { changed = true; if (on) speakingNow.add(id); else speakingNow.delete(id); }
    }
    if (changed) ping();
  }, 40);

  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio) {
      sink.appendChild(track.attach());
      if (pub.source === Track.Source.Microphone) meter(p.identity, track.mediaStreamTrack);
      applyVolume(p);
    }
    ping();
  });
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
    track.detach().forEach((el) => el.remove());
    if (pub.source === Track.Source.Microphone) unmeter(p.identity);
    ping();
  });
  room.on(RoomEvent.ParticipantDisconnected, (p) => { unmeter(p.identity); speakingNow.delete(p.identity); ping(); });
  room.on(RoomEvent.LocalTrackPublished, (pub) => { if (pub.source === Track.Source.Microphone && pub.track) meter(me.id, pub.track.mediaStreamTrack); });
  for (const ev of [RoomEvent.ParticipantConnected, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.Reconnected, RoomEvent.TrackSubscriptionStatusChanged])
    room.on(ev, ping);
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (!room.canPlaybackAudio) void room.startAudio().catch(() => {}); });

  /* ---- reactions over the data channel ---- */
  const reactSubs = new Set<(from: string, emoji: string) => void>();
  const enc = new TextEncoder(), dec = new TextDecoder();
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
    if (topic !== "mustela.react" || !p) return;
    try { const e = JSON.parse(dec.decode(payload)).e; if (typeof e === "string" && e.length <= 16) reactSubs.forEach((f) => f(p.identity, e)); } catch { /* not ours */ }
  });

  await room.connect(url, token);
  void room.startAudio().catch(() => {});
  void ctx.resume().catch(() => {});

  // Join with the microphone on unless you asked otherwise; a refused mic doesn't stop you listening.
  if (!prefs.joinMuted) await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});

  /* ---- input sensitivity: a noise gate in front of the microphone ---- */
  let gate: { ctx: AudioContext; timer: number; clone: MediaStreamTrack } | null = null;
  let sens = { auto: prefs.autoSensitivity, threshold: prefs.threshold };
  const micTrack = () => room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
  function stopGate() {
    if (!gate) return;
    clearInterval(gate.timer); gate.clone.stop(); void gate.ctx.close().catch(() => {});
    gate = null;
    const t = micTrack(); if (t) t.enabled = true;
  }
  function startGate() {
    stopGate();
    if (sens.auto) return;
    const t = micTrack(); if (!t) return;
    const clone = t.clone();
    const gctx = new AudioContext();
    const an = gctx.createAnalyser(); an.fftSize = 512;
    gctx.createMediaStreamSource(new MediaStream([clone])).connect(an);
    const b = new Float32Array(an.fftSize);
    let lastLoud = 0;
    const timer = window.setInterval(() => {
      an.getFloatTimeDomainData(b);
      let s = 0; for (const x of b) s += x * x;
      const db = 20 * Math.log10(Math.sqrt(s / b.length) || 1e-8);
      const now = performance.now();
      if (db > sens.threshold) lastLoud = now;
      t.enabled = now - lastLoud < 280;
    }, 20);
    gate = { ctx: gctx, timer, clone };
  }
  room.on(RoomEvent.LocalTrackPublished, (pub) => { if (pub.source === Track.Source.Microphone) startGate(); });
  room.on(RoomEvent.LocalTrackUnpublished, (pub) => { if (pub.source === Track.Source.Microphone) { stopGate(); unmeter(me.id); } });
  if (room.localParticipant.isMicrophoneEnabled) { startGate(); const t = micTrack(); if (t) meter(me.id, t); }

  /* ---- soundboard: a separate published track fed by Web Audio ---- */
  let sb: { dest: MediaStreamAudioDestinationNode; track: LocalAudioTrack } | null = null;
  async function soundboard() {
    if (sb) return sb;
    const dest = ctx.createMediaStreamDestination();
    const track = new LocalAudioTrack(dest.stream.getAudioTracks()[0]!, undefined, false);
    await room.localParticipant.publishTrack(track, { name: "soundboard", source: Track.Source.Unknown, dtx: false });
    sb = { dest, track };
    return sb;
  }

  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    clearInterval(tick); stopGate(); sink.remove();
    meters.forEach((m) => m.src.disconnect()); meters.clear();
    void ctx.close().catch(() => {});
  };
  room.on(RoomEvent.Disconnected, cleanup);

  const member = (p: Participant): VoiceMember => ({
    ...(p.identity === me.id ? me : nameOf(p.identity)),
    speaking: speakingNow.has(p.identity),
    muted: !p.isMicrophoneEnabled,
    deaf: p.identity === me.id ? deaf : undefined,
    camera: p.isCameraEnabled,
    screen: p.isScreenShareEnabled,
  });

  let screenTrackOff: (() => void) | undefined;
  return {
    auth: { url, token },
    setMic: async (on) => void (await room.localParticipant.setMicrophoneEnabled(on)),
    setCamera: async (on) => void (await room.localParticipant.setCameraEnabled(on)),
    setScreen: async (on, o) => {
      screenTrackOff?.(); screenTrackOff = undefined;
      if (!on) { await room.localParticipant.setScreenShareEnabled(false); ping(); return; }
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("NoDisplayMedia");
      const q = SCREEN[o?.quality ?? prefs.screenQuality] ?? SCREEN["720p30"];
      // Same capture settings as Stoat's client: raw stream audio, no voice processing on it.
      const pub = await room.localParticipant.setScreenShareEnabled(true, {
        resolution: q.resolution, contentHint: q.contentHint,
        audio: o?.audio === false ? false : { autoGainControl: false, echoCancellation: false, noiseSuppression: false },
      }, { screenShareEncoding: q.encoding });
      // Stopping from the browser's own "Stop sharing" bar or closing the window being shared.
      const t = pub?.track;
      if (t) {
        const ended = () => { void room.localParticipant.setScreenShareEnabled(false).catch(() => {}); const a = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio); if (a?.track) void room.localParticipant.unpublishTrack(a.track); ping(); };
        t.on("ended", ended);
        screenTrackOff = () => t.off("ended", ended);
      }
      ping();
    },
    setDeaf: async (on) => {
      deaf = on;
      applyAll();
      if (on) await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      ping();
    },
    setOutputVolume: (v) => { outVolume = v / 100; applyAll(); },
    setSensitivity: (auto, threshold) => { const was = sens.auto; sens = { auto, threshold }; if (was !== auto || (!auto && !gate)) startGate(); },
    state: () => ({ mic: room.localParticipant.isMicrophoneEnabled, cam: room.localParticipant.isCameraEnabled, screen: room.localParticipant.isScreenShareEnabled, deaf }),
    playSound: async (data, volume = 1) => {
      const s = await soundboard();
      if (ctx.state === "suspended") await ctx.resume();
      const b = await ctx.decodeAudioData(data.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = b;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(s.dest);                  // to everyone in the call
      if (!deaf) gain.connect(ctx.destination); // and to you
      src.start();
    },
    streams: () => [...room.remoteParticipants.values()].filter((p) => p.getTrackPublication(Track.Source.ScreenShare)).map((p) => ({
      id: p.identity,
      watching: !!p.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed,
      hasAudio: !!p.getTrackPublication(Track.Source.ScreenShareAudio),
    })),
    watch: (id, on) => {
      const p = room.remoteParticipants.get(id);
      for (const s of [Track.Source.ScreenShare, Track.Source.ScreenShareAudio]) p?.getTrackPublication(s)?.setSubscribed(on);
      ping();
    },
    userAudio: (id, kind) => { const a = audioOf(id); return kind === "voice" ? { volume: a.v, muted: a.m } : { volume: a.sv, muted: a.sm }; },
    setUserAudio: (id, kind, p) => {
      const a = { ...audioOf(id) };
      if (kind === "voice") { if (p.volume !== undefined) a.v = Math.max(0, Math.min(2, p.volume)); if (p.muted !== undefined) a.m = p.muted; }
      else { if (p.volume !== undefined) a.sv = Math.max(0, Math.min(2, p.volume)); if (p.muted !== undefined) a.sm = p.muted; }
      ua[id] = a; saveUA(ua);
      const rp = room.remoteParticipants.get(id); if (rp) applyVolume(rp);
      ping();
    },
    react: (emoji) => {
      void room.localParticipant.publishData(enc.encode(JSON.stringify({ e: emoji })), { reliable: true, topic: "mustela.react" }).catch(() => {});
      reactSubs.forEach((f) => f(me.id, emoji));
    },
    onReaction: (cb) => (reactSubs.add(cb), () => void reactSubs.delete(cb)),
    leave: async () => { cleanup(); await room.disconnect(); },
    participants: () => [member(room.localParticipant), ...[...room.remoteParticipants.values()].map(member)],
    speaking: () => (meters.size ? [...speakingNow] : room.activeSpeakers.map((p) => p.identity)),
    video: (id, source) => {
      const p = id === me.id ? room.localParticipant : room.remoteParticipants.get(id);
      const pub = source === "camera" ? p?.getTrackPublication(Track.Source.Camera)
        : source === "screen" ? p?.getTrackPublication(Track.Source.ScreenShare)
        : p?.getTrackPublication(Track.Source.ScreenShare) ?? p?.getTrackPublication(Track.Source.Camera);
      return pub?.track?.mediaStreamTrack ?? null;
    },
    onEnd: (cb) => {
      const f = (reason?: DisconnectReason) => { if (!ended || reason !== undefined) cb(reason === DisconnectReason.DUPLICATE_IDENTITY ? "moved" : "dropped"); };
      room.on(RoomEvent.Disconnected, f);
      return () => void room.off(RoomEvent.Disconnected, f);
    },
    onChange: (cb) => (subs.add(cb), () => void subs.delete(cb)),
  };
}

/** Lists microphones, speakers and cameras. Labels only appear once mic/camera permission has been granted. */
export async function listDevices(): Promise<{ input: MediaDeviceInfo[]; output: MediaDeviceInfo[]; video: MediaDeviceInfo[] }> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return { input: all.filter((d) => d.kind === "audioinput"), output: all.filter((d) => d.kind === "audiooutput"), video: all.filter((d) => d.kind === "videoinput") };
  } catch {
    return { input: [], output: [], video: [] };
  }
}
