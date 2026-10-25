import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { ChannelInfo, Space } from "../lib/backend/types";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { setInboxOpen } from "./nav";
import { backend } from "./store";

type Row = { s: Space; c: ChannelInfo };

/**
 * Discord's inbox: everything you haven't read, and the places that mention
 * you, grouped by server. Opens from the title bar.
 */
export function Inbox(props: { spaces: Space[]; onOpen(serverId: string, channelId: string): void }) {
  const [tab, setTab] = createSignal<"unread" | "mentions">("unread");
  const close = () => setInboxOpen(false);
  const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
  addEventListener("keydown", esc); onCleanup(() => removeEventListener("keydown", esc));

  const rows = createMemo<Row[]>(() => props.spaces.flatMap((s) => s.channels.filter((c) => c.kind !== "voice" && !c.muted && (tab() === "mentions" ? (c.mentions ?? 0) > 0 : c.unread)).map((c) => ({ s, c }))));
  const groups = createMemo(() => {
    const m = new Map<string, { s: Space; list: ChannelInfo[] }>();
    for (const r of rows()) { const g = m.get(r.s.id) ?? { s: r.s, list: [] }; g.list.push(r.c); m.set(r.s.id, g); }
    return [...m.values()];
  });
  const readAll = () => { for (const r of rows()) backend()?.markRead({ channel: r.c.id }); };

  return (
    <div class="pop-scrim clear" onClick={close}>
      <div class="inbox" role="dialog" aria-label="Inbox" onClick={(e) => e.stopPropagation()}>
        <header class="inbox-head">
          <Icon name="inbox" size={18} /><h2>Inbox</h2><span class="grow" />
          <Show when={rows().length}><button class="btn small" onClick={readAll}><Icon name="check-all" size={15} />Mark all read</button></Show>
        </header>
        <nav class="inbox-tabs" role="tablist">
          <button role="tab" aria-selected={tab() === "unread"} classList={{ on: tab() === "unread" }} onClick={() => setTab("unread")}>Unreads</button>
          <button role="tab" aria-selected={tab() === "mentions"} classList={{ on: tab() === "mentions" }} onClick={() => setTab("mentions")}>Mentions</button>
        </nav>
        <div class="inbox-body">
          <For each={groups()} fallback={
            <div class="inbox-empty"><Icon name={tab() === "mentions" ? "at" : "check-all"} size={30} /><p>{tab() === "mentions" ? "Nobody's mentioned you." : "You're all caught up."}</p></div>
          }>{(g) => (
            <section class="inbox-group">
              <h3>
                <Show when={!g.s.home} fallback={<><Icon name="chat" size={14} />Direct messages</>}>
                  <span class="mini-orb">{g.s.iconUrl ? <img src={g.s.iconUrl} alt="" /> : g.s.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>{g.s.name}
                </Show>
              </h3>
              <For each={g.list}>{(c) => (
                <div class="inbox-row">
                  <button class="inbox-open" onClick={() => { close(); props.onOpen(g.s.id, c.id); }}>
                    <Show when={c.kind === "dm" && c.peer} fallback={<Icon name={c.kind === "group" ? "users" : "hash"} size={18} class="muted" />}><Avatar person={c.peer!} size={24} /></Show>
                    <span class="grow">{c.name}</span>
                    <Show when={c.mentions}><span class="badge">{c.mentions}</span></Show>
                  </button>
                  <button class="icon-btn" title="Mark as read" aria-label={`Mark ${c.name} as read`} onClick={() => backend()?.markRead({ channel: c.id })}><Icon name="check" size={16} /></button>
                </div>
              )}</For>
            </section>
          )}</For>
        </div>
      </div>
    </div>
  );
}
