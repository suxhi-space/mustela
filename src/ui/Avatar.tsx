import { createMemo, createSignal, Show } from "solid-js";
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
  const { ref, profile } = createPerson(() => props.person, () => props.profile);
  const anim = createAnim(profile, "decor");
  const [broken, setBroken] = createSignal(false);
  const slot = () => profile()?.decor ?? { preset: 0, hue: 0, speed: 8, intensity: 8 };
  const h = () => hueOf(props.person.id);
  return (
    <span class="av" style={{ width: `${size()}px`, height: `${size()}px` }} ref={(el) => { ref(el); props.profileRef?.(el); }}>
      <Show when={slot().preset}>
        <DecorCanvas slot={slot} size={size()} animate={anim() && !props.still} />
      </Show>
      <Show
        when={props.person.avatarUrl && !broken()}
        fallback={<span class="av-img av-fallback" style={{ background: `hsl(${h()} 45% 42%)`, "font-size": `${size() * 0.42}px` }}>{props.person.name.slice(0, 1).toUpperCase()}</span>}
      >
        <img class="av-img" src={props.person.avatarUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
      </Show>
      <Show when={props.presence !== false && props.person.online !== undefined}>
        <span class={`av-dot p-${props.person.online ? props.person.presence ?? "online" : "offline"}`} classList={{ on: !!props.person.online }} title={props.person.online ? (props.person.presence ?? "online") : "offline"} style={{ width: `${Math.max(9, size() * 0.3)}px`, height: `${Math.max(9, size() * 0.3)}px` }} />
      </Show>
    </span>
  );
}

/** A display name with the person's chosen font and effect, readable on this viewer's surface. */
export function NameText(props: { person: Person; profile?: ProfileConfig | null; class?: string }) {
  // The ref matters: profiles load once a name has been on screen, so without it other people's
  // name styles only ever appeared inside their profile card.
  const { profile, ref } = createPerson(() => props.person, () => props.profile);
  const css = createMemo(() => nameCss(profile()?.name ?? null, surfaceInt()));
  return <span ref={ref} class={`name ${props.class ?? ""} ${css().class}`} style={css().style}>{props.person.name}</span>;
}
