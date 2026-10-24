import { createResource, createSignal, For, Show } from "solid-js";
import type { Person } from "../lib/backend/types";
import { createAnim } from "./anim";
import { Avatar, createPerson, NameText } from "./Avatar";
import { roleStyle } from "./chat/Message";
import { createSize } from "./hooks";
import { PlateCanvas } from "./Paint";
import { backend } from "./store";

function MemberRow(props: { person: Person; onOpen(p: Person): void }) {
  const { ref, profile } = createPerson(() => props.person);
  const [size, sizeRef] = createSize();
  const anim = createAnim(profile, "plate");
  return (
    <button class="member" classList={{ off: !props.person.online }} onClick={() => props.onOpen(props.person)}
      ref={(el) => { ref(el); sizeRef(el); }}>
      <Show when={profile()?.plate.preset && size().w > 0}>
        <PlateCanvas slot={() => profile()!.plate} w={size().w} h={size().h} animate={anim()} />
      </Show>
      <Avatar person={props.person} size={32} />
      <span class="member-text">
        <span class="member-name" style={roleStyle(props.person.colour)}><NameText person={props.person} />
          <Show when={props.person.bot}><span class="tag">Bot</span></Show></span>
        <Show when={props.person.status}><small>{props.person.status}</small></Show>
      </span>
    </button>
  );
}

/** Member list grouped like Stoat: hoisted roles, then Online, then Offline (collapsible). */
export function Members(props: { spaceId: string; onOpen(p: Person): void }) {
  const [groups] = createResource(() => props.spaceId, (id) => backend()!.members(id));
  const [hideOffline, setHideOffline] = createSignal(false);
  return (
    <aside class="members" aria-label="Members">
      <Show when={groups.loading}><div class="loading-row"><div class="spinner small" /></div></Show>
      <Show when={groups.error}><p class="empty small">Couldn't load members.</p></Show>
      <For each={groups()}>{(g) => (
        <section>
          <Show when={g.title === "Offline"} fallback={<h3 class="mhead">{g.title} — {g.people.length}</h3>}>
            <button class="mhead toggle" onClick={() => setHideOffline(!hideOffline())} aria-expanded={!hideOffline()}>Offline — {g.people.length}</button>
          </Show>
          <Show when={g.title !== "Offline" || !hideOffline()}>
            <For each={g.people}>{(p) => <MemberRow person={p} onOpen={props.onOpen} />}</For>
          </Show>
        </section>
      )}</For>
    </aside>
  );
}
