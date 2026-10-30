import { batch, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { ChannelInfo, Msg, Person } from "../lib/backend/types";
import { Composer, composer } from "./chat/Composer";
import { MessageRow } from "./chat/Message";
import { Icon } from "./icons";
import { backend } from "./store";
import { jumpRequest, setJumpRequest } from "./nav";
import { getDraft } from "./drafts";

const day = (d: Date) => d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

/**
 * One channel's messages: newest page first, older pages as you scroll up,
 * live updates, typing, replies, edits. Keeps you pinned to the bottom unless
 * you've scrolled up to read.
 */
export function Chat(props: { channel: ChannelInfo; spaceId?: string; onProfile(p: Person): void; onOpenChannel(id: string): void; banner?: JSX.Element }) {
  const [msgs, setMsgs] = createSignal<Msg[]>([]);
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading");
  const [more, setMore] = createSignal(false);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [replyTo, setReplyTo] = createSignal<Msg | null>(null);
  const [editing, setEditing] = createSignal<string | null>(null);
  const [typers, setTypers] = createSignal<Person[]>([]);
  const [pinned, setPinned] = createSignal(true); // stuck to the bottom
  const [hl, setHl] = createSignal<string | null>(null);
  /** Showing an older stretch of history (after a jump), not the newest messages. */
  const [detached, setDetached] = createSignal(false);
  const [loadingNewer, setLoadingNewer] = createSignal(false);
  /** Where you'd read up to when you opened this channel: drives the "new messages" bar and the New line. */
  const [since, setSince] = createSignal<string | null>(null);
  const [sinceBar, setSinceBar] = createSignal(false);
  let jumping = 0; // while a jump settles: no paging, no snapping to the bottom
  let list!: HTMLDivElement, inner!: HTMLDivElement, top!: HTMLDivElement, bottom!: HTMLDivElement;

  const b = () => backend()!;
  const rules = createMemo(() => b().channelRules(props.channel.id));
  // A memo, so a refreshed channel object with the same id doesn't reload the conversation.
  const id = createMemo(() => props.channel.id);
  const toBottom = () => { if (list) list.scrollTop = list.scrollHeight; };
  /** "Mark as unread" picked this message: it and everything after stay unread until you leave the chat. */
  const [unreadFrom, setUnreadFrom] = createSignal<string | null>(null);
  const ack = () => { if (document.hasFocus() && pinned() && !unreadFrom()) b().ack(id()); };

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
    // Read where you were up to before anything marks the channel read.
    const marker = props.channel.unread ? b().lastRead(cid) ?? null : null;
    batch(() => { setMsgs([]); setState("loading"); setReplyTo(null); setEditing(null); setTypers([]); setPinned(true); setMore(false); setDetached(false); setSince(marker); setSinceBar(!!marker); setUnreadFrom(null); });
    let alive = true;
    const direct = props.channel.kind === "dm" || props.channel.kind === "group";
    // DMs open at the first unread message; channels open at the newest, with a bar to jump back.
    const load = direct && marker ? b().messagesAround(cid, marker).then((page) => ({ page, around: true })) : b().messages(cid).then((page) => ({ page, around: false }));
    load.then(({ page, around }) => {
      if (!alive) return;
      const at = around ? page.findIndex((m) => m.id === marker) : -1;
      // An "around" page that reaches the newest message isn't detached history.
      const tail = around ? page.length - at - 1 : 0;
      batch(() => { setMsgs(page); setMore(page.length >= 25); setState("ready"); if (around && tail >= 24) { setDetached(true); setPinned(false); } });
      queueMicrotask(() => {
        if (around && at >= 0) {
          jumping = Date.now() + 800;
          document.getElementById("new-line")?.scrollIntoView({ block: "center" });
          if (tail < 24) ack();
        } else { toBottom(); ack(); }
      });
      // The reply you were writing comes back with the draft.
      const rid = getDraft(cid).reply?.id;
      if (rid) void (page.find((m) => m.id === rid) ? Promise.resolve(page.find((m) => m.id === rid)!) : b().message(cid, rid)).then((m) => { if (alive && m && id() === cid) setReplyTo(m); });
    }).catch(() => alive && setState("error"));
    onCleanup(() => { alive = false; });
  }));

  // "Mark as unread" on a message here: the New line goes right above it.
  const onMarkUnread = (e: Event) => {
    const d = (e as CustomEvent<{ channelId: string; messageId: string }>).detail;
    if (d?.channelId !== id()) return;
    const list = msgs(), i = list.findIndex((m) => m.id === d.messageId);
    if (i >= 0) batch(() => { setUnreadFrom(d.messageId); setSince(i > 0 ? list[i - 1]!.id : null); setSinceBar(true); });
  };
  addEventListener("mustela:mark-unread", onMarkUnread);
  onCleanup(() => removeEventListener("mustela:mark-unread", onMarkUnread));

  /** The first message after where you'd read, if it's loaded. */
  const firstNew = createMemo(() => {
    if (unreadFrom()) return unreadFrom();
    const mk = since();
    if (!mk) return null;
    const list = msgs();
    const i = list.findIndex((m) => m.id === mk);
    if (i < 0) return null;
    return list.slice(i + 1).find((m) => m.author.id !== b().me.id && !m.pending)?.id ?? null;
  });
  /** "12 new messages since 3:42 PM" (or "50+" when the marker isn't loaded). */
  const sinceText = createMemo(() => {
    const from = unreadFrom();
    if (from) {
      const list = msgs(), i = list.findIndex((m) => m.id === from);
      if (i >= 0) {
        const n = list.length - i, at = list[i]!.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        return `${n} new message${n === 1 ? "" : "s"} since ${at}`;
      }
    }
    const mk = since();
    if (!mk) return "";
    const list = msgs();
    const i = list.findIndex((m) => m.id === mk);
    const fresh = i < 0 ? null : list.slice(i + 1).filter((m) => m.author.id !== b().me.id);
    if (fresh && !fresh.length) return "";
    const when = i >= 0 ? list[i + 1]?.at : undefined;
    const time = when ? when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    const n = fresh ? `${fresh.length} new message${fresh.length === 1 ? "" : "s"}` : `${list.length}+ new messages`;
    return time ? `${n} since ${time}` : n;
  });
  async function jumpToNew() {
    const from = unreadFrom();
    if (from) { document.getElementById(`msg-${from}`)?.scrollIntoView({ block: "center" }); return; }
    const mk = since();
    if (!mk) return;
    if (!msgs().some((m) => m.id === mk)) {
      jumping = Date.now() + 1200;
      const page = await b().messagesAround(id(), mk).catch(() => []);
      if (!page.length) return;
      batch(() => { setMsgs(page); setMore(true); setDetached(true); setPinned(false); });
      await new Promise((r) => requestAnimationFrame(r));
    }
    document.getElementById("new-line")?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  const markRead = () => { setUnreadFrom(null); b().markRead({ channel: id() }); setSinceBar(false); };

  // Live events for this channel.
  createEffect(on(id, (cid) => {
    const off = b().onEvent((e) => {
      if (e.t === "message" && e.m.channelId === cid) {
        if (msgs().some((m) => m.id === e.m.id) || detached()) return;
        setMsgs([...msgs(), e.m]);
        setTypers(typers().filter((p) => p.id !== e.m.author.id));
        if (pinned() || e.m.author.id === b().me.id) queueMicrotask(toBottom);
        ack();
      } else if (e.t === "update" && e.m.channelId === cid) {
        setMsgs(msgs().map((m) => (m.id === e.m.id ? e.m : m)));
      } else if (e.t === "delete" && e.channelId === cid) {
        setMsgs(msgs().filter((m) => m.id !== e.id));
      } else if (e.t === "reconnected" && !detached() && msgs().length) {
        // Load whatever arrived while the connection was down.
        const last = msgs()[msgs().length - 1]!.id;
        void b().messagesAfter(cid, last).then((page) => {
          if (id() !== cid || !page.length) return;
          const known = new Set(msgs().map((m) => m.id));
          setMsgs([...msgs(), ...page.filter((m) => !known.has(m.id))]);
          if (page.length >= 25) setDetached(true); // a long gap: let "Jump to present" reload the newest page
          if (pinned()) queueMicrotask(toBottom);
        }).catch(() => {});
      } else if (e.t === "typing" && e.channelId === cid) {
        setTypers(e.people.filter((p) => p.id !== b().me.id));
      }
    });
    onCleanup(off);
  }));

  // Keep the bottom in view while images load, if you were at the bottom.
  onMount(() => {
    const ro = new ResizeObserver(() => { if (pinned() && Date.now() > jumping) toBottom(); });
    ro.observe(inner);
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) void older(); }, { root: list, rootMargin: "400px 0px 0px 0px" });
    io.observe(top);
    const io2 = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) void newer(); }, { root: list, rootMargin: "0px 0px 400px 0px" });
    io2.observe(bottom);
    onCleanup(() => io2.disconnect());
    const focus = () => ack();
    addEventListener("focus", focus);
    onCleanup(() => { ro.disconnect(); io.disconnect(); removeEventListener("focus", focus); });
  });

  async function older() {
    if (!more() || loadingOlder() || state() !== "ready" || !msgs().length || Date.now() < jumping) return;
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

  /** Reading forward after a jump: load the next page until we reach the newest message. */
  async function newer() {
    if (!detached() || loadingNewer() || !msgs().length || Date.now() < jumping) return;
    setLoadingNewer(true);
    const cid = id();
    try {
      const page = await b().messagesAfter(cid, msgs()[msgs().length - 1]!.id);
      if (cid !== id()) return;
      const known = new Set(msgs().map((m) => m.id));
      batch(() => { setMsgs([...msgs(), ...page.filter((m) => !known.has(m.id))]); if (page.length < 25) setDetached(false); });
    } catch { /* retry on next scroll */ }
    finally { setLoadingNewer(false); }
  }

  /** Back to the newest messages, reloading if we'd jumped into history. */
  async function present() {
    if (detached()) {
      const page = await b().messages(id()).catch(() => null);
      if (page) batch(() => { setMsgs(page); setMore(page.length >= 25); setDetached(false); });
    }
    queueMicrotask(() => { toBottom(); setPinned(true); ack(); });
  }

  async function jump(mid: string) {
    let el = document.getElementById(`msg-${mid}`);
    let instant = false;
    if (!el) {
      instant = true;
      jumping = Date.now() + 1200;
      // Not loaded: fetch the stretch of history around it.
      const page = await b().messagesAround(id(), mid).catch(() => []);
      if (!page.some((m) => m.id === mid)) return;
      batch(() => { setMsgs(page); setMore(true); setDetached(true); setPinned(false); });
      await new Promise((r) => requestAnimationFrame(r));
      el = document.getElementById(`msg-${mid}`);
      if (!el) return;
    }
    el.scrollIntoView({ block: "center", behavior: instant || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setHl(mid);
    setTimeout(() => hl() === mid && setHl(null), 1800);
  }

  async function send(text: string, files: File[], spoilers: boolean[], mention: boolean, onProgress: (f: number) => void) {
    const r = replyTo();
    await b().send(id(), { text, files, spoilers, replies: r ? [{ id: r.id, mention }] : undefined, onProgress });
    setReplyTo(null);
  }

  // Jumps asked for from elsewhere (search results, pinned messages, links).
  createEffect(on([jumpRequest, state] as const, ([r, st]) => {
    if (!r || r.channelId !== id() || st !== "ready") return;
    setJumpRequest(null);
    void jump(r.id);
  }));

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
    onReply: (m: Msg) => { setReplyTo(m); setEditing(null); composer.focus(); },
    onEdit: (m: Msg | null) => setEditing(m?.id ?? null),
    onJump: (mid: string) => void jump(mid),
    local: (mid: string) => msgs().find((m) => m.id === mid),
    ctx: { onUser: (uid: string) => props.onProfile(b().person(uid)), onChannel: props.onOpenChannel },
    get serverId() { return props.spaceId && props.spaceId !== "home" ? props.spaceId : undefined; },
    rules: () => rules(),
  };

  /* Drop files anywhere on the chat. Counting enter/leave because they fire for every child element. */
  const [dropping, setDropping] = createSignal(0);
  const [dropped, setDropped] = createSignal<File[] | null>(null);
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");

  return (
    <div class="chat" ref={(el) => {
      // The message box's height, so the "viewing older messages" card floats just above it whatever its size.
      onMount(() => {
        const box = el.querySelector<HTMLElement>(".composer-wrap");
        if (!box) return;
        const ro = new ResizeObserver(() => el.style.setProperty("--composer-h", `${box.offsetHeight}px`));
        ro.observe(box); onCleanup(() => ro.disconnect());
      });
    }}
      onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setDropping(dropping() + 1); } }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; } }}
      onDragLeave={(e) => { if (hasFiles(e)) setDropping(Math.max(0, dropping() - 1)); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDropping(0); setDropped([...(e.dataTransfer?.files ?? [])]); }}>
      {props.banner}
      <Show when={sinceBar() && sinceText()}>
        <div class="since-bar" role="status">
          <button class="sb-jump" onClick={() => void jumpToNew()}>{sinceText()}<span class="grow" /><span class="sb-act">Jump<Icon name="arrow-in" size={14} /></span></button>
          <button class="sb-read" onClick={markRead}>Mark as read<Icon name="check-all" size={15} /></button>
        </div>
      </Show>
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
                <Show when={firstNew() === m.id}><div class="new-line" id="new-line" role="separator" aria-label="New messages"><span>New</span></div></Show>
                <MessageRow m={m} prev={newDay() ? undefined : prev()} editing={editing() === m.id} act={act} highlight={hl() === m.id} />
              </>
            );
          }}</For>
          <Show when={loadingNewer()}><div class="loading-row"><div class="spinner small" /></div></Show>
          <div ref={bottom} class="newer-sentinel" />
        </div>
      </div>
      <Show when={detached()} fallback={<Show when={!pinned()}><button class="jump-present panel" onClick={() => void present()}><Icon name="down" size={16} />Jump to present</button></Show>}>
        <div class="older-bar" role="status"><span>You're viewing older messages</span><button class="btn small primary" onClick={() => void present()}>Jump to present</button></div>
      </Show>
      <div class="typing" aria-live="polite">
        <Show when={typingText()}><span class="dots" aria-hidden="true"><i /><i /><i /></span>{typingText()}</Show>
      </div>
      <Composer channel={props.channel} spaceId={props.spaceId && props.spaceId !== "home" ? props.spaceId : undefined} people={people} replyTo={replyTo()} onCancelReply={() => setReplyTo(null)}
        onEditLast={editLast} onSent={() => void present()} send={send}
        incoming={dropped} onIncomingTaken={() => setDropped(null)}
        sendGif={(url) => b().send(id(), { text: url }).then(() => { setPinned(true); queueMicrotask(toBottom); })} />
      <Show when={dropping() > 0}>
        <div class="drop-zone" aria-hidden="true">
          <div class="dz-card panel"><Icon name="plus-circle" size={34} /><strong>Upload to {props.channel.kind === "dm" ? props.channel.name : `#${props.channel.name}`}</strong><small>Up to 5 files, 20 MB each</small></div>
        </div>
      </Show>
    </div>
  );
}
