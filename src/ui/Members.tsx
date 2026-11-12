import { TextWithEmoji } from "./chat/Markdown";
import { createEffect, createMemo, createResource, createSignal, For, Index, on, onCleanup, Show } from "solid-js";
import type { MemberGroup, Person } from "../lib/backend/types";
import type { ProfileConfig } from "../lib/profile/model";
import { createAnim } from "./anim";
import { Avatar, createPerson, NameText } from "./Avatar";
import { roleStyle } from "./chat/Message";
import { createSize } from "./hooks";
import { PlateCanvas } from "./Paint";
import { backend } from "./store";
import { userMenu } from "./menus";
import { activity, verb } from "./activity";
import { Icon } from "./icons";

/** `profile`: show this one instead of looking theirs up (the profile editor's nameplate preview). */
export function MemberRow(props: { person: Person; onOpen(p: Person): void; serverId?: string; profile?: ProfileConfig | null }) {
  const { ref, profile, info } = createPerson(() => props.person, () => props.profile);
  const act = () => (props.person.id === backend()?.me.id ? activity.current() : info()?.activity) ?? null;
  const [size, sizeRef] = createSize();
  const anim = createAnim(profile, "plate", () => true); // a member list row
  return (
    <button class="member" classList={{ off: !props.person.online }} onClick={() => props.onOpen(props.person)}
      onContextMenu={(e) => userMenu(e, props.person, props.serverId)}
      ref={(el) => { ref(el); sizeRef(el); }}>
      <Show when={profile()?.plate.preset && size().w > 0}>
        <PlateCanvas slot={() => profile()!.plate} w={size().w} h={size().h} animate={anim()} />
      </Show>
      <Avatar person={props.person} size={32} />
      <span class="member-text">
        <span class="member-name" style={roleStyle(props.person.colour)}><NameText person={props.person} />
          <Show when={props.person.roleIcon}>{(src) => <img class="role-icon" src={src()} alt="" />}</Show>
          <Show when={props.person.bot}><span class="tag">Bot</span></Show></span>
        <Show when={act() && props.person.online} fallback={<Show when={props.person.status}><small><TextWithEmoji v={props.person.status!} /></small></Show>}>
          <small class="member-act"><Icon name="gamepad" size={13} />{verb(act()!.kind)} <b>{act()!.name}</b></small>
        </Show>
      </span>
    </button>
  );
}

/** Rows drawn at first, and how many more each time you scroll near the end (big servers have thousands). */
const PAGE = 25;

/**
 * People who haven't changed since the list was last built keep the very same object, so a refresh only redraws the
 * rows that changed (their avatars and nameplates aren't rebuilt).
 */
const seen = new Map<string, { sig: string; p: Person }>();
function keepSame(groups: MemberGroup[]): MemberGroup[] {
  return groups.map((g) => ({ ...g, people: g.people.map((p) => {
    const sig = JSON.stringify(p), old = seen.get(p.id);
    if (old && old.sig === sig) return old.p;
    seen.set(p.id, { sig, p });
    return p;
  }) }));
}

/** Member list grouped like Stoat: hoisted roles, then Online, then Offline (collapsible). */
export function Members(props: { spaceId: string; onOpen(p: Person): void }) {
  // Asked for a moment after the server opens, so the channel's messages go first (Stoat answers one at a time).
  const [ready, setReady] = createSignal<string | null>(null);
  createEffect(on(() => props.spaceId, (id) => { setReady(null); const t = setTimeout(() => setReady(id), 400); onCleanup(() => clearTimeout(t)); }));
  const [groups, { refetch }] = createResource(ready, (id) => backend()!.members(id).then(keepSame));
  // Someone went online/offline: rebuild the list (from memory, nothing is downloaded), at most every 2 seconds,
  // or every 30 in big lists (big servers send these all the time, and the list shouldn't be rebuilt nonstop).
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(backend()!.onEvent((e) => {
    if (e.t !== "presence" || presenceTimer || !ready()) return;
    const size = (groups.latest ?? []).reduce((n, g) => n + g.people.length, 0);
    presenceTimer = setTimeout(() => {
      // Hidden or minimised: nothing is rebuilt until you look again, then once.
      if (document.hidden) { addEventListener("visibilitychange", () => { presenceTimer = undefined; void refetch(); }, { once: true }); return; }
      presenceTimer = undefined; void refetch();
    }, size > 500 ? 30_000 : 2000);
  }));
  onCleanup(() => clearTimeout(presenceTimer));
  const [hideOffline, setHideOffline] = createSignal(false);
  // Only the rows you can reach get drawn (and have their profiles looked up); more come in as you scroll.
  const [budget, setBudget] = createSignal(PAGE);
  createEffect(on(() => props.spaceId, () => setBudget(PAGE)));
  const visible = createMemo(() => {
    let left = budget();
    return (groups() ?? []).map((g) => {
      const open = g.title !== "Offline" || !hideOffline();
      const people = open ? g.people.slice(0, Math.max(0, left)) : [];
      left -= people.length;
      return { ...g, shown: people };
    });
  });
  const more = () => (groups() ?? []).reduce((n, g) => n + (g.title !== "Offline" || !hideOffline() ? g.people.length : 0), 0) > budget();
  let io: IntersectionObserver | undefined;
  onCleanup(() => io?.disconnect());
  const sentinel = (el: HTMLElement) => {
    io?.disconnect();
    io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setBudget((b) => b + PAGE); }, { rootMargin: "600px 0px" });
    io.observe(el);
  };
  return (
    <aside class="members" aria-label="Members">
      <Show when={!groups.latest && (groups.loading || !ready())}><div class="loading-row"><div class="spinner small" /></div></Show>
      <Show when={groups.error}><p class="empty small">Couldn't load members.</p></Show>
      {/* By position, so adding rows keeps the ones already drawn (their profiles and nameplates) in place. */}
      <Index each={visible()}>{(g) => (
        <section>
          <Show when={g().title === "Offline"} fallback={<h3 class="mhead">{g().title}<span class="count">{g().people.length}</span></h3>}>
            <button class="mhead toggle" onClick={() => setHideOffline(!hideOffline())} aria-expanded={!hideOffline()}>Offline<span class="count">{g().people.length}</span></button>
          </Show>
          <For each={g().shown}>{(p) => <MemberRow person={p} onOpen={props.onOpen} serverId={props.spaceId} />}</For>
        </section>
      )}</Index>
      <Show when={more()}><div ref={sentinel} class="members-more" aria-hidden="true" /></Show>
    </aside>
  );
}
