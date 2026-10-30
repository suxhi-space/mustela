import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { ChannelInfo, Person, VoiceMember } from "../../lib/backend/types";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { openMenu, type MenuItem } from "../menu";
import { setProfileOpen } from "../nav";
import { backend, device, updateDevice } from "../store";
import { openSoundboard } from "./Soundboard";
import { call, canPip, closePopout, enterPip, joinCall, leaveCall, openPopout, toggleCall } from "./state";

/** One person's camera or screen. Muted: their sound plays through the call's audio, not this element. */
export function VideoFill(props: { id: string; source?: "camera" | "screen"; fit?: "cover" | "contain" }) {
  let v!: HTMLVideoElement;
  createEffect(() => {
    call.tick();
    const t = call.handle()?.video(props.id, props.source) ?? null;
    const cur = (v.srcObject as MediaStream | null)?.getVideoTracks()[0];
    if (cur === t) return;
    v.srcObject = t ? new MediaStream([t]) : null;
    if (t) void v.play().catch(() => {});
  });
  onCleanup(() => { if (v) v.srcObject = null; });
  return <video ref={v} class="vid" style={{ "object-fit": props.fit ?? "cover" }} muted playsinline />;
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

/** Right-click someone in the call: their volume, local mute, their stream's sound, watching. */
export function callMemberMenu(e: MouseEvent, p: Person, opts: { focus?(): void; fullscreen?(): void } = {}) {
  const h = call.handle();
  const self = p.id === backend()?.me.id;
  const items: MenuItem[] = [{ header: p.name }];
  if (!self && h?.userAudio && h.setUserAudio) {
    const voice = h.userAudio(p.id, "voice");
    items.push({ custom: () => <VolumeRow label="User volume" value={voice.volume} onChange={(volume) => h.setUserAudio!(p.id, "voice", { volume })} /> });
    items.push({ label: "Mute", icon: "mic-off", checked: voice.muted, onSelect: () => h.setUserAudio!(p.id, "voice", { muted: !voice.muted }) });
    const stream = h.streams?.().find((s) => s.id === p.id);
    if (stream) {
      const sa = h.userAudio(p.id, "stream");
      items.push({ sep: true }, { header: "Stream" });
      if (stream.hasAudio) {
        items.push({ custom: () => <VolumeRow label="Stream volume" value={sa.volume} onChange={(volume) => h.setUserAudio!(p.id, "stream", { volume })} /> });
        items.push({ label: "Mute stream", icon: "volume", checked: sa.muted, onSelect: () => h.setUserAudio!(p.id, "stream", { muted: !sa.muted }) });
      }
      items.push(stream.watching
        ? { label: "Stop watching", icon: "eye-off", onSelect: () => h.watch?.(p.id, false) }
        : { label: "Watch stream", icon: "screen", onSelect: () => h.watch?.(p.id, true) });
    }
  }
  items.push({ sep: true });
  if (opts.focus) items.push({ label: "Focus", icon: "expand", onSelect: opts.focus });
  if (opts.fullscreen) items.push({ label: "Full screen", icon: "fullscreen", onSelect: opts.fullscreen });
  // Profiles open in the main window, so the pop-out leaves this out.
  if ((e.target as Node | null)?.ownerDocument === document) items.push({ label: "Profile", icon: "user", onSelect: () => setProfileOpen(backend()!.person(p.id)) });
  openMenu(e, items);
}

type Tile = { key: string; person: VoiceMember; kind: "person" | "stream" };

/**
 * The call, Discord-style: a dark stage with everyone as tiles (cameras and
 * shared screens as video), click a tile to focus it, full screen, reactions,
 * and the controls along the bottom. Used in voice channels, DM calls and the
 * pop-out window.
 */
export function CallStage(props: { channel: ChannelInfo; compact?: boolean; chatOpen?: boolean; onToggleChat?(): void; header?: JSX.Element; /** Drawn in the pop-out window */ popout?: boolean }) {
  let stage!: HTMLElement;
  const here = () => call.active() && call.channel()?.id === props.channel.id;
  const elsewhere = () => call.active() && !here();
  const [focus, setFocus] = createSignal<string | null>(null);
  const [full, setFull] = createSignal(false);
  // The stage's own window: the main one, or the pop-out.
  const doc = () => stage?.ownerDocument ?? document;
  const sync = () => setFull(doc().fullscreenElement === stage);
  onMount(() => { const d = doc(); d.addEventListener("fullscreenchange", sync); onCleanup(() => d.removeEventListener("fullscreenchange", sync)); });
  const toggleFull = () => (doc().fullscreenElement ? void doc().exitFullscreen() : void stage.requestFullscreen?.().catch(() => {}));

  const tiles = createMemo<Tile[]>(() => {
    const out: Tile[] = [];
    const hide = device().hideNoVideo;
    for (const p of call.people()) {
      // "Hide people without video" keeps cameras and streams, and always you.
      if (!hide || p.camera || p.id === backend()?.me.id) out.push({ key: `p:${p.id}`, person: p, kind: "person" });
      if (p.screen) out.push({ key: `s:${p.id}`, person: p, kind: "stream" });
    }
    return out;
  });
  // Tiles are listed by key, so a tile (and its video) stays put when someone starts or stops talking.
  // Rebuilding every tile on each change made streams stutter and could crash the call.
  const byKey = createMemo(() => new Map(tiles().map((t) => [t.key, t])));
  const keys = createMemo<string[]>((prev) => { const next = tiles().map((t) => t.key); return prev && prev.length === next.length && prev.every((k, i) => k === next[i]) ? prev : next; });
  // A new stream gets the focus, like Discord.
  let seen = new Set<string>();
  createEffect(() => {
    const streams = tiles().filter((t) => t.kind === "stream").map((t) => t.key);
    const fresh = streams.find((k) => !seen.has(k));
    seen = new Set(streams);
    if (fresh && !focus()) setFocus(fresh);
    if (focus() && !tiles().some((t) => t.key === focus())) setFocus(null);
  });
  const focused = () => (focus() && byKey().has(focus()!) ? focus() : null);
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
    const mutedForMe = () => (call.tick(), p().id !== backend()?.me.id && !!call.handle()?.userAudio?.(p().id, "voice").muted);
    const hasVideo = () => (call.tick(), !!call.handle()?.video(p().id, tp.t.kind === "stream" ? "screen" : "camera"));
    const watching = () => tp.t.kind !== "stream" || p().id === backend()?.me.id || !!streamInfo(p().id)?.watching || hasVideo();
    return (
      <div class="ctile" classList={{ talking: talking() && !sound(), sound: sound(), stream: tp.t.kind === "stream", big: !!tp.big, video: hasVideo() }}
        onClick={() => setFocus(focus() === tp.t.key ? null : tp.t.key)}
        onDblClick={() => { setFocus(tp.t.key); toggleFull(); }}
        onContextMenu={(e) => callMemberMenu(e, p(), { focus: () => setFocus(tp.t.key), fullscreen: () => { setFocus(tp.t.key); toggleFull(); } })}>
        <Show when={hasVideo() && watching()} fallback={
          <Show when={tp.t.kind === "stream" && !watching()} fallback={<span class="ctile-av"><Avatar person={p()} size={tp.big ? 96 : 64} presence={false} still={!talking() && !!device().perf.lighterInCalls} /></span>}>
            <div class="ctile-watch">
              <Icon name="screen" size={28} />
              <span>{p().name} is streaming</span>
              <button class="btn small primary" onClick={(e) => { e.stopPropagation(); call.handle()?.watch?.(p().id, true); setFocus(tp.t.key); }}>Watch stream</button>
            </div>
          </Show>
        }>
          <VideoFill id={p().id} source={tp.t.kind === "stream" ? "screen" : "camera"} fit={tp.t.kind === "stream" ? "contain" : "cover"} />
        </Show>
        <span class="ctile-name">
          <Show when={tp.t.kind === "stream"}><span class="live-pill">LIVE</span></Show>
          <NameText person={p()} />
          <Show when={tp.t.kind === "person" && p().deaf}><Icon name="headphones-off" size={14} class="danger" /></Show>
          <Show when={tp.t.kind === "person" && p().muted && !p().deaf}><Icon name="mic-off" size={14} class="danger" /></Show>
          <Show when={tp.t.kind === "person" && mutedForMe()}><span title="You muted them for yourself"><Icon name="volume-off" size={14} class="muted-me" /></span></Show>
        </span>
      </div>
    );
  };

  return (
    <section ref={stage} class="cstage" classList={{ compact: !!props.compact, full: full() }} aria-label="Call">
      <Show when={props.header}>{props.header}</Show>
      <Show when={here() && (!call.popped() || props.popout)} fallback={
        <div class="cstage-idle">
          <Show when={call.popped() && here()} fallback={
            <>
              <div class="cs-head">
                <span class="cs-ic"><Icon name="speaker" size={22} /></span>
                <h2>{props.channel.name}</h2>
              </div>
              {/* Who's here, before you join */}
              <Show when={props.channel.voice?.length} fallback={<p class="muted">No one's here yet. Join and others will see you're in.</p>}>
                <section class="cs-people">
                  <h3 class="label">{props.channel.voice!.length === 1 ? "1 person" : `${props.channel.voice!.length} people`} in voice</h3>
                  <ul>
                    <For each={(props.channel.voice ?? []).slice(0, 8)}>{(p) => (
                      <li><Avatar person={p} size={30} presence={false} still /><span class="cs-name"><NameText person={p} /></span>
                        <Show when={p.screen}><span class="live-pill">LIVE</span></Show>
                        <Show when={p.muted}><Icon name="mic-off" size={14} class="danger" /></Show></li>
                    )}</For>
                    <Show when={(props.channel.voice?.length ?? 0) > 8}><li class="muted">and {props.channel.voice!.length - 8} more</li></Show>
                  </ul>
                </section>
              </Show>
              <Show when={elsewhere()}><p class="muted small">You're in {call.channel()?.name}. Joining moves you here.</p></Show>
              <div class="cs-join">
                <Show when={props.onToggleChat}><button class="cbtn" title="Open the channel's chat" aria-label="Chat" onClick={props.onToggleChat}><Icon name="chat" size={20} /></button></Show>
                <button class="btn big primary cs-join-btn" disabled={call.busy()} onClick={() => void joinCall(props.channel)}>{call.busy() ? "Joining…" : elsewhere() ? "Switch to this call" : "Join voice"}</button>
              </div>
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
            <div class="cgrid" style={{ "--n": String(Math.min(keys().length, 16)) }}>
              <For each={keys()}>{(k) => <TileView k={k} />}</For>
            </div>
          }>{(f) => (
            <>
              <div class="cfocus"><TileView k={f()} big /></div>
              <Show when={others().length}><div class="cstrip"><For each={others()}>{(k) => <TileView k={k} />}</For></div></Show>
            </>
          )}</Show>
        </div>
        <Show when={call.error()}><p class="err cstage-err" role="alert">{call.error()}</p></Show>
        <div class="cbar" role="toolbar" aria-label="Call controls">
          <span class="cbar-side">
            <button class="cbtn ghost desk-only" classList={{ on: device().hideNoVideo }} aria-pressed={device().hideNoVideo} title={device().hideNoVideo ? "Show everyone" : "Hide people without video"} onClick={() => updateDevice({ hideNoVideo: !device().hideNoVideo })}><Icon name="video-off" size={18} /></button>
            <Show when={props.onToggleChat}><button class="cbtn ghost" classList={{ on: !!props.chatOpen }} title={props.chatOpen ? "Hide chat" : "Show chat"} aria-pressed={!!props.chatOpen} onClick={props.onToggleChat}><Icon name="chat" size={20} /></button></Show>
          </span>
          <span class="cbar-mid">
            <button class="cbtn" classList={{ off: !call.on().mic }} title={call.on().mic ? "Mute" : "Unmute"} aria-pressed={!call.on().mic} onClick={() => void toggleCall("mic")}><Icon name={call.on().mic ? "mic" : "mic-off"} size={20} /></button>
            <button class="cbtn" classList={{ off: call.on().deaf }} title={call.on().deaf ? "Undeafen" : "Deafen"} aria-pressed={call.on().deaf} onClick={() => void toggleCall("deaf")}><Icon name={call.on().deaf ? "headphones-off" : "headphones"} size={20} /></button>
            <button class="cbtn" classList={{ on: call.on().cam }} title={call.on().cam ? "Turn off camera" : "Turn on camera"} aria-pressed={call.on().cam} onClick={() => void toggleCall("cam")}><Icon name={call.on().cam ? "video" : "video-off"} size={20} /></button>
            <button class="cbtn" classList={{ on: call.on().screen }} title={call.on().screen ? "Stop sharing" : "Share your screen"} aria-pressed={call.on().screen} onClick={() => void toggleCall("screen")}><Icon name="screen" size={20} /></button>
            <button class="cbtn" title="Soundboard" onClick={(e) => openSoundboard(e.currentTarget)}><Icon name="music" size={20} /></button>
            <Show when={canPip()}><button class="cbtn" title="Picture in picture" onClick={() => void enterPip()}><Icon name="collapse" size={20} /></button></Show>
            <button class="cbtn leave" title="Leave call" onClick={() => void leaveCall()}><Icon name="hangup" size={22} /></button>
            {/* Phones: the rest in one menu, so the bar fits */}
            <button class="cbtn ghost phone-only" title="More" aria-label="More call options" onClick={(e) => openMenu(e.currentTarget, [
              { label: device().hideNoVideo ? "Show everyone" : "Hide people without video", icon: "video-off", onSelect: () => updateDevice({ hideNoVideo: !device().hideNoVideo }) },
              { label: full() ? "Exit full screen" : "Full screen", icon: full() ? "fullscreen-exit" : "fullscreen", onSelect: toggleFull },
            ])}><Icon name="dots" size={20} /></button>
          </span>
          <span class="cbar-side right desk-only">
            <Show when={call.canPopOut()}>
              <Show when={props.popout} fallback={<button class="cbtn ghost" title="Pop out" aria-label="Pop out" onClick={() => void openPopout()}><Icon name="popout" size={18} /></button>}>
                <button class="cbtn ghost" title="Bring the call back" aria-label="Bring the call back" onClick={() => void closePopout()}><Icon name="back" size={18} /></button>
              </Show>
            </Show>
            <button class="cbtn ghost" title={full() ? "Exit full screen" : "Full screen"} onClick={toggleFull}><Icon name={full() ? "fullscreen-exit" : "fullscreen"} size={18} /></button>
          </span>
        </div>
      </Show>
    </section>
  );
}
