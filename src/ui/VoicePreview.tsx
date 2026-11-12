import { createMemo, For, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { ChannelInfo, Person } from "../lib/backend/types";
import { Avatar, NameText } from "./Avatar";
import { call, joinCall } from "./call/state";
import { createProfileInfo } from "./hooks";
import { Icon } from "./icons";
import { useBack } from "./back";
import { dragToClose } from "./sheetDrag";
import { ActivityIcon, friendsFirst } from "./VoiceFaces";

/**
 * A voice channel at a glance, before joining (tapping a call on the phone's Home, like Discord's): who's in it (your
 * friends first), anyone streaming, what they're playing, and the same chat button and Join voice as the voice
 * channel's own screen. The channel name opens the channel itself.
 */
export function VoicePreview(props: { channel: ChannelInfo; where?: string; onClose(): void; onOpen(): void; onChat(): void }) {
  useBack(() => props.onClose());
  const people = createMemo(() => friendsFirst(props.channel.voice ?? []));
  const streamers = createMemo(() => people().filter((p) => (p as Person & { screen?: boolean }).screen));
  const here = () => call.active() && call.channel()?.id === props.channel.id;
  const elsewhere = () => call.active() && !here();
  // (Each button acts first, then closes the card: once it's closed, which channel it was is gone.)
  const join = () => { const ch = props.channel; if (here()) props.onOpen(); else void joinCall(ch); props.onClose(); };
  return (
    <Portal>
      <div class="scrim vp-scrim" onClick={props.onClose}>
        <div class="modal sheet panel vp-sheet" role="dialog" aria-label={`${props.channel.name}, voice`} onClick={(e) => e.stopPropagation()}
          ref={(el) => onMount(() => dragToClose(el, props.onClose))}>
          <header class="vp-head">
            <button class="icon-btn vp-down" aria-label="Close" onClick={props.onClose}><Icon name="down" size={20} /></button>
            <button class="vp-title" onClick={() => { props.onOpen(); props.onClose(); }}>
              <Icon name="volume-up" size={18} /><span>{props.channel.name}</span><Icon name="right" size={16} />
            </button>
          </header>
          <Show when={props.where}><p class="vp-where">{props.where}</p></Show>

          <For each={streamers()}>{(s) => (
            <section class="vp-section">
              <h3 class="label">{s.name}'s stream</h3>
              {/* A stream is only sent to people in the call, so this shows them until you join and watch. */}
              <div class="vp-stream">
                <Show when={s.avatarUrl}><img class="vp-stream-bg" src={s.avatarUrl} alt="" /></Show>
                <span class="live-pill">LIVE</span>
                <button class="btn vp-watch" onClick={join}>{here() ? "Watch stream" : "Join to watch"}</button>
              </div>
            </section>
          )}</For>

          <section class="vp-section">
            <h3 class="label">{people().length === 1 ? "1 person in voice" : `${people().length} people in voice`}</h3>
            <ul class="sheet-people vp-people">
              <For each={people()}>{(p) => {
                const v = p as Person & { muted?: boolean; deaf?: boolean; screen?: boolean };
                return (
                  <li><div class="vp-row">
                    <Avatar person={p} size={36} presence={false} still />
                    <span class="cs-name"><NameText person={p} /></span>
                    <ActivityIcon person={p} />
                    <Show when={v.screen}><span class="live-pill">LIVE</span></Show>
                    <Show when={v.deaf}><Icon name="headphones-off" size={16} class="danger" /></Show>
                    <Show when={v.muted && !v.deaf}><Icon name="mic-off" size={16} class="danger" /></Show>
                  </div></li>
                );
              }}</For>
            </ul>
          </section>

          {/* What they're playing (shown only when someone is) */}
          <section class="vp-section vp-games">
            <h3 class="label">Activities</h3>
            <div class="vp-game-list"><For each={people()}>{(p) => <GameRow person={p} />}</For></div>
          </section>

          <div class="cs-join vp-join">
            <button class="cbtn" title="Open the channel's chat" aria-label="Chat" onClick={() => { props.onChat(); props.onClose(); }}><Icon name="chat" size={20} /></button>
            <button class="btn big primary cs-join-btn" disabled={call.busy()} onClick={join}>{call.busy() ? "Joining…" : here() ? "Open voice" : elsewhere() ? "Switch to this call" : "Join voice"}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function GameRow(props: { person: Person }) {
  const info = createProfileInfo(() => props.person.id);
  const a = () => info()?.activity ?? null;
  return (
    <Show when={a()}>{(x) => (
      <div class="vp-game">
        <Show when={x().image} fallback={<span class="vp-game-ic"><Icon name={x().kind === "listening" ? "headphones" : "gamepad"} size={18} /></span>}><img class="vp-game-ic" src={x().image} alt="" /></Show>
        <span class="pv-text"><strong>{x().name}</strong><small>{props.person.name}</small></span>
      </div>
    )}</Show>
  );
}
