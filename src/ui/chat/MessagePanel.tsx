import { batch, createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js";
import { createPhone, narrowLayout } from "../hooks";
import { useBack } from "../back";
import { SEARCH_BATCH, type Attachment, type ChannelInfo, type Embed, type Msg, type Person, type SearchSort } from "../../lib/backend/types";
import { fmtStamp } from "../../lib/time";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { requestJump } from "../nav";
import { backend } from "../store";
import { Select } from "../controls";
import { Markdown } from "./Markdown";
import { openGallery } from "./Gallery";
import { ytEmbed } from "./videoFull";
import { MOBILE_UI } from "../target";
import { parseSearch, searchText, type SearchFilters } from "../../lib/searchQuery";
import { openMenu } from "../menu";
import { rememberSearch, searchDraft, setSearchDraft, setSearchPeople } from "./searchState";

export type Panel = { kind: "search"; q: string; /** open the Filters window */ filters?: boolean } | { kind: "pins" };

type Tab = "messages" | "media" | "links" | "files";
type Has = "" | "media" | "link" | "file";
type When = "" | "on" | "before" | "after";
type Kind = "" | "people" | "bots";

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"]/g;
const isMedia = (a: Attachment) => a.type === "image" || a.type === "video";
/** A picture, video, GIF or YouTube card in the message, not a normal link preview. */
const embedIsMedia = (e: Embed) =>
  !!(e.video?.url || e.gif || e.kind === "image" || e.kind === "video" || (e.special?.type === "YouTube" && e.special.id));
const linksOf = (m: Msg) => [...new Set([...(m.text.match(URL_RE) ?? []), ...(m.embeds ?? []).flatMap((e) => (e.url && !e.gif ? [e.url] : []))])];
const has = (m: Msg, h: Has) =>
  !h || (h === "media" ? !!(m.attachments?.some(isMedia) || m.embeds?.some(embedIsMedia)) : h === "file" ? !!m.attachments?.some((a) => !isMedia(a)) : linksOf(m).length > 0);

/** Highlight the searched words in a result (whole-word starts, any case), like Discord. Text only. */
function markWords(el: HTMLElement, words: string[]) {
  if (!words.length || !el.isConnected) return;
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let re: RegExp;
  try { re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${esc.join("|")})`, "giu"); } catch { return; }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const t of nodes) {
    const v = t.data;
    re.lastIndex = 0;
    if (!re.test(v)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (const m of v.matchAll(re)) {
      frag.append(v.slice(at, m.index), Object.assign(document.createElement("mark"), { className: "mp-mark", textContent: m[0] }));
      at = m.index! + m[0].length;
    }
    frag.append(v.slice(at));
    t.replaceWith(frag);
  }
}

/** How far back the Media, Links and Files tabs look (Stoat's search only matches words, so these read history). */
const HISTORY_PAGES = 6;

async function history(channelId: string): Promise<Msg[]> {
  const out: Msg[] = [];
  let before: string | undefined;
  for (let i = 0; i < HISTORY_PAGES; i++) {
    const page = await backend()!.messages(channelId, before).catch(() => [] as Msg[]);
    if (!page.length) break;
    out.push(...page);
    const oldest = page.reduce((a, b) => (a.id < b.id ? a : b));
    if (before === oldest.id) break;
    before = oldest.id;
    if (page.length < 50) break;
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1)); // newest first
}

/**
 * Search (with who sent it and what it has, and tabs for media, links and files) or pinned messages for the open
 * channel, in the right-hand column (full screen on phones). Tapping a result shows it where it was, with a button
 * to jump there in the chat.
 */
export function MessagePanel(props: { panel: Panel; channel: ChannelInfo; spaceId?: string; onClose(): void }) {
  useBack(() => (preview() ? setPreview(null) : props.onClose()));
  const pins = () => props.panel.kind === "pins";
  const [q, setQ] = createSignal(props.panel.kind === "search" ? props.panel.q : "");
  // Computers type in the top bar's box (shared, so a narrow window's own box here has the same words); phones and
  // tablets in this panel's own.
  const own = createSignal(q());
  const [draft, setDraft] = MOBILE_UI ? own : [searchDraft, setSearchDraft] as const;
  const phone = createPhone();
  const ownBox = () => MOBILE_UI || phone();
  const [tab, setTab] = createSignal<Tab>("messages");
  const [from, setFrom] = createSignal("");
  const [hasF, setHasF] = createSignal<Has>("");
  // The rest of Discord's filters: mentions someone, sent on/before/after a day, people or bots.
  const [mentions, setMentions] = createSignal("");
  const [when, setWhen] = createSignal<When>("");
  const [day, setDay] = createSignal(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = createSignal<Kind>("");
  const filtering = () => !!(from() || hasF() || mentions() || when() || kind());
  const clearFilters = () => batch(() => { setFrom(""); setHasF(""); setMentions(""); setWhen(""); setKind(""); });
  const [preview, setPreview] = createSignal<Msg | null>(null);
  // Newest first, oldest first, or best match (Stoat's search sorts these three ways).
  const [sort, setSort] = createSignal<SearchSort>("Latest");
  // The server's members, so from: and mentions: can name anyone, not just people in the results.
  const [members] = createResource(() => (props.spaceId && props.spaceId !== "home" ? props.spaceId : null), (sid) => backend()!.members(sid).catch(() => []));

  /** What's typed in the box: filters (from:Mika has:link…) come out, the rest is the words to search for. */
  const apply = (text: string) => {
    const { words, filters } = parseSearch(text, allPeople());
    batch(() => {
      setQ(words);
      setFrom(filters.from); setMentions(filters.mentions); setHasF(filters.has); setKind(filters.kind);
      setWhen(filters.when); if (filters.day) setDay(filters.day);
    });
  };
  // A new search from the channel's own search box while this is open.
  createEffect(on(() => props.panel, (p) => {
    if (p.kind === "search" && p.filters) setFiltersOpen(true);
    if (p.kind === "search" && p.q) { setDraft(p.q); apply(p.q); setTab("messages"); setPreview(null); }
  }, { defer: true }));
  // The first search, once the people it might name are known.
  if (props.panel.kind === "search" && props.panel.q) { setQ(""); queueMicrotask(() => apply(draft())); }
  createEffect(on(members, () => { if (/(from|mentions):/i.test(draft())) apply(draft()); }, { defer: true }));

  const [found] = createResource(() => (pins() ? { c: props.channel.id } : null), (k) => backend()!.pinned(k.c));

  // Search results come in batches of 100 (Stoat's most per request) and show 25 to a page, like Discord. The next
  // batch is only asked for when you page past what's loaded.
  const PAGE = 25;
  const [hits, setHits] = createSignal<Msg[]>([]);
  const [more, setMore] = createSignal(false);
  const [searching, setSearching] = createSignal(false);
  const [searchErr, setSearchErr] = createSignal("");
  const [page, setPage] = createSignal(0);
  let runId = 0;
  async function loadBatch(reset: boolean) {
    const id = reset ? ++runId : runId, words = q(), how = sort(), cid = props.channel.id;
    if (!words) { setHits([]); setMore(false); setSearching(false); return; }
    const have = reset ? [] : hits();
    const last = have[have.length - 1];
    const cursor = !last || how === "Relevance" ? {} : how === "Oldest" ? { after: last.id } : { before: last.id };
    setSearching(true); setSearchErr("");
    try {
      const got = await backend()!.search(cid, words, how, cursor);
      if (id !== runId) return;
      const seen = new Set(have.map((m) => m.id));
      setHits([...have, ...got.filter((m) => !seen.has(m.id))]);
      setMore(got.length >= SEARCH_BATCH && how !== "Relevance");
    } catch (e) {
      if (id === runId) setSearchErr((e as Error)?.message || "Search didn't work. Try again.");
    } finally { if (id === runId) setSearching(false); }
  }
  createEffect(on(() => [q(), sort(), props.channel.id, pins()] as const, ([, , , p]) => { setPage(0); if (!p) void loadBatch(true); }));

  // History is only read when it's needed: the Media, Links and Files tabs, and filters with no words (Stoat's
  // search needs words). Reading it alongside a search used to hold the search up behind Stoat's rate limit.
  const needHistory = () => !pins() && (tab() !== "messages" || (!q() && filtering()));
  const [histOn, setHistOn] = createSignal(false);
  createEffect(() => { if (needHistory()) setHistOn(true); });
  const [hist] = createResource(() => (histOn() ? props.channel.id : null), history);

  const people = createMemo(() => {
    const seen = new Map<string, Person>();
    for (const m of [...hits(), ...(hist() ?? [])]) if (!m.system) seen.set(m.author.id, m.author);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  /** Everyone a filter can name: the members, the people in the results and history, the other person in a DM. */
  const allPeople = createMemo(() => {
    const seen = new Map<string, Person>();
    for (const p of people()) seen.set(p.id, p);
    for (const g of members() ?? []) for (const p of g.people) if (!seen.has(p.id)) seen.set(p.id, p);
    if (props.channel.peer && !seen.has(props.channel.peer.id)) seen.set(props.channel.peer.id, props.channel.peer);
    const me = backend()?.me;
    if (me && !seen.has(me.id)) seen.set(me.id, me);
    return [...seen.values()];
  });
  if (!MOBILE_UI) createEffect(() => setSearchPeople(allPeople()));
  // Closing search clears the top bar's box (the panel's own details are gone by then, so remember its kind).
  let wasSearch = false;
  createEffect(() => { wasSearch = props.panel.kind === "search"; });
  onCleanup(() => { if (!MOBILE_UI) { setSearchPeople([]); if (wasSearch) setSearchDraft(""); } });
  const nameOf = (id: string) => allPeople().find((p) => p.id === id)?.name ?? "someone";
  const pass = (m: Msg) => {
    if (from() && m.author.id !== from()) return false;
    if (mentions() && !m.text.includes(`<@${mentions()}>`)) return false;
    if (kind() && !!m.author.bot !== (kind() === "bots")) return false;
    if (when()) {
      const d = new Date(`${day()}T00:00:00`), next = new Date(d.getTime() + 864e5);
      if (Number.isNaN(d.getTime())) return true;
      const t = m.at.getTime();
      if (when() === "on" ? t < d.getTime() || t >= next.getTime() : when() === "before" ? t >= d.getTime() : t < next.getTime()) return false;
    }
    return true;
  };
  const byFrom = (l: Msg[]) => l.filter(pass);
  const results = () => {
    const list = byFrom((q() ? hits() : hist()) ?? []).filter((m) => !m.system && has(m, hasF()));
    // History comes newest first; Stoat's search already sorts the way you asked.
    return !q() && sort() === "Oldest" ? list.slice().reverse() : list;
  };
  /** This page of results; going past what's loaded asks Stoat for the next batch. */
  const pageList = () => results().slice(page() * PAGE, (page() + 1) * PAGE);
  const pageCount = () => Math.ceil(results().length / PAGE) + (more() && q() ? 1 : 0);
  let listEl: HTMLDivElement | undefined;
  const goPage = (n: number) => {
    if (n < 0 || n >= pageCount()) return;
    setPage(n);
    listEl?.scrollTo({ top: 0 });
    if ((n + 1) * PAGE > results().length && more() && !searching()) void loadBatch(false);
  };
  // A next batch that turned out empty: back to the last page there is.
  createEffect(() => { const n = pageCount(); if (n && page() >= n) setPage(n - 1); });
  /** Page buttons like Discord's: the first, the last known, and the ones around this page. */
  const pageNums = () => {
    const n = pageCount(), at = page(), out: (number | "…")[] = [];
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1 || Math.abs(i - at) <= 1) out.push(i);
      else if (out[out.length - 1] !== "…") out.push("…");
    }
    return out;
  };
  /** The searched words, for highlighting in the results. */
  const terms = () => q().split(/\s+/).map((w) => w.replace(/^["']+|["']+$/g, "")).filter((w) => w.length > 1);

  type Hit = { m: Msg; url: string; name: string; preview?: string; video: boolean; spoiler?: boolean; frame?: string };
  const fromAttachment = (m: Msg, a: Attachment): Hit => ({ m, url: a.url, name: a.name, preview: a.previewUrl, video: a.type !== "image", spoiler: a.spoiler });
  const fromEmbed = (m: Msg, e: Embed): Hit | null => {
    if (e.special?.type === "YouTube" && e.special.id) {
      const id = e.special.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
      const thumb = e.image?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      return { m, url: thumb, name: e.title || "YouTube", preview: thumb, video: true, frame: ytEmbed(id, !MOBILE_UI) };
    }
    if (e.video?.url) return { m, url: e.video.url, name: e.title || e.siteName || "Video", preview: e.image?.url, video: true };
    if (e.image?.url && (e.kind === "image" || e.kind === "video" || e.gif)) return { m, url: e.image.url, name: e.title || (e.gif ? "GIF" : "Image"), preview: e.image.url, video: false };
    return null;
  };
  // A memo, so the tile you tap is the same object the gallery looks up (a fresh list never contained it).
  const media = createMemo((): Hit[] => byFrom(hist() ?? []).flatMap((m) => [
    ...(m.attachments ?? []).filter(isMedia).map((a) => fromAttachment(m, a)),
    ...(m.embeds ?? []).filter(embedIsMedia).map((e) => fromEmbed(m, e)).filter((x): x is Hit => !!x),
  ]));
  const files = () => byFrom(hist() ?? []).flatMap((m) => (m.attachments ?? []).filter((a) => !isMedia(a)).map((a) => ({ m, a })));
  const links = () => byFrom(hist() ?? []).flatMap((m) => linksOf(m).map((url) => ({ m, url, embed: m.embeds?.find((e) => e.url === url) })));

  const title = () => (pins() ? "Pinned messages" : "Search");
  /** Phones swipe through every result like a gallery; computers only through the pictures sent together. */
  const openFromSearch = (hit: Hit, i: number) => {
    if (hit.frame) { openGallery([{ url: `https://www.youtube.com/watch?v=${/embed\/([^?]+)/.exec(hit.frame)?.[1] ?? ""}`, name: hit.name, video: true, preview: hit.preview, frame: hit.frame, from: hit.m.author, at: hit.m.at, locate: () => jumpTo(hit.m) }]); return; }
    const all = media().filter((x) => !x.frame);
    const list = MOBILE_UI ? all : all.filter((x) => x.m.id === hit.m.id);
    const at = Math.max(0, list.indexOf(hit));
    void i;
    openGallery(list.map((x) => ({ url: x.url, name: x.name, spoiler: x.spoiler, video: x.video, preview: x.preview, from: x.m.author, at: x.m.at, locate: () => jumpTo(x.m) })), at);
  };
  const jumpTo = (m: Msg) => {
    requestJump(m.channelId, m.id);
    // Where the panel covers the chat (phones, narrow windows), get out of the way so the message is seen.
    if (narrowLayout()) props.onClose(); else setPreview(null);
  };
  /** A result: on computers it's shown where it was in the chat, like Discord; phones and tablets show it in context here first. */
  const openResult = (m: Msg) => (MOBILE_UI ? setPreview(m) : jumpTo(m));
  const submit = (e: Event) => { e.preventDefault(); apply(draft().trim()); if (!draft().trim() && tab() === "messages") setTab("media"); };
  /** Taking a filter off (its chip's ×) also takes its words out of the box. */
  const unset = (key: RegExp, clear: () => void) => { clear(); setDraft(draft().replace(new RegExp(`(^|\\s)${key.source}:(?:"[^"]*"|\\S*)`, "gi"), " ").replace(/\s+/g, " ").trim()); };
  let searchInput: HTMLInputElement | undefined;

  const filterCount = () => [from(), mentions(), hasF(), when(), kind()].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = createSignal(props.panel.kind === "search" && !!props.panel.filters);
  const current = (): SearchFilters => ({ from: from(), mentions: mentions(), has: hasF(), when: when(), day: day(), kind: kind() });
  const setAll = (f: SearchFilters) => batch(() => { setFrom(f.from); setMentions(f.mentions); setHasF(f.has); setWhen(f.when); if (f.day) setDay(f.day); setKind(f.kind); });
  /** Discord's Filters window: every filter in one place; Apply writes them into the search box too. */
  const FiltersDialog = () => {
    const before = current();
    const cancel = () => { setAll(before); setFiltersOpen(false); };
    const applyAll = () => { const t = searchText(q(), current(), nameOf); setDraft(t); rememberSearch(t); setFiltersOpen(false); };
    useBack(cancel);
    const opts = () => allPeople().slice().sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ v: p.id, label: p.name }));
    return (
      <div class="scrim" onClick={(e) => e.target === e.currentTarget && cancel()}>
        <div class="modal panel mp-filters-dialog" role="dialog" aria-label="Filters">
          <header><h3>Filters</h3><button class="icon-btn" aria-label="Close" onClick={cancel}><Icon name="close" size={18} /></button></header>
          <div class="mfd-body">
            <label class="mfd-row"><b>From</b><small>Sent by this person</small>
              <Select label="From" value={from()} onChange={setFrom} options={[{ v: "", label: "Anyone" }, ...opts()]} /></label>
            <label class="mfd-row"><b>Has</b><small>Includes this type of content</small>
              <Select label="Has" value={hasF()} onChange={(v) => setHasF(v as Has)} options={[{ v: "", label: "Any content" }, { v: "media", label: "Media (pictures, videos, GIFs)" }, { v: "link", label: "A link" }, { v: "file", label: "A file" }]} /></label>
            <label class="mfd-row"><b>Mentions</b><small>Mentions this person</small>
              <Select label="Mentions" value={mentions()} onChange={setMentions} options={[{ v: "", label: "Anyone" }, ...opts()]} /></label>
            <div class="mfd-row"><b>Date</b><small>When the message was sent</small>
              <div class="mfd-date">
                <Select label="Date" value={when()} onChange={(v) => setWhen(v as When)} options={[{ v: "", label: "Any time" }, { v: "on", label: "During" }, { v: "before", label: "Before" }, { v: "after", label: "After" }]} />
                <Show when={when()}><input class="mp-date" type="date" value={day()} max={new Date().toISOString().slice(0, 10)} aria-label="Day" onInput={(e) => e.currentTarget.value && setDay(e.currentTarget.value)} /></Show>
              </div>
            </div>
            <label class="mfd-row"><b>Author type</b><small>Sent by people or by bots</small>
              <Select label="Author type" value={kind()} onChange={(v) => setKind(v as Kind)} options={[{ v: "", label: "People and bots" }, { v: "people", label: "People" }, { v: "bots", label: "Bots" }]} /></label>
          </div>
          <footer class="mfd-foot">
            <Show when={filterCount()}><button class="link" onClick={clearFilters}>Clear filters ({filterCount()})</button></Show>
            <span class="grow" />
            <button class="btn" onClick={cancel}>Cancel</button>
            <button class="btn primary" onClick={applyAll}>Apply filters</button>
          </footer>
        </div>
      </div>
    );
  };

  return (
    <section class="mpanel" aria-label={title()}>
      <header class="mp-head">
        <Icon name={pins() ? "pin" : "search"} size={18} />
        <Show when={!pins() && ownBox()} fallback={<h3>{title()}</h3>}>
          <form class="search-box wide mp-search" role="search" onSubmit={submit}>
            <input name="q" value={draft()} placeholder={`Search ${props.channel.name}`} aria-label={`Search in ${props.channel.name}`} autocomplete="off"
              ref={(el) => { searchInput = el; if (!draft()) queueMicrotask(() => el.focus()); }} onInput={(e) => setDraft(e.currentTarget.value)} enterkeyhint="search" />
            <Show when={draft()}><button type="button" class="mp-clear" aria-label="Clear" onClick={() => { setDraft(""); apply(""); }}><Icon name="close" size={14} /></button></Show>
          </form>
        </Show>
        <span class="grow" />
        <button class="icon-btn" onClick={props.onClose} aria-label="Close"><Icon name="close" size={18} /></button>
      </header>

      <Show when={!pins()}>
        <nav class="mp-tabs" role="tablist">
          <For each={[["messages", "Messages"], ["media", "Media"], ["links", "Links"], ["files", "Files"]] as [Tab, string][]}>{([k, label]) => (
            <button role="tab" aria-selected={tab() === k} classList={{ on: tab() === k }} onClick={() => setTab(k)}>{label}</button>
          )}</For>
        </nav>
        {/* Computers, like Discord: filters are typed in the box (from:, has:… suggested as you type) or picked in the
            Filters window; this bar shows how many results, the Filters button and the sort. Phones and tablets pick
            them from the menus below instead. */}
        <Show when={!MOBILE_UI && tab() === "messages" && (q() || filtering())}>
          <div class="mp-resbar">
            <span class="mp-count">{searching() && !hits().length ? "Searching…" : (() => { const n = results().length; return n === 1 && !more() ? "1 result" : `${n}${more() && q() ? "+" : ""} results`; })()}</span>
            <span class="grow" />
            <button class="btn small" onClick={() => setFiltersOpen(true)}><Icon name="gear" size={14} />Filters{filterCount() ? ` (${filterCount()})` : ""}</button>
            <button class="btn small" onClick={(e) => openMenu(e.currentTarget, (q() ? ["Latest", "Oldest", "Relevance"] : ["Latest", "Oldest"]).map((k) => ({
              label: k === "Latest" ? "Newest first" : k === "Oldest" ? "Oldest first" : "Best match", checked: sort() === k, onSelect: () => setSort(k as SearchSort) })))}>
              <Icon name="swap" size={14} />Sort</button>
          </div>
        </Show>
        <Show when={filtersOpen()}><FiltersDialog /></Show>
        <div class="mp-filters" classList={{ "mobile-only": !MOBILE_UI }}>
          <Select label="From" value={from()} onChange={setFrom} options={[{ v: "", label: "From anyone" }, ...people().map((p) => ({ v: p.id, label: `From ${p.name}` }))]} />
          <Show when={tab() === "messages"}>
            <Select label="Has" value={hasF()} onChange={(v) => setHasF(v as Has)}
              options={[{ v: "", label: "Has anything" }, { v: "media", label: "Has media" }, { v: "link", label: "Has a link" }, { v: "file", label: "Has a file" }]} />
          </Show>
          <Select label="Mentions" value={mentions()} onChange={setMentions} options={[{ v: "", label: "Mentions anyone" }, ...people().map((p) => ({ v: p.id, label: `Mentions ${p.name}` }))]} />
          <Select label="Author type" value={kind()} onChange={(v) => setKind(v as Kind)} options={[{ v: "", label: "People and bots" }, { v: "people", label: "Only people" }, { v: "bots", label: "Only bots" }]} />
          <Select label="Date" value={when()} onChange={(v) => setWhen(v as When)} options={[{ v: "", label: "Any time" }, { v: "on", label: "Sent on" }, { v: "before", label: "Before" }, { v: "after", label: "After" }]} />
          <Show when={when()}>
            <input class="mp-date" type="date" value={day()} max={new Date().toISOString().slice(0, 10)} aria-label="Day" onInput={(e) => e.currentTarget.value && setDay(e.currentTarget.value)} />
          </Show>
          <Show when={filtering()}><button class="btn small mp-reset" onClick={clearFilters}>Clear filters</button></Show>
        </div>
      </Show>

      <div class="mp-list" ref={listEl} classList={{ gallery: tab() === "media" && !pins() }}>
        <Switch>
          <Match when={pins() || tab() === "messages"}>
            <Show when={pins() || q() || filtering()} fallback={<p class="empty">Type words to search messages, pick a filter, or look through Media, Links and Files.</p>}>
              <Show when={pins() ? !found.loading : !(q() ? searching() && !pageList().length : hist.loading)} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
                <Show when={!(pins() ? found.error : searchErr())} fallback={<p class="empty">{pins() ? (found.error as Error)?.message || "Couldn't load these." : searchErr()}</p>}>
                  <For each={pins() ? found() : pageList()} fallback={<p class="empty">{pins() ? "Nothing is pinned here yet. Right-click a message to pin it." : "No messages match. Try fewer words or another filter."}</p>}>{(m) => (
                    <button class="mp-item" onClick={() => openResult(m)}>
                      <header>
                        <Avatar person={m.author} size={24} presence={false} still />
                        <NameText person={m.author} class="mp-name" />
                        <time>{fmtStamp(m.at)}</time>
                      </header>
                      <Show when={m.text} fallback={<em class="muted">{m.attachments?.length ? `${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}` : "Empty message"}</em>}><div class="mp-text-wrap" ref={(el) => queueMicrotask(() => markWords(el, terms()))}><Markdown text={m.text} class="mp-text" /></div></Show>
                      <Show when={m.attachments?.some(isMedia)}>
                        <span class="mp-thumbs"><For each={m.attachments!.filter(isMedia).slice(0, 4)}>{(a) => <img src={a.previewUrl ?? a.url} alt="" loading="lazy" />}</For></span>
                      </Show>
                    </button>
                  )}</For>
                </Show>
              </Show>
            </Show>
          </Match>
          <Match when={hist.loading}><div class="loading-row"><div class="spinner small" /></div></Match>
          <Match when={tab() === "media"}>
            <For each={media()} fallback={<p class="empty">No pictures or videos in recent messages.</p>}>{(hit, i) => (
              <button class="mp-tile" classList={{ spoiled: !!hit.spoiler }} onClick={() => openFromSearch(hit, i())} aria-label={`${hit.name}, from ${hit.m.author.name}`}>
                <Show when={!hit.video || hit.preview} fallback={<span class="mp-vid"><Icon name="video" size={22} /></span>}><img src={hit.preview ?? hit.url} alt="" loading="lazy" /></Show>
                <Show when={hit.video && (hit.preview || hit.frame)}><span class="mp-vid"><Icon name="play" size={26} /></span></Show>
                <Show when={hit.spoiler}><span class="mp-spoiler"><Icon name="eye" size={26} /></span></Show>
                <span class="mp-by"><Avatar person={hit.m.author} size={26} presence={false} still /></span>
              </button>
            )}</For>
          </Match>
          <Match when={tab() === "links"}>
            <For each={links()} fallback={<p class="empty">No links in recent messages.</p>}>{({ m, url, embed }) => (
              <div class="mp-link">
                <a href={url} target="_blank" rel="noopener noreferrer" class="mp-link-main">
                  <Show when={embed?.image?.url ?? embed?.iconUrl} fallback={<span class="mp-link-ic"><Icon name="link" size={18} /></span>}>{(src) => <img src={src()} alt="" loading="lazy" />}</Show>
                  <span class="mp-link-text"><strong>{embed?.title || hostOf(url)}</strong><small>{embed?.siteName || url}</small></span>
                </a>
                <button class="mp-link-from" onClick={() => openResult(m)}><Avatar person={m.author} size={18} presence={false} still /><span>{m.author.name} · {fmtStamp(m.at)}</span><Icon name="chevron-right" size={14} /></button>
              </div>
            )}</For>
          </Match>
          <Match when={tab() === "files"}>
            <For each={files()} fallback={<p class="empty">No files in recent messages.</p>}>{({ m, a }) => (
              <button class="mp-link mp-file" onClick={() => openResult(m)}>
                <span class="mp-link-ic"><Icon name="file" size={18} /></span>
                <span class="mp-link-text"><strong>{a.name}</strong><small>{m.author.name} · {fmtStamp(m.at)}</small></span>
              </button>
            )}</For>
          </Match>
        </Switch>
      </div>
      <Show when={!pins() && tab() === "messages" && pageCount() > 1}>
        <nav class="mp-pages" aria-label="Result pages">
          <button class="mp-pg" disabled={page() === 0} onClick={() => goPage(page() - 1)}><Icon name="back" size={14} />Previous</button>
          <For each={pageNums()}>{(n) => (n === "…" ? <span class="mp-gap">…</span>
            : <button class="mp-num" classList={{ on: n === page() }} aria-current={n === page() ? "page" : undefined} onClick={() => goPage(n)}>{n + 1}</button>)}</For>
          <button class="mp-pg" disabled={page() >= pageCount() - 1} onClick={() => goPage(page() + 1)}>Next<Icon name="right" size={14} /></button>
        </nav>
      </Show>

      <Show when={preview()}>{(m) => <MessagePreview m={m()} onClose={() => setPreview(null)} onJump={() => jumpTo(m())} />}</Show>
    </section>
  );
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** A result where it was in the conversation (a few messages either side), and a button to jump there in the chat. */
function MessagePreview(props: { m: Msg; onClose(): void; onJump(): void }) {
  const [around] = createResource(() => props.m, (m) => backend()!.messagesAround(m.channelId, m.id).catch(() => [m]));
  const near = () => {
    const l = [...(around() ?? [props.m])].sort((a, b) => (a.id < b.id ? -1 : 1));
    const i = l.findIndex((x) => x.id === props.m.id);
    return i < 0 ? [props.m] : l.slice(Math.max(0, i - 3), i + 4);
  };
  return (
    <div class="mp-preview" role="dialog" aria-label="Message preview">
      <header class="mp-head">
        <button class="icon-btn" onClick={props.onClose} aria-label="Back to results"><Icon name="back" size={18} /></button>
        <h3>In context</h3>
      </header>
      <div class="mp-pv-list">
        <Show when={!around.loading} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
          <For each={near()}>{(x) => (
            <article class="mp-pv-msg" classList={{ target: x.id === props.m.id }} ref={(el) => { if (x.id === props.m.id) queueMicrotask(() => el.scrollIntoView({ block: "center" })); }}>
              <Avatar person={x.author} size={32} presence={false} still />
              <div>
                <header><NameText person={x.author} class="mp-name" /><time>{fmtStamp(x.at)}</time></header>
                <Show when={x.text}><Markdown text={x.text} class="mp-text" /></Show>
                <Show when={x.attachments?.some(isMedia)}>
                  <span class="mp-thumbs"><For each={x.attachments!.filter(isMedia).slice(0, 4)}>{(a) => <img src={a.previewUrl ?? a.url} alt="" loading="lazy" />}</For></span>
                </Show>
                <Show when={x.attachments?.some((a) => !isMedia(a))}><small class="muted">{x.attachments!.filter((a) => !isMedia(a)).map((a) => a.name).join(", ")}</small></Show>
              </div>
            </article>
          )}</For>
        </Show>
      </div>
      <footer class="mp-pv-bar">
        <button class="btn primary mp-pv-jump" onClick={props.onJump}><Icon name="arrow-down" size={16} />Jump to message</button>
      </footer>
    </div>
  );
}
