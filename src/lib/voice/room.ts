import { Room, RoomEvent, Track } from "livekit-client";
import type { Person, VoiceHandle } from "../backend/types";

/**
 * Voice, camera and screenshare over LiveKit. Stoat's `join_call` hands back
 * a LiveKit URL + token; everything after that is plain livekit-client.
 *
 * Note: screenshare needs getDisplayMedia, which the WebView must support.
 * WebView2 (Windows) and WKWebView (macOS 13+) do; WebKitGTK (Linux) support
 * depends on the distro. Android WebView has no getDisplayMedia, so mobile
 * screenshare needs a native plugin later. Voice and camera work everywhere.
 */
export async function connectVoice(url: string, token: string, me: Person, nameOf: (id: string) => Person): Promise<VoiceHandle> {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const subs = new Set<() => void>();
  const ping = () => subs.forEach((s) => s());
  for (const ev of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ActiveSpeakersChanged, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished])
    room.on(ev, ping);
  await room.connect(url, token);

  return {
    setMic: async (on) => void (await room.localParticipant.setMicrophoneEnabled(on)),
    setCamera: async (on) => void (await room.localParticipant.setCameraEnabled(on)),
    setScreen: async (on) => void (await room.localParticipant.setScreenShareEnabled(on)),
    leave: async () => void (await room.disconnect()),
    participants: () => [me, ...[...room.remoteParticipants.values()].map((p) => nameOf(p.identity))],
    speaking: () => room.activeSpeakers.map((p) => p.identity),
    video: (id) => {
      const p = id === me.id ? room.localParticipant : room.remoteParticipants.get(id);
      const pub = p?.getTrackPublication(Track.Source.ScreenShare) ?? p?.getTrackPublication(Track.Source.Camera);
      return pub?.track?.mediaStreamTrack ?? null;
    },
    onEnd: (cb) => { const f = () => cb(); room.on(RoomEvent.Disconnected, f); return () => void room.off(RoomEvent.Disconnected, f); },
    onChange: (cb) => (subs.add(cb), () => void subs.delete(cb)),
  };
}
