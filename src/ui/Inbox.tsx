import { createMemo, createResource, For, onCleanup, Show } from "solid-js";
import { useBack } from "./back";
import type { Msg, Space } from "../lib/backend/types";
import { plain } from "../lib/markdown";
import { Avatar, NameText } from "./Avatar";
import { Icon } from "./icons";
import { requestJump, setInboxOpen } from "./nav";
import { backend } from "./store";

const MAX = 40;

/**
 * The inbox: messages that mention you (you, a role you have, @everyone or @online),
 * grouped by server. Click one to jump straight to it. Opens from the title bar,
 * or full screen from the bell on phones.
 */
export function Inbox(props: { spaces: Space[]; onOpen(serverId: string, channelId: string): void }) {
  const close = () => setInboxOpen(false);
  useBack(close);
  const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
  addEventListener("keydown", esc); onCleanup(() => removeEventListener("keydown", esc));

  const where = (cid: string) => {
    for (const s of props.spaces) { const c = s.channels.find((x) => x.id === cid); if (c) return { s, c }; }
    return null;
  };
  // Newest first, at most MAX messages, fetched together (most are already cached by the SDK).
  const [items, { refetch }] = createResource(() => backend()?.mentionIds() ?? [], async (list) => {
    const flat = list.flatMap((x) => x.ids.map((id) => ({ channelId: x.channelId, id }))).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, MAX);
    const got = await Promise.all(flat.map((x) => backend()!.message(x.channelId, x.id)));
    return got.filter((m): m is Msg => !!m);
  });
  const groups = createMemo(() => {
    const m = new Map<string, { s?: Space; title: string; list: { msg: Msg; channel: string }[] }>();
    for (const msg of items() ?? []) {
      const w = where(msg.channelId);
      const key = w?.s.id ?? "other";
      const g = m.get(key) ?? { s: w?.s, title: w?.s.home ? "Direct messages" : w?.s.name ?? "Elsewhere", list: [] };
      g.list.push({ msg, channel: w?.c.kind === "dm" ? w.c.name : w?.c.kind === "group" ? w.c.name : `#${w?.c.name ?? "channel"}` });
      m.set(key, g);
    }
    return [...m.values()];
  });
  const jump = (msg: Msg) => {
    const w = where(msg.channelId);
    close();
    if (w) props.onOpen(w.s.id, w.c.id);
    requestJump(msg.channelId, msg.id);
  };
  const readAll = () => { for (const x of backend()?.mentionIds() ?? []) backend()?.markRead({ channel: x.channelId }); setTimeout(() => void refetch(), 300); };

  return (
    <div class="pop-scrim clear" onClick={close}>
      <div class="inbox" role="dialog" aria-label="Inbox" onClick={(e) => e.stopPropagation()}>
        <header class="inbox-head">
          <button class="icon-btn inbox-back" aria-label="Back" onClick={close}><Icon name="back" size={20} /></button>
          <Icon name="at" size={18} /><h2>Mentions</h2><span class="grow" />
          <Show when={items()?.length}><button class="btn small" onClick={readAll}><Icon name="check-all" size={15} />Mark all read</button></Show>
        </header>
        <div class="inbox-body">
          <Show when={!items.loading || items()} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
            <For each={groups()} fallback={<div class="inbox-empty"><Icon name="at" size={30} /><p>Nobody's mentioned you. You're all caught up.</p></div>}>{(g) => (
              <section class="inbox-group">
                <h3>
                  <Show when={g.s && !g.s.home} fallback={<><Icon name="chat" size={14} />{g.title}</>}>
                    <span class="mini-orb">{g.s!.iconUrl ? <img src={g.s!.iconUrl} alt="" /> : g.s!.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>{g.title}
                  </Show>
                </h3>
                <For each={g.list}>{(it) => (
                  <button class="inbox-msg" onClick={() => jump(it.msg)}>
                    <Avatar person={it.msg.author} size={32} presence={false} still />
                    <span class="im-body">
                      <span class="im-top"><NameText person={it.msg.author} /><small class="muted">{it.channel} · {it.msg.at.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small></span>
                      <span class="im-text">{plain(it.msg.text, { user: (id) => backend()!.person(id).name, channel: (id) => backend()!.channelName(id) }).slice(0, 200) || "Sent an attachment"}</span>
                    </span>
                  </button>
                )}</For>
              </section>
            )}</For>
          </Show>
        </div>
      </div>
    </div>
  );
}
