import { Show } from "solid-js";
import { Icon } from "../icons";
import { call, closePopout, leaveCall, openPopout, toggleCall } from "./state";

/** Small panel above the user bar while you're in a call. Visible from any channel. */
export function CallPanel(props: { onOpen(): void }) {
  return (
    <Show when={call.active()}>
      <div class="callpanel" role="region" aria-label="Current call">
        <button class="cp-info" onClick={props.onOpen} title="Open call">
          <span class="cp-live" aria-hidden="true" />
          <span class="cp-text"><strong>Voice connected</strong><small>{call.channel()?.name}</small></span>
        </button>
        <Show when={call.canPopOut()}>
          <button class="icon-btn" onClick={() => (call.popped() ? void closePopout() : void openPopout())}
            aria-label={call.popped() ? "Bring call back" : "Pop out call"} title={call.popped() ? "Bring call back" : "Pop out call"}>
            <Icon name={call.popped() ? "back" : "popout"} size={18} />
          </button>
        </Show>
        <button class="icon-btn" classList={{ danger: !call.on().mic }} aria-pressed={!call.on().mic} onClick={() => void toggleCall("mic")} aria-label={call.on().mic ? "Mute" : "Unmute"} title={call.on().mic ? "Mute" : "Unmute"}><Icon name={call.on().mic ? "mic" : "mic-off"} size={18} /></button>
        <button class="icon-btn" classList={{ danger: call.on().deaf }} aria-pressed={call.on().deaf} onClick={() => void toggleCall("deaf")} aria-label={call.on().deaf ? "Undeafen" : "Deafen"} title={call.on().deaf ? "Undeafen" : "Deafen"}><Icon name={call.on().deaf ? "headphones-off" : "headphones"} size={18} /></button>
        <button class="icon-btn danger" onClick={() => void leaveCall()} aria-label="Leave call" title="Leave call"><Icon name="hangup" size={18} /></button>
      </div>
    </Show>
  );
}
