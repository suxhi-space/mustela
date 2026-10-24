import { createEffect, For, onCleanup, Show } from "solid-js";
import type { ChannelInfo, Person } from "../lib/backend/types";
import { call, joinCall, leaveCall, openPopout, toggleCall } from "./call/state";
import { Avatar, NameText } from "./Avatar";
import { Icon } from "./icons";

/** A person's camera or screen, when they have one on. */
function VideoFill(props: { person: Person }) {
  let v!: HTMLVideoElement;
  createEffect(() => {
    call.people(); // re-check when tracks change
    const t = call.handle()?.video(props.person.id) ?? null;
    v.srcObject = t ? new MediaStream([t]) : null;
    if (t) void v.play().catch(() => {});
  });
  onCleanup(() => { if (v) v.srcObject = null; });
  return <video ref={v} class="vid" muted playsinline />;
}

export function Voice(props: { channel: ChannelInfo }) {
  const here = () => call.active() && call.channel()?.id === props.channel.id;
  const elsewhere = () => call.active() && !here();
  const on = call.on;
  const ctl = (k: "mic" | "cam" | "screen", icon: string, label: string) => (
    <button class="ctl" classList={{ on: on()[k] }} aria-pressed={on()[k]} onClick={() => void toggleCall(k)}><Icon name={icon} />{label}</button>
  );
  return (
    <div class="stage">
      <Show when={here()} fallback={
        <div class="stage-empty">
          <Icon name="speaker" size={40} />
          <h2>{props.channel.name}</h2>
          <Show when={elsewhere()}><p>You're in {call.channel()?.name}. Joining here moves you.</p></Show>
          <button class="btn primary big" onClick={() => void joinCall(props.channel)} disabled={call.busy()}>{call.busy() ? "Joining…" : elsewhere() ? "Move here" : "Join voice"}</button>
          <Show when={call.error()}><p class="err">{call.error()}</p></Show>
        </div>
      }>
        <Show when={call.popped()} fallback={
          <div class="people"><For each={call.people()}>{(p) => (
            <div class="tile" classList={{ talking: call.speaking().includes(p.id) }}>
              <Show when={call.handle()?.video(p.id)} fallback={<Avatar person={p} size={64} presence={false} />}><VideoFill person={p} /></Show>
              <NameText person={p} />
            </div>
          )}</For></div>
        }>
          <div class="stage-empty"><Icon name="popout" size={36} /><p>This call is in its own window.</p><button class="btn" onClick={() => void import("./call/state").then((m) => m.closePopout())}>Bring it back</button></div>
        </Show>
        <Show when={call.error()}><p class="err center">{call.error()}</p></Show>
        <div class="controls" role="toolbar" aria-label="Voice controls">
          {ctl("mic", "mic", "Mic")}{ctl("cam", "video", "Camera")}{ctl("screen", "screen", "Share")}
          <Show when={call.canPopOut() && !call.popped()}><button class="ctl" onClick={() => void openPopout()}><Icon name="popout" />Pop out</button></Show>
          <button class="ctl danger" onClick={() => void leaveCall()}><Icon name="hangup" />Leave</button>
        </div>
      </Show>
    </div>
  );
}
