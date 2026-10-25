import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { ChannelInfo, Person, VoiceMember } from "../../lib/backend/types";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { openMenu, type MenuItem } from "../menu";
import { setProfileOpen } from "../nav";
import { backend } from "../store";
import { openSoundboard } from "./Soundboard";
import { call, canPip, closePopout, enterPip, isPopoutWindow, joinCall, leaveCall, openPopout, sendReaction, toggleCall } from "./state";
import { UEmoji } from "../chat/UEmoji";

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

const QUICK = ["👍", "😂", "❤️", "🔥", "😮", "👏", "🎉", "💀"];

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
  if (!isPopoutWindow) items.push({ label: "Profile", icon: "user", onSelect: () => setProfileOpen(backend()!.person(p.id)) });
  openMenu(e, items);
}

type Tile = { key: string; person: VoiceMember; kind: "person" | "stream" };

/**
 * The call, Discord-style: a dark stage with everyone as tiles (cameras and
 * shared screens as video), click a tile to focus it, full screen, reactions,
 * and the controls along the bottom. Used in voice channels, DM calls and the
 * pop-out window.
 */
export function CallStage(props: { channel: ChannelInfo; compact?: boolean; chatOpen?: boolean; onToggleChat?(): void; header?: JSX.Element }) {
  let stage!: HTMLElement;
  const here = () => call.active() && call.channel()?.id === props.channel.id;
  const elsewhere = () => call.active() && !here();
  const [focus, setFocus] = createSignal<string | null>(null);
  const [full, setFull] = createSignal(false);
  const sync = () => setFull(document.fullscreenElement === stage);
  document.addEventListener("fullscreenchange", sync);
  onCleanup(() => document.removeEventListener("fullscreenchange", sync));
  const toggleFull = () => (document.fullscreenElement ? void document.exitFullscreen() : void stage.requestFullscreen?.().catch(() => {}));

  const tiles = createMemo<Tile[]>(() => {
    const out: Tile[] = [];
    for (const p of call.people()) {
      out.push({ key: `p:${p.id}`, person: p, kind: "person" });
      if (p.screen) out.push({ key: `s:${p.id}`, person: p, kind: "stream" });
    }
    return out;
  });
  // A new stream gets the focus, like Discord.
  let seen = new Set<string>();
  createEffect(() => {
    const streams = tiles().filter((t) => t.kind === "stream").map((t) => t.key);
    const fresh = streams.find((k) => !seen.has(k));
    seen = new Set(streams);
    if (fresh && !focus()) setFocus(fresh);
    if (focus() && !tiles().some((t) => t.key === focus())) setFocus(null);
  });
  const focused = () => tiles().find((t) => t.key === focus());
  const others = () => tiles().filter((t) => t.key !== focus());
  const streamInfo = (id: string) => call.streams().find((s) => s.id === id);

  const TileView = (tp: { t: Tile; big?: boolean }) => {
    const p = () => tp.t.person;
    const talking = () => tp.t.kind === "person" && call.speaking().includes(p().id);
    const hasVideo = () => (call.tick(), !!call.handle()?.video(p().id, tp.t.kind === "stream" ? "screen" : "camera"));
    const watching = () => tp.t.kind !== "stream" || p().id === backend()?.me.id || isPopoutWindow || !!streamInfo(p().id)?.watching || hasVideo();
    const reaction = () => call.reactions().filter((r) => r.from === p().id && tp.t.kind === "person");
    return (
      <div class="ctile" classList={{ talking: talking(), stream: tp.t.kind === "stream", big: !!tp.big, video: hasVideo() }}
        onClick={() => setFocus(focus() === tp.t.key ? null : tp.t.key)}
        onDblClick={() => { setFocus(tp.t.key); toggleFull(); }}
        onContextMenu={(e) => callMemberMenu(e, p(), { focus: () => setFocus(tp.t.key), fullscreen: () => { setFocus(tp.t.key); toggleFull(); } })}>
        <Show when={hasVideo() && watching()} fallback={
          <Show when={tp.t.kind === "stream" && !watching()} fallback={<span class="ctile-av"><Avatar person={p()} size={tp.big ? 96 : 64} presence={false} /></span>}>
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
        </span>
        <For each={reaction()}>{(r) => <span class="ctile-react" aria-hidden="true"><UEmoji e={r.emoji} /></span>}</For>
      </div>
    );
  };

  return (
    <section ref={stage} class="cstage" classList={{ compact: !!props.compact, full: full() }} aria-label="Call">
      <Show when={props.header}>{props.header}</Show>
      <Show when={here() && !call.popped()} fallback={
        <div class="cstage-idle">
          <Show when={call.popped() && here()} fallback={
            <>
              <div class="cs-faces">
                <For each={(props.channel.voice ?? []).slice(0, 6)} fallback={<span class="cs-empty-ic"><Icon name="speaker" size={34} /></span>}>
                  {(p) => <Avatar person={p} size={56} presence={false} still profile={null} />}
                </For>
              </div>
              <h2>{props.channel.name}</h2>
              <p class="muted">{props.channel.voice?.length ? `${props.channel.voice.map((p) => p.name).slice(0, 3).join(", ")}${props.channel.voice.length > 3 ? ` and ${props.channel.voice.length - 3} more` : ""} ${props.channel.voice.length === 1 ? "is" : "are"} in the call.` : "No one's here yet."}
                {elsewhere() ? ` You're in ${call.channel()?.name}; joining moves you here.` : ""}</p>
              <button class="btn big primary" disabled={call.busy()} onClick={() => void joinCall(props.channel)}>{call.busy() ? "Joining…" : elsewhere() ? "Switch to this call" : "Join voice"}</button>
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
            <div class="cgrid" style={{ "--n": String(Math.min(tiles().length, 16)) }}>
              <For each={tiles()}>{(t) => <TileView t={t} />}</For>
            </div>
          }>{(f) => (
            <>
              <div class="cfocus"><TileView t={f()} big /></div>
              <Show when={others().length}><div class="cstrip"><For each={others()}>{(t) => <TileView t={t} />}</For></div></Show>
            </>
          )}</Show>
          <div class="creacts" aria-hidden="true"><For each={call.reactions()}>{(r) => <span style={{ left: `${10 + (r.key * 80)}%` }}><UEmoji e={r.emoji} /></span>}</For></div>
        </div>
        <Show when={call.error()}><p class="err cstage-err" role="alert">{call.error()}</p></Show>
        <div class="cbar" role="toolbar" aria-label="Call controls">
          <span class="cbar-side">
            <Show when={props.onToggleChat}><button class="cbtn ghost" classList={{ on: !!props.chatOpen }} title={props.chatOpen ? "Hide chat" : "Show chat"} aria-pressed={!!props.chatOpen} onClick={props.onToggleChat}><Icon name="chat" size={20} /></button></Show>
          </span>
          <span class="cbar-mid">
            <button class="cbtn" classList={{ off: !call.on().mic }} title={call.on().mic ? "Mute" : "Unmute"} aria-pressed={!call.on().mic} onClick={() => void toggleCall("mic")}><Icon name={call.on().mic ? "mic" : "mic-off"} size={20} /></button>
            <button class="cbtn" classList={{ off: call.on().deaf }} title={call.on().deaf ? "Undeafen" : "Deafen"} aria-pressed={call.on().deaf} onClick={() => void toggleCall("deaf")}><Icon name={call.on().deaf ? "headphones-off" : "headphones"} size={20} /></button>
            <button class="cbtn" classList={{ on: call.on().cam }} title={call.on().cam ? "Turn off camera" : "Turn on camera"} aria-pressed={call.on().cam} onClick={() => void toggleCall("cam")}><Icon name={call.on().cam ? "video" : "video-off"} size={20} /></button>
            <button class="cbtn" classList={{ on: call.on().screen }} title={call.on().screen ? "Stop sharing" : "Share your screen"} aria-pressed={call.on().screen} onClick={() => void toggleCall("screen")}><Icon name="screen" size={20} /></button>
            <button class="cbtn" title="Soundboard" onClick={(e) => openSoundboard(e.currentTarget)}><Icon name="music" size={20} /></button>
            <button class="cbtn" title="Send a reaction" onClick={(e) => openMenu(e.currentTarget, [{ custom: () => (
              <div class="react-row">{QUICK.map((q) => <button onClick={() => sendReaction(q)}>{q}</button>)}</div>
            ) }])}><Icon name="smile" size={20} /></button>
            <Show when={canPip()}><button class="cbtn" title="Picture in picture" onClick={() => void enterPip()}><Icon name="collapse" size={20} /></button></Show>
            <button class="cbtn leave" title="Leave call" onClick={() => void leaveCall()}><Icon name="hangup" size={22} /></button>
          </span>
          <span class="cbar-side right">
            <Show when={call.canPopOut()}><button class="cbtn ghost" title="Pop out" onClick={() => void openPopout()}><Icon name="popout" size={18} /></button></Show>
            <button class="cbtn ghost" title={full() ? "Exit full screen" : "Full screen"} onClick={toggleFull}><Icon name={full() ? "fullscreen-exit" : "fullscreen"} size={18} /></button>
          </span>
        </div>
      </Show>
    </section>
  );
}
