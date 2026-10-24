import { batch, createEffect, createResource, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { ChannelInfo, Msg, Person } from "../lib/backend/types";
import { Composer } from "./chat/Composer";
import { MessageRow } from "./chat/Message";
import { Icon } from "./icons";
import { backend } from "./store";

const day = (d: Date) => d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

/**
 * One channel's messages: newest page first, older pages as you scroll up,
 * live updates, typing, replies, edits. Keeps you pinned to the bottom unless
 * you've scrolled up to read.
 */
export function Chat(props: { channel: ChannelInfo; spaceId?: string; onProfile(p: Person): void; onOpenChannel(id: string): void }) {
  const [msgs, setMsgs] = createSignal<Msg[]>([]);
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading");
  const [more, setMore] = createSignal(false);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<Msg | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [typers, setTypers] = createSignal<Person[]>([]);
  const [pinned, setPinned] = createSignal(true); // stuck to the bottom
  const [hl, setHl] = createSignal<string | null>(null);
  let list!: HTMLDivElement, inner!: HTMLDivElement, top!: HTMLDivElement;

  const b = () => backend()!;
  const id = () => props.channel.id;
  const toBottom = () => { if (list) list.scrollTop = list.scrollHeight; };
  const ack = () => { if (document.hasFocus() && pinned()) b().ack(id()); };

  const [members] = createResource(() => props.spaceId && props.spaceId !== "home" ? props.spaceId : null, (s) => b().members(s).catch(() => []));
  const people = (): Person[] => {
    const fromMembers = (members() ?? []).flatMap((g) => g.people);
    if (fromMembers.length) return fromMembers;
    const seen = new Map<string, Person>();
    if (props.channel.peer) seen.set(props.channel.peer.id, props.channel.peer);
    for (const m of msgs()) seen.set(m.author.id, m.author);
    return [...seen.values()];
  };

  // (Re)load when the channel changes.
  createEffect(on(id, (cid) => {
    batch(() => { setMsgs([]); setState("loading"); setReplyTo(null); setEditing(null); setTypers([]); setPinned(true); setMore(false); });
    let alive = true;
    b().messages(cid).then((page) => {
      if (!alive) return;
      batch(() => { setMsgs(page); setMore(page.length >= 25); setState("ready"); });
      queueMicrotask(() => { toBottom(); ack(); });
    }).catch(() => alive && setState("error"));
    onCleanup(() => { alive = false; });
  }));

  // Live events for this channel.
  createEffect(on(id, (cid) => {
    const off = b().onEvent((e) => {
      if (e.t === "message" && e.m.channelId === cid) {
        if (msgs().some((m) => m.id === e.m.id)) return;
        setMsgs([...msgs(), e.m]);
        setTypers(typers().filter((p) => p.id !== e.m.author.id));
        if (pinned() || e.m.author.id === b().me.id) queueMicrotask(toBottom);
        ack();
      } else if (e.t === "update" && e.m.channelId === cid) {
        setMsgs(msgs().map((m) => (m.id === e.m.id ? e.m : m)));
      } else if (e.t === "delete" && e.channelId === cid) {
        setMsgs(msgs().filter((m) => m.id !== e.id));
      } else if (e.t === "typing" && e.channelId === cid) {
        setTypers(e.people.filter((p) => p.id !== b().me.id));
      }
    });
    onCleanup(off);
  }));

  // Keep the bottom in view while images load, if you were at the bottom.
  onMount(() => {
    const ro = new ResizeObserver(() => { if (pinned()) toBottom(); });
    ro.observe(inner);
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) void older(); }, { root: list, rootMargin: "400px 0px 0px 0px" });
    io.observe(top);
    const focus = () => ack();
    addEventListener("focus", focus);
    onCleanup(() => { ro.disconnect(); io.disconnect(); removeEventListener("focus", focus); });
  });

  async function older() {
    if (!more() || loadingOlder() || state() !== "ready" || !msgs().length) return;
    setLoadingOlder(true);
    const cid = id();
    try {
      const page = await b().messages(cid, msgs()[0]!.id);
      if (cid !== id()) return;
      const h = list.scrollHeight, t = list.scrollTop;
      const known = new Set(msgs().map((m) => m.id));
      setMsgs([...page.filter((m) => !known.has(m.id)), ...msgs()]);
      setMore(page.length >= 25);
      list.scrollTop = t + (list.scrollHeight - h); // stay on the message you were reading
    } catch { /* try again on next scroll */ }
    finally { setLoadingOlder(false); }
  }

  function jump(mid: string) {
    const el = document.getElementById(`msg-${mid}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setHl(mid);
    setTimeout(() => hl() === mid && setHl(null), 1800);
  }

  async function send(text: string, files: File[], mention: boolean) {
    const r = replyTo();
    await b().send(id(), { text, files, replies: r ? [{ id: r.id, mention }] : undefined });
    setReplyTo(null);
  }

  const editLast = () => {
    const mine = [...msgs()].reverse().find((m) => m.author.id === b().me.id && !m.system);
    if (mine) setEditing(mine.id);
  };

  const typingText = () => {
    const t = typers();
    if (!t.length) return "";
    if (t.length === 1) return `${t[0]!.name} is typing…`;
    if (t.length <= 3) return `${t.slice(0, -1).map((p) => p.name).join(", ")} and ${t[t.length - 1]!.name} are typing…`;
    return "Several people are typing…";
  };

  const act = {
    onProfile: props.onProfile,
    onReply: (m: Msg) => { setReplyTo(m); setEditing(null); (document.querySelector(".composer textarea") as HTMLTextAreaElement | null)?.focus(); },
    onEdit: (m: Msg | null) => setEditing(m?.id ?? null),
    onJump: jump,
    local: (mid: string) => msgs().find((m) => m.id === mid),
    ctx: { onUser: (uid: string) => props.onProfile(b().person(uid)), onChannel: props.onOpenChannel },
  };

  return (
    <>
      <div class="messages" ref={list} role="log" aria-live="polite" aria-relevant="additions"
        onScroll={() => setPinned(list.scrollHeight - list.scrollTop - list.clientHeight < 80)}>
        <div ref={inner} class="messages-inner">
          <div ref={top} class="older-sentinel" />
          <Show when={state() === "ready" && !more()}>
            <div class="channel-start">
              <div class="cs-icon panel-raised"><Icon name={props.channel.kind === "dm" ? "user" : props.channel.kind === "group" ? "users" : "hash"} size={30} /></div>
              <h2>{props.channel.kind === "dm" ? props.channel.name : props.channel.kind === "text" ? `Welcome to #${props.channel.name}` : props.channel.name}</h2>
              <p class="muted">{props.channel.kind === "dm" ? `This is the start of your conversation with ${props.channel.name}.` : props.channel.description || "This is the start of the channel."}</p>
            </div>
          </Show>
          <Show when={loadingOlder() || state() === "loading"}><div class="loading-row"><div class="spinner small" /></div></Show>
          <Show when={state() === "error"}><p class="empty">Couldn't load messages. Check your connection, then open this channel again.</p></Show>
          <For each={msgs()}>{(m, i) => {
            const prev = () => msgs()[i() - 1];
            const newDay = () => !prev() || prev()!.at.toDateString() !== m.at.toDateString();
            return (
              <>
                <Show when={newDay()}><div class="day" role="separator"><span>{day(m.at)}</span></div></Show>
                <MessageRow m={m} prev={newDay() ? undefined : prev()} editing={editing() === m.id} act={act} highlight={hl() === m.id} />
              </>
            );
          }}</For>
        </div>
      </div>
      <Show when={!pinned()}>
        <button class="jump-present panel" onClick={() => { toBottom(); setPinned(true); ack(); }}><Icon name="down" size={16} />Jump to present</button>
      </Show>
      <div class="typing" aria-live="polite">
        <Show when={typingText()}><span class="dots" aria-hidden="true"><i /><i /><i /></span>{typingText()}</Show>
      </div>
      <Composer channel={props.channel} people={people} replyTo={replyTo()} onCancelReply={() => setReplyTo(null)}
        onEditLast={editLast} onSent={() => { setPinned(true); queueMicrotask(toBottom); }} send={send} />
    </>
  );
}
