import { motionOk, StillImg } from "./StillImg";
import { friendNick } from "./nicks";
import { createMemo, createSignal, Show } from "solid-js";
import { TextWithEmoji } from "./chat/EmojiText";
import type { Person } from "../lib/backend/types";
import type { ProfileConfig } from "../lib/profile/model";
import { nameCss } from "../lib/profile/nameStyle";
import { createAnim } from "./anim";
import { createProfileInfo, createSeen } from "./hooks";
import { DecorCanvas } from "./Paint";
import { surfaceInt } from "./store";

const hueOf = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;

/** Resolves someone's profile lazily: only fetched once the element has been on screen. */
export function createPerson(person: () => Person, given?: () => ProfileConfig | null | undefined) {
  const [seen, ref] = createSeen();
  const info = createProfileInfo(() => person().id, () => seen() && given?.() === undefined);
  const profile = createMemo(() => (given && given() !== undefined ? given()! : info()?.config ?? null));
  return { ref, info, profile };
}

export function Avatar(props: {
  person: Person;
  size?: number;
  /** Pass a profile to skip lookup (settings preview). `null` means "none". */
  profile?: ProfileConfig | null;
  presence?: boolean;
  /** Force a still image (picker thumbnails). */
  still?: boolean;
  profileRef?: (el: HTMLElement) => void;
}) {
  const size = () => props.size ?? 40;
  // The status dot: big enough to read at a glance on small avatars, not oversized on big ones.
  const dot = () => Math.round(Math.min(24, Math.max(11, size() * 0.36)));
  const { ref, profile } = createPerson(() => props.person, () => props.profile);
  // In a chat or a member list (big servers can hold those still); found once the picture is on the page.
  const [el, setEl] = createSignal<HTMLElement>();
  // (A profile card always moves, wherever it opens.)
  const anim = createAnim(profile, "decor", () => { const e = el(); return !!e && !e.closest(".pcard") && !!e.closest(".chat, .members-col, .members-sheet, .member"); });
  const [broken, setBroken] = createSignal(false);
  const slot = () => profile()?.decor ?? { preset: 0, hue: 0, speed: 8, intensity: 8 };
  const h = () => hueOf(props.person.id);
  return (
    <span class="av" style={{ width: `${size()}px`, height: `${size()}px` }} ref={(e) => { ref(e); setEl(e); props.profileRef?.(e); }}>
      <Show when={slot().preset}>
        <DecorCanvas slot={slot} size={size()} animate={anim() && !props.still} />
      </Show>
      <Show
        when={props.person.avatarUrl && !broken()}
        fallback={<span class="av-img av-fallback" style={{ background: `hsl(${h()} 45% 42%)`, "font-size": `${size() * 0.42}px` }}>{props.person.name.slice(0, 1).toUpperCase()}</span>}
      >
        {/* Animated avatars hold still while Mustela is behind another window ("Keep animating in the background" off). */}
        <StillImg class="av-img" src={props.person.avatarUrl!} still={!!props.still || !motionOk()} alt="" loading="lazy" onError={() => setBroken(true)} />
      </Show>
      <Show when={props.presence !== false && props.person.online !== undefined}>
        <span class={`av-dot p-${props.person.online ? props.person.presence ?? "online" : "offline"}`} classList={{ on: !!props.person.online }} title={props.person.online ? (props.person.presence ?? "online") : "offline"} style={{ width: `${dot()}px`, height: `${dot()}px`, "border-width": size() >= 56 ? "3.5px" : undefined }} />
      </Show>
    </span>
  );
}

/** A display name with the person's chosen font and effect, readable on this viewer's surface. */
export function NameText(props: { person: Person; profile?: ProfileConfig | null; class?: string; fontOnly?: boolean }) {
  // The ref matters: profiles load once a name has been on screen, so without it other people's
  // name styles only ever appeared inside their profile card.
  const { profile, ref } = createPerson(() => props.person, () => props.profile);
  const css = createMemo(() => nameCss(profile()?.name ?? null, surfaceInt(), !!props.fontOnly));
  // A nickname you gave this friend shows instead (their own name on hover).
  const nick = () => friendNick(props.person.id);
  return <span ref={ref} class={`name ${props.class ?? ""} ${css().class}`} style={css().style} title={nick() ? props.person.name : undefined}><TextWithEmoji v={nick() ?? props.person.name} /></span>;
}
