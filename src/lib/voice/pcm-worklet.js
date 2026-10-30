// Plays the screen-share sound Mustela captures itself (src-tauri/src/screen.rs): 48 kHz stereo
// float chunks (about 20 ms each), interleaved. It holds a little audio back before playing so short
// hiccups don't click, and if it falls behind it drops one chunk at a time (never a big jump), so the
// sound never drifts behind the picture. Its own file (not a blob) so the app's security policy,
// which only runs Mustela's own scripts, lets it load.
registerProcessor("mustela-pcm", class extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.off = 0; this.primed = false;
    this.port.onmessage = (e) => { this.q.push(new Float32Array(e.data)); if (this.q.length > 8) { this.q.shift(); this.off = 0; } };
  }
  process(_, outs) {
    const [l, r] = outs[0]; let i = 0;
    // Wait for about 60 ms of sound before starting (again, after running dry).
    if (!this.primed) { if (this.q.length < 3) { l.fill(0); r.fill(0); return true; } this.primed = true; }
    if (!this.q.length) this.primed = false;
    while (i < l.length && this.q.length) {
      const b = this.q[0];
      while (i < l.length && this.off < b.length) { l[i] = b[this.off]; r[i] = b[this.off + 1]; i++; this.off += 2; }
      if (this.off >= b.length) { this.q.shift(); this.off = 0; }
    }
    for (; i < l.length; i++) { l[i] = 0; r[i] = 0; }
    return true;
  }
});
