import { createSignal, For, Show } from "solid-js";
import { createPhone } from "./hooks";
import type { ChannelInfo, Person, VoiceMember } from "../lib/backend/types";
import { Avatar, NameText } from "./Avatar";
import { CallStage, callMemberMenu } from "./call/CallStage";
import { call } from "./call/state";
import { Chat } from "./Chat";
import { Icon } from "./icons";
import { device, updateDevice } from "./store";

function MemberIcons(props: { m: VoiceMember }) {
  return (
    <span class="vm-icons">
      <Show when={props.m.screen}><span class="live-pill">LIVE</span></Show>
      <Show when={props.m.camera}><Icon name="video" size={14} /></Show>
      <Show when={props.m.deaf}><Icon name="headphones-off" size={14} class="danger" /></Show>
      <Show when={props.m.muted}><Icon name="mic-off" size={14} class="danger" /></Show>
    </span>
  );
}

/** People in a voice channel, listed under it in the sidebar like Stoat and Discord. Right-click for volume. */
export function VoiceMembers(props: { members: VoiceMember[]; channelId?: string }) {
  // While you're in this call, show the live state (instant speaking, your own mute/deafen).
  const live = (m: VoiceMember) => (call.active() && call.channel()?.id === props.channelId ? call.people().find((p) => p.id === m.id) ?? m : m);
  return (
    <ul class="voice-members">
      <For each={props.members}>{(m) => (
        <li classList={{ talking: call.speaking().includes(m.id) && !call.soundboard().includes(m.id), sound: call.soundboard().includes(m.id) }} onContextMenu={(e) => callMemberMenu(e, m)}>
          <Avatar person={m} size={22} presence={false} still={!(call.speaking().includes(m.id))} />
          <span class="vm-name"><NameText person={m} fontOnly /></span>
          <MemberIcons m={live(m)} />
        </li>
      )}</For>
    </ul>
  );
}

/** Phones show the call or the voice channel's chat, one at a time (the chat button switches). */
export const [phoneVoiceChat, setPhoneVoiceChat] = createSignal(false);

/** A voice channel: the call fills the view, with the channel's text chat beside it (or, on a phone, instead of it). */
export function Voice(props: { channel: ChannelInfo; spaceId?: string; onProfile(p: Person): void; onOpenChannel(id: string): void }) {
  const phone = createPhone();
  const chatOpen = () => (phone() ? phoneVoiceChat() : device().voiceChat);
  const toggle = () => (phone() ? setPhoneVoiceChat(!phoneVoiceChat()) : updateDevice({ voiceChat: !device().voiceChat }));
  return (
    <div class="voice-view" classList={{ "with-chat": chatOpen(), "phone-chat": phone() && chatOpen() }}>
      <Show when={!(phone() && chatOpen())}>
        <CallStage channel={props.channel} chatOpen={chatOpen()} onToggleChat={toggle} />
      </Show>
      <Show when={chatOpen()}>
        <aside class="voice-chat">
          <Show when={phone()}>
            <button class="vc-back" onClick={() => setPhoneVoiceChat(false)}><Icon name="speaker" size={16} /><span>Back to {props.channel.name}</span><Icon name="right" size={14} /></button>
          </Show>
          <Chat channel={props.channel} spaceId={props.spaceId} onProfile={props.onProfile} onOpenChannel={props.onOpenChannel} />
        </aside>
      </Show>
    </div>
  );
}
