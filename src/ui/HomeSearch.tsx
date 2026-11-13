import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import type { ChannelInfo, Msg, Person, Space } from "../lib/backend/types";
import { Avatar, NameText } from "./Avatar";
import { useBack } from "./back";
import { openGallery } from "./chat/Gallery";
import { Icon } from "./icons";
import { openMenu, toast, type MenuItem } from "./menu";
import { requestJump } from "./nav";
import { backend } from "./store";
import { shortAgo } from "./time";

/**
 * Home search, like Discord's: on phones a search screen (Recent, People split into Friends and Server members,
 * Messages in your DMs, Media from those messages, Channels); on desktop a quick switcher ("Find or start a
 * conversation", Ctrl+K) that jumps to people, chats, channels and servers, and opens the same search for messages.
 * Everything but message search is matched here on the device, so results show as you type.
 */

/* ---------- what you opened lately (this device) ---------- */
const VISITS = "mustela:recent-channels", HISTORY = "mustela:search-history";
const read = <T,>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (k: string, v: unknown[]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* just this session */ } };
const [visits, setVisits] = createSignal<string[]>(read<string>(VISITS));
/** Called whenever a chat or channel is opened (Shell). */
export function noteVisit(cid: string) {
  const next = [cid, ...visits().filter((x) => x !== cid)].slice(0, 12);
  setVisits(next); write(VISITS, next);
}
type HistoryItem = { kind: "person"; id: string } | { kind: "channel"; id: string };
const [history, setHistory] = createSignal<HistoryItem[]>(read<HistoryItem>(HISTORY));
const remember = (h: HistoryItem) => { const next = [h, ...history().filter((x) => !(x.kind === h.kind && x.id === h.id))].slice(0, 10); setHistory(next); write(HISTORY, next); };
const forget = (h?: HistoryItem) => { const next = h ? history().filter((x) => !(x.kind === h.kind && x.id === h.id)) : []; setHistory(next); write(HISTORY, next); };

/* ---------- matching ---------- */
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** 3: starts with it, 2: a word starts with it, 1: contains it, 0: no match. */
export function matchScore(q: string, ...texts: (string | undefined)[]) {
  const x = norm(q.trim());
  if (!x) return 0;
  let best = 0;
  for (const t of texts) {
    if (!t) continue;
    const n = norm(t);
    if (n.startsWith(x)) return 3;
    if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(x))) best = Math.max(best, 2);
    else if (n.includes(x)) best = Math.max(best, 1);
  }
  return best;
}
const top = <T,>(list: T[], score: (t: T) => number, n: number) =>
  list.map((t) => [t, score(t)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);

/* ---------- people you could mean: friends, people you have DMs with, and members of your servers ---------- */
type Who = { p: Person; friend: boolean; servers: string[] };
let memberCache: { me: string; at: number; map: Map<string, Who> } | null = null;
function usePeople(spaces: () => Space[] | undefined) {
  const [friends] = createResource(() => backend(), (b) => b.friends().catch(() => null));
  const [members, setMembers] = createSignal<Map<string, Who>>(memberCache?.map ?? new Map());
  // Server members load once in the background (a few servers at a time), kept for a few minutes.
  onMount(() => {
    const b = backend(); if (!b) return;
    if (memberCache && memberCache.me === b.me.id && Date.now() - memberCache.at < 5 * 60_000) return;
    let live = true;
    onCleanup(() => { live = false; });
    void (async () => {
      const map = new Map<string, Who>();
      for (const s of (spaces() ?? []).filter((x) => !x.home).slice(0, 15)) {
        const groups = await b.members(s.id).catch(() => []);
        if (!live) return;
        for (const g of groups) for (const p of g.people) {
          if (p.id === b.me.id) continue;
          const w = map.get(p.id) ?? { p, friend: false, servers: [] };
          if (!w.servers.includes(s.name)) w.servers.push(s.name);
          map.set(p.id, w);
        }
        setMembers(new Map(map));
      }
      memberCache = { me: b.me.id, at: Date.now(), map };
    })();
  });
  return createMemo(() => {
    const all = new Map<string, Who>(members());
    for (const p of friends()?.friends ?? []) all.set(p.id, { p, friend: true, servers: all.get(p.id)?.servers ?? [] });
    for (const c of spaces()?.find((s) => s.home)?.channels ?? []) if (c.peer && !all.has(c.peer.id)) all.set(c.peer.id, { p: c.peer, friend: false, servers: [] });
    return [...all.values()];
  });
}

/** Friends first among equally good matches; no match is no match, friend or not. */
const personScore = (q: string, w: Who) => { const m = matchScore(q, w.p.name, w.p.username); return m ? m * 2 + (w.friend ? 1 : 0) : 0; };

type Place = { c: ChannelInfo; s: Space };
const placesOf = (spaces: Space[] | undefined): Place[] => (spaces ?? []).flatMap((s) => s.channels.map((c) => ({ c, s })));

async function openPerson(p: Person, openChannel: (cid: string) => void) {
  try { openChannel(await backend()!.openDM(p.id)); } catch { toast("Couldn't open a conversation with them.", true); }
}

/* ---------- message search across your DMs and groups ---------- */
type Hit = { m: Msg; c: ChannelInfo };
function useMessageSearch(q: () => string, spaces: () => Space[] | undefined) {
  const [hits, setHits] = createSignal<Hit[]>([]);
  const [busy, setBusy] = createSignal(false);
  let run = 0;
  createEffect(on(q, (x) => {
    const id = ++run;
    setHits([]);
    const query = x.trim();
    if (query.length < 2) { setBusy(false); return; }
    setBusy(true);
    const t = setTimeout(async () => {
      // Your most recent conversations first, a few at a time (gentle on Stoat's rate limit).
      const convs = (spaces()?.find((s) => s.home)?.channels ?? []).filter((c) => c.kind === "dm" || c.kind === "group").slice(0, 20);
      const out: Hit[] = [];
      for (let i = 0; i < convs.length && id === run; i += 3) {
        const found = await Promise.all(convs.slice(i, i + 3).map((c) => backend()!.search(c.id, query).then((ms) => ms.map((m) => ({ m, c })), () => [] as Hit[])));
        if (id !== run) return;
        out.push(...found.flat());
        setHits([...out].sort((a, b) => (a.m.id < b.m.id ? 1 : -1)));
      }
      if (id === run) setBusy(false);
    }, 350);
    onCleanup(() => clearTimeout(t));
  }));
  return { hits, busy };
}

const mediaOf = (hits: Hit[]) => hits.flatMap((h) => (h.m.attachments ?? []).filter((a) => a.type === "image" || a.type === "video").map((a) => ({ a, h })));

/* ---------- rows ---------- */
type MediaHit = { a: NonNullable<Msg["attachments"]>[number]; h: Hit };
function MediaTile(props: { x: MediaHit; all: MediaHit[]; i: number; onLocate(h: Hit): void }) {
  const x = () => props.x;
  return (
    <button class="mp-tile" classList={{ spoiled: !!x().a.spoiler }} onClick={() => openGallery(props.all.map((y) => ({ url: y.a.url, name: y.a.name, spoiler: y.a.spoiler, video: y.a.type === "video", preview: y.a.previewUrl, from: y.h.m.author, at: y.h.m.at, locate: () => props.onLocate(y.h) })), props.i)}>
      <Show when={x().a.type === "image"} fallback={<video src={`${x().a.url}#t=0.1`} muted playsinline preload="metadata" />}><img src={x().a.previewUrl ?? x().a.url} alt="" loading="lazy" /></Show>
      <Show when={x().a.spoiler}><span class="mp-spoiler">Spoiler</span></Show>
      <span class="mp-by"><Avatar person={x().h.m.author} size={20} presence={false} still /></span>
    </button>
  );
}
function PersonRow(props: { w: Who; onOpen(): void; extra?: JSX.Element }) {
  return (
    <button class="hs-row" onClick={props.onOpen}>
      <Avatar person={props.w.p} size={40} />
      <span class="hs-text"><NameText person={props.w.p} class="hs-name" /><small>{props.w.p.username ?? ""}{props.w.servers.length && !props.w.friend ? ` · ${props.w.servers.slice(0, 2).join(", ")}` : ""}</small></span>
      {props.extra}
    </button>
  );
}
function PlaceRow(props: { p: Place; onOpen(): void; extra?: JSX.Element }) {
  const c = () => props.p.c;
  return (
    <button class="hs-row" onClick={props.onOpen}>
      <Show when={c().kind === "dm" && c().peer} fallback={<span class="hs-ic"><Icon name={c().kind === "voice" ? "speaker" : c().kind === "group" ? "users" : "hash"} size={20} /></span>}>
        <Avatar person={c().peer!} size={40} />
      </Show>
      <span class="hs-text"><span class="hs-name">{c().name}</span><small>{props.p.s.home ? (c().kind === "group" ? "Group" : "Direct message") : props.p.s.name}</small></span>
      {props.extra}
    </button>
  );
}

function MsgCard(props: { h: Hit; onOpen(): void }) {
  const h = () => props.h;
  return (
    <button class="mp-item hs-msg" onClick={props.onOpen}>
      <Avatar person={h().m.author} size={40} presence={false} />
      <span class="hs-text">
        <span class="hs-msg-top"><NameText person={h().m.author} class="hs-name" /><small class="hs-when" title={h().m.at.toLocaleString()}>{shortAgo(h().m.at)}</small></span>
        <small class="hs-where">{`${h().c.kind === "dm" ? "with " : "in "}${h().c.name}`}</small>
        <span class="hs-msg-text">{h().m.text || (h().m.attachments?.length ? `${h().m.attachments!.length} attachment${h().m.attachments!.length > 1 ? "s" : ""}` : "")}</span>
      </span>
    </button>
  );
}

/* ---------- the search screen (phones; a window on desktop) ---------- */
type Tab = "recent" | "people" | "messages" | "media" | "pins" | "links" | "files" | "channels";
export function HomeSearch(props: { spaces: () => Space[] | undefined; openChannel(cid: string): void; onClose(): void; query?: string; tab?: Tab; window?: boolean }) {
  useBack(props.onClose);
  const [q, setQ] = createSignal(props.query ?? "");
  const [tab, setTab] = createSignal<Tab>(props.tab ?? (props.query ? "people" : "recent"));
  const [dir, setDir] = createSignal<"l" | "r" | "">("");
  const tabs = (): Tab[] => (q().trim() ? ["people", "messages", "media", "links", "files", "channels"] : ["recent", "people", "media", "pins", "links", "files"]);
  const go = (t: Tab) => { const list = tabs(); setDir(list.indexOf(t) > list.indexOf(tab()) ? "r" : "l"); setTab(t); };
  // Typing moves you from Recent to People, like Discord's.
  createEffect(on(() => !!q().trim(), (has) => { if (has && (tab() === "recent" || tab() === "pins")) setTab("people"); if (!has && (tab() === "messages" || tab() === "channels")) setTab("recent"); }, { defer: true }));
  const people = usePeople(props.spaces);
  const places = createMemo(() => placesOf(props.spaces()));
  const { hits, busy } = useMessageSearch(q, props.spaces);
  const open = (cid: string) => { props.openChannel(cid); props.onClose(); };
  const openP = (w: Who) => { remember({ kind: "person", id: w.p.id }); void openPerson(w.p, open); };
  const openPlace = (p: Place) => { remember({ kind: "channel", id: p.c.id }); open(p.c.id); };

  const foundPeople = createMemo(() => (q().trim() ? top(people(), (w) => personScore(q(), w), 60) : people().filter((w) => w.friend)));
  const foundPlaces = createMemo(() => top(places().filter((p) => p.c.kind !== "dm"), (p) => matchScore(q(), p.c.name), 40));
  // With nothing typed, Media shows what was posted lately in your conversations (loaded once).
  const [recentMedia] = createResource(() => (!q().trim() && ["recent", "media", "links", "files"].includes(tab()) ? props.spaces() : null), async (sp) => {
    // Across your 10 most recent conversations (like Discord's), a few at a time.
    const convs = (sp?.find((s) => s.home)?.channels ?? []).filter((c) => c.kind === "dm" || c.kind === "group").slice(0, 10);
    const out: Hit[] = [];
    for (let i = 0; i < convs.length; i += 3) {
      const got = await Promise.all(convs.slice(i, i + 3).map((c) => backend()!.messages(c.id).then((ms) => ms.map((m) => ({ m, c })), () => [] as Hit[])));
      out.push(...got.flat());
    }
    return out.sort((a, b) => (a.m.id < b.m.id ? 1 : -1));
  });
  /* Filters for Messages and Media, like the chat search's: who sent it, in which conversation, what it has, when. */
  const [from, setFrom] = createSignal(""), [inC, setInC] = createSignal(""), [hasF, setHasF] = createSignal(""), [when, setWhen] = createSignal(""), [day, setDay] = createSignal(new Date().toISOString().slice(0, 10));
  const [men, setMen] = createSignal(""), [kind, setKind] = createSignal("");
  const filtering = () => !!(from() || inC() || hasF() || when() || men() || kind());
  const clearFilters = () => { setFrom(""); setInC(""); setHasF(""); setWhen(""); setMen(""); setKind(""); };
  const pass = (h: Hit) => {
    if (from() && h.m.author.id !== from()) return false;
    if (men() && !h.m.text.includes(`<@${men()}>`)) return false;
    if (kind() && !!h.m.author.bot !== (kind() === "bots")) return false;
    if (inC() && h.c.id !== inC()) return false;
    const atts = h.m.attachments ?? [];
    if (hasF() === "media" && !atts.some((a) => a.type === "image" || a.type === "video")) return false;
    if (hasF() === "file" && !atts.some((a) => a.type !== "image" && a.type !== "video")) return false;
    if (hasF() === "link" && !/https?:\/\//.test(h.m.text)) return false;
    if (when()) {
      const d = new Date(`${day()}T00:00:00`), t = h.m.at.getTime();
      if (!Number.isNaN(d.getTime())) { const next = d.getTime() + 864e5; if (when() === "on" ? t < d.getTime() || t >= next : when() === "before" ? t >= d.getTime() : t < next) return false; }
    }
    return true;
  };
  const source = () => (q().trim() ? hits() : recentMedia() ?? []);
  const shown = createMemo(() => hits().filter(pass));
  const media = createMemo(() => mediaOf(source().filter(pass)));
  const links = createMemo(() => source().filter(pass).flatMap((h) => [...new Set(h.m.text.match(/https?:\/\/[^\s<>()]+/g) ?? [])].map((url) => ({ url, h }))));
  const files = createMemo(() => source().filter(pass).flatMap((h) => (h.m.attachments ?? []).filter((a) => a.type !== "image" && a.type !== "video").map((a) => ({ a, h }))));
  // Pinned messages in your recent conversations (loaded when you open Pins).
  const [pins] = createResource(() => (tab() === "pins" ? props.spaces() : null), async (sp) => {
    const convs = (sp?.find((s) => s.home)?.channels ?? []).filter((c) => c.kind === "dm" || c.kind === "group").slice(0, 12);
    const out: Hit[] = [];
    for (const c of convs) out.push(...(await backend()!.pinned(c.id).catch(() => [] as Msg[])).map((m) => ({ m, c })));
    return out.sort((a, b) => (a.m.id < b.m.id ? 1 : -1));
  });
  // Who and where, from what was found (plus your friends), for the filter menus.
  const fromOpts = createMemo(() => { const m = new Map<string, Person>(); for (const h of source()) m.set(h.m.author.id, h.m.author); return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); });
  const inOpts = createMemo(() => (props.spaces()?.find((x) => x.home)?.channels ?? []).filter((c) => c.kind === "dm" || c.kind === "group"));
  /** People a filter can name: those in the results, then your friends. */
  const filterPeople = () => { const m = new Map<string, Person>(); const me = backend()?.me; if (me) m.set(me.id, me); for (const p of fromOpts()) m.set(p.id, p); for (const w of people()) if (w.friend) m.set(w.p.id, w.p); return [...m.values()].slice(0, 40); };
  const nameOf = (id: string) => filterPeople().find((p) => p.id === id)?.name ?? "someone";
  /** Dates come from the phone's own date picker. */
  const pickDate = (mode: string) => {
    const i = Object.assign(document.createElement("input"), { type: "date", value: day(), max: new Date().toISOString().slice(0, 10) });
    i.style.cssText = "position:fixed;left:50%;top:40%;opacity:0;width:1px;height:1px;";
    document.body.appendChild(i);
    const done = () => { if (i.value) { setDay(i.value); setWhen(mode); } i.remove(); };
    i.addEventListener("change", done, { once: true }); i.addEventListener("blur", () => setTimeout(() => i.remove(), 300), { once: true });
    try { i.showPicker(); } catch { i.focus(); i.click(); }
  };
  // Like Discord's: one "Filter results…" menu; picking a filter shows the messages it finds.
  const toMessages = () => { if (!["messages", "media", "links", "files"].includes(tab())) go(q().trim() ? "messages" : "media"); };
  const choose = (set: (v: string) => void, v: string) => () => { set(v); toMessages(); };
  const filterMenu = (el: Element) => openMenu(el, [
    { header: "Filter results…" },
    { label: "From a specific person", icon: "user", sub: filterPeople().map((p): MenuItem => ({ label: p.name, checked: from() === p.id, onSelect: choose(setFrom, p.id) })) },
    { label: "In a specific DM", icon: "chat", sub: inOpts().map((c): MenuItem => ({ label: c.name, checked: inC() === c.id, onSelect: choose(setInC, c.id) })) },
    { label: "Has specific data", icon: "clip", sub: [["media", "Pictures or videos"], ["link", "A link"], ["file", "A file"]].map(([v, l]): MenuItem => ({ label: l!, checked: hasF() === v, onSelect: choose(setHasF, v!) })) },
    { label: "Mention someone", icon: "at", sub: filterPeople().map((p): MenuItem => ({ label: p.name, checked: men() === p.id, onSelect: choose(setMen, p.id) })) },
    { sep: true },
    { label: "Sent on a date", icon: "calendar", onSelect: () => { toMessages(); pickDate("on"); } },
    { label: "Before a date", icon: "calendar", onSelect: () => { toMessages(); pickDate("before"); } },
    { label: "After a date", icon: "calendar", onSelect: () => { toMessages(); pickDate("after"); } },
    { sep: true },
    { label: "By author type", icon: "bot", sub: [["people", "Only people"], ["bots", "Only bots"]].map(([v, l]): MenuItem => ({ label: l!, checked: kind() === v, onSelect: choose(setKind, v!) })) },
  ], { grouped: true });
  const fmtDay = () => new Date(`${day()}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  type Chip = { label: string; clear: () => void };
  const chips = (): Chip[] => ([
    from() && { label: `From: ${nameOf(from())}`, clear: () => setFrom("") },
    inC() && { label: `In: ${inOpts().find((c) => c.id === inC())?.name ?? "a DM"}`, clear: () => setInC("") },
    hasF() && { label: `Has: ${hasF() === "media" ? "pictures or videos" : hasF() === "link" ? "a link" : "a file"}`, clear: () => setHasF("") },
    men() && { label: `Mentions: ${nameOf(men())}`, clear: () => setMen("") },
    when() && { label: `${when() === "on" ? "On" : when() === "before" ? "Before" : "After"} ${fmtDay()}`, clear: () => setWhen("") },
    kind() && { label: kind() === "bots" ? "Only bots" : "Only people", clear: () => setKind("") },
  ] as (Chip | "")[]).filter((x): x is Chip => !!x);
  const historyRows = createMemo(() => history().map((h) => (h.kind === "person" ? { h, w: people().find((w) => w.p.id === h.id) } : { h, p: places().find((p) => p.c.id === h.id) })).filter((x) => x.w || x.p));
  const recentPlaces = createMemo(() => visits().map((id) => places().find((p) => p.c.id === id)).filter((p): p is Place => !!p).slice(0, 8));
  const label: Record<Tab, () => string> = {
    recent: () => "Recent", people: () => (q().trim() ? `People (${foundPeople().length})` : "People"),
    messages: () => `Messages${busy() ? "" : ` (${shown().length})`}`, media: () => (q().trim() ? `Media (${media().length})` : "Media"),
    channels: () => (q().trim() ? `Channels (${foundPlaces().length})` : "Channels"),
    pins: () => "Pins", links: () => (q().trim() ? `Links (${links().length})` : "Links"), files: () => (q().trim() ? `Files (${files().length})` : "Files"),
  };
  let input!: HTMLInputElement;
  onMount(() => requestAnimationFrame(() => input?.focus()));

  return (
    <div class="hsearch" classList={{ "hs-window": !!props.window }} role="dialog" aria-label="Search" data-swipe-tabs>
      {/* The same header and pill tabs as the search in a chat (MessagePanel), so search looks like Mustela everywhere */}
      <header class="mp-head hs-head">
        <Icon name="search" size={18} />
        <form class="search-box wide mp-search" role="search" onSubmit={(e) => { e.preventDefault(); input.blur(); }}>
          <input ref={input} placeholder="Search people, messages, channels" value={q()} onInput={(e) => setQ(e.currentTarget.value)} aria-label="Search people, messages and channels" enterkeyhint="search" autocomplete="off" />
          <Show when={q()}><button type="button" class="mp-clear" aria-label="Clear" onClick={() => { setQ(""); input.focus(); }}><Icon name="close" size={14} /></button></Show>
        </form>
        <button class="icon-btn hs-filter" classList={{ on: filtering() }} aria-label="Filter results" title="Filter results" onClick={(e) => filterMenu(e.currentTarget)}><Icon name="sliders" size={20} /></button>
        <button class="icon-btn" aria-label="Close search" onClick={props.onClose}><Icon name="close" size={18} /></button>
      </header>
      <nav class="mp-tabs hs-tabs" role="tablist">
        <For each={tabs()}>{(t) => <button role="tab" aria-selected={tab() === t} classList={{ on: tab() === t }} onClick={() => go(t)}>{label[t]()}</button>}</For>
      </nav>
      {/* Active filters, each removable */}
      <Show when={chips().length && ["messages", "media", "links", "files"].includes(tab())}>
        <div class="hs-chips">
          <For each={chips()}>{(c) => <button class="hs-chip" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>{c.label}<Icon name="close" size={13} /></button>}</For>
          <Show when={chips().length > 1}><button class="link hs-clear" onClick={clearFilters}>Clear all</button></Show>
        </div>
      </Show>
      <div class="hs-body">
        {/* Each tab slides in from its side */}
        <For each={[tab()]}>{(t) => (
          <div class="hs-page" classList={{ "slide-l": dir() === "l", "slide-r": dir() === "r" }}>
            <Show when={t === "recent"}>
              <Show when={historyRows().length}>
                <h3 class="hs-sec">Search history<span class="grow" /><button class="link" onClick={() => forget()}>Clear all</button></h3>
                <For each={historyRows()}>{(x) => {
                  const del = <button class="icon-btn hs-x" aria-label="Remove from history" onClick={(e) => { e.stopPropagation(); forget(x.h); }}><Icon name="close" size={16} /></button>;
                  return x.w ? <PersonRow w={x.w} onOpen={() => openP(x.w!)} extra={del} /> : <PlaceRow p={x.p!} onOpen={() => openPlace(x.p!)} extra={del} />;
                }}</For>
              </Show>
              <Show when={recentPlaces().length}>
                <h3 class="hs-sec">Recently opened</h3>
                <For each={recentPlaces()}>{(p) => <PlaceRow p={p} onOpen={() => openPlace(p)} />}</For>
              </Show>
              <Show when={media().length}>
                <h3 class="hs-sec">Photos & media<span class="grow" /><button class="link" onClick={() => go("media")}>View all</button></h3>
                <div class="mp-list gallery hs-media">
                  <For each={media().slice(0, 9)}>{(x, i) => <MediaTile x={x} all={media()} i={i()} onLocate={(h) => { props.onClose(); requestJump(h.c.id, h.m.id); }} />}</For>
                </div>
              </Show>
              <Show when={!historyRows().length && !recentPlaces().length && !media().length && !recentMedia.loading}><p class="empty">Search for people, messages in your DMs, pictures and channels.</p></Show>
            </Show>
            <Show when={t === "people"}>
              <Show when={foundPeople().some((w) => w.friend)}>
                <h3 class="hs-sec">Friends</h3>
                <For each={foundPeople().filter((w) => w.friend)}>{(w) => <PersonRow w={w} onOpen={() => openP(w)} />}</For>
              </Show>
              <Show when={q().trim() && foundPeople().some((w) => !w.friend)}>
                <h3 class="hs-sec">Server members</h3>
                <For each={foundPeople().filter((w) => !w.friend)}>{(w) => <PersonRow w={w} onOpen={() => openP(w)} />}</For>
              </Show>
              <Show when={!foundPeople().length}><p class="empty">{q().trim() ? `No one called “${q().trim()}”.` : "Your friends show here."}</p></Show>
            </Show>
            <Show when={t === "messages"}>
              <For each={shown()}>{(h) => <MsgCard h={h} onOpen={() => { props.onClose(); requestJump(h.c.id, h.m.id); }} />}</For>
              <Show when={busy()}><div class="loading-row"><div class="spinner small" /></div></Show>
              <Show when={!busy() && !shown().length}><p class="empty">{q().trim().length < 2 ? "Type at least two letters to search your messages." : hits().length ? "No messages match those filters." : `No messages with “${q().trim()}” in your DMs.`}</p></Show>
            </Show>
            <Show when={t === "media"}>
              <div class="mp-list gallery hs-media">
                <For each={media()}>{(x, i) => <MediaTile x={x} all={media()} i={i()} onLocate={(h) => { props.onClose(); requestJump(h.c.id, h.m.id); }} />}</For>
                <Show when={!media().length && !(q().trim() ? busy() : recentMedia.loading)}><p class="empty">{q().trim() ? "No pictures or videos in the messages found." : "No pictures or videos in your recent conversations."}</p></Show>
                <Show when={q().trim() ? busy() && !media().length : recentMedia.loading}><div class="loading-row"><div class="spinner small" /></div></Show>
              </div>
            </Show>
            <Show when={t === "pins"}>
              <For each={pins() ?? []}>{(h) => <MsgCard h={h} onOpen={() => { props.onClose(); requestJump(h.c.id, h.m.id); }} />}</For>
              <Show when={pins.loading}><div class="loading-row"><div class="spinner small" /></div></Show>
              <Show when={!pins.loading && !(pins() ?? []).length}><p class="empty">No pinned messages in your recent conversations.</p></Show>
            </Show>
            <Show when={t === "links"}>
              <For each={links()}>{(x) => (
                <a class="mp-item hs-link" href={x.url} target="_blank" rel="noopener noreferrer nofollow">
                  <span class="hs-ic"><Icon name="link" size={18} /></span>
                  <span class="hs-text"><span class="hs-name">{x.url.replace(/^https?:\/\/(www\.)?/, "")}</span><small>{x.h.m.author.name} · {x.h.c.name}</small></span>
                </a>
              )}</For>
              <Show when={!links().length && !(q().trim() ? busy() : recentMedia.loading)}><p class="empty">{q().trim() ? "No links in the messages found." : "No links in your recent conversations."}</p></Show>
              <Show when={q().trim() ? busy() && !links().length : recentMedia.loading}><div class="loading-row"><div class="spinner small" /></div></Show>
            </Show>
            <Show when={t === "files"}>
              <For each={files()}>{(x) => (
                <a class="mp-item hs-link" href={x.a.url} target="_blank" rel="noopener noreferrer" download={x.a.name}>
                  <span class="hs-ic"><Icon name="file" size={18} /></span>
                  <span class="hs-text"><span class="hs-name">{x.a.name}</span><small>{x.h.m.author.name} · {x.h.c.name}</small></span>
                </a>
              )}</For>
              <Show when={!files().length && !(q().trim() ? busy() : recentMedia.loading)}><p class="empty">{q().trim() ? "No files in the messages found." : "No files in your recent conversations."}</p></Show>
              <Show when={q().trim() ? busy() && !files().length : recentMedia.loading}><div class="loading-row"><div class="spinner small" /></div></Show>
            </Show>
            <Show when={t === "channels"}>
              <For each={q().trim() ? foundPlaces() : recentPlaces().filter((p) => !p.s.home)}>{(p) => <PlaceRow p={p} onOpen={() => openPlace(p)} />}</For>
              <Show when={!(q().trim() ? foundPlaces() : recentPlaces().filter((p) => !p.s.home)).length}><p class="empty">{q().trim() ? `No channels called “${q().trim()}”.` : "Channels you open show here."}</p></Show>
            </Show>
          </div>
        )}</For>
      </div>
    </div>
  );
}

/* ---------- desktop: the quick switcher ---------- */
type Opt = { key: string; section: string; render: () => JSX.Element; run(): void };
export function QuickSwitcher(props: { spaces: () => Space[] | undefined; openChannel(cid: string): void; openSpace(id: string): void; onClose(): void; onSearchMessages(q: string): void }) {
  useBack(props.onClose);
  const [q, setQ] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const people = usePeople(props.spaces);
  const places = createMemo(() => placesOf(props.spaces()));
  const open = (cid: string) => { props.openChannel(cid); props.onClose(); };
  const opts = createMemo((): Opt[] => {
    const x = q().trim();
    const place = (p: Place, section: string): Opt => ({ key: `c${p.c.id}`, section, run: () => { remember({ kind: "channel", id: p.c.id }); open(p.c.id); }, render: () => <PlaceRow p={p} onOpen={() => {}} /> });
    if (!x) {
      const prev = visits().map((id) => places().find((p) => p.c.id === id)).filter((p): p is Place => !!p).slice(0, 6).map((p) => place(p, "Previous channels"));
      const mentions = places().filter((p) => (p.c.mentions ?? 0) > 0).slice(0, 5).map((p) => place(p, "Mentions"));
      return [...prev, ...mentions.filter((m) => !prev.some((p) => p.key === m.key))];
    }
    const ppl = top(people(), (w) => personScore(x, w), 6).map((w): Opt => ({ key: `p${w.p.id}`, section: "People", run: () => { remember({ kind: "person", id: w.p.id }); void openPerson(w.p, open); }, render: () => <PersonRow w={w} onOpen={() => {}} /> }));
    const chats = top(places().filter((p) => p.s.home && p.c.kind === "group"), (p) => matchScore(x, p.c.name), 4).map((p) => place(p, "Conversations"));
    const chans = top(places().filter((p) => !p.s.home), (p) => matchScore(x, p.c.name), 8).map((p) => place(p, "Channels"));
    const servers = top((props.spaces() ?? []).filter((s) => !s.home), (s) => matchScore(x, s.name), 4).map((s): Opt => ({ key: `s${s.id}`, section: "Servers", run: () => { props.openSpace(s.id); props.onClose(); }, render: () => (
      <span class="hs-row"><span class="hs-ic">{s.iconUrl ? <img src={s.iconUrl} alt="" /> : s.name.slice(0, 1)}</span><span class="hs-text"><span class="hs-name">{s.name}</span><small>Server</small></span></span>) }));
    const msgs: Opt = { key: "msgs", section: "Messages", run: () => { props.onClose(); props.onSearchMessages(x); }, render: () => (
      <span class="hs-row"><span class="hs-ic"><Icon name="search" size={18} /></span><span class="hs-text"><span class="hs-name">Search messages for “{x}”</span><small>In your DMs and groups</small></span></span>) };
    return [...ppl, ...chats, ...chans, ...servers, msgs];
  });
  createEffect(on(q, () => setSel(0)));
  const key = (e: KeyboardEvent) => {
    const n = opts().length;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => (i + 1) % Math.max(1, n)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => (i - 1 + n) % Math.max(1, n)); }
    else if (e.key === "Enter") { e.preventDefault(); opts()[sel()]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); props.onClose(); }
  };
  let list!: HTMLDivElement;
  createEffect(() => list?.querySelector(`[data-i="${sel()}"]`)?.scrollIntoView({ block: "nearest" }));
  return (
    <Portal>
      <div class="scrim qs-scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="modal panel qs" role="dialog" aria-label="Find or start a conversation">
          <input class="qs-input" placeholder="Where would you like to go?" value={q()} onInput={(e) => setQ(e.currentTarget.value)} onKeyDown={key} autofocus aria-label="Where would you like to go?" />
          <div class="qs-list" ref={list} role="listbox">
            <For each={opts()}>{(o, i) => (
              <>
                <Show when={i() === 0 || opts()[i() - 1]!.section !== o.section}><h3 class="hs-sec">{o.section}</h3></Show>
                <div class="qs-opt" role="option" data-i={i()} aria-selected={sel() === i()} classList={{ on: sel() === i() }} onMouseMove={() => setSel(i())} onClick={() => o.run()}>{o.render()}</div>
              </>
            )}</For>
            <Show when={!opts().length}><p class="empty">Open a few chats and they'll show here. Type to find people, channels and servers.</p></Show>
          </div>
          <p class="qs-tip">Tip: Ctrl+K opens this from anywhere. ↑ ↓ to move, Enter to go.</p>
        </div>
      </div>
    </Portal>
  );
}
