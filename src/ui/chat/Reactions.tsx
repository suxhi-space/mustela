import { createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { Msg } from "../../lib/backend/types";
import { Avatar, NameText } from "../Avatar";
import { useBack } from "../back";
import { Icon } from "../icons";
import { setProfileOpen } from "../nav";
import { backend } from "../store";
import { UEmoji } from "./UEmoji";

/** "View reactions": every reaction on a message, and who left each one. */
const [shown, setShown] = createSignal<{ m: Msg; pick?: string } | null>(null);
export const openReactions = (m: Msg, pick?: string) => setShown({ m, pick });

const isCustom = (e: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(e);

export function ReactionsHost() {
  return <Show when={shown()} keyed>{(s) => <ReactionsView m={s.m} pick={s.pick} />}</Show>;
}

function ReactionsView(props: { m: Msg; pick?: string }) {
  const close = () => setShown(null);
  useBack(close);
  const list = () => props.m.reactions ?? [];
  const [tab, setTab] = createSignal(props.pick ?? list()[0]?.emoji ?? "");
  const users = () => list().find((r) => r.emoji === tab())?.users ?? [];
  const icon = (e: string) => (isCustom(e) ? <img class="cemoji" src={backend()!.emojiUrl(e)} alt="" /> : <UEmoji e={e} />);
  return (
    <Portal>
      <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === "Escape" && close()}>
        <div class="modal reactions-view" role="dialog" aria-label="Reactions">
          <header class="rv-head"><h2>Reactions</h2><span class="grow" /><button class="icon-btn" aria-label="Close" onClick={close}><Icon name="close" size={18} /></button></header>
          <div class="rv-body">
            <nav class="rv-tabs" role="tablist">
              <For each={list()}>{(r) => (
                <button role="tab" aria-selected={tab() === r.emoji} classList={{ on: tab() === r.emoji }} onClick={() => setTab(r.emoji)}>{icon(r.emoji)}<span>{r.users.length}</span></button>
              )}</For>
            </nav>
            <ul class="rv-people">
              <For each={users()} fallback={<li class="empty">No reactions.</li>}>{(id) => {
                const p = () => backend()!.person(id);
                return <li><button onClick={() => { close(); setProfileOpen(p()); }}><Avatar person={p()} size={32} presence={false} still /><span><NameText person={p()} fontOnly /><Show when={p().username}><small>{p().username}</small></Show></span></button></li>;
              }}</For>
            </ul>
          </div>
        </div>
      </div>
    </Portal>
  );
}
