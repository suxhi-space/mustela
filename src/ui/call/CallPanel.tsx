import { Show } from "solid-js";
import { Icon } from "../icons";
import { call, closePopout, leaveCall, openPopout, toggleCall } from "./state";

/**
 * The bar above your card while you're in a call, as wide as the card (like Discord's).
 * Mute and deafen live on the card itself, so this has where you are, sharing, pop-out and leave.
 */
export function CallPanel(props: { onOpen(): void; /** Where the call is: the server's name, or "Direct message" */ where?: string }) {
  return (
    <Show when={call.active()}>
      <div class="callpanel" role="region" aria-label="Current call">
        <button class="cp-info" onClick={props.onOpen} title="Open call">
          <span class="cp-live" aria-hidden="true" />
          <span class="cp-text"><strong>{call.busy() ? "Connecting…" : "Voice connected"}</strong>
            <small title={`${call.channel()?.name ?? ""}${props.where ? ` / ${props.where}` : ""}`}>{call.channel()?.name}<Show when={props.where}><span class="cp-where"> / {props.where}</span></Show></small></span>
        </button>
        <Show when={call.canPopOut()}>
          <button class="icon-btn" onClick={() => (call.popped() ? void closePopout() : void openPopout())}
            aria-label={call.popped() ? "Bring call back" : "Pop out call"} title={call.popped() ? "Bring call back" : "Pop out call"}>
            <Icon name={call.popped() ? "back" : "popout"} size={18} />
          </button>
        </Show>
        <button class="icon-btn" classList={{ on: call.on().screen }} aria-pressed={call.on().screen} onClick={() => void toggleCall("screen")} aria-label={call.on().screen ? "Stop sharing" : "Share your screen"} title={call.on().screen ? "Stop sharing" : "Share your screen"}><Icon name="screen" size={18} /></button>
        <button class="icon-btn danger" onClick={() => void leaveCall()} aria-label="Leave call" title="Leave call"><Icon name="hangup" size={18} /></button>
      </div>
    </Show>
  );
}
