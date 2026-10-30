import {
  type AudioProcessorOptions, type TrackProcessor,
  DisconnectReason, LocalAudioTrack, LocalVideoTrack, Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room, RoomEvent,
  AudioPresets, ScreenSharePresets, Track, VideoPresets,
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

  /**
   * Soundboard while you're muted: LiveKit's mute silences the whole mic track, sounds included. So a sound
   * opens the track just for itself, with your voice held at zero, and it mutes again when the sound ends.
   * You show as muted throughout and your voice never goes out.
   */
  let heldOpen = false, soundsPlaying = 0;
  const voiceGain = (open: boolean) => (open && !heldOpen ? 1 : 0);
  /** The microphone's mixer (see the soundboard below), once the mic is published. */
  let mixer: { ctx: AudioContext; voice: GainNode; sounds: GainNode; src: MediaStreamAudioSourceNode; dest: MediaStreamAudioDestinationNode } | null = null;

  /* ---- input sensitivity: a noise gate in front of the microphone ---- */
  let gate: { ctx: AudioContext; timer: number; clone: MediaStreamTrack } | null = null;
  let sens = { auto: prefs.autoSensitivity, threshold: prefs.threshold };
  const micTrack = () => room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
  function stopGate() {
    if (!gate) return;
    clearInterval(gate.timer); gate.clone.stop(); void gate.ctx.close().catch(() => {});
    gate = null;
    const t = micTrack(); if (t) t.enabled = true;
    if (mixer) mixer.voice.gain.value = voiceGain(true);
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
      const open = now - lastLoud < 280;
      // With the mixer in place the gate closes only your voice, never a soundboard sound.
      if (mixer) { mixer.voice.gain.value = voiceGain(open); t.enabled = true; } else t.enabled = open;
    }, 20);
    gate = { ctx: gctx, timer, clone };
  }
  room.on(RoomEvent.LocalTrackPublished, (pub) => { if (pub.source === Track.Source.Microphone) startGate(); });
  room.on(RoomEvent.LocalTrackUnpublished, (pub) => { if (pub.source === Track.Source.Microphone) { stopGate(); unmeter(me.id); } });
  if (room.localParticipant.isMicrophoneEnabled) { startGate(); const t = micTrack(); if (t) meter(me.id, t); }

  /* ---- soundboard: mixed into the microphone ----
   * Stoat's own apps only play people's microphone, so a separate soundboard track was silent for them.
   * Instead the mic goes through a small mixer (a LiveKit audio processor) and sounds are added to it.
   * Sounds play while you're muted too, like Discord's soundboard (see heldOpen above). */
  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: "mustela-soundboard-mix",
    async init(o) {
      const c = o.audioContext;
      const src = c.createMediaStreamSource(new MediaStream([o.track]));
      const dest = c.createMediaStreamDestination();
      const sounds = c.createGain(), voice = c.createGain();
      src.connect(voice).connect(dest);
      sounds.connect(dest);
      mixer = { ctx: c, voice, sounds, src, dest };
      processor.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(o) { await processor.destroy(); await processor.init(o); },
    async destroy() { mixer?.src.disconnect(); mixer?.voice.disconnect(); mixer?.sounds.disconnect(); mixer = null; },
  };
  let soundTrack: { dest: MediaStreamAudioDestinationNode } | null = null;
  async function playOnOwnTrack(data: ArrayBuffer, volume: number) {
    if (ctx.state === "suspended") await ctx.resume();
    if (!soundTrack) {
      const dest = ctx.createMediaStreamDestination();
      const track = dest.stream.getAudioTracks()[0];
      if (!track) throw new Error("Sounds can't play into the call on this system.");
      await room.localParticipant.publishTrack(track, { source: Track.Source.Unknown, name: "soundboard", dtx: false });
      soundTrack = { dest };
    }
    const b = await ctx.decodeAudioData(data.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = b;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(soundTrack.dest);
    if (!deaf) gain.connect(ctx.destination);
    src.onended = () => { gain.disconnect(); src.disconnect(); };
    src.start();
    const secs = Math.min(10, b.duration);
    announceSound(me.id, secs);
    void room.localParticipant.publishData(enc.encode(JSON.stringify({ d: secs })), { reliable: true, topic: "mustela.sound" }).catch(() => {});
  }
  const micPub = () => room.localParticipant.getTrackPublication(Track.Source.Microphone);
  async function attachMixer() {
    const t = micPub()?.track as LocalAudioTrack | undefined;
    if (!t || (t as any).getProcessor?.() === processor) return;
    try { await t.setProcessor(processor); } catch { /* this system can't process audio; sounds won't reach the call */ }
  }
  room.on(RoomEvent.LocalTrackPublished, (pub) => { if (pub.source === Track.Source.Microphone) void attachMixer(); });
  void attachMixer();

  /** Who's playing a sound right now (you, and other Mustela users who said so), for the ring colour. */
  const soundUntil = new Map<string, number>();
  const announceSound = (id: string, seconds: number) => {
    soundUntil.set(id, performance.now() + seconds * 1000);
    ping();
    setTimeout(ping, seconds * 1000 + 30);
  };
  room.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, _k?: unknown, topic?: string) => {
    if (topic !== "mustela.sound" || !p) return;
    try { const d = Number(JSON.parse(dec.decode(payload)).d); if (d > 0 && d <= 12) announceSound(p.identity, d); } catch { /* not ours */ }
  });

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
  /** A share from Mustela's own capture, while it's on. */
  let nativeShare: { video: LocalVideoTrack; audio?: LocalAudioTrack; capture: { stop(): void } } | null = null;
  const unpublishNative = async (n: NonNullable<typeof nativeShare>) => {
    await room.localParticipant.unpublishTrack(n.video).catch(() => {});
    if (n.audio) await room.localParticipant.unpublishTrack(n.audio).catch(() => {});
    n.capture.stop();
  };
  return {
    auth: { url, token },
    setMic: async (on) => {
      // A sound is playing through your muted mic: unmuting just lets your voice in; muting is already true.
      if (heldOpen) { if (on) { heldOpen = false; if (mixer) mixer.voice.gain.value = 1; ping(); } return; }
      await room.localParticipant.setMicrophoneEnabled(on);
    },
    setCamera: async (on) => void (await room.localParticipant.setCameraEnabled(on)),
    setScreen: async (on, o) => {
      screenTrackOff?.(); screenTrackOff = undefined;
      if (nativeShare) { const n = nativeShare; nativeShare = null; await unpublishNative(n); }
      if (!on) { await room.localParticipant.setScreenShareEnabled(false); ping(); return; }
      if (o?.native) {
        // Mustela's own capture: publish its tracks as a normal screen share (same presets as Stoat's).
        const q = SCREEN[o.quality ?? prefs.screenQuality] ?? SCREEN["720p30"];
        const video = new LocalVideoTrack(o.native.video, undefined, true);
        await room.localParticipant.publishTrack(video, { source: Track.Source.ScreenShare, screenShareEncoding: q.encoding, simulcast: false, videoCodec: "vp8" });
        let audio: LocalAudioTrack | undefined;
        if (o.native.audio) {
          audio = new LocalAudioTrack(o.native.audio, undefined, true);
          // Game and video sound, not a voice: stereo at music quality, sent continuously (no voice-style gaps).
          await room.localParticipant.publishTrack(audio, { source: Track.Source.ScreenShareAudio, audioPreset: AudioPresets.musicHighQualityStereo, forceStereo: true, dtx: false, red: false });
        }
        nativeShare = { video, audio, capture: o.native };
        const mine = nativeShare;
        o.native.onEnded(() => { if (nativeShare === mine && mine) { nativeShare = null; void unpublishNative(mine).then(ping); } });
        ping();
        return;
      }
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
    state: () => ({ mic: room.localParticipant.isMicrophoneEnabled && !heldOpen, cam: room.localParticipant.isCameraEnabled, screen: room.localParticipant.isScreenShareEnabled || !!nativeShare, deaf }),
    playSound: async (data, volume = 1) => {
      // Sounds go out through the microphone, so it has to exist; joining muted publishes it silenced.
      if (!micPub()) { await room.localParticipant.setMicrophoneEnabled(true); await micPub()?.mute(); }
      await attachMixer();
      const m = mixer;
      // Some systems (Android's web view among them) can't run the microphone mixer: the sound goes out
      // on its own track instead. Mustela users hear it; Stoat's own apps only play microphones.
      if (!m) return playOnOwnTrack(data, volume);
      if (m.ctx.state === "suspended") await m.ctx.resume();
      const b = await m.ctx.decodeAudioData(data.slice(0));
      const src = m.ctx.createBufferSource();
      src.buffer = b;
      const gain = m.ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(m.sounds);                     // to everyone in the call
      if (!deaf) gain.connect(m.ctx.destination); // and to you
      const pub = micPub();
      if (pub?.isMuted && !heldOpen) { heldOpen = true; m.voice.gain.value = 0; await pub.unmute(); }
      soundsPlaying++;
      src.onended = () => {
        gain.disconnect(); src.disconnect();
        if (--soundsPlaying > 0 || !heldOpen) return;
        heldOpen = false;
        void micPub()?.mute().then(() => { if (mixer) mixer.voice.gain.value = 1; ping(); });
      };
      src.start();
      const secs = Math.min(10, b.duration);
      announceSound(me.id, secs);
      void room.localParticipant.publishData(enc.encode(JSON.stringify({ d: secs })), { reliable: true, topic: "mustela.sound" }).catch(() => {});
    },
    soundboard: () => { const now = performance.now(); return [...soundUntil].filter(([, t]) => t > now).map(([id]) => id); },
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
    leave: async () => { nativeShare?.capture.stop(); nativeShare = null; cleanup(); await room.disconnect(); },
    participants: () => [member(room.localParticipant), ...[...room.remoteParticipants.values()].map(member)],
    // While a sound holds your muted mic open, your ring stays off (your voice isn't going out).
    speaking: () => (meters.size ? [...speakingNow] : room.activeSpeakers.map((p) => p.identity)).filter((id) => !(heldOpen && id === me.id)),
    video: (id, source) => {
      const p = id === me.id ? room.localParticipant : room.remoteParticipants.get(id);
      const pub = source === "camera" ? p?.getTrackPublication(Track.Source.Camera)
        : source === "screen" ? p?.getTrackPublication(Track.Source.ScreenShare)
        : p?.getTrackPublication(Track.Source.ScreenShare) ?? p?.getTrackPublication(Track.Source.Camera);
      return pub?.track?.mediaStreamTrack ?? null;
    },
    onEnd: (cb) => {
      const f = (reason?: DisconnectReason) => { if (!ended || reason !== undefined) cb(reason === DisconnectReason.DUPLICATE_IDENTITY || reason === DisconnectReason.PARTICIPANT_REMOVED ? "moved" : "dropped"); };
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
