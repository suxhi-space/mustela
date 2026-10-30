import { createEffect, createMemo, createResource, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { useBack } from "../back";
import type { Attachment, ChannelInfo, Msg, Person } from "../../lib/backend/types";
import { fmtStamp } from "../../lib/time";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { requestJump } from "../nav";
import { backend } from "../store";
import { Select } from "../controls";
import { Markdown } from "./Markdown";

export type Panel = { kind: "search"; q: string } | { kind: "pins" };

type Tab = "messages" | "media" | "links" | "files";
type Has = "" | "media" | "link" | "file";

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"]/g;
const isMedia = (a: Attachment) => a.type === "image" || a.type === "video";
const linksOf = (m: Msg) => [...new Set([...(m.text.match(URL_RE) ?? []), ...(m.embeds ?? []).flatMap((e) => (e.url && !e.gif ? [e.url] : []))])];
const has = (m: Msg, h: Has) =>
  !h || (h === "media" ? !!m.attachments?.some(isMedia) : h === "file" ? !!m.attachments?.some((a) => !isMedia(a)) : linksOf(m).length > 0);

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
export function MessagePanel(props: { panel: Panel; channel: ChannelInfo; onClose(): void }) {
  useBack(() => (preview() ? setPreview(null) : props.onClose()));
  const pins = () => props.panel.kind === "pins";
  const [q, setQ] = createSignal(props.panel.kind === "search" ? props.panel.q : "");
  const [draft, setDraft] = createSignal(q());
  const [tab, setTab] = createSignal<Tab>("messages");
  const [from, setFrom] = createSignal("");
  const [hasF, setHasF] = createSignal<Has>("");
  const [preview, setPreview] = createSignal<Msg | null>(null);
  // A new search from the channel's own search box while this is open.
  createEffect(on(() => props.panel, (p) => { if (p.kind === "search" && p.q) { setQ(p.q); setDraft(p.q); setTab("messages"); setPreview(null); } }, { defer: true }));

  const [found] = createResource(() => (pins() ? { k: "pins" as const, c: props.channel.id } : q() ? { k: "q" as const, c: props.channel.id, q: q() } : null),
    (k) => (k.k === "pins" ? backend()!.pinned(k.c) : backend()!.search(k.c, k.q!)));
  // History for the other tabs, loaded once when one of them is first opened.
  const [hist] = createResource(() => (!pins() && tab() !== "messages" ? props.channel.id : null), history);

  const people = createMemo(() => {
    const seen = new Map<string, Person>();
    for (const m of [...(found() ?? []), ...(hist() ?? [])]) if (!m.system) seen.set(m.author.id, m.author);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const byFrom = (l: Msg[]) => (from() ? l.filter((m) => m.author.id === from()) : l);
  const results = () => byFrom(found() ?? []).filter((m) => has(m, hasF()));
  const media = () => byFrom(hist() ?? []).flatMap((m) => (m.attachments ?? []).filter(isMedia).map((a) => ({ m, a })));
  const files = () => byFrom(hist() ?? []).flatMap((m) => (m.attachments ?? []).filter((a) => !isMedia(a)).map((a) => ({ m, a })));
  const links = () => byFrom(hist() ?? []).flatMap((m) => linksOf(m).map((url) => ({ m, url, embed: m.embeds?.find((e) => e.url === url) })));

  const title = () => (pins() ? "Pinned messages" : "Search");
  const submit = (e: Event) => { e.preventDefault(); setQ(draft().trim()); if (!draft().trim() && tab() === "messages") setTab("media"); };

  return (
    <section class="mpanel" aria-label={title()}>
      <header class="mp-head">
        <Icon name={pins() ? "pin" : "search"} size={18} />
        <Show when={!pins()} fallback={<h3>{title()}</h3>}>
          <form class="search-box wide mp-search" role="search" onSubmit={submit}>
            <input name="q" value={draft()} placeholder={`Search ${props.channel.name}`} aria-label={`Search in ${props.channel.name}`} autocomplete="off"
              ref={(el) => { if (!q()) queueMicrotask(() => el.focus()); }} onInput={(e) => setDraft(e.currentTarget.value)} enterkeyhint="search" />
            <Show when={draft()}><button type="button" class="mp-clear" aria-label="Clear" onClick={() => { setDraft(""); setQ(""); }}><Icon name="close" size={14} /></button></Show>
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
        <div class="mp-filters">
          <Select label="From" value={from()} onChange={setFrom} options={[{ v: "", label: "From anyone" }, ...people().map((p) => ({ v: p.id, label: p.name }))]} />
          <Show when={tab() === "messages"}>
            <Select label="Has" value={hasF()} onChange={(v) => setHasF(v as Has)}
              options={[{ v: "", label: "Has anything" }, { v: "media", label: "Has media" }, { v: "link", label: "Has a link" }, { v: "file", label: "Has a file" }]} />
          </Show>
        </div>
      </Show>

      <div class="mp-list" classList={{ gallery: tab() === "media" && !pins() }}>
        <Switch>
          <Match when={pins() || tab() === "messages"}>
            <Show when={pins() || q()} fallback={<p class="empty">Type words to search messages, or look through Media, Links and Files.</p>}>
              <Show when={!found.loading} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
                <Show when={!found.error} fallback={<p class="empty">{(found.error as Error)?.message || "Couldn't load these."}</p>}>
                  <For each={pins() ? found() : results()} fallback={<p class="empty">{pins() ? "Nothing is pinned here yet. Right-click a message to pin it." : "No messages match. Try fewer words or another filter."}</p>}>{(m) => (
                    <button class="mp-item" onClick={() => setPreview(m)}>
                      <header>
                        <Avatar person={m.author} size={24} presence={false} still />
                        <NameText person={m.author} class="mp-name" />
                        <time>{fmtStamp(m.at)}</time>
                      </header>
                      <Show when={m.text} fallback={<em class="muted">{m.attachments?.length ? `${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}` : "Empty message"}</em>}><Markdown text={m.text} class="mp-text" /></Show>
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
            <For each={media()} fallback={<p class="empty">No pictures or videos in recent messages.</p>}>{({ m, a }) => (
              <button class="mp-tile" onClick={() => setPreview(m)} aria-label={`${a.name}, from ${m.author.name}`}>
                <Show when={a.type === "image"} fallback={<span class="mp-vid"><Icon name="video" size={22} /></span>}><img src={a.previewUrl ?? a.url} alt="" loading="lazy" /></Show>
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
                <button class="mp-link-from" onClick={() => setPreview(m)}><Avatar person={m.author} size={18} presence={false} still /><span>{m.author.name} · {fmtStamp(m.at)}</span><Icon name="chevron-right" size={14} /></button>
              </div>
            )}</For>
          </Match>
          <Match when={tab() === "files"}>
            <For each={files()} fallback={<p class="empty">No files in recent messages.</p>}>{({ m, a }) => (
              <button class="mp-link mp-file" onClick={() => setPreview(m)}>
                <span class="mp-link-ic"><Icon name="file" size={18} /></span>
                <span class="mp-link-text"><strong>{a.name}</strong><small>{m.author.name} · {fmtStamp(m.at)}</small></span>
              </button>
            )}</For>
          </Match>
        </Switch>
      </div>

      <Show when={preview()}>{(m) => <MessagePreview m={m()} onClose={() => setPreview(null)} onJump={() => {
        requestJump(m().channelId, m().id);
        // Where the panel covers the chat (phones, narrow windows), get out of the way so the message is seen.
        if (matchMedia("(max-width: 900px)").matches) props.onClose(); else setPreview(null);
      }} />}</Show>
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
