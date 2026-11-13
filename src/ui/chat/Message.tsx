import { gifsMove, StillImg } from "../StillImg";
import { useBack } from "../back";
import { Portal } from "solid-js/web";
import { toast } from "../menu";
import { MOBILE_UI } from "../target";
import { useAutoplay } from "../autoplay";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { createEditor, type ChipLookup } from "./Editor";
import { openReactions } from "./Reactions";
import { linkCards, videoSite } from "../../lib/social";
import { FormatBar, formatKey } from "./FormatBar";
import type { ChannelRules, Attachment, Embed, Msg, Person, Reaction } from "../../lib/backend/types";
import { fmtStamp, fmtTime } from "../../lib/time";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { backend, device } from "../store";
import { inTauri } from "../../lib/platform";
import { Markdown, PlainLine, type MdCtx } from "./Markdown";
import { justReacted, markReacted, reactBurst } from "./reactFx";
import { doubleTapEmoji, isFav, openEmojiPicker, openGallery, openLightbox, toggleFav } from "./overlays";
import { openOutside } from "./Gallery";
import { messageMenu } from "../menus";
import { copy } from "../menu";
import { UEmoji } from "./UEmoji";
import { FRAME_SANDBOX, VideoBox, ytEmbed } from "./videoFull";

const time = (d: Date) => fmtTime(d);
const stamp = (d: Date) => fmtStamp(d);
const size = (n?: number) => (n === undefined ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** Stoat role colours can be plain colours or CSS gradients. */
export const roleStyle = (c?: string): Record<string, string> =>
  !c || /url\(|image\(|var\(|expression|[;{}<>]/i.test(c) ? {} : /gradient\(/.test(c) ? { "background-image": c, "-webkit-background-clip": "text", "background-clip": "text", color: "transparent" } : { color: c };
const isCustom = (e: string) => /^[0-9A-Z]{26}$/.test(e);

/** System messages: an icon by kind, and people as chips with their picture (tap for their card, like Stoat). */
const sysKind = (t?: string) => (t && /left|remove|kicked|banned/.test(t) ? "out" : t && /joined|added/.test(t) ? "in" : "other");
const sysIcon = (t?: string) => (sysKind(t) === "out" ? "door" : sysKind(t) === "in" ? "arrow-in" : t?.includes("pinned") ? "pin" : t?.startsWith("call") ? "phone" : t?.startsWith("channel") ? "pencil" : "info");
function SystemText(props: { text: string; onProfile(p: Person): void }) {
  const parts = () => props.text.split(/<@([0-9A-Za-z]{1,32})>/);
  return (
    <For each={parts()}>{(part, i) => (i() % 2 === 0 ? part : (() => {
      const p = backend()?.person(part) ?? { id: part, name: "Someone" };
      return (
        <button class="sys-who" onClick={(e) => { e.stopPropagation(); props.onProfile(backend()?.person(part) ?? p); }}>
          <Avatar person={p} size={18} presence={false} still profile={null} /><span>{p.name}</span>
        </button>
      );
    })())}</For>
  );
}

/** Same author within 5 minutes, no reply, no system message: drawn as a continuation. */
export const continues = (prev: Msg | undefined, m: Msg) =>
  !!prev && !prev.system && !m.system && !m.replyIds?.length && prev.author.id === m.author.id && prev.author.name === m.author.name &&
  m.at.getTime() - prev.at.getTime() < 5 * 60_000 && prev.at.toDateString() === m.at.toDateString();

function ReactionChip(props: { r: Reaction; mid: string; onToggle(on: boolean): void; onView?(): void }) {
  const me = () => props.r.users.includes(backend()!.me.id);
  // A little bump when the count goes up (yours with a pop), so reacting feels like it landed.
  const [bump, setBump] = createSignal<"" | "mine" | "more">(justReacted(props.mid, props.r.emoji) ? "mine" : "");
  if (bump()) setTimeout(() => setBump(""), 450);
  let last = props.r.users.length, wasMe = me(), t: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const n = props.r.users.length, mine = me();
    if (n > last) { setBump(mine && !wasMe ? "mine" : "more"); clearTimeout(t); t = setTimeout(() => setBump(""), 450); }
    last = n; wasMe = mine;
  });
  const who = () => props.r.users.slice(0, 6).map((u) => backend()!.person(u).name).join(", ") + (props.r.users.length > 6 ? ` and ${props.r.users.length - 6} more` : "");
  return (
    <button class="reaction" classList={{ on: me(), "bump-mine": bump() === "mine", "bump-more": bump() === "more" }} aria-pressed={me()} title={who()} onClick={() => props.onToggle(!me())}
      onContextMenu={(e) => { if (props.onView) { e.preventDefault(); e.stopPropagation(); props.onView(); } }}>
      <Show when={isCustom(props.r.emoji)} fallback={<span class="re" data-emoji={props.r.emoji}><UEmoji e={props.r.emoji} /></span>}>
        <StillImg class="cemoji" data-emoji-id={props.r.emoji} src={backend()!.emojiUrl(props.r.emoji)} alt="" still={!!backend()!.emojis().find((x) => x.id === props.r.emoji)?.animated && !gifsMove()} />
      </Show>
      <span class="rc">{props.r.users.length}</span>
    </button>
  );
}

const isMediaAtt = (a: Attachment) => a.type === "image" || a.type === "video";
const mediaOf = (m: Msg) => (m.attachments ?? []).filter(isMediaAtt);

/**
 * A message's pictures and videos as one grid: 2 side by side, 3 as one big and two stacked, 4 in a square, and
 * more in rows of three (with the odd ones out as a wider first row), every row the same height.
 */
function MediaGrid(props: { m: Msg }) {
  const media = () => mediaOf(props.m);
  const n = () => media().length;
  const lead = () => (n() === 2 || n() === 4 ? 2 : n() % 3);
  const tile = (i: number): JSX.CSSProperties => {
    if (n() === 3) return {};
    if (i < lead()) return lead() === 1 ? { "grid-column": "span 6", "aspect-ratio": "3 / 1" } : { "grid-column": "span 3", "aspect-ratio": n() === 2 ? "1 / 1" : "4 / 3" };
    return { "grid-column": "span 2", "aspect-ratio": "1 / 1" };
  };
  return (
    <div class="media-grid" classList={{ three: n() === 3 }}>
      <For each={media()}>{(a, i) => <GridTile a={a} m={props.m} style={tile(i())} />}</For>
    </div>
  );
}

/**
 * Spoilered pictures you've uncovered in the chat, so the viewer shows them uncovered too when you swipe to them.
 * Each one leaves the list when its message leaves the screen (the chat covers them again next time, as before).
 */
const uncovered = new Set<string>();
function useSpoiler(a: Attachment) {
  const [revealed, set] = createSignal(!a.spoiler);
  onCleanup(() => uncovered.delete(a.url));
  return [revealed, (v: boolean) => { if (v) uncovered.add(a.url); set(v); }] as const;
}

function GridTile(props: { a: Attachment; m: Msg; style: JSX.CSSProperties }) {
  const [revealed, setRevealed] = useSpoiler(props.a);
  return (
    <div class="mg-tile" classList={{ spoiled: !revealed() }} style={props.style}>
      <Show when={props.a.type === "image"} fallback={<VideoBox src={props.a.url} poster={props.a.previewUrl} class="media-vid" preload="metadata" open={(t) => showAll(props.a, props.m, t)} />}>
        <img src={props.a.previewUrl ?? props.a.url} alt={props.a.name} loading="lazy" onClick={() => (revealed() ? showAll(props.a, props.m) : setRevealed(true))} />
      </Show>
      <Show when={!revealed()}><button class="spoil-cover" onClick={() => setRevealed(true)}>Spoiler</button></Show>
    </div>
  );
}

/** A link preview's pictures (a post with several): the same grid as attachments, up to four tiles, then "+N". */
function PicGrid(props: { urls: string[]; name: string }) {
  const shown = () => props.urls.slice(0, 4);
  const n = () => shown().length;
  const more = () => props.urls.length - n();
  const tile = (i: number): JSX.CSSProperties => {
    if (n() === 3) return {};
    if (n() === 2 || n() === 4) return { "grid-column": "span 3", "aspect-ratio": n() === 2 ? "1 / 1" : "4 / 3" };
    return i === 0 ? { "grid-column": "span 6", "aspect-ratio": "3 / 1" } : { "grid-column": "span 2", "aspect-ratio": "1 / 1" };
  };
  const open = (i: number) => openGallery(props.urls.map((url, k) => ({ url, name: `${props.name} (${k + 1} of ${props.urls.length})` })), i);
  return (
    <div class="media-grid em-grid" classList={{ three: n() === 3 }}>
      <For each={shown()}>{(u, i) => (
        <div class="mg-tile" style={tile(i())}>
          <img src={u} alt="" loading="lazy" onClick={() => open(i())} />
          <Show when={i() === n() - 1 && more() > 0}><button class="mg-more" onClick={() => open(i())}>+{more()}</button></Show>
        </div>
      )}</For>
    </div>
  );
}

/** A picture from a message, big, with the message's other pictures and videos to swipe through. */
function showAll(a: Attachment, m?: Msg, start?: number) {
  const media = (m?.attachments ?? [a]).filter((x) => x.type === "image" || x.type === "video");
  openGallery(media.map((x) => ({ url: x.url, name: x.name, spoiler: x.spoiler && !uncovered.has(x.url), video: x.type === "video", preview: x.previewUrl, from: m?.author, at: m?.at, start: x === a ? start : undefined })), Math.max(0, media.indexOf(a)));
}

function AttachmentView(props: { a: Attachment; m?: Msg }) {
  const [revealed, setRevealed] = useSpoiler(props.a);
  const [gone, setGone] = createSignal(false);
  const dims = () => {
    const w = props.a.width ?? 400, h = props.a.height ?? 300;
    const s = Math.min(1, 400 / w, 300 / h);
    return { width: `${Math.round(w * s)}px`, "aspect-ratio": `${w} / ${h}` };
  };
  return (
    <Show when={!gone()}>
    <Show when={props.a.type !== "file" && props.a.type !== "audio"} fallback={
      <Show when={props.a.type === "audio"} fallback={
        <a class="file-card panel-inset" href={props.a.url} target="_blank" rel="noopener noreferrer" download={props.a.name}>
          <Icon name="file" size={28} />
          <span class="fc-text"><strong>{props.a.name}</strong><small>{size(props.a.size)}</small></span>
          <Icon name="download" size={18} />
        </a>
      }>
        <div class="file-card panel-inset audio"><span class="fc-text"><strong>{props.a.name}</strong></span><audio controls preload="none" src={props.a.url} /></div>
      </Show>
    }>
      <div class="media" classList={{ spoiled: !revealed() }} style={dims()}>
        <Show when={props.a.type === "image"} fallback={<VideoBox src={props.a.url} poster={props.a.previewUrl} class="media-vid" preload="metadata" onError={() => setGone(true)} open={(t) => showAll(props.a, props.m, t)} />}>
          <img src={props.a.previewUrl ?? props.a.url} alt={props.a.name} loading="lazy" onError={() => setGone(true)} onClick={() => (revealed() ? showAll(props.a, props.m) : setRevealed(true))} />
        </Show>
        <Show when={!revealed()}><button class="spoil-cover" onClick={() => setRevealed(true)}>Spoiler</button></Show>
      </div>
    </Show>
    </Show>
  );
}

/** A GIF plays like a GIF: looping, silent, no controls. Star it to keep it in your favorites. */
function GifEmbed(props: { e: Embed }) {
  const [gone, setGone] = createSignal(false);
  const src = () => props.e.video?.url ?? props.e.image?.url ?? "";
  const w = () => props.e.video?.width ?? props.e.image?.width ?? 300, h = () => props.e.video?.height ?? props.e.image?.height ?? 200;
  const fav = () => ({ url: props.e.url ?? src(), preview: src(), w: w(), h: h() });
  const scale = () => Math.min(1, 320 / w(), 280 / h());
  const play = useAutoplay();
  const [hoverGif, setHoverGif] = createSignal(false);
  return (
    <Show when={!gone()}>
    <div class="media gif" style={{ width: `${Math.round(w() * scale())}px`, "aspect-ratio": `${w()} / ${h()}` }}>
      <Show when={props.e.video} fallback={<StillImg src={src()} still={!gifsMove() && !hoverGif()} alt="GIF" loading="lazy" onError={() => setGone(true)} onPointerEnter={() => setHoverGif(true)} onPointerLeave={() => setHoverGif(false)} />}>
        <video ref={play} src={src()} muted playsinline preload="metadata" aria-label="GIF" onError={() => setGone(true)} />
      </Show>
      <button class="gif-star" classList={{ on: isFav(fav().url) }} aria-pressed={isFav(fav().url)} aria-label={isFav(fav().url) ? "Remove from favorite GIFs" : "Add to favorite GIFs"}
        title={isFav(fav().url) ? "Remove from favorites" : "Add to favorites"} onClick={() => toggleFav(fav())}><Icon name="star" size={16} /></button>
    </div>
    </Show>
  );
}

const SPECIAL_LABEL: Record<string, string> = { YouTube: "Watch on YouTube", Twitch: "Watch on Twitch", Spotify: "Open in Spotify", Soundcloud: "Listen on SoundCloud", Bandcamp: "Listen on Bandcamp", AppleMusic: "Open in Apple Music", Streamable: "Watch on Streamable", Lightspeed: "Watch on Lightspeed" };

/** YouTube: the thumbnail, and the video plays here when you press play (privacy-friendly youtube-nocookie). */
function YouTubeInline(props: { id: string; thumb?: string; title?: string }) {
  const [on, setOn] = createSignal(false);
  const id = () => props.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
  return (
    <Show when={on()} fallback={
      <button class="em-player em-yt" aria-label={`Play ${props.title ?? "video"}`} onClick={() => setOn(true)}>
        <img class="em-img" src={props.thumb ?? `https://i.ytimg.com/vi/${id()}/hqdefault.jpg`} alt="" loading="lazy" />
        <span class="em-play"><Icon name="play" size={22} /></span>
      </button>
    }>
      <div class="vid-box yt-box">
        <iframe class="em-frame" src={ytEmbed(id(), false)} title={props.title ?? "YouTube video"}
          sandbox={FRAME_SANDBOX} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerPolicy="strict-origin-when-cross-origin" />
        {/* Computers: opens in the media viewer, like pictures (YouTube's own full-screen button is turned off in the
            chat). Phones and tablets: opens the video in the YouTube app (or the browser), which handles full screen
            and turning sideways properly; Mustela itself stays upright. */}
        <Show when={MOBILE_UI} fallback={
          <button type="button" class="vid-fs" aria-label="Full screen" title="Full screen" onClick={(ev) => {
            (ev.currentTarget.parentElement?.querySelector("iframe") as HTMLIFrameElement | null)?.setAttribute("src", "about:blank");
            openGallery([{ url: `https://www.youtube.com/watch?v=${id()}`, name: props.title ?? "YouTube", video: true, preview: props.thumb ?? `https://i.ytimg.com/vi/${id()}/hqdefault.jpg`, frame: ytEmbed(id(), !MOBILE_UI) }]);
            setOn(false);
          }}><Icon name="fullscreen" size={18} /></button>
        }>
          <button type="button" class="vid-fs" aria-label="Open in YouTube" title="Open in YouTube" onClick={() => {
            setOn(false); // stops the player here
            void openOutside(`https://www.youtube.com/watch?v=${id()}`);
          }}><Icon name="popout" size={18} /></button>
        </Show>
      </div>
    </Show>
  );
}

/**
 * A social post's own preview (fetched by the app, the way Discord does), with its picture or video. Stoat's
 * own card for the link (`fallback`) shows while it loads, and stays if there's nothing better.
 */
function SocialPreview(props: { url: string; fallback?: Embed }) {
  const [broken, setBroken] = createSignal(false);
  const [p] = createResource(() => props.url, async (url) => {
    if (!inTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<{ url: string; site?: string; title?: string; description?: string; image?: string; images?: string[]; video?: string; colour?: string } | null>("link_preview", { url }).catch(() => null);
  });
  // Stoat's own card stays unless Mustela's adds something: a video, several pictures, or a picture Stoat's lacks
  // (on a video site, Stoat's still picture of a clip is replaced by Mustela's playable one as before).
  const better = (x: NonNullable<ReturnType<typeof p>>) => {
    const f = props.fallback;
    if (!f || (!f.image && !f.video) || videoSite(props.url)) return true;
    return !!x.video || (x.images?.length ?? 0) > 1;
  };
  return (
    <Show when={p() && better(p()!) ? p() : null} fallback={<Show when={props.fallback}>{(e) => <EmbedView e={e()} />}</Show>}>{(x) => (
      <div class="embed panel-inset social-embed" style={x().colour && /^#[0-9a-f]{3,8}$/i.test(x().colour!) ? { "--embed": x().colour } : {}}>
        <Show when={x().site}><div class="em-site">{x().site}</div></Show>
        <Show when={x().title}><a class="em-title" href={props.url} target="_blank" rel="noopener noreferrer nofollow">{x().title}</a></Show>
        <Show when={x().description}><div class="em-desc">{x().description!.slice(0, 400)}</div></Show>
        <Show when={x().video && !broken()} fallback={
          // A post with several pictures: all of them, in a grid like attachments (the viewer swipes through them).
          <Show when={!x().video && (x().images?.length ?? 0) > 1 && !broken()} fallback={
          <Show when={x().image && !broken()}>
          <Show when={x().video} fallback={<img class="em-img" src={x().image} alt="" loading="lazy" onError={() => setBroken(true)} onClick={() => openLightbox(x().image!, x().title ?? "image")} />}>
            {/* The video wouldn't play here: open the post instead. */}
            <a class="em-player" href={props.url} target="_blank" rel="noopener noreferrer nofollow" aria-label="Open the video">
              <img class="em-img" src={x().image} alt="" loading="lazy" /><span class="em-play"><Icon name="play" size={22} /></span>
            </a>
          </Show>
        </Show>}><PicGrid urls={x().images!} name={x().title ?? "image"} /></Show>}>
          <VideoBox src={x().video!} poster={x().image} onError={() => setBroken(true)} item={{ name: x().title ?? "Video" }} clickOpens />
        </Show>
      </div>
    )}</Show>
  );
}

/** A link preview from a ||spoilered|| link: blurred with a Spoiler button until you tap it. */
function SpoilerCover(props: { on: boolean; children: JSX.Element }) {
  const [shown, setShown] = createSignal(false);
  const covered = () => props.on && !shown();
  // The card is made once and only uncovered, so a video under it is the same player afterwards.
  return (
    <div class="embed-wrap" classList={{ "embed-spoiler": covered() }}
      ref={(el) => el.addEventListener("click", (e) => { if (!covered()) return; e.stopPropagation(); e.preventDefault(); setShown(true); }, true)}>
      <div class="es-inner" aria-hidden={covered() || undefined} inert={covered() || undefined}>{props.children}</div>
      <Show when={covered()}><button type="button" class="spoil-cover">Spoiler</button></Show>
    </div>
  );
}

/** A card with nothing to show but the site's name (a mirror that gave Stoat no title, text or picture). */
const emptyEmbed = (e: Embed) => (e.kind === "website" || e.kind === "text") && !e.title && !e.description && !e.image && !e.video && !e.special;

function EmbedView(props: { e: Embed }) {
  const e = () => props.e;
  const [mediaGone, setMediaGone] = createSignal(false);
  return (
    <Show when={!emptyEmbed(e())}>
    <Show when={!e().gif} fallback={<GifEmbed e={e()} />}>
      <Show when={e().kind === "website" || e().kind === "text"} fallback={
        <Show when={!mediaGone() && e().image} fallback={<Show when={!mediaGone() && e().video}><VideoBox src={e().video!.url} class="media-vid" onError={() => setMediaGone(true)} item={{ name: e().title ?? "Video" }} clickOpens /></Show>}>
          <img class="media embed-img" src={e().image!.url} alt="" loading="lazy" onError={() => setMediaGone(true)} onClick={() => openLightbox(e().image!.url, e().url ?? "image")} />
        </Show>
      }>
        <div class="embed panel-inset" style={e().colour && /^#[0-9a-f]{3,8}$/i.test(e().colour!) ? { "--embed": e().colour } : {}}>
          <Show when={e().siteName}><div class="em-site"><Show when={e().iconUrl}><img src={e().iconUrl} alt="" /></Show>{e().siteName}</div></Show>
          <Show when={e().title}>
            <Show when={e().url} fallback={<div class="em-title">{e().title}</div>}>
              <a class="em-title" href={e().url} target="_blank" rel="noopener noreferrer nofollow">{e().title}</a>
            </Show>
          </Show>
          {/* Bots and webhooks (GitHub…) write their embeds in markdown: shown formatted, like Stoat. Website previews are plain text. */}
          <Show when={e().description}>
            <Show when={e().kind === "text"} fallback={<div class="em-desc">{e().description!.slice(0, 350)}</div>}>
              <Markdown text={e().description!.length > 1500 ? `${e().description!.slice(0, 1500)}…` : e().description!} class="em-desc em-md" />
            </Show>
          </Show>
          {/* YouTube plays right here; a post with a video (an Instagram reel, a clip on X) plays inline. */}
          <Show when={e().kind === "website" && e().special?.type === "YouTube" && e().special?.id} fallback={
            <Show when={e().video && e().kind === "website" && !e().special} fallback={
              <Show when={!mediaGone() && e().image && e().kind === "website"}>
                <Show when={e().special && e().url} fallback={<img class="em-img" src={e().image!.url} alt="" loading="lazy" onError={() => setMediaGone(true)} onClick={() => openLightbox(e().image!.url, e().title ?? "image")} />}>
                  <a class="em-player" href={e().url} target="_blank" rel="noopener noreferrer nofollow" aria-label={SPECIAL_LABEL[e().special!.type] ?? "Open link"}>
                    <img class="em-img" src={e().image!.url} alt="" loading="lazy" />
                    <span class="em-play"><Icon name="play" size={22} /></span>
                  </a>
                </Show>
              </Show>
            }>
              <Show when={!mediaGone()}><VideoBox src={e().video!.url} poster={e().image?.url} preload="none" onError={() => setMediaGone(true)} item={{ name: e().title ?? "Video" }} clickOpens /></Show>
            </Show>
          }>
            <YouTubeInline id={e().special!.id!} thumb={e().image?.url} title={e().title} />
          </Show>
        </div>
      </Show>
    </Show>
    </Show>
  );
}

/** Stoat invite links: stt.gg/CODE, rvlt.gg/CODE, or …/invite/CODE on a Stoat/Revolt host. */
const INVITE_RE = /https?:\/\/(?:(?:www\.)?(?:stt|rvlt)\.gg|(?:app\.|www\.)?(?:stoat\.chat|revolt\.chat))\/(?:invite\/)?([A-Za-z0-9]{4,32})(?![\w/])/g;
export const inviteCodes = (text: string) => [...new Set([...text.matchAll(INVITE_RE)].map((m) => m[1]!))].slice(0, 3);

export function InviteCard(props: { code: string }) {
  const [info] = createResource(() => props.code, (c) => backend()!.invite(c));
  const [state, setState] = createSignal<"idle" | "busy" | "err" | "joined">("idle");
  async function join() {
    setState("busy");
    try { await backend()!.joinInvite(props.code); setState("joined"); } catch { setState("err"); }
  }
  return (
    <div class="invite-card panel-inset">
      <p class="label">You've been invited to join a server</p>
      <Show when={info()} fallback={<p class="muted small">{info.loading ? "Loading invite…" : "This invite is invalid or has expired."}</p>}>
        {(i) => (
          <div class="ic-row">
            <span class="ic-icon">
              <Show when={i().iconUrl} fallback={<span>{i().serverName.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>}><img src={i().iconUrl} alt="" /></Show>
            </span>
            <span class="ic-text">
              <strong>{i().serverName}</strong>
              <small><Show when={i().memberCount !== undefined}><span class="ic-dot" />{i().memberCount} members</Show><Show when={i().channelName}><span class="ic-chan">#{i().channelName}</span></Show></small>
            </span>
            <button class="btn small" classList={{ primary: !i().joined && state() !== "joined" }} disabled={i().joined || state() === "busy" || state() === "joined"} onClick={() => void join()}>
              {i().joined || state() === "joined" ? "Joined" : state() === "busy" ? "Joining…" : state() === "err" ? "Try again" : "Join"}
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}

function ReplyPreview(props: { channelId: string; id: string; local(id: string): Msg | undefined; onJump(id: string): void }) {
  const [m] = createResource(() => props.id, async (id) => props.local(id) ?? (await backend()!.message(props.channelId, id)));
  return (
    <button class="reply-ref" onClick={() => props.onJump(props.id)}>
      <Icon name="reply" size={14} class="flip" />
      <Show when={m()} fallback={<em class="muted">{m.loading ? "Loading…" : "Original message was deleted"}</em>}>
        {(r) => (<>
          <Avatar person={r().author} size={16} presence={false} still profile={null} />
          <NameText person={r().author} class="rr-name" fontOnly />
          <span class="rr-text"><Show when={r().text.trim()} fallback={r().attachments?.length ? "Sent an attachment" : ""}><PlainLine text={r().text} max={300} /></Show></span>
        </>)}
      </Show>
    </button>
  );
}

export interface MessageActions {
  onProfile(p: Person): void;
  onReply(m: Msg): void;
  onEdit(m: Msg | null): void;
  onJump(id: string): void;
  local(id: string): Msg | undefined;
  ctx: MdCtx;
  /** The server this chat belongs to, for permission-aware menus */
  serverId?: string;
  /** What I may do in this channel (shared by every message in it) */
  rules(): ChannelRules;
}

/** How chips are drawn in the edit box: names looked up as they're drawn. */
function chipLookup(): ChipLookup {
  const b = () => backend();
  return {
    user: (id) => { const p = b()?.person(id); return p && p.name !== "Unknown" ? { name: p.name, colour: p.colour } : undefined; },
    channel: (id) => b()?.channelName(id),
    role: (id) => { const r = b()?.role(id); return r ? { name: r.name, colour: r.colour } : undefined; },
    emoji: (id) => { const e = b()?.emojis().find((x) => x.id === id); return e ? { name: e.name, url: e.url } : undefined; },
    messageLink: (url) => {
      const mm = /\/channel\/([0-9A-HJKMNP-TV-Z]{26})\/[0-9A-HJKMNP-TV-Z]{26}$/.exec(url);
      const name = mm && b()?.channelName(mm[1]!);
      return name ? `#${name} › message` : undefined;
    },
  };
}

export function MessageRow(props: { m: Msg; prev?: Msg; editing: boolean; act: MessageActions; highlight?: boolean }) {
  const m = () => props.m;
  const rules = () => props.act.rules();
  const mine = () => m().author.id === backend()!.me.id;
  const head = () => !continues(props.prev, m());
  const compact = () => device().layout === "compact";
  const [confirmDel, setConfirmDel] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const b = () => backend()!;
  const invites = createMemo(() => inviteCodes(m().text));
  /** A message that's only a GIF link or only invite links shows the GIF/card, not the URL (like Stoat and Discord). */
  const linkOnly = createMemo(() => {
    const t = m().text.trim();
    if (!t || /\s/.test(t) || !/^https?:\/\//.test(t)) return false;
    return (m().embeds ?? []).some((e) => e.gif) || invites().length > 0;
  });
  // One card per link: Stoat's, or Mustela's own preview of a social post when Stoat's has no video. Links inside
  // ||spoiler|| marks cover their card until tapped. Invite links get the invite card instead.
  const cards = createMemo(() => linkCards(m().text, m().embeds ?? [], (u) => inviteCodes(u).length > 0));
  const menu = (e: MouseEvent) => messageMenu(e, m(), { reply: props.act.onReply, edit: (x) => props.act.onEdit(x), askDelete: () => setConfirmDel(true) }, props.act.serverId);
  const fail = (e: unknown) => toast((e as Error)?.message || "That didn't work.", true);
  const react = (emoji: string, on: boolean) => { if (on) markReacted(m().id, emoji); void b().react(m().channelId, m().id, emoji, on).catch(fail); };

  let editApi: ReturnType<typeof createEditor> | undefined;
  let editBox: HTMLDivElement | undefined;
  const [editSel, setEditSel] = createSignal<{ from: number; to: number } | null>(null);
  async function saveEdit() {
    const t = draft().trim();
    if (!t) { setConfirmDel(true); return; }
    if (t !== m().text) await b().edit(m().channelId, m().id, t).catch(fail);
    props.act.onEdit(null);
  }

  /**
   * Phones and tablets: a second tap on the message within a moment reacts with your double-tap emoji (again
   * removes it). Single taps aren't delayed; taps on links, pictures, names and buttons don't count.
   */
  let lastTap = 0;
  const canDouble = () => !props.editing && !m().pending && rules().canReact;
  // Your own reactions show straight away (the server's answer replaces this): reacting felt laggy while the chip
  // waited for the round trip.
  const [mineNow, setMineNow] = createSignal<Record<string, boolean>>({});
  const reactions = createMemo(() => {
    const me = b().me.id, want = mineNow();
    const list = (m().reactions ?? []).map((r) => (r.emoji in want && want[r.emoji] !== r.users.includes(me) ? { ...r, users: want[r.emoji] ? [...r.users, me] : r.users.filter((u) => u !== me) } : r)).filter((r) => r.users.length);
    for (const [k, on] of Object.entries(want)) if (on && !list.some((r) => r.emoji === k)) list.push({ emoji: k, users: [me] });
    return list;
  });
  // Once the server's copy agrees, the local one goes.
  createEffect(on(() => m().reactions, () => setMineNow((w) => {
    const me = b().me.id, left = Object.fromEntries(Object.entries(w).filter(([k, on]) => !!m().reactions?.find((r) => r.emoji === k)?.users.includes(me) !== on));
    return Object.keys(left).length === Object.keys(w).length ? w : left;
  }), { defer: true }));
  const quickReact = (x: number, y: number) => {
    getSelection()?.removeAllRanges(); // a double tap also selects a word on phones
    const key = doubleTapEmoji(), had = !!reactions().find((r) => r.emoji === key)?.users.includes(b().me.id);
    navigator.vibrate?.(10);
    if (!had) reactBurst(x, y, key);
    setMineNow((w) => ({ ...w, [key]: !had }));
    react(key, !had);
  };
  const doubleTap = (e: MouseEvent) => {
    if (!canDouble()) return;
    if ((e.target as HTMLElement).closest("a, button, video, input, textarea, .reactions, .msg-replies")) { lastTap = 0; return; }
    const now = Date.now();
    if (now - lastTap > 320) { lastTap = now; return; }
    lastTap = 0;
    quickReact(e.clientX, e.clientY);
  };
  /**
   * Pictures count too: a tap on one waits a moment for a second tap (two taps react, one opens the picture as
   * before). Runs before the picture's own tap handler, which only gets the single taps.
   */
  let picTimer: ReturnType<typeof setTimeout> | undefined, picTap = 0, passing = false;
  const picTaps = (el: HTMLElement) => {
    if (!MOBILE_UI) return;
    el.addEventListener("click", (e) => {
      const pic = (e.target as HTMLElement).closest<HTMLElement>("img.media, img.em-img, img.embed-img, .media img, .pic-grid img, .attachments img");
      if (!pic || passing || !canDouble() || pic.closest("a, button")) return;
      e.stopPropagation(); e.preventDefault();
      const now = Date.now();
      if (now - picTap < 320) { clearTimeout(picTimer); picTap = 0; quickReact(e.clientX, e.clientY); return; }
      picTap = now;
      picTimer = setTimeout(() => { picTap = 0; passing = true; pic.click(); passing = false; }, 260);
    }, true);
    onCleanup(() => clearTimeout(picTimer));
  };

  return (
    <Show when={!m().system} fallback={
      <div class="msg system" id={`msg-${m().id}`} data-kind={sysKind(m().systemType)}>
        <Icon name={sysIcon(m().systemType)} size={16} />
        <span class="sys-text"><SystemText text={m().system!} onProfile={props.act.onProfile} /></span>
        <time>{time(m().at)}</time>
      </div>
    }>
      <article class="msg" id={`msg-${m().id}`} classList={{ head: head(), tight: compact(), mentioned: !!m().mentionsMe, pending: !!m().pending, hl: !!props.highlight }}
        data-own={mine() || undefined} onContextMenu={(e) => { if (props.editing || m().pending) return; menu(e); }}
        ref={picTaps} onClick={(e) => { if (MOBILE_UI) doubleTap(e); }}
        onPointerEnter={(e) => {
          // The toolbar sits over the message's top edge; at the very top of the chat that's cut off, so it drops inside.
          const el = e.currentTarget, list = el.closest(".messages") ?? el.parentElement;
          const top = el.getBoundingClientRect().top - (list?.getBoundingClientRect().top ?? 0);
          el.classList.toggle("tools-in", top < 22);
        }}>
        <Show when={m().replyIds?.length}>
          <div class="msg-replies"><For each={m().replyIds}>{(id) => <ReplyPreview channelId={m().channelId} id={id} local={props.act.local} onJump={props.act.onJump} />}</For></div>
        </Show>
        <div class="msg-gutter">
          <Show when={head() && !compact()} fallback={<time class="gutter-time" title={stamp(m().at)}>{time(m().at)}</time>}>
            <button class="msg-av" onClick={() => props.act.onProfile(m().author)} aria-label={`${m().author.name}'s profile`}>
              <Avatar person={m().author} size={40} presence={false} />
            </button>
          </Show>
        </div>
        <div class="msg-body">
          <Show when={head() || compact()}>
            <header>
              <button class="msg-name" onClick={() => props.act.onProfile(m().author)} style={roleStyle(m().author.colour)}>
                <NameText person={m().author} fontOnly />
              </button>
              {/* Their top role's icon, like Stoat */}
              <Show when={m().author.roleIcon}>{(src) => <img class="role-icon" src={src()} alt="" />}</Show>
              {/* Their pronouns, in the same little pill as on their card */}
              <Show when={m().author.pronouns}>{(pr) => <span class="msg-pronouns" title="Pronouns">{pr()}</span>}</Show>
              <Show when={m().author.bot}><span class="tag">Bot</span></Show>
              <Show when={!compact()}><time title={stamp(m().at)}>{stamp(m().at)}</time></Show>
            </header>
          </Show>
          <Show when={props.editing} fallback={
            <Show when={m().text}>
              <Show when={!linkOnly()} fallback={<Show when={m().editedAt}><span class="edited" title={stamp(m().editedAt!)}>(edited)</span></Show>}>
                <div class="msg-text"><Markdown text={m().text} ctx={props.act.ctx} /><Show when={m().editedAt}><span class="edited" title={stamp(m().editedAt!)}>(edited)</span></Show></div>
              </Show>
            </Show>
          }>
            {/* The message box's own editor, so mentions and #channels show as chips instead of their ids.
                On phones it sits where the message box is, marked "Editing message". */}
            <div class="edit-box" ref={editBox} classList={{ "fmt-open": !!editSel() }}>
              <FormatBar ed={() => editApi} host={() => editBox} selection={editSel} />
              <div class="edit-head"><Icon name="pencil" size={14} /><span>Editing message</span><span class="grow" />
                <button class="icon-btn" aria-label="Cancel editing" onClick={() => props.act.onEdit(null)}><Icon name="close" size={16} /></button></div>
              <div class="edit-row">
                <div class="field-input editor edit-ed" ref={(host) => {
                  setDraft(m().text);
                  const ed = editApi = createEditor(host, {
                    text: m().text, placeholder: "", label: "Edit message", look: chipLookup(),
                    on: {
                      onKey: (e) => {
                        if (e.key === "Escape") { props.act.onEdit(null); return true; }
                        if (formatKey(e, editApi, editSel())) return true;
                        if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); void saveEdit(); return true; }
                        return false;
                      },
                      onChange: setDraft, onCaret: () => {}, onSelection: setEditSel, onPasteFiles: () => {},
                    },
                  });
                  queueMicrotask(() => { ed.focus(); ed.view.dispatch({ selection: { anchor: ed.text().length } }); });
                  onCleanup(() => ed.destroy());
                }} />
                <button type="button" class="icon-btn" aria-label="Emoji" title="Emoji" onClick={(e) => openEmojiPicker(e.currentTarget, ({ text: x }) => editApi?.insertAtCaret(x))}><Icon name="smile" size={20} /></button>
                <button class="btn small primary edit-save" onClick={() => void saveEdit()}>Save</button>
              </div>
              <small class="muted desk-only">Escape to <button class="link" onClick={() => props.act.onEdit(null)}>cancel</button>, Enter to <button class="link" onClick={() => void saveEdit()}>save</button></small>
            </div>
          </Show>
          <Show when={m().attachments?.length}>
            <div class="attachments">
              {/* Several pictures or videos sit together in one grid, like Discord; one on its own keeps its shape. */}
              <Show when={mediaOf(m()).length > 1} fallback={<For each={m().attachments}>{(a) => <AttachmentView a={a} m={m()} />}</For>}>
                <MediaGrid m={m()} />
                <For each={m().attachments!.filter((a) => !isMediaAtt(a))}>{(a) => <AttachmentView a={a} m={m()} />}</For>
              </Show>
            </div>
          </Show>
          <Show when={invites().length}><div class="embeds"><For each={invites()}>{(c) => <InviteCard code={c} />}</For></div></Show>
          <Show when={cards().length}>
            <div class="embeds"><For each={cards()}>{(c) => (
              <SpoilerCover on={c.spoiler}>{c.kind === "embed" ? <EmbedView e={c.e} /> : <SocialPreview url={c.url} fallback={c.fallback} />}</SpoilerCover>
            )}</For></div>
          </Show>
          <Show when={reactions().length}>
            <div class="reactions">
              <For each={reactions()}>{(r) => <ReactionChip r={r} mid={m().id} onToggle={(on) => { setMineNow((w) => ({ ...w, [r.emoji]: on })); react(r.emoji, on); }} onView={() => openReactions(m(), r.emoji)} />}</For>
              <button class="reaction add" aria-label="Add reaction" onClick={(e) => openEmojiPicker(e.currentTarget, ({ key }) => react(key, true))}><Icon name="smile-plus" size={16} /></button>
            </div>
          </Show>
          <Show when={m().failed}><small class="err">Couldn't send. Check your connection.</small></Show>
          <Show when={confirmDel()}>
            <DeleteDialog m={m()} ctx={props.act.ctx} onCancel={() => setConfirmDel(false)}
              onDelete={() => { setConfirmDel(false); props.act.onEdit(null); void b().remove(m().channelId, m().id).catch(fail); }} />
          </Show>
        </div>
        {/* Desktop only: on phones and tablets holding the message gives every option. */}
        <Show when={!MOBILE_UI && !m().pending && !props.editing}>
          <div class="msg-tools panel" role="toolbar" aria-label="Message actions">
            <Show when={rules().canSend}><button aria-label="Reply" title="Reply" onClick={() => props.act.onReply(m())}><Icon name="reply" size={18} /></button></Show>
            <Show when={rules().canReact}><button aria-label="Add reaction" title="Add reaction" onClick={(e) => openEmojiPicker(e.currentTarget, ({ key }) => react(key, true))}><Icon name="smile-plus" size={18} /></button></Show>
            <Show when={mine()}><button aria-label="Edit" title="Edit" onClick={() => props.act.onEdit(m())}><Icon name="pencil" size={18} /></button></Show>
            <Show when={mine() || rules().canManage}>
              <button aria-label="Delete" title="Delete (hold Shift to skip the question)" onClick={(e) => { if (e.shiftKey) void b().remove(m().channelId, m().id).catch(fail); else setConfirmDel(true); }}><Icon name="trash" size={18} /></button>
            </Show>
            <button aria-label="More" title="More" aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menu(new MouseEvent("contextmenu", { clientX: r.left - 200, clientY: r.bottom + 4 })); }}><Icon name="dots" size={18} /></button>
          </div>
        </Show>
      </article>
    </Show>
  );
}

/**
 * "Delete message?" like Discord's: a pop-up showing the message you're about to delete, Cancel and Delete. Enter
 * deletes, Escape cancels; on desktop, holding Shift when you click the bin skips it.
 */
function DeleteDialog(props: { m: Msg; ctx: MdCtx; onCancel(): void; onDelete(): void }) {
  useBack(props.onCancel);
  const keys = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); props.onCancel(); } if (e.key === "Enter") { e.preventDefault(); props.onDelete(); } };
  onMount(() => addEventListener("keydown", keys));
  onCleanup(() => removeEventListener("keydown", keys));
  return (
    <Portal>
      <div class="scrim del-scrim" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
        <div class="modal panel del-dialog" role="alertdialog" aria-label="Delete message">
          <h3>Delete message</h3>
          <p class="muted">Are you sure you want to delete this message?</p>
          <div class="del-preview">
            <Avatar person={props.m.author} size={36} presence={false} still />
            <div class="del-body">
              <div class="del-head"><NameText person={props.m.author} fontOnly /><time>{props.m.at.toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</time></div>
              <Show when={props.m.text} fallback={<span class="muted">{props.m.attachments?.length ? "An attachment" : "A message"}</span>}>
                <div class="del-text"><Markdown text={props.m.text} ctx={props.ctx} /></div>
              </Show>
            </div>
          </div>
          <Show when={!MOBILE_UI}><p class="del-tip"><b>Tip:</b> hold Shift when you click the bin to delete straight away.</p></Show>
          <div class="dialog-actions">
            <button class="btn" onClick={props.onCancel}>Cancel</button>
            <button class="btn danger-fill" onClick={props.onDelete} ref={(el) => queueMicrotask(() => el.focus())}>Delete</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
