/**
 * Small interface sounds, synthesized so there are no audio files to ship.
 * Soft sine/triangle tones with quick envelopes: present but not shrill.
 */
export type Sfx = "message" | "join" | "leave" | "mute" | "unmute" | "deafen" | "undeafen";

let ctx: AudioContext | undefined;
const NOTES: Record<Sfx, [number, number][]> = {
  //            [frequency Hz, start offset s]
  message: [[880, 0], [1318.5, 0.07]],
  join: [[523.3, 0], [659.3, 0.08], [784, 0.16]],
  leave: [[784, 0], [659.3, 0.08], [523.3, 0.16]],
  mute: [[440, 0], [330, 0.06]],
  unmute: [[330, 0], [440, 0.06]],
  deafen: [[392, 0], [262, 0.07]],
  undeafen: [[262, 0], [392, 0.07]],
};

export function playSfx(kind: Sfx, volume = 0.18) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    for (const [f, at] of NOTES[kind]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = kind === "message" ? "sine" : "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(volume, t0 + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + at); o.stop(t0 + at + 0.25);
    }
  } catch { /* no audio output */ }
}
