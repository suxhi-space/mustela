import { createResource, For, Show } from "solid-js";
import type { ChannelInfo, Msg } from "../../lib/backend/types";
import { fmtStamp } from "../../lib/time";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { requestJump } from "../nav";
import { backend } from "../store";
import { Markdown } from "./Markdown";

export type Panel = { kind: "search"; q: string } | { kind: "pins" };

/** Search results or pinned messages for the open channel, in the right-hand column. */
export function MessagePanel(props: { panel: Panel; channel: ChannelInfo; onClose(): void }) {
  const [list] = createResource(() => ({ p: props.panel, c: props.channel.id }), ({ p, c }) =>
    p.kind === "pins" ? backend()!.pinned(c) : backend()!.search(c, p.q));
  const title = () => (props.panel.kind === "pins" ? "Pinned messages" : `Results for “${(props.panel as { q: string }).q}”`);
  return (
    <section class="mpanel" aria-label={title()}>
      <header class="mp-head">
        <Icon name={props.panel.kind === "pins" ? "pin" : "search"} size={18} />
        <h3>{title()}</h3>
        <span class="grow" />
        <button class="icon-btn" onClick={props.onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </header>
      <div class="mp-list">
        <Show when={!list.loading} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
          <Show when={!list.error} fallback={<p class="empty">{(list.error as Error)?.message || "Couldn't load these."}</p>}>
            <For each={list()} fallback={<p class="empty">{props.panel.kind === "pins" ? "Nothing is pinned here yet. Right-click a message to pin it." : "No messages match. Try fewer words."}</p>}>{(m: Msg) => (
              <article class="mp-item">
                <header>
                  <Avatar person={m.author} size={24} presence={false} still />
                  <NameText person={m.author} class="mp-name" />
                  <time>{fmtStamp(m.at)}</time>
                </header>
                <Show when={m.text} fallback={<em class="muted">{m.attachments?.length ? "Attachment" : "Empty message"}</em>}><Markdown text={m.text} class="mp-text" /></Show>
                <button class="btn small mp-jump" onClick={() => requestJump(m.channelId, m.id)}>Jump</button>
              </article>
            )}</For>
          </Show>
        </Show>
      </div>
    </section>
  );
}
