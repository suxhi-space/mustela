/**
 * Screen share from Mustela's own capture (src-tauri/src/screen.rs) instead of the browser's
 * picker: frames arrive as JPEGs over a Tauri channel and become a video track; on Windows an
 * app's sound arrives as raw samples and becomes an audio track. Both go to LiveKit like any
 * other screen share, so Stoat's apps see a normal stream.
 */
export interface ScreenSource { id: string; name: string; app: string; pid: number; width: number; height: number; thumb?: string; primary: boolean }
export interface NativeCapture { video: MediaStreamTrack; audio?: MediaStreamTrack; stop(): void; onEnded(cb: () => void): void }

const SIZES = { "720p30": [1280, 720, 30], "1080p30": [1920, 1080, 30], "1080p60": [1920, 1080, 60] } as const;

export async function listSources(thumbs = true): Promise<ScreenSource[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ScreenSource[]>("screen_sources", { thumbs });
}

/** A video track that pictures can be written into: straight into the track where the web view can, else a canvas stream. */
function frameTrack(w: number, h: number, fps: number): { video: MediaStreamTrack; write(bmp: ImageBitmap): void } {
  const Gen = (globalThis as any).MediaStreamTrackGenerator as (new (o: { kind: "video" }) => MediaStreamTrack & { writable: WritableStream }) | undefined;
  let video: MediaStreamTrack, write: (bmp: ImageBitmap) => void;
  if (Gen && typeof (globalThis as any).VideoFrame === "function") {
    const gen = new Gen({ kind: "video" });
    const writer = gen.writable.getWriter();
    const t0 = performance.now();
    write = (bmp) => {
      const frame = new (globalThis as any).VideoFrame(bmp, { timestamp: Math.round((performance.now() - t0) * 1000) });
      void writer.write(frame).catch(() => {}).finally(() => { try { frame.close(); } catch { /* already closed */ } });
      bmp.close();
    };
    video = gen;
  } else {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { alpha: false })!;
    write = (bmp) => {
      if (cv.width !== bmp.width || cv.height !== bmp.height) { cv.width = bmp.width; cv.height = bmp.height; }
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
    };
    video = cv.captureStream(fps).getVideoTracks()[0]!;
  }
  (video as any).contentHint = "motion";
  return { video, write };
}

export async function startNativeCapture(src: ScreenSource, quality: keyof typeof SIZES, audio: "off" | "app" | "system"): Promise<NativeCapture> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const [w, h, fps] = SIZES[quality] ?? SIZES["720p30"];
  const ended = new Set<() => void>();
  let stopped = false;

  /* ---- video: draw each JPEG and hand it to WebRTC ---- */
  const { video, write } = frameTrack(w, h, fps);

  const frames = new Channel<ArrayBuffer>();
  let busy = false, pending: ArrayBuffer | null = null;
  // Going live waits for the first picture: a share with no frames yet can't be published.
  let firstFrame!: () => void;
  const gotFrame = new Promise<void>((r) => (firstFrame = r));
  const draw = async (buf: ArrayBuffer) => {
    busy = true;
    try { write(await createImageBitmap(new Blob([buf], { type: "image/jpeg" }))); firstFrame(); } catch { /* a bad frame: skip it */ }
    void invoke("screen_ack").catch(() => {});
    busy = false;
    if (pending) { const p = pending; pending = null; void draw(p); }
  };
  frames.onmessage = (buf) => {
    if (stopped) return;
    // An empty message means the window closed or the screen went away.
    if (!buf || (buf as ArrayBuffer).byteLength === 0) { stop(); ended.forEach((f) => f()); return; }
    if (busy) { if (pending) void invoke("screen_ack").catch(() => {}); pending = buf as ArrayBuffer; } else void draw(buf as ArrayBuffer);
  };
  await invoke("screen_start", { id: src.id, width: w, height: h, fps, channel: frames });
  const ok = await Promise.race([gotFrame.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 6000))]);
  if (!ok) {
    stopped = true;
    void invoke("screen_stop").catch(() => {});
    video.stop();
    throw new Error(src.id.startsWith("window:") ? "No picture came from that window. Make sure it's open (not minimised), or share its screen instead." : "No picture came from that screen.");
  }

  /* ---- sound (Windows): 48 kHz stereo float chunks into a small player ---- */
  let audioTrack: MediaStreamTrack | undefined, actx: AudioContext | undefined;
  if (audio !== "off") {
    try {
      actx = new AudioContext({ sampleRate: 48000 });
      await actx.audioWorklet.addModule(new URL("./pcm-worklet.js", import.meta.url));
      const node = new AudioWorkletNode(actx, "mustela-pcm", { numberOfInputs: 0, outputChannelCount: [2] });
      const dest = actx.createMediaStreamDestination();
      node.connect(dest);
      const pcm = new Channel<ArrayBuffer>();
      pcm.onmessage = (buf) => { if (!stopped && buf && (buf as ArrayBuffer).byteLength) node.port.postMessage(buf, [buf as ArrayBuffer]); };
      await invoke("screen_audio", { pid: audio === "app" ? src.pid : 0, channel: pcm });
      audioTrack = dest.stream.getAudioTracks()[0];
    } catch {
      void actx?.close().catch(() => {});
      actx = undefined; audioTrack = undefined; // the picture still goes out without sound
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    void invoke("screen_stop").catch(() => {});
    video.stop();
    audioTrack?.stop();
    void actx?.close().catch(() => {});
  }
  return { video, audio: audioTrack, stop, onEnded: (cb) => void ended.add(cb) };
}

/**
 * Android screen share: Android's own prompt picks the screen, a capture service sends JPEG frames
 * (src-tauri/plugins/mustela-native, ScreenService), and they become a video track like on desktop.
 * No sound yet. At most 30 frames a second, to spare the phone.
 */
export async function startAndroidCapture(quality: keyof typeof SIZES): Promise<NativeCapture> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const [w, h, maxFps] = SIZES[quality] ?? SIZES["720p30"];
  const fps = Math.min(maxFps, 30);
  const ended = new Set<() => void>();
  let stopped = false;
  const { video, write } = frameTrack(w, h, fps);
  let firstFrame!: () => void;
  const gotFrame = new Promise<void>((r) => (firstFrame = r));
  const ack = () => void invoke("plugin:mustela-native|screen_ack").catch(() => {});
  const frames = new Channel<{ f?: string; end?: boolean }>();
  frames.onmessage = (m) => {
    if (stopped) return;
    if (m?.end) { stop(); ended.forEach((f) => f()); return; }
    if (!m?.f) return;
    const bin = atob(m.f), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    void createImageBitmap(new Blob([bytes], { type: "image/jpeg" })).then((bmp) => { write(bmp); firstFrame(); }).catch(() => {}).finally(ack);
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    void invoke("plugin:mustela-native|screen_stop").catch(() => {});
    video.stop();
  }
  // Resolves once you've agreed in Android's prompt ("cancelled" if you didn't).
  await invoke("plugin:mustela-native|screen_start", { payload: { width: w, height: h, fps }, channel: frames });
  const ok = await Promise.race([gotFrame.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
  if (!ok) { stop(); throw new Error("No picture came from your screen."); }
  return { video, stop, onEnded: (cb) => void ended.add(cb) };
}
