import { PHONE_QUERY } from "../hooks";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import type { ChannelInfo, Person, VoiceMember, VoicePrefs } from "../../lib/backend/types";
import { Select, Slider, Switch } from "../controls";
import { devices } from "../settings/VoiceVideo";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { attempt, copy, openMenu, type MenuItem } from "../menu";
import { backToList, currentServer, openChannel, setProfileOpen, setSettingsOpen } from "../nav";
import { channelMenu, friendItems, voiceModItems } from "../menus";
import { composer } from "../chat/Composer";
import { backend, device, platform, updateDevice } from "../store";
import { inTauri } from "../../lib/platform";
import { landscapeTablet, phoneCall, setTabletFull, tabletFull } from "./tablet";
import { createPhone } from "../hooks";
import { openSoundboard } from "./Soundboard";
import { applyVoicePrefs, call, canPip, closePopout, enterPip, joinCall, leaveCall, openPopout, screenButton, toggleCall } from "./state";

/** One person's camera or screen. Muted: their sound plays through the call's audio, not this element. */
/**
 * Whether Mustela is the window you're using right now (focused and visible). Your own stream's preview
 * pauses when it isn't, like Discord's, so sharing doesn't also cost a second copy being drawn.
 */
const [appActive, setAppActive] = createSignal(typeof document === "undefined" || (document.hasFocus() && !document.hidden));
if (typeof window !== "undefined") {
  const sync = () => setAppActive(document.hasFocus() && !document.hidden);
  window.addEventListener("focus", sync); window.addEventListener("blur", () => setTimeout(sync, 0));
  document.addEventListener("visibilitychange", sync);
}

export function VideoFill(props: { id: string; source?: "camera" | "screen"; fit?: "cover" | "contain" }) {
  let v!: HTMLVideoElement;
  // Your own screen share, while you're in another window: the stream keeps going, only this preview stops.
  const mine = () => props.source === "screen" && props.id === backend()?.me.id;
  const paused = () => mine() && !appActive() && !(v?.ownerDocument && v.ownerDocument !== document && v.ownerDocument.hasFocus());
  createEffect(() => {
    call.tick();
    const t = paused() ? null : call.handle()?.video(props.id, props.source) ?? null;
    const cur = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (cur === t) return;
    v.srcObject = t ? new MediaStream([t]) : null;
    if (t) void v.play().catch(() => {});
  });
  onCleanup(() => { if (v) v.srcObject = null; });
  return (
    <>
      <video ref={v} class="vid" style={{ "object-fit": props.fit ?? "cover" }} muted playsinline />
      <Show when={paused()}>
        <div class="vid-paused"><strong>Your stream is still running!</strong><span>The preview is paused while you're in another window, to save resources.</span></div>
      </Show>
    </>
  );
}

/** A volume slider row for the right-click menu (0-200%, like Discord). */
function VolumeRow(props: { label: string; value: number; onChange(v: number): void }) {
  const [v, setV] = createSignal(Math.round(props.value * 100));
  return (
    <div class="ctx-volume" onClick={(e) => e.stopPropagation()}>
      <span class="ctx-label">{props.label}<b>{v()}%</b></span>
      <input type="range" min={0} max={200} step={5} value={v()} aria-label={props.label}
        onInput={(e) => { setV(+e.currentTarget.value); props.onChange(+e.currentTarget.value / 100); }} />
    </div>
  );
}

/**
 * Right-click (or hold) someone in a voice channel, laid out like Discord's: who they are, how they sound to you,
 * what you see, friends, and (with the permissions) moving and server-muting them. Only what Stoat and Mustela can
 * actually do.
 */
export async function callMemberMenu(e: MouseEvent, p: Person, opts: { focus?(): void; fullscreen?(): void; serverId?: string; channelId?: string } = {}) {
  e.preventDefault(); e.stopPropagation();
  const be = backend();
  if (!be) return;
  const h = call.handle();
  const self = p.id === be.me.id;
  const inMyCall = !!h && call.people().some((x) => x.id === p.id);
  const channelId = opts.channelId ?? (inMyCall ? call.channel()?.id : undefined);
  const serverId = opts.serverId ?? (channelId ? be.serverOfChannel?.(channelId) : undefined);
  const person = be.person(p.id) ?? p;
  // Phones: a card from the bottom with their picture, instead of a little menu.
  const sheet = matchMedia(PHONE_QUERY + ", (pointer: coarse) and (orientation: portrait)").matches;
  const items: MenuItem[] = sheet ? [] : [{ header: p.name }];
  // Profiles open in the main window, so the pop-out leaves this out.
  if ((e.target as Node | null)?.ownerDocument === document) items.push({ label: "Profile", icon: "user", onSelect: () => setProfileOpen(person) });
  items.push({ label: "Mention", icon: "at", onSelect: () => composer.insert(`<@${p.id}> `) });
  if (!self) items.push({ label: "Message", icon: "chat", onSelect: () => attempt(async () => openChannel(await be.openDM(p.id))) });
  if (!self && inMyCall && h?.userAudio && h.setUserAudio) {
    const voice = h.userAudio(p.id, "voice");
    items.push({ sep: true });
    items.push({ custom: () => <VolumeRow label="User volume" value={voice.volume} onChange={(volume) => h.setUserAudio!(p.id, "voice", { volume })} /> });
    items.push({ label: "Mute for me", icon: voice.muted ? "volume-off" : "mic-off", checked: voice.muted, onSelect: () => h.setUserAudio!(p.id, "voice", { muted: !voice.muted }) });
    const stream = h.streams?.().find((s) => s.id === p.id);
    if (stream) {
      const sa = h.userAudio(p.id, "stream");
      items.push({ sep: true }, { header: "Stream" });
      if (stream.hasAudio) {
        items.push({ custom: () => <VolumeRow label="Stream volume" value={sa.volume} onChange={(volume) => h.setUserAudio!(p.id, "stream", { volume })} /> });
        items.push({ label: "Mute stream for me", icon: sa.muted ? "volume-off" : "volume", checked: sa.muted, onSelect: () => h.setUserAudio!(p.id, "stream", { muted: !sa.muted }) });
      }
      items.push(stream.watching
        ? { label: "Stop watching", icon: "eye-off", onSelect: () => h.watch?.(p.id, false) }
        : { label: "Watch stream", icon: "screen", onSelect: () => h.watch?.(p.id, true) });
    }
  }
  if (opts.focus || opts.fullscreen) items.push({ sep: true });
  if (opts.focus) items.push({ label: "Focus", icon: "expand", onSelect: opts.focus });
  if (opts.fullscreen) items.push({ label: "Full screen", icon: "fullscreen", onSelect: opts.fullscreen });
  if (!self) items.push(...friendItems(person));
  items.push(...(await voiceModItems(person, serverId, channelId)));
  items.push({ sep: true }, { label: "Copy user ID", icon: "id", onSelect: () => copy(p.id, "ID copied") });
  openMenu(e, items, sheet ? { sheet, head: () => (
    <div class="ctx-person"><Avatar person={p} size={56} presence={false} /><span><strong><NameText person={p} /></strong><Show when={p.username}><small>{p.username}</small></Show></span></div>
  ) } : {});
}

import { holdToOpen, justHeld, markHeld } from "../hold";

type Tile = { key: string; person: VoiceMember; kind: "person" | "stream"; ended?: boolean };

/**
 * Lays the call's tiles out like Discord: every tile the same shape (16:9, or nearly square on a phone), as big as
 * they can be while all of them fit, centred. When there are so many that they'd get too small, they stay at a
 * readable size and the grid scrolls instead. Phones with one or two people keep their full-height tiles.
 */
function fitTiles(el: HTMLElement, count: () => number, phone: () => boolean) {
  const lay = () => {
    const n = count(), p = phone();
    if (!n || (p && n <= 2)) { el.removeAttribute("data-fit"); el.removeAttribute("data-scroll"); return; }
    const cs = getComputedStyle(el);
    const W = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    const gap = parseFloat(cs.columnGap) || 8;
    const aspect = p ? 1 : 16 / 9;
    const minW = p ? 140 : matchMedia("(pointer: coarse)").matches ? 220 : 190;
    const minCols = p ? 2 : 1;
    const fits = Array.from({ length: Math.max(1, n - minCols + 1) }, (_, i) => {
      const cols = minCols + i, rows = Math.ceil(n / cols);
      return { cols, w: Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * aspect) };
    });
    // The biggest tiles win; when another layout is nearly as big, the one closer to a square grid looks better.
    const top = Math.max(...fits.map((f) => f.w));
    const square = (cols: number) => Math.abs(cols - Math.ceil(n / cols));
    let best = fits.filter((f) => f.w >= top * 0.9).sort((a, b) => square(a.cols) - square(b.cols) || b.w - a.w)[0]!;
    let scroll = false;
    if (best.w < minW) {
      // Too crowded to fit: keep them readable and scroll.
      const cols = Math.max(minCols, Math.floor((W + gap) / (minW + gap)));
      best = { cols, w: (W - gap * (cols - 1)) / cols };
      scroll = Math.ceil(n / cols) * (best.w / aspect + gap) - gap > H + 1;
    }
    el.dataset.fit = "";
    el.toggleAttribute("data-scroll", scroll);
    el.style.setProperty("--fit-cols", String(best.cols));
    el.style.setProperty("--fit-w", `${Math.floor(best.w)}px`);
    el.style.setProperty("--fit-h", `${Math.floor(best.w / aspect)}px`);
  };
  const ro = new ResizeObserver(lay);
  ro.observe(el);
  createEffect(() => { count(); phone(); lay(); });
  onCleanup(() => ro.disconnect());
}

/**
 * The call, Discord-style: a dark stage with everyone as tiles (cameras and
 * shared screens as video), click a tile to focus it, full screen, reactions,
 * and the controls along the bottom. Used in voice channels, DM calls and the
 * pop-out window.
 */
export function CallStage(props: { channel: ChannelInfo; compact?: boolean; chatOpen?: boolean; onToggleChat?(): void; header?: JSX.Element; /** Drawn in the pop-out window */ popout?: boolean }) {
  let stage!: HTMLElement;
  const here = () => call.active() && call.channel()?.id === props.channel.id;
  // The phone call screen on phones and upright tablets; sideways tablets get it in full screen (see tablet.ts).
  const phoneWidth = createPhone();
  const phone = () => phoneCall(phoneWidth());
  const elsewhere = () => call.active() && !here();
  const [focus, setFocus] = createSignal<string | null>(null);
  // Phones, in the call itself: the controls (and the top bar) step aside after a few seconds so the call
  // or a stream gets the whole screen. A tap brings them back.
  const [chrome, setChrome] = createSignal(true);
  // A phone held either way (sideways it's wider than the phone layout, but still a phone).
  const touchPhoneMq = (() => { const mq = matchMedia(PHONE_QUERY + ", (pointer: coarse) and (max-height: 500px)"); const [m, setM] = createSignal(mq.matches); const f = () => setM(mq.matches); mq.addEventListener("change", f); onCleanup(() => mq.removeEventListener("change", f)); return m; })();
  const touchPhone = () => touchPhoneMq() || phone();
  let swipe: { x: number; y: number } | null = null;
  let chromeTimer: ReturnType<typeof setTimeout> | undefined;
  let swallow = false; // the tap that brings the controls back doesn't also press what's under it
  onMount(() => stage.addEventListener("click", (e) => { if (swallow) { swallow = false; e.stopPropagation(); } }, true));
  const wake = () => {
    setChrome(true); clearTimeout(chromeTimer);
    // The controls step aside after a few seconds (a tap brings them back); this never enlarges anything by itself.
    if (touchPhone() && here() && !props.popout && (!props.chatOpen || !phone())) chromeTimer = setTimeout(() => { if (!document.querySelector(".call-sheet.open, .ctx-sheet, .soundboard")) setChrome(false); else wake(); }, 4000);
  };
  createEffect(() => { touchPhone(); here(); props.chatOpen; untrack(wake); });
  createEffect(() => document.documentElement.classList.toggle("call-immersive", touchPhone() && here() && (!props.chatOpen || !phone()) && !chrome()));
  // Phones in the call: its own bar on top replaces the channel's.
  createEffect(() => document.documentElement.classList.toggle("call-top-on", phone() && here() && !props.popout && !props.chatOpen));
  onCleanup(() => document.documentElement.classList.remove("call-top-on"));
  // A tablet using the phone call screen: its own styles (mobile.css), which a sideways tablet's desktop look skips.
  createEffect(() => document.documentElement.classList.toggle("call-phone", phone() && !phoneWidth() && !props.popout));
  onCleanup(() => document.documentElement.classList.remove("call-phone"));
  // Watching a stream on a phone: let it turn sideways, like a video (back to normal when you stop watching).
  // Only someone else's stream: yours is just a "You're sharing your screen!" card on phones.
  createEffect(on(() => touchPhone() && here() && !props.popout && !!focused() && focused()!.startsWith("s:") && focused() !== `s:${backend()?.me.id}` && platform === "android" && inTauri(), (wide) => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("plugin:mustela-native|landscape", { payload: { on: wide } })).catch(() => {});
  }));
  onCleanup(() => {
    if (platform !== "android" || !inTauri()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => { void invoke("plugin:mustela-native|landscape", { payload: { on: false } }); void invoke("plugin:mustela-native|system_bars", { payload: { on: true } }); }).catch(() => {});
  });
  onCleanup(() => { clearTimeout(chromeTimer); document.documentElement.classList.remove("call-immersive"); });
  const [full, setFull] = createSignal(false);
  // Phones: the web view refuses the browser's full screen, so the stage covers the app. The video stays in Mustela.
  const [fill, setFill] = createSignal(false);
  // The stage's own window: the main one, or the pop-out.
  const doc = () => stage?.ownerDocument ?? document;
  const sync = () => setFull(doc().fullscreenElement === stage);
  // A sideways tablet's full screen is the phone call screen across the whole tablet, not the browser's full screen.
  const tabletMode = () => landscapeTablet() && !props.popout && here();
  onMount(() => { const d = doc(); d.addEventListener("fullscreenchange", sync); onCleanup(() => d.removeEventListener("fullscreenchange", sync)); });
  const toggleFull = () => {
    if (tabletMode()) { setTabletFull(!tabletFull()); return; }
    if (touchPhone() && !props.popout) {
      const next = !fill();
      setFill(next);
      if (next) { clearTimeout(chromeTimer); setChrome(false); }
      else wake();
      return;
    }
    if (doc().fullscreenElement) void doc().exitFullscreen();
    else void stage.requestFullscreen?.().catch(() => {});
  };
  const isFull = () => (tabletMode() ? tabletFull() : touchPhone() && !props.popout ? fill() : full());

  /** Someone has a camera on or is streaming: only then is there anything for "only video" to keep. */
  const anyVideo = createMemo(() => call.people().some((p) => p.camera || p.screen));
  const tiles = createMemo<Tile[]>(() => {
    const out: Tile[] = [];
    // "Hide people without video" keeps only cameras and the streams you're watching (you included: no camera,
    // no tile). With nobody on camera or streaming it has nothing to keep, so it does nothing.
    const hide = device().hideNoVideo && anyVideo();
    const me = backend()?.me.id;
    const watched = (id: string) => id === me || !!call.streams().find((s) => s.id === id)?.watching;
    const gone = call.ended();
    for (const p of call.people()) {
      if (!hide || p.camera) out.push({ key: `p:${p.id}`, person: p, kind: "person" });
      if (p.screen && (!hide || watched(p.id))) out.push({ key: `s:${p.id}`, person: p, kind: "stream" });
      // A stream you were watching ended: its tile stays (same place) until you close it.
      else if (!p.screen && gone.includes(p.id)) out.push({ key: `s:${p.id}`, person: p, kind: "stream", ended: true });
    }
    for (const id of gone) if (!out.some((t) => t.key === `s:${id}`)) out.push({ key: `s:${id}`, person: backend()!.person(id), kind: "stream", ended: true });
    return out;
  });
  // Tiles are listed by key, so a tile (and its video) stays put when someone starts or stops talking.
  // Rebuilding every tile on each change made streams stutter and could crash the call.
  const byKey = createMemo(() => new Map(tiles().map((t) => [t.key, t])));
  const keys = createMemo<string[]>((prev) => { const next = tiles().map((t) => t.key); return prev && prev.length === next.length && prev.every((k, i) => k === next[i]) ? prev : next; });
  // A new stream gets the focus on desktop. Phones keep the grid (like Discord's app): you enlarge one yourself.
  let seen = new Set<string>();
  createEffect(() => {
    const streams = tiles().filter((t) => t.kind === "stream").map((t) => t.key);
    const fresh = streams.find((k) => !seen.has(k));
    seen = new Set(streams);
    if (fresh && !focus() && !phone()) setFocus(fresh);
    if (focus() && !tiles().some((t) => t.key === focus())) setFocus(null);
  });
  const focused = () => (focus() && byKey().has(focus()!) ? focus() : null);
  // Only while a stream is full screen or its controls have stepped aside: the status bar leaves with Mustela's
  // buttons and comes back with them. A tap that shows the buttons shows the clock and battery again.
  createEffect(on(() => {
    const key = focused();
    const watching = !!key?.startsWith("s:") && key !== `s:${backend()?.me.id}`;
    const inStream = fill() || (touchPhone() && here() && watching);
    return platform === "android" && inTauri() && inStream && !chrome();
  }, (hide) => {
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("plugin:mustela-native|system_bars", { payload: { on: !hide } })).catch(() => {});
  }));
  // Enlarging or shrinking a tile starts (or stops) the controls' timer; the call updating many times a second doesn't.
  const hasFocus = createMemo(() => !!focused());
  createEffect(on(hasFocus, () => wake(), { defer: true }));
  const others = createMemo<string[]>(() => keys().filter((k) => k !== focus()));
  const streamInfo = (id: string) => call.streams().find((s) => s.id === id);

  const TileView = (tp: { k: string; big?: boolean }) => {
    // The tile for this key; it stays the same element while the person's details change.
    const tile = () => byKey().get(tp.k);
    return <Show when={tile()}>{(cur) => <TileBody t={cur()} big={tp.big} />}</Show>;
  };
  const TileBody = (tp: { t: Tile; big?: boolean }) => {
    const p = () => tp.t.person;
    const talking = () => tp.t.kind === "person" && call.speaking().includes(p().id);
    const sound = () => tp.t.kind === "person" && call.soundboard().includes(p().id);
    // Muted for you: their voice on a person tile, their stream's sound on a stream tile.
    const mutedForMe = () => (call.tick(), p().id !== backend()?.me.id && !!call.handle()?.userAudio?.(p().id, tp.t.kind === "stream" ? "stream" : "voice").muted);
    const hasVideo = () => (call.tick(), !!call.handle()?.video(p().id, tp.t.kind === "stream" ? "screen" : "camera"));
    const watching = () => tp.t.kind !== "stream" || p().id === backend()?.me.id || !!streamInfo(p().id)?.watching || hasVideo();
    const mine = () => tp.t.kind === "stream" && p().id === backend()?.me.id;
    return (
      <div class="ctile" classList={{ talking: talking() && !sound(), sound: sound(), stream: tp.t.kind === "stream", big: !!tp.big, video: hasVideo() }}
        {...holdToOpen()}
        onClick={() => { if (!justHeld()) setFocus(focus() === tp.t.key ? null : tp.t.key); }}
        onDblClick={() => { setFocus(tp.t.key); toggleFull(); }}
        onContextMenu={(e) => { markHeld(); callMemberMenu(e, p(), { focus: () => setFocus(tp.t.key), fullscreen: () => { setFocus(tp.t.key); toggleFull(); } }); }}>
        <Show when={!tp.t.ended} fallback={
          <div class="ctile-ended">
            <Icon name="screen" size={30} />
            <span>This stream has ended.</span>
            <button class="btn small" onClick={(e) => { e.stopPropagation(); call.handle()?.closeEnded?.(p().id); }}>Close stream</button>
          </div>
        }>
        {/* Phones: your own stream isn't drawn back to you (that's the phone's whole screen, and costly), like Discord. */}
        <Show when={!(phone() && mine())} fallback={
          <div class="ctile-mine">
            <strong>You're sharing your screen!</strong>
            <Show when={tp.big}><span>You can switch to other apps for your friends to see.</span></Show>
            <button class="btn small" onClick={(e) => { e.stopPropagation(); void toggleCall("screen"); }}>Stop sharing</button>
          </div>
        }>
        <Show when={hasVideo() && watching()} fallback={
          <Show when={tp.t.kind === "stream" && !watching()} fallback={<span class="ctile-av"><Avatar person={p()} size={tp.big ? 96 : 64} presence={false} still={!talking() && !!device().perf.lighterInCalls} /></span>}>
            <div class="ctile-watch">
              <Icon name="screen" size={28} />
              <span>{p().name} is streaming</span>
              <button class="btn small primary" onClick={(e) => { e.stopPropagation(); call.handle()?.watch?.(p().id, true); if (!phone()) setFocus(tp.t.key); }}>Watch stream</button>
            </div>
          </Show>
        }>
          <VideoFill id={p().id} source={tp.t.kind === "stream" ? "screen" : "camera"} fit={tp.t.kind === "stream" ? "contain" : "cover"} />
        </Show>
        </Show>
        </Show>
        {/* Phones, on a stream you're watching (or your own): stop it, and make it big or small again */}
        <Show when={phone() && tp.t.kind === "stream" && !tp.t.ended && (mine() || (watching() && hasVideo()))}>
          <button class="ctile-corner left" aria-label={mine() ? "Stop sharing" : "Stop watching"}
            onClick={(e) => { e.stopPropagation(); if (mine()) void toggleCall("screen"); else { call.handle()?.watch?.(p().id, false); if (focus() === tp.t.key) setFocus(null); } }}><Icon name="close" size={18} /></button>
          <button class="ctile-corner right" aria-label={tp.big ? "Make it smaller" : "Make it bigger"}
            onClick={(e) => { e.stopPropagation(); setFocus(focus() === tp.t.key ? null : tp.t.key); }}><Icon name={tp.big ? "collapse" : "expand"} size={18} /></button>
          <Show when={tp.big && !mine() && watching() && hasVideo()}>
            <button class="ctile-fs" aria-label={isFull() ? "Exit full screen" : "Full screen"}
              onClick={(e) => { e.stopPropagation(); setFocus(tp.t.key); toggleFull(); }}><Icon name={isFull() ? "fullscreen-exit" : "fullscreen"} size={18} /></button>
          </Show>
        </Show>
        <span class="ctile-name">
          <Show when={tp.t.kind === "stream"}><Show when={!tp.t.ended} fallback={<Icon name="screen" size={14} />}><span class="live-pill">LIVE</span></Show></Show>
          <NameText person={p()} />
          <Show when={tp.t.kind === "person" && p().deaf}><Icon name="headphones-off" size={14} class="danger" /></Show>
          <Show when={tp.t.kind === "person" && p().muted && !p().deaf}><Icon name="mic-off" size={14} class="danger" /></Show>
          <Show when={tp.t.kind === "person" && mutedForMe()}><span title="You muted them for yourself"><Icon name="volume-off" size={14} class="muted-me" /></span></Show>
        </span>
        {/* A clear corner badge, so a muted stream or person is obvious without listening for it */}
        <Show when={mutedForMe()}>
          <span class="ctile-muted" title={tp.t.kind === "stream" ? "Stream muted for you" : "Muted for you"}><Icon name="volume-off" size={16} /></span>
        </Show>
      </div>
    );
  };

  return (
    <section ref={stage} class="cstage" classList={{ "has-sheet": phone() && !props.popout && here() && (!call.popped() || !!props.popout), compact: !!props.compact, full: full() || fill(), "stage-fill": fill(), "chrome-off": !chrome() }} aria-label="Call"
      onTouchStart={(e) => { const t = e.touches[0]; swipe = t && !(e.target as Element).closest(".call-sheet, .ctx, .soundboard, input, textarea") ? { x: t.clientX, y: t.clientY } : null; }}
      onTouchEnd={(e) => {
        // Phones: swipe up on the call to bring up all the controls (swipe down puts them away), like Discord.
        const t = e.changedTouches[0], s0 = swipe; swipe = null;
        if (!s0 || !t || !phone()) return;
        const dx = t.clientX - s0.x, dy = t.clientY - s0.y;
        if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) { wake(); dispatchEvent(new CustomEvent("mustela:call-sheet", { detail: dy < 0 })); }
      }}
      onPointerDown={(e) => {
        const t = e.target as Element | null;
        if (t?.closest("button, a, input, textarea, .call-sheet, .call-top, .cbar, .ctx, .soundboard")) { wake(); return; }
        const key = focused();
        const watching = touchPhone() && !!key?.startsWith("s:") && key !== `s:${backend()?.me.id}`;
        if (watching && chrome()) { clearTimeout(chromeTimer); setChrome(false); swallow = true; return; }
        if (!chrome()) swallow = true;
        wake();
      }}>
      <Show when={props.header}>{props.header}</Show>
      <Show when={here() && (!call.popped() || props.popout)} fallback={
        <div class="cstage-idle">
          <Show when={call.popped() && here()} fallback={
            <>
              {/* Who's here at a glance: their pictures, then the names (the same on phones; the buttons go to the bottom there). */}
              <div class="cs-faces">
                <For each={(props.channel.voice ?? []).slice(0, 6)} fallback={<span class="cs-empty-ic"><Icon name="speaker" size={34} /></span>}>
                  {(p) => <Avatar person={p} size={56} presence={false} still profile={null} />}
                </For>
              </div>
              <h2>{props.channel.name}</h2>
              <p class="muted">{props.channel.voice?.length ? `${props.channel.voice.map((p) => p.name).slice(0, 3).join(", ")}${props.channel.voice.length > 3 ? ` and ${props.channel.voice.length - 3} more` : ""} ${props.channel.voice.length === 1 ? "is" : "are"} in the call.` : "No one's here yet."}
                {elsewhere() ? ` You're in ${call.channel()?.name}; joining moves you here.` : ""}</p>
              <Show when={phone()} fallback={
                <button class="btn big primary" disabled={call.busy()} onClick={() => void joinCall(props.channel)}>{call.busy() ? "Joining…" : elsewhere() ? "Switch to this call" : "Join voice"}</button>
              }>
              <div class="cs-join">
                  <Show when={props.onToggleChat}><button class="cbtn" title="Open the channel's chat" aria-label="Chat" onClick={props.onToggleChat}><Icon name="chat" size={20} /></button></Show>
                  <button class="btn big primary cs-join-btn" disabled={call.busy()} onClick={() => void joinCall(props.channel)}>{call.busy() ? "Joining…" : elsewhere() ? "Switch to this call" : "Join voice"}</button>
                </div>
              </Show>
              <Show when={call.error()}><p class="err" role="alert">{call.error()}</p></Show>
            </>
          }>
            <Icon name="popout" size={30} />
            <h2>The call is in its own window</h2>
            <button class="btn primary" onClick={() => void closePopout()}>Bring it back here</button>
          </Show>
        </div>
      }>
        <div class="cstage-main" classList={{ focused: !!focused() }}>
          <Show when={focused()} fallback={
            <div class="cgrid" data-n={Math.min(keys().length, 16)} style={{ "--n": String(Math.min(keys().length, 16)) }}
              ref={(el) => fitTiles(el, () => keys().length, phoneWidth)}>
              <For each={keys()}>{(k) => <TileView k={k} />}</For>
            </div>
          }>{(f) => (
            <>
              <div class="cfocus"><TileView k={f()} big /></div>
              {/* Phones: an enlarged stream is all you see (the others come back when you shrink it) */}
              <Show when={others().length && !(phone() && f().startsWith("s:"))}><div class="cstrip"><For each={others()}>{(k) => <TileView k={k} />}</For></div></Show>
            </>
          )}</Show>
        </div>
        <Show when={call.error()}><p class="err cstage-err" role="alert">{call.error()}</p></Show>
        {/* Phones: a simple bar on top, like other apps' call screens: minimise, the channel, sound, chat, people */}
        <Show when={phone() && !props.popout}>
          <header class="call-top">
            <Show when={tabletFull() && tabletMode()} fallback={<button class="ct-btn" aria-label="Minimise the call" onClick={() => backToList()}><Icon name="down" size={22} /></button>}>
              <button class="ct-btn" aria-label="Exit full screen" onClick={() => setTabletFull(false)}><Icon name="fullscreen-exit" size={22} /></button>
            </Show>
            {/* The channel's menu card (like holding it in the list); the chat has its own button next to it. */}
            <button class="ct-name" aria-label={`${props.channel.name}, channel options`} onClick={(e) => channelMenu(e, props.channel, props.channel.kind === "voice" ? currentServer() ?? undefined : undefined)}>
              <Icon name="speaker" size={16} /><span>{props.channel.name}</span><Icon name="down" size={14} />
            </button>
            <span class="grow" />
            <button class="ct-btn" classList={{ on: !call.on().deaf }} aria-label="Sound: where it plays and how loud" onClick={(e) => void openOutputSheet(e.currentTarget)}>
              <Icon name={call.on().deaf ? "headphones-off" : "volume-up"} size={20} /></button>
            <Show when={props.onToggleChat}><button class="ct-btn" aria-label="Open the chat" onClick={() => (tabletFull() && tabletMode() ? setTabletFull(false) : props.onToggleChat?.())}><Icon name="chat" size={20} /></button></Show>
          </header>
        </Show>
        <Show when={phone() && !props.popout}>
          <CallSheet chatOpen={props.chatOpen} onToggleChat={tabletFull() && tabletMode() ? () => setTabletFull(false) : props.onToggleChat} full={isFull()} toggleFull={toggleFull} />
        </Show>
        <div class="cbar" classList={{ "has-sheet": phone() && !props.popout }} role="toolbar" aria-label="Call controls">
          <span class="cbar-side">
            <button class="cbtn ghost desk-only" classList={{ on: device().hideNoVideo && anyVideo() }} aria-pressed={device().hideNoVideo} disabled={!anyVideo()} title={!anyVideo() ? "Nobody has video on" : device().hideNoVideo ? "Show everyone" : "Hide people without video and streams you're not watching"} onClick={() => updateDevice({ hideNoVideo: !device().hideNoVideo })}><Icon name="video-off" size={18} /></button>
            <Show when={props.onToggleChat}><button class="cbtn ghost" classList={{ on: !!props.chatOpen }} title={props.chatOpen ? "Hide chat" : "Show chat"} aria-pressed={!!props.chatOpen} onClick={props.onToggleChat}><Icon name="chat" size={20} /></button></Show>
          </span>
          <span class="cbar-mid">
            <button class="cbtn" classList={{ off: !call.on().mic }} title={call.on().mic ? "Mute" : "Unmute"} aria-pressed={!call.on().mic} onClick={() => void toggleCall("mic")}><Icon name={call.on().mic ? "mic" : "mic-off"} size={20} /></button>
            <button class="cbtn" classList={{ off: call.on().deaf }} title={call.on().deaf ? "Undeafen" : "Deafen"} aria-pressed={call.on().deaf} onClick={() => void toggleCall("deaf")}><Icon name={call.on().deaf ? "headphones-off" : "headphones"} size={20} /></button>
            <button class="cbtn" classList={{ on: call.on().cam }} title={call.on().cam ? "Turn off camera" : "Turn on camera"} aria-pressed={call.on().cam} onClick={() => void toggleCall("cam")}><Icon name={call.on().cam ? "video" : "video-off"} size={20} /></button>
            <button class="cbtn" classList={{ on: call.on().screen }} title={call.on().screen ? "Stop or change your stream" : "Share your screen"} aria-pressed={call.on().screen} onClick={(e) => screenButton(e.currentTarget)}><Icon name="screen" size={20} /></button>
            <button class="cbtn" title="Soundboard" onClick={(e) => openSoundboard(e.currentTarget)}><Icon name="music" size={20} /></button>
            <Show when={canPip()}><button class="cbtn" title="Picture in picture" onClick={() => void enterPip()}><Icon name="collapse" size={20} /></button></Show>
            <button class="cbtn leave" title="Leave call" onClick={() => void leaveCall()}><Icon name="hangup" size={22} /></button>
            {/* Phones: the rest in one menu, so the bar fits */}
            <button class="cbtn ghost phone-only" title="More" aria-label="More call options" onClick={(e) => openMenu(e.currentTarget, [
              { label: device().hideNoVideo ? "Show everyone" : "Hide people without video", icon: "video-off", disabled: !anyVideo(), onSelect: () => updateDevice({ hideNoVideo: !device().hideNoVideo }) },
              { label: isFull() ? "Exit full screen" : "Full screen", icon: isFull() ? "fullscreen-exit" : "fullscreen", onSelect: toggleFull },
            ])}><Icon name="dots" size={20} /></button>
          </span>
          <span class="cbar-side right desk-only">
            <Show when={call.canPopOut()}>
              <Show when={props.popout} fallback={<button class="cbtn ghost" title="Pop out" aria-label="Pop out" onClick={() => void openPopout()}><Icon name="popout" size={18} /></button>}>
                <button class="cbtn ghost" title="Bring the call back" aria-label="Bring the call back" onClick={() => void closePopout()}><Icon name="back" size={18} /></button>
              </Show>
            </Show>
            <button class="cbtn ghost" title={isFull() ? "Exit full screen" : "Full screen"} onClick={toggleFull}><Icon name={isFull() ? "fullscreen-exit" : "fullscreen"} size={18} /></button>
          </span>
        </div>
      </Show>
    </section>
  );
}

/**
 * Phones: the call's controls as a sheet you pull up from the bottom (like Discord's mobile call screen).
 * Collapsed it's the everyday buttons; pulled up it adds everything else and who's in the call.
 */
function CallSheet(props: { chatOpen?: boolean; onToggleChat?(): void; full: boolean; toggleFull(): void }) {
  const [open, setOpen] = createSignal(false);
  const [drag, setDrag] = createSignal(0); // px the sheet is dragged away from where it rests
  let startY = 0, startOpen = false, dragging = false, moved = false;
  // How tall the hidden part is, kept up to date as people join and leave.
  const [extra, setExtra] = createSignal(0);
  const body = (el: HTMLDivElement) => {
    const ro = new ResizeObserver(() => setExtra(el.offsetHeight));
    ro.observe(el); onCleanup(() => ro.disconnect());
  };
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button:not(.sheet-grab)")) return;
    dragging = true; moved = false; startY = e.clientY; startOpen = open();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) moved = true;
    // Closed: drag up (negative) to reveal; open: drag down (positive) to hide.
    setDrag(startOpen ? Math.max(0, Math.min(extra(), dy)) : Math.max(-extra(), Math.min(0, dy)));
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    const d = drag();
    setDrag(0);
    if (!moved) return setOpen(!open());
    if (startOpen ? d > extra() / 3 : -d > extra() / 3) setOpen(!startOpen);
  };
  const offset = () => (open() ? 0 : extra()) + drag();
  const act = (f: () => void) => () => { f(); setOpen(false); };
  // A swipe up anywhere on the call screen pulls the sheet up too (the stage tells it, below).
  const fromStage = (e: Event) => { const v = (e as CustomEvent<boolean>).detail; setOpen(v); };
  addEventListener("mustela:call-sheet", fromStage);
  onCleanup(() => removeEventListener("mustela:call-sheet", fromStage));
  return (
    <>
      <Show when={open()}><div class="sheet-scrim" onClick={() => setOpen(false)} /></Show>
      <Show when={props.onToggleChat}>
        <button class="sheet-chat" classList={{ on: !!props.chatOpen }} aria-label={props.chatOpen ? "Hide chat" : "Show chat"} onClick={props.onToggleChat}><Icon name="chat" size={18} /></button>
      </Show>
      <div class="call-sheet" classList={{ open: open(), dragging: drag() !== 0, measured: extra() > 0 }} style={{ transform: `translateY(${offset()}px)` }}
        role="toolbar" aria-label="Call controls" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <button class="sheet-grab" aria-label={open() ? "Fewer call options" : "More call options"} aria-expanded={open()}><i /></button>
        <div class="sheet-main">
          <button class="cbtn" classList={{ on: call.on().cam }} aria-label={call.on().cam ? "Turn off camera" : "Turn on camera"} aria-pressed={call.on().cam} onClick={() => void toggleCall("cam")}><Icon name={call.on().cam ? "video" : "video-off"} size={22} /></button>
          <button class="cbtn" classList={{ off: !call.on().mic }} aria-label={call.on().mic ? "Mute" : "Unmute"} aria-pressed={!call.on().mic} onClick={() => void toggleCall("mic")}><Icon name={call.on().mic ? "mic" : "mic-off"} size={22} /></button>
          <button class="cbtn" classList={{ on: call.on().screen }} aria-label={call.on().screen ? "Stop or change your stream" : "Share your screen"} aria-pressed={call.on().screen} onClick={(e) => screenButton(e.currentTarget)}><Icon name="screen" size={22} /></button>
          <button class="cbtn" aria-label="Soundboard" onClick={(e) => { const el = e.currentTarget; setOpen(false); openSoundboard(el); }}><Icon name="music" size={22} /></button>
          <button class="cbtn leave" aria-label="Leave call" onClick={() => void leaveCall()}><Icon name="hangup" size={24} /></button>
        </div>
        <div class="sheet-more" ref={body}>
          <div class="sheet-grid">
            <button classList={{ on: call.on().deaf }} onClick={act(() => void toggleCall("deaf"))}><Icon name={call.on().deaf ? "headphones-off" : "headphones"} size={22} /><span>{call.on().deaf ? "Undeafen" : "Deafen"}</span></button>
            <Show when={canPip()}><button onClick={act(() => void enterPip())}><Icon name="collapse" size={22} /><span>Picture in picture</span></button></Show>
            <button classList={{ on: device().hideNoVideo }} disabled={!call.people().some((p) => p.camera || p.screen)} onClick={act(() => updateDevice({ hideNoVideo: !device().hideNoVideo }))}><Icon name="video-off" size={22} /><span>{device().hideNoVideo ? "Show everyone" : "Only video"}</span></button>
            <button onClick={act(props.toggleFull)}><Icon name={props.full ? "fullscreen-exit" : "fullscreen"} size={22} /><span>{props.full ? "Exit full screen" : "Full screen"}</span></button>
          </div>
          <QuickVoiceSettings onAll={act(() => setSettingsOpen("voice"))} />
          <h3 class="label">In the call — {call.people().length}</h3>
          <ul class="sheet-people">
            <For each={call.people()}>{(p) => (
              <li><button {...holdToOpen()} onClick={() => { if (!justHeld()) act(() => setProfileOpen(backend()!.person(p.id)))(); }}
                onContextMenu={(e) => { markHeld(); setOpen(false); callMemberMenu(e, p); }}>
                <span classList={{ "sp-ring": true, talking: call.speaking().includes(p.id) }}><Avatar person={p} size={36} presence={false} still /></span>
                <span class="cs-name"><NameText person={p} /></span>
                <Show when={p.screen}><span class="live-pill">LIVE</span></Show>
                <Show when={p.deaf}><Icon name="headphones-off" size={16} class="danger" /></Show>
                <Show when={p.muted && !p.deaf}><Icon name="mic-off" size={16} class="danger" /></Show>
              </button></li>
            )}</For>
          </ul>
        </div>
      </div>
    </>
  );
}

/** The call settings you reach for mid-call (Discord's call sheet has the same): mic and speaker, and processing. */
function QuickVoiceSettings(props: { onAll(): void }) {
  const [list] = createResource(devices);
  const v = () => device().voice;
  const set = (p: Partial<VoicePrefs>) => { updateDevice({ voice: { ...v(), ...p } }); applyVoicePrefs(); };
  const opts = (l: MediaDeviceInfo[] | undefined, what: string) => [{ v: "", label: "System default" }, ...(l ?? []).map((d, i) => ({ v: d.deviceId, label: d.label || `${what} ${i + 1}` }))];
  return (
    <section class="sheet-settings">
      <h3 class="label">Call settings</h3>
      <div class="ss-row"><Icon name="mic" size={18} /><span>Microphone</span><Select label="Microphone" value={v().inputDevice} options={opts(list()?.input, "Microphone")} onChange={(inputDevice) => set({ inputDevice })} /></div>
      <Show when={list()?.output.length}>
        <div class="ss-row"><Icon name="headphones" size={18} /><span>Speaker</span><Select label="Speaker" value={v().outputDevice} options={opts(list()?.output, "Speaker")} onChange={(outputDevice) => set({ outputDevice })} /></div>
      </Show>
      <div class="ss-row"><Icon name="speaker" size={18} /><span>Call volume</span><Slider label="Call volume" min={0} max={200} value={v().outputVolume} suffix="%" onChange={(outputVolume) => set({ outputVolume })} /></div>
      <div class="ss-row"><Icon name="sparkle" size={18} /><span>Noise suppression</span><Switch label="Noise suppression" on={v().noiseSuppression} onChange={(noiseSuppression) => set({ noiseSuppression })} /></div>
      <div class="ss-row"><Icon name="gear" size={18} /><span>Echo cancellation</span><Switch label="Echo cancellation" on={v().echoCancellation} onChange={(echoCancellation) => set({ echoCancellation })} /></div>
      <button class="btn small ss-all" onClick={props.onAll}>All voice & video settings</button>
    </section>
  );
}

/**
 * Phones: the speaker button in a call. Where the sound plays (phone, speaker, Bluetooth, headphones; on a
 * computer, the output devices), how loud, and deafen, in one card from the bottom.
 */
async function openOutputSheet(anchor: Element) {
  type Out = { id: string; kind: string; name: string; selected: boolean };
  let outs: Out[] = [];
  const android = platform === "android" && inTauri();
  try {
    if (android) {
      const { invoke } = await import("@tauri-apps/api/core");
      const r = await invoke<{ outputs: { id: number; kind: string; name: string; selected: boolean }[] }>("plugin:mustela-native|audio_outputs");
      outs = r.outputs.map((o) => ({ ...o, id: String(o.id) }));
    } else {
      const v = device().voice;
      outs = (await devices()).output.map((d, i) => ({ id: d.deviceId, kind: "other", name: d.label || `Speaker ${i + 1}`, selected: d.deviceId === v.outputDevice }));
      if (outs.length) outs.unshift({ id: "", kind: "other", name: "System default", selected: !v.outputDevice });
    }
  } catch { /* no list: just volume and deafen */ }
  const pick = async (o: Out) => {
    if (android) { const { invoke } = await import("@tauri-apps/api/core"); await invoke("plugin:mustela-native|set_audio_output", { payload: { id: Number(o.id) } }).catch(() => {}); }
    else { updateDevice({ voice: { ...device().voice, outputDevice: o.id } }); applyVoicePrefs(); }
  };
  const icon = (k: string) => ({ earpiece: "phone", speaker: "volume", bluetooth: "headphones", wired: "headphones", usb: "headphones" } as Record<string, string>)[k] ?? "speaker";
  const row = (o: Out): MenuItem => ({ label: o.name, icon: icon(o.kind), checked: o.selected, onSelect: () => void pick(o) });
  const builtIn = outs.filter((o) => o.kind === "earpiece" || o.kind === "speaker"), external = outs.filter((o) => o.kind !== "earpiece" && o.kind !== "speaker");
  const items: MenuItem[] = [
    ...(builtIn.length ? [{ header: "This phone" } as MenuItem, ...builtIn.map(row)] : []),
    ...(external.length ? [{ header: android ? "External devices" : "Output device" } as MenuItem, ...external.map(row)] : []),
    { sep: true },
    { custom: () => <VolumeRow label="Call volume" value={device().voice.outputVolume / 100} onChange={(v) => { updateDevice({ voice: { ...device().voice, outputVolume: Math.round(v * 100) } }); applyVoicePrefs(); }} /> },
    { label: call.on().deaf ? "Undeafen" : "Deafen", icon: call.on().deaf ? "headphones" : "headphones-off", onSelect: () => void toggleCall("deaf") },
  ];
  openMenu(anchor, items, { sheet: true, head: () => <h3 class="out-title">Audio output</h3> });
}
