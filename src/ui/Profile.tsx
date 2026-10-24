import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import type { Person } from "../lib/backend/types";
import { hex, mix, textOn, contrast } from "../lib/color";
import { CANONICAL_HEIGHT, CANONICAL_WIDTH, markerHeight } from "../lib/marker/codec";
import type { ProfileConfig } from "../lib/profile/model";
import { createAnim } from "./anim";
import { Avatar, createPerson, NameText } from "./Avatar";
import { createSize } from "./hooks";
import { EffectCanvas, FrameCanvas } from "./Paint";
import { backend } from "./store";
import { Icon } from "./icons";
import { RatingBadge } from "./controls";
import { Markdown } from "./chat/Markdown";
import { ratingOf } from "./anim";

const STRIP = markerHeight(CANONICAL_WIDTH);
const PRESENCE_LABEL: Record<string, string> = { online: "Online", idle: "Idle", focus: "Focus", busy: "Do Not Disturb", invisible: "Invisible", offline: "Offline" };

/**
 * The full profile card: banner, avatar with decoration, name, badges, bio,
 * with the person's effect drawn over it and their frame around it.
 * `profile` is passed directly for the live preview in settings.
 */
export function ProfileCard(props: { person: Person; profile?: ProfileConfig | null; bio?: string; banner?: string; children?: JSX.Element; showRating?: boolean; marked?: boolean }) {
  const { profile, info, ref: seenRef } = createPerson(() => props.person, () => props.profile);
  const [size, sizeRef] = createSize();
  const fxAnim = createAnim(profile, "effect");
  const frameAnim = createAnim(profile, "frame");
  const theme = createMemo(() => {
    const t = profile()?.theme;
    if (!t) return null;
    const bg = t.primary, fg = textOn(bg);
    return { "--pc-bg": hex(bg), "--pc-bg2": hex(mix(bg, t.accent, 0.55)), "--pc-fg": hex(fg), "--pc-accent": hex(t.accent),
      "--pc-sub": hex(mix(fg, bg, contrast(fg, bg) > 8 ? 0.35 : 0.2)) } as Record<string, string>;
  });
  const bannerUrl = () => props.banner ?? info()?.bannerUrl;
  const bio = () => props.bio ?? info()?.bio;
  const hasMarker = () => props.marked ?? (profile() !== null && !!info()?.bannerUrl); // our strip is in the bottom rows

  const [more, setMore] = createSignal(false);
  const long = () => (bio()?.length ?? 0) > 240 || (bio()?.split("\n").length ?? 0) > 5;
  const presence = () => (props.person.online ? props.person.presence ?? "online" : "offline");

  return (
    <article class="pcard" classList={{ themed: !!theme() }} style={theme() ?? {}} ref={(el) => { seenRef(el); sizeRef(el); }}>
      <div class="pc-banner" style={hasMarker() ? { "aspect-ratio": `${CANONICAL_WIDTH} / ${CANONICAL_HEIGHT - STRIP}` } : {}}>
        <Show when={bannerUrl()} fallback={<div class="pc-banner-fill" />}>
          <img src={bannerUrl()} alt="" loading="lazy" />
        </Show>
        <Show when={props.person.online !== undefined}>
          <span class="pc-presence" title={props.person.status}>
            <span class={`pdot p-${presence()}`} />{PRESENCE_LABEL[presence()] ?? "Online"}
          </span>
        </Show>
      </div>
      <div class="pc-head">
        <div class="pc-avatar"><Avatar person={props.person} size={84} profile={profile()} presence={false} /></div>
      </div>
      <div class="pc-body">
        <h2 class="pc-name"><NameText person={props.person} profile={profile()} /></h2>
        <div class="pc-meta">
          <Show when={props.person.username}><span>{props.person.username}{props.person.discriminator ? `#${props.person.discriminator}` : ""}</span></Show>
          <Show when={props.person.bot}><span class="tag">Bot</span></Show>
          <For each={props.person.badges}>{(b) => <span class="pc-badge">{b}</span>}</For>
        </div>
        <Show when={props.person.status}><p class="pc-status">{props.person.status}</p></Show>
        <Show when={bio()}>
          <section class="pc-section">
            <h3 class="label">About me</h3>
            <Markdown text={bio()!} class={`pc-bio ${long() && !more() ? "clamp" : ""}`} />
            <Show when={long()}><button class="link pc-more" onClick={() => setMore(!more())}>{more() ? "Show less" : "Read more"}</button></Show>
          </section>
        </Show>
        <Show when={props.showRating && profile()}>
          <section class="pc-section">
            <h3 class="label">Performance</h3>
            <RatingBadge rating={ratingOf(profile()!).total.rating} label={ratingOf(profile()!).total.label} />
          </section>
        </Show>
        {props.children}
      </div>
      <Show when={profile()?.effect.preset && size().w > 0}>
        <EffectCanvas slot={() => profile()!.effect} w={size().w} h={size().h} animate={fxAnim()} />
      </Show>
      <Show when={profile()?.frame.preset && size().w > 0}>
        <FrameCanvas slot={() => profile()!.frame} w={size().w} h={size().h} animate={frameAnim()} radius={18} />
      </Show>
    </article>
  );
}

/** Centered modal that shows a person's card, with Message / Add friend like Stoat. */
export function ProfileModal(props: { person: Person; onClose(): void; onMessage?(channelId: string): void }) {
  const self = () => backend()?.me.id === props.person.id;
  const [note, setNote] = createSignal("");
  async function message() {
    try { props.onMessage?.(await backend()!.openDM(props.person.id)); } catch { setNote("Couldn't open a conversation."); }
  }
  async function addFriend() {
    try { await backend()!.friendAction(props.person.id, "add"); setNote("Friend request sent."); } catch (e) { setNote(e instanceof Error && e.message ? e.message : "Couldn't send a friend request."); }
  }
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <div class="modal profile-modal" role="dialog" aria-label={`${props.person.name}'s profile`}>
        <button class="icon-btn close" onClick={props.onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        <ProfileCard person={props.person}>
          <Show when={!self() && !props.person.bot}>
            <div class="pc-actions">
              <button class="btn primary small" onClick={() => void message()}><Icon name="chat" size={16} />Message</button>
              <button class="btn small" onClick={() => void addFriend()}><Icon name="friends" size={16} />Add friend</button>
            </div>
            <Show when={note()}><p class="small pc-note">{note()}</p></Show>
          </Show>
        </ProfileCard>
      </div>
    </div>
  );
}
