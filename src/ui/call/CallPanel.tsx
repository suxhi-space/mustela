import { Show } from "solid-js";
import { MOBILE_UI } from "../target";
import { device, updateDevice } from "../store";
import { Icon } from "../icons";
import { call, closePopout, leaveCall, openPopout, screenButton, toggleCall } from "./state";

/**
 * The bar above your card while you're in a call, as wide as the card (like Discord's).
 * Mute and deafen live on the card itself on desktop, so there this has where you are, sharing, pop-out and leave.
 * Phones have a mute button in place of sharing (sharing is in the call screen).
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
        <button class="icon-btn desk-only" classList={{ on: call.on().screen }} aria-pressed={call.on().screen} onClick={(e) => screenButton(e.currentTarget)} aria-label={call.on().screen ? "Stop or change your stream" : "Share your screen"} title={call.on().screen ? "Stop or change your stream" : "Share your screen"}><Icon name="screen" size={18} /></button>
        <MuteButton />
        {/* Phones and tablets: show or hide the small call tile that follows you around the app */}
        <Show when={MOBILE_UI}><button class="icon-btn" classList={{ on: device().miniCall }} aria-pressed={device().miniCall} onClick={() => updateDevice({ miniCall: !device().miniCall })}
          aria-label={device().miniCall ? "Hide the mini call view" : "Show the mini call view"} title={device().miniCall ? "Hide the mini call view" : "Show the mini call view"}><Icon name={device().miniCall ? "eye" : "eye-off"} size={18} /></button></Show>
        <button class="icon-btn danger" onClick={() => void leaveCall()} aria-label="Leave call" title="Leave call"><Icon name="hangup" size={18} /></button>
      </div>
    </Show>
  );
}

/**
 * Phones: tap to mute or unmute; hold to mute and deafen. Deafened, it shows that, and a tap undeafens.
 */
function MuteButton() {
  let timer: ReturnType<typeof setTimeout> | undefined, held = false;
  let micBefore = true; // undeafening puts your mic back how it was, like Discord
  const deaf = () => call.on().deaf;
  const label = () => (deaf() ? "Undeafen" : call.on().mic ? "Mute (hold to deafen)" : "Unmute (hold to deafen)");
  const press = (e: PointerEvent) => {
    held = false;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    timer = setTimeout(() => {
      held = true;
      if (!deaf()) { micBefore = call.on().mic; void toggleCall("deaf"); navigator.vibrate?.(20); }
    }, 450);
  };
  const release = () => clearTimeout(timer);
  return (
    <button class="icon-btn phone-only cp-mute" classList={{ off: !call.on().mic || deaf(), deaf: deaf() }} aria-label={label()} title={label()}
      onPointerDown={press} onPointerUp={release} onPointerLeave={release} onPointerCancel={release} onContextMenu={(e) => e.preventDefault()}
      onClick={async () => {
        if (held) { held = false; return; }
        if (!deaf()) return void toggleCall("mic");
        await toggleCall("deaf");
        if (micBefore && !call.on().mic) await toggleCall("mic");
      }}>
      <Icon name={deaf() ? "headphones-off" : call.on().mic ? "mic" : "mic-off"} size={18} />
    </button>
  );
}
