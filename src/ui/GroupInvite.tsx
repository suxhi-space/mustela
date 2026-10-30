import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { useBack } from "./back";
import type { ChannelInfo, Person } from "../lib/backend/types";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { toast } from "./menu";
import { backend } from "./store";

/**
 * "Add friends to DM", like Discord: from a DM it starts a new group with the
 * two of you plus whoever you pick; from a group it adds them in.
 */
export function GroupInvite(props: { channel: ChannelInfo; onClose(): void; onOpen(channelId: string): void }) {
  useBack(() => props.onClose());
  const [friends] = createResource(() => backend()!.friends().then((f) => f.friends));
  const inside = createMemo(() => new Set(backend()!.recipients(props.channel.id).map((p) => p.id)));
  const [q, setQ] = createSignal("");
  const [picked, setPicked] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal(false);
  const list = () => (friends() ?? []).filter((f) => !inside().has(f.id) && f.name.toLowerCase().includes(q().trim().toLowerCase()));
  const toggle = (p: Person) => setPicked(picked().includes(p.id) ? picked().filter((x) => x !== p.id) : [...picked(), p.id].slice(0, 49));
  async function go() {
    setBusy(true);
    try {
      if (props.channel.kind === "group") {
        for (const id of picked()) await backend()!.addToGroup(props.channel.id, id);
        toast(picked().length === 1 ? "Added to the group" : `Added ${picked().length} people`);
        props.onClose();
      } else {
        const id = await backend()!.createGroup([...inside(), ...picked()]);
        props.onClose(); props.onOpen(id);
      }
    } catch (e) { toast((e as Error).message || "Couldn't do that.", true); } finally { setBusy(false); }
  }
  return (
    <div class="scrim" onClick={props.onClose}>
      <div class="modal panel group-invite" role="dialog" aria-label="Add friends" onClick={(e) => e.stopPropagation()}>
        <h2>{props.channel.kind === "group" ? "Add friends to this group" : "Start a group"}</h2>
        <p class="muted small">{props.channel.kind === "group" ? "They'll see the conversation from now on." : `A new group with ${props.channel.name} and whoever you pick.`}</p>
        <label class="search-box wide"><Icon name="search" size={16} /><input placeholder="Search friends" value={q()} onInput={(e) => setQ(e.currentTarget.value)} autofocus /></label>
        <div class="gi-list">
          <For each={list()} fallback={<p class="empty small">{friends.loading ? "Loading friends…" : "No friends to add."}</p>}>{(f) => (
            <button class="gi-row" classList={{ on: picked().includes(f.id) }} aria-pressed={picked().includes(f.id)} onClick={() => toggle(f)}>
              <Avatar person={f} size={32} /><span class="grow">{f.name}</span><span class="gi-check"><Show when={picked().includes(f.id)}><Icon name="check" size={14} /></Show></span>
            </button>
          )}</For>
        </div>
        <div class="row end">
          <button class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn primary" disabled={!picked().length || busy()} onClick={() => void go()}>{props.channel.kind === "group" ? "Add" : "Create group"}</button>
        </div>
      </div>
    </div>
  );
}
