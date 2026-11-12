import { createMemo, For, Show } from "solid-js";
import { createProfileInfo } from "./hooks";
import type { Person } from "../lib/backend/types";
import { Avatar } from "./Avatar";
import { backend } from "./store";
import { MOBILE_UI } from "./target";

/**
 * Who's in a voice channel, as one rounded tile (the profile card's "In voice" and the Home strip on phones).
 *
 * Plain pictures (no decorations, no speaking ring), sized from the tile so nothing ever pokes out of it. One person
 * fills it; two sit diagonally; three make a triangle; four a 2×2 grid. Phones show up to 3 spots, desktop up to 4;
 * with more people the last spot is "+N".
 */
export function VoiceFaces(props: { people: Person[]; size: number }) {
  const max = MOBILE_UI ? 3 : 4;
  const shown = createMemo(() => {
    const all = props.people;
    if (all.length <= max) return { faces: all, more: 0 };
    return { faces: all.slice(0, max - 1), more: all.length - (max - 1) };
  });
  /** Where each spot goes: [left, top, size] inside the tile */
  const spots = createMemo(() => {
    const T = props.size, p = Math.round(T * 0.08), n = shown().faces.length + (shown().more ? 1 : 0);
    if (n <= 1) return [[p, p, T - 2 * p]];
    if (n === 2) { const s = Math.round(T * 0.56); return [[p, p, s], [T - p - s, T - p - s, s]]; }
    const s = Math.floor((T - 2 * p - 2) / 2), far = T - p - s;
    if (n === 3) return [[Math.round((T - s) / 2), p, s], [p, far, s], [far, far, s]];
    return [[p, p, s], [far, p, s], [p, far, s], [far, far, s]];
  });
  const at = (i: number) => { const [x, y] = spots()[i] ?? [0, 0]; return { left: `${x}px`, top: `${y}px` }; };
  return (
    <span class="vfaces" classList={{ two: spots().length === 2 }} style={{ width: `${props.size}px`, height: `${props.size}px` }}
      title={props.people.map((m) => m.name).join(", ")}>
      <For each={shown().faces}>{(m, i) => (
        <span class="vf-spot" style={at(i())}><Avatar person={m} size={spots()[i()]?.[2] ?? 24} presence={false} still profile={null} /></span>
      )}</For>
      <Show when={shown().more}>
        <span class="vf-spot vf-more" style={{ ...at(shown().faces.length), width: `${spots()[shown().faces.length]?.[2]}px`, height: `${spots()[shown().faces.length]?.[2]}px` }}>+{shown().more}</span>
      </Show>
    </span>
  );
}

/** `first` (if any), then your friends, then everyone else, each person once. */
export function friendsFirst(others: Person[], first?: Person): Person[] {
  const rel = (p: Person) => backend()?.person(p.id).relation ?? p.relation;
  const rest = others.filter((p) => p.id !== first?.id);
  return [...(first ? [first] : []), ...rest.filter((p) => rel(p) === "friend"), ...rest.filter((p) => rel(p) !== "friend")];
}

/** The app they're playing or listening to, as a small icon beside their name (voice lists, like Discord's). */
export function ActivityIcon(props: { person: Person }) {
  const info = createProfileInfo(() => props.person.id);
  const a = () => info()?.activity ?? null;
  return (
    <Show when={a()?.image}>{(src) => (
      <img class="act-ic" src={src()} alt="" title={`${{ listening: "Listening to", watching: "Watching", streaming: "Streaming", competing: "Competing in" }[a()!.kind as string] ?? "Playing"} ${a()!.name}`} loading="lazy" />
    )}</Show>
  );
}
