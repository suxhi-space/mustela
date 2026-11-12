import { batch, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { phoneLayout } from "./hooks";
import { MOBILE_UI } from "./target";
import type { ChannelInfo, Msg, Person } from "../lib/backend/types";
import { Composer, composer } from "./chat/Composer";
import { MessageRow } from "./chat/Message";
import { Icon } from "./icons";
import { backend, platform } from "./store";
import { backToList, jumpRequest, openChannel, setJumpRequest } from "./nav";
import { getDraft } from "./drafts";
import { fmtTime } from "../lib/time";
import { cachedChat, saveChat } from "../lib/chatCache";

// The day dividers: formatters made once (making one per message was slow), and days compared by number.
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const dayFmtYear = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const day = (d: Date) => (d.getFullYear() === new Date().getFullYear() ? dayFmt : dayFmtYear).format(d);
const sameDay = (a: Date, b: Date) => a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

/** The index of the last message at or before this id (ids sort by time), or -1. */
function lastUpTo(list: Msg[], id: string): number {
  let at = -1;
  for (let i = 0; i < list.length && list[i]!.id <= id; i++) at = i;
  return at;
}

/** The fresh messages, reusing the ones already shown where nothing changed (same object = same row on screen). */
function keepSame(shown: Msg[], fresh: Msg[]): Msg[] {
  if (!shown.length) return fresh;
  const byId = new Map(shown.map((m) => [m.id, m]));
  const key = (m: Msg) => { try { return JSON.stringify({ ...m, pending: undefined }); } catch { return ""; } };
  return fresh.map((m) => { const o = byId.get(m.id); return o && !o.pending && key(o) === key(m) && key(m) ? o : m; });
}

/*
 * "Mark as unread" picks a message; Stoat only keeps "read up to just before it". The message itself is remembered
 * here (on this device), so opening the chat again puts the New line on it, your own messages included.
 */
const MARKED_KEY = "mustela:marked-unread";
const markedAll = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(MARKED_KEY) ?? "{}") ?? {}; } catch { return {}; } };
const saveMarked = (m: Record<string, string>) => { try { localStorage.setItem(MARKED_KEY, JSON.stringify(Object.fromEntries(Object.entries(m).slice(-50)))); } catch { /* storage off */ } };
addEventListener("mustela:mark-unread", (e) => {
  const d = (e as CustomEvent<{ channelId: string; messageId: string }>).detail;
  if (d?.channelId && d.messageId) saveMarked({ ...markedAll(), [d.channelId]: d.messageId });
});
/** The message you marked unread in this chat, if it's still unread (read elsewhere since = forgotten). Taken once. */
function takeMarked(channelId: string, lastRead: string | undefined): string | null {
  const all = markedAll(), mid = all[channelId];
  if (!mid) return null;
  delete all[channelId]; saveMarked(all);
  return lastRead !== undefined && lastRead < mid ? mid : null;
}

/* ---------- mature channels: confirm your age first, like Stoat (remembered per channel on this device) ---------- */
const AGE_KEY = "mustela:mature-ok";
const okd = (): string[] => { try { return JSON.parse(localStorage.getItem(AGE_KEY) ?? "[]"); } catch { return []; } };
const [confirmed, setConfirmed] = createSignal<string[]>(okd());
const confirmAge = (id: string) => { const next = [...confirmed().filter((x) => x !== id), id].slice(-500); setConfirmed(next); try { localStorage.setItem(AGE_KEY, JSON.stringify(next)); } catch { /* storage off: asks again next time */ } };
/** The last channel you were in that isn't mature, for "Back". */
let lastSafe: string | null = null;

export function Chat(props: Parameters<typeof ChannelChat>[0]) {
  createEffect(() => { if (!props.channel.mature) lastSafe = props.channel.id; });
  return (
    <Show when={!props.channel.mature || confirmed().includes(props.channel.id)} fallback={<MatureGate channel={props.channel} />}>
      <ChannelChat {...props} />
    </Show>
  );
}

function MatureGate(props: { channel: ChannelInfo }) {
  const [sure, setSure] = createSignal(false);
  const back = () => (phoneLayout() || !lastSafe ? backToList() : openChannel(lastSafe));
  return (
    <div class="mature-gate">
      <svg class="mg-sign" viewBox="0 0 64 56" aria-hidden="true"><path d="M28.5 4a4 4 0 0 1 7 0l27 46a4 4 0 0 1-3.5 6H5a4 4 0 0 1-3.5-6z" fill="#f5a524" /><rect x="29" y="18" width="6" height="20" rx="3" fill="#1b1b1f" /><circle cx="32" cy="45" r="3.5" fill="#1b1b1f" /></svg>
      <h2>#{props.channel.name}</h2>
      <p>This channel is marked as mature.</p>
      <label class="mg-check"><input type="checkbox" checked={sure()} onChange={(e) => setSure(e.currentTarget.checked)} />I confirm that I am at least 18 years old.</label>
      <div class="mg-actions">
        <button class="btn" onClick={back}>Back</button>
        <button class="btn primary" disabled={!sure()} onClick={() => confirmAge(props.channel.id)}>Enter channel</button>
      </div>
    </div>
  );
}

/**
 * One channel's messages: newest page first, older pages as you scroll up,
 * live updates, typing, replies, edits. Keeps you pinned to the bottom unless
 * you've scrolled up to read.
 */
function ChannelChat(props: { channel: ChannelInfo; spaceId?: string; onProfile(p: Person): void; onOpenChannel(id: string): void; banner?: JSX.Element }) {
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
  /** Showing the saved copy of the chat while the fresh one loads (no paging back, no marking read yet). */
  const [stale, setStale] = createSignal(false);
  /** The account to keep a copy of recent chats for (not the demo). */
  const cacheAccount = () => { const be = b(); return be.session() ? be.me.id : null; };
  // Keep the copy up to date: the newest messages of the chat you're reading.
  createEffect(() => {
    const list = msgs(), account = cacheAccount();
    if (account && state() === "ready" && !stale() && !detached() && list.length) saveChat(account, id(), list);
  });
  let jumping = 0; // while a jump settles: no paging, no snapping to the bottom
  /** The chat has opened and done its own first scroll (to the bottom, or to the New line): jumps go after that. */
  const [settled, setSettled] = createSignal(false);
  /**
   * After a jump, the message stays in the middle while pictures and link cards around it finish loading (they used
   * to push it to the bottom of the screen, or out of view). Until you touch or scroll yourself, or 2 seconds pass.
   */
  let centerOn: string | null = null, centerUntil = 0;
  const recenter = () => {
    if (!centerOn || Date.now() > centerUntil) { centerOn = null; return false; }
    document.getElementById(`msg-${centerOn}`)?.scrollIntoView({ block: "center" });
    return true;
  };
  let list!: HTMLDivElement, inner!: HTMLDivElement, top!: HTMLDivElement, bottom!: HTMLDivElement;

  const b = () => backend()!;
  const rules = createMemo(() => b().channelRules(props.channel.id));
  // A memo, so a refreshed channel object with the same id doesn't reload the conversation.
  const id = createMemo(() => props.channel.id);
  const toBottom = () => { if (list) list.scrollTop = list.scrollHeight; };
  /**
   * Only scrolling up yourself leaves the bottom. Pictures and link cards finishing loading, the saved copy being
   * swapped for the fresh messages, or the message box growing can all move the list without you touching it, and
   * those used to leave a chat you were up to date in on "You're viewing older messages".
   */
  let lastTop = 0;
  /**
   * You're scrolling it yourself: a finger on it, or it's still gliding after you let go (or a mouse wheel just
   * turned). Mustela never pulls the chat back to the bottom meanwhile: near the bottom, a picture loading while you
   * dragged up used to snap you back down, again and again.
   */
  let touching = false, userUntil = 0;
  const userScrolling = () => touching || Date.now() < userUntil;
  const onScroll = () => {
    const top = list.scrollTop, gap = list.scrollHeight - top - list.clientHeight, up = top < lastTop - 1;
    lastTop = top;
    // Still gliding after your finger left: that's still you.
    if (userScrolling()) userUntil = Math.max(userUntil, Date.now() + 250);
    if (gap < 80) { setPinned(true); return; }
    if (pinned() && !up && Date.now() > jumping && !userScrolling()) { toBottom(); return; }
    setPinned(false);
  };
  /** "Mark as unread" picked this message: it and everything after stay unread until you leave the chat. */
  const [unreadFrom, setUnreadFrom] = createSignal<string | null>(null);
  /** Opening a chat where you'd marked this message unread: the New line goes on it (it's read now, like Discord). */
  const [newAt, setNewAt] = createSignal<string | null>(null);
  // Android's web view doesn't always report focus, so there "on screen" is enough to count as read.
  const looking = () => document.hasFocus() || (platform === "android" && document.visibilityState === "visible");
  const ack = () => { if (looking() && pinned() && !unreadFrom()) b().ack(id()); };

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
    const manual = takeMarked(cid, b().lastRead(cid));
    const marker = manual || props.channel.unread ? b().lastRead(cid) ?? null : null;
    batch(() => { setMsgs([]); setState("loading"); setReplyTo(null); setEditing(null); setTypers([]); setPinned(true); setMore(false); setDetached(false); setSince(marker); setSinceBar(!!marker); setUnreadFrom(null); setNewAt(manual); setSettled(false); });
    let alive = true;
    const direct = props.channel.kind === "dm" || props.channel.kind === "group";
    // DMs open at the first unread message; channels open at the newest, with a bar to jump back. A message you
    // marked unread yourself opens there in both.
    const load = manual ? b().messagesAround(cid, manual).then((page) => ({ page, around: true })) : direct && marker ? b().messagesAround(cid, marker).then((page) => ({ page, around: true })) : b().messages(cid).then((page) => ({ page, around: false }));
    // Opening at the newest messages: show the saved copy of this chat (lib/chatCache.ts) straight away while the
    // fresh page loads. (Not for a DM opening at its first unread: that starts somewhere else.)
    const account = cacheAccount();
    if (account && !manual && !(direct && marker)) void cachedChat(account, cid).then((saved) => {
      if (!alive || !saved || state() !== "loading") return;
      batch(() => { setMsgs(saved); setMore(false); setState("ready"); setStale(true); });
      queueMicrotask(toBottom);
    });
    load.then(async ({ page, around }) => {
      if (!alive) return;
      setStale(false);
      // Swapping the saved copy for the fresh page: keep the messages that didn't change as they are, so their
      // pictures and link cards don't load again and push the list around.
      page = keepSame(msgs(), page);
      // Where you'd read up to: the last message at or before the marker. (Compared by time, not looked up: "mark as
      // unread" leaves a marker just before a message, which no message has as its id.)
      let at = !around ? -1 : manual ? page.findIndex((m) => m.id === manual) - 1 : lastUpTo(page, marker!);
      if (manual && at < -1) { setNewAt(null); at = -1; } // the message is gone (deleted): no New line to show
      // Only other people's messages are new. Messages you sent yourself (from another device, or before the read
      // marker caught up) leave nothing to jump to: open at the newest, marked read, instead of the old spot.
      // (Not when you marked one of your own messages unread on purpose.)
      if (around && !newAt() && (at < 0 || !page.slice(at + 1).some((m) => m.author.id !== b().me.id && !m.system))) {
        setSince(null); setSinceBar(false);
        if (at < 0 || page.length - at - 1 >= 24) page = await b().messages(cid).catch(() => page);
        if (!alive) return;
        around = false; at = -1;
      }
      // An "around" page that reaches the newest message isn't detached history.
      const tail = around ? page.length - at - 1 : 0;
      batch(() => { setMsgs(page); setMore(page.length >= 25); setState("ready"); if (around && tail >= 24) { setDetached(true); setPinned(false); } });
      queueMicrotask(() => {
        if (around && (at >= 0 || newAt())) {
          jumping = Date.now() + 800;
          document.getElementById("new-line")?.scrollIntoView({ block: "center" });
          // Seen once, like Discord: it's read now, so next time it opens at the newest (the New line stays for now).
          if (looking()) b().ack(cid);
        } else { toBottom(); ack(); }
        setSettled(true);
      });
      // The reply you were writing comes back with the draft.
      const rid = getDraft(cid).reply?.id;
      if (rid) void (page.find((m) => m.id === rid) ? Promise.resolve(page.find((m) => m.id === rid)!) : b().message(cid, rid)).then((m) => { if (alive && m && id() === cid) setReplyTo(m); });
    }).catch(() => alive && setState("error"));
    onCleanup(() => {
      alive = false;
      // Leaving a chat you were reading at the bottom: make sure it's marked read, so it opens there next time.
      if (state() === "ready" && pinned() && !detached() && !unreadFrom()) b().ack(cid);
    });
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
    const from = unreadFrom() ?? newAt();
    if (from) return msgs().some((m) => m.id === from) ? from : null;
    const mk = since();
    if (!mk) return null;
    const list = msgs();
    if (lastUpTo(list, mk) < 0) return null; // where you'd read up to isn't loaded
    return list.find((m) => m.id > mk && m.author.id !== b().me.id && !m.pending)?.id ?? null;
  });
  /** "12 new messages since 3:42 PM" (or "50+" when the marker isn't loaded). */
  const sinceText = createMemo(() => {
    const from = unreadFrom() ?? newAt();
    if (from) {
      const list = msgs(), i = list.findIndex((m) => m.id === from);
      if (i >= 0) {
        // Like the badge in the list: only other people's messages count (yours aren't new to you).
        const n = list.slice(i).filter((m) => m.author.id !== b().me.id && !m.system).length, at = fmtTime(list[i]!.at);
        return n ? `${n} new message${n === 1 ? "" : "s"} since ${at}` : `Unread since ${at}`;
      }
    }
    const mk = since();
    if (!mk) return "";
    const list = msgs();
    // Message ids sort by time, so "newer than where you read" works even when that message itself isn't
    // loaded (or was deleted). Only when every loaded message is newer can there be more than we see: then "N+".
    const fresh = list.filter((m) => m.id > mk && m.author.id !== b().me.id);
    if (!fresh.length) return "";
    const more = !!list.length && list[0]!.id > mk && !list.some((m) => m.id === mk);
    const firstNew = list.find((m) => m.id > mk);
    const time = firstNew ? fmtTime(firstNew.at) : "";
    const n = `${fresh.length}${more ? "+" : ""} new message${fresh.length === 1 && !more ? "" : "s"}`;
    return time && !more ? `${n} since ${time}` : n;
  });
  /**
   * Leaving the bottom on purpose (a jump): said straight away, before the scroll starts. Otherwise anything that
   * resized the chat first (the keyboard closing as you tap the bar, a picture loading) snapped it back to the bottom
   * and the jump did nothing.
   */
  const leaveBottom = (ms = 1200) => { jumping = Date.now() + ms; setPinned(false); };
  /** A jump that found nothing to go to: still at the bottom if that's where you are. */
  const noJump = () => { jumping = 0; setPinned(list.scrollHeight - list.scrollTop - list.clientHeight < 80); };
  async function jumpToNew() {
    leaveBottom();
    const from = unreadFrom() ?? newAt();
    if (from && msgs().some((m) => m.id === from)) { document.getElementById(`msg-${from}`)?.scrollIntoView({ block: "center" }); return; }
    const mk = since();
    if (!mk) return noJump();
    if (lastUpTo(msgs(), mk) < 0) {
      const page = await b().messagesAround(id(), mk).catch(() => []);
      if (!page.length) return noJump();
      batch(() => { setMsgs(page); setMore(true); setDetached(true); setPinned(false); });
      await new Promise((r) => requestAnimationFrame(r));
    }
    document.getElementById("new-line")?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  const markRead = () => { batch(() => { setUnreadFrom(null); setNewAt(null); setSinceBar(false); }); b().markRead({ channel: id() }); };

  // Live events for this channel.
  createEffect(on(id, (cid) => {
    const off = b().onEvent((e) => {
      if (e.t === "message" && e.m.channelId === cid) {
        if (msgs().some((m) => m.id === e.m.id) || detached()) return;
        // Reading at the bottom of a busy channel: keep the newest 150 or so loaded (older ones load again when
        // you scroll up), so a chat left open for hours doesn't keep growing.
        const next = [...msgs(), e.m];
        if (pinned() && next.length > 180) { setMsgs(next.slice(-150)); setMore(true); }
        else setMsgs(next);
        setTypers(typers().filter((p) => p.id !== e.m.author.id));
        if (pinned() || e.m.author.id === b().me.id) queueMicrotask(toBottom);
        // Stoat only counts the message as unread just after this event, so marking it read right now did nothing
        // and the chat later reopened at that message. Give it a moment.
        setTimeout(ack, 400);
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
    const ro = new ResizeObserver(() => { if (recenter()) return; if (pinned() && Date.now() > jumping && !userScrolling()) toBottom(); });
    list.addEventListener("touchstart", () => { touching = true; }, { passive: true });
    const lift = () => { touching = false; userUntil = Date.now() + 400; };
    list.addEventListener("touchend", lift, { passive: true });
    list.addEventListener("touchcancel", lift, { passive: true });
    list.addEventListener("wheel", () => { userUntil = Date.now() + 400; }, { passive: true });
    // Touching or scrolling the chat yourself ends the "keep it in the middle" after a jump.
    const mine = () => { centerOn = null; };
    for (const ev of ["pointerdown", "wheel", "touchstart", "keydown"]) list.addEventListener(ev, mine, { passive: true });
    ro.observe(inner);
    ro.observe(list); // the list itself getting shorter (a reply bar, a taller message box) shouldn't leave the bottom either
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
    if (stale() || !more() || loadingOlder() || state() !== "ready" || !msgs().length || Date.now() < jumping) return;
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
    leaveBottom();
    if (!el) {
      instant = true;
      // Not loaded: fetch the stretch of history around it.
      const page = await b().messagesAround(id(), mid).catch(() => []);
      if (!page.some((m) => m.id === mid)) return noJump();
      batch(() => { setMsgs(page); setMore(true); setDetached(true); setPinned(false); });
      await new Promise((r) => requestAnimationFrame(r));
      el = document.getElementById(`msg-${mid}`);
      if (!el) return;
    }
    el.scrollIntoView({ block: "center", behavior: instant || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    centerOn = mid; centerUntil = Date.now() + 2000; leaveBottom(2000);
    setHl(mid);
    setTimeout(() => hl() === mid && setHl(null), 1800);
  }

  async function send(text: string, files: File[], spoilers: boolean[], mention: boolean, onProgress: (f: number) => void) {
    const r = replyTo();
    await b().send(id(), { text, files, spoilers, replies: r ? [{ id: r.id, mention }] : undefined, onProgress });
    // Sending reads the chat (like Discord), even one you'd marked unread: the New line and bar go too.
    batch(() => { setReplyTo(null); if (unreadFrom()) { setUnreadFrom(null); setSinceBar(false); } });
  }

  // Jumps asked for from elsewhere (search results, pinned messages, links).
  // They wait until the chat has opened, so its own first scroll to the bottom can't undo them.
  createEffect(on([jumpRequest, settled] as const, ([r, ok]) => {
    if (!r || r.channelId !== id() || !ok) return;
    setJumpRequest(null);
    void jump(r.id);
  }));

  const editLast = () => {
    const mine = [...msgs()].reverse().find((m) => m.author.id === b().me.id && !m.system);
    if (mine) setEditing(mine.id);
  };

  /** Scrolled up, or jumped back to an older message. */
  const viewingOlder = () => detached() || !pinned();
  // While the "older messages" bar covers the typing line, the bar says who's typing instead.
  const OlderText = () => (
    <Show when={typingText()} fallback={<span>You're viewing older messages</span>}>
      <span class="ob-typing"><span class="dots" aria-hidden="true"><i /><i /><i /></span>{typingText()}</span>
    </Show>
  );
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
    <div class="chat" classList={{ "older-on": viewingOlder() }}
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
        onScroll={onScroll}>
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
            const newDay = () => !prev() || !sameDay(prev()!.at, m.at);
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
      <div class="typing" aria-live="polite">
        <Show when={typingText()}><span class="dots" aria-hidden="true"><i /><i /><i /></span>{typingText()}</Show>
      </div>
      <Composer channel={props.channel} spaceId={props.spaceId && props.spaceId !== "home" ? props.spaceId : undefined} people={people} replyTo={replyTo()} onCancelReply={() => setReplyTo(null)}
        onEditLast={editLast} onSent={() => void present()} send={send}
        above={<Show when={viewingOlder()}>{/* Scrolled up or jumped back. It sits inside the message box's own area, so it always stays stuck to its top. */}
          <Show when={MOBILE_UI} fallback={
            <div class="older-bar" role="status"><OlderText /><button class="ob-jump" onClick={() => void present()}>Jump to present<Icon name="down" size={14} /></button></div>
          }>
            {/* Phones and tablets: a round arrow above the message box, on the right, like a jump-to-bottom button. */}
            <button class="jump-arrow" aria-label="Jump to present" title="Jump to present" onClick={() => void present()}><Icon name="down" size={22} /></button>
          </Show>
        </Show>}
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
