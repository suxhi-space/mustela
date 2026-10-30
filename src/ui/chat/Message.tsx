import { toast } from "../menu";
import { useAutoplay } from "../autoplay";
import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import type { ChannelRules, Attachment, Embed, Msg, Person, Reaction } from "../../lib/backend/types";
import { plain } from "../../lib/markdown";
import { fmtStamp, fmtTime } from "../../lib/time";
import { Avatar, NameText } from "../Avatar";
import { Icon } from "../icons";
import { backend, device } from "../store";
import { Markdown, type MdCtx } from "./Markdown";
import { isFav, openEmojiPicker, openLightbox, toggleFav } from "./overlays";
import { messageMenu } from "../menus";
import { copy } from "../menu";
import { UEmoji } from "./UEmoji";

const time = (d: Date) => fmtTime(d);
const stamp = (d: Date) => fmtStamp(d);
const size = (n?: number) => (n === undefined ? "" : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** Stoat role colours can be plain colours or CSS gradients. */
export const roleStyle = (c?: string): Record<string, string> =>
  !c || /url\(|image\(|var\(|expression|[;{}<>]/i.test(c) ? {} : /gradient\(/.test(c) ? { "background-image": c, "-webkit-background-clip": "text", "background-clip": "text", color: "transparent" } : { color: c };
const isCustom = (e: string) => /^[0-9A-Z]{26}$/.test(e);

/** Same author within 5 minutes, no reply, no system message: drawn as a continuation. */
export const continues = (prev: Msg | undefined, m: Msg) =>
  !!prev && !prev.system && !m.system && !m.replyIds?.length && prev.author.id === m.author.id && prev.author.name === m.author.name &&
  m.at.getTime() - prev.at.getTime() < 5 * 60_000 && prev.at.toDateString() === m.at.toDateString();

function ReactionChip(props: { r: Reaction; onToggle(on: boolean): void }) {
  const me = () => props.r.users.includes(backend()!.me.id);
  const who = () => props.r.users.slice(0, 6).map((u) => backend()!.person(u).name).join(", ") + (props.r.users.length > 6 ? ` and ${props.r.users.length - 6} more` : "");
  return (
    <button class="reaction" classList={{ on: me() }} aria-pressed={me()} title={who()} onClick={() => props.onToggle(!me())}>
      <Show when={isCustom(props.r.emoji)} fallback={<span class="re" data-emoji={props.r.emoji}><UEmoji e={props.r.emoji} /></span>}>
        <img class="cemoji" data-emoji-id={props.r.emoji} src={backend()!.emojiUrl(props.r.emoji)} alt="" />
      </Show>
      <span class="rc">{props.r.users.length}</span>
    </button>
  );
}

function AttachmentView(props: { a: Attachment }) {
  const [revealed, setRevealed] = createSignal(!props.a.spoiler);
  const dims = () => {
    const w = props.a.width ?? 400, h = props.a.height ?? 300;
    const s = Math.min(1, 400 / w, 300 / h);
    return { width: `${Math.round(w * s)}px`, "aspect-ratio": `${w} / ${h}` };
  };
  return (
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
        <Show when={props.a.type === "image"} fallback={<video controls preload="metadata" src={props.a.url} poster={props.a.previewUrl} />}>
          <img src={props.a.previewUrl ?? props.a.url} alt={props.a.name} loading="lazy" onClick={() => (revealed() ? openLightbox(props.a.url, props.a.name) : setRevealed(true))} />
        </Show>
        <Show when={!revealed()}><button class="spoil-cover" onClick={() => setRevealed(true)}>Spoiler</button></Show>
      </div>
    </Show>
  );
}

/** A GIF plays like a GIF: looping, silent, no controls. Star it to keep it in your favorites. */
function GifEmbed(props: { e: Embed }) {
  const src = () => props.e.video?.url ?? props.e.image?.url ?? "";
  const w = () => props.e.video?.width ?? props.e.image?.width ?? 300, h = () => props.e.video?.height ?? props.e.image?.height ?? 200;
  const fav = () => ({ url: props.e.url ?? src(), preview: src(), w: w(), h: h() });
  const scale = () => Math.min(1, 320 / w(), 280 / h());
  const play = useAutoplay();
  return (
    <div class="media gif" style={{ width: `${Math.round(w() * scale())}px`, "aspect-ratio": `${w()} / ${h()}` }}>
      <Show when={props.e.video} fallback={<img src={src()} alt="GIF" loading="lazy" />}>
        <video ref={play} src={src()} muted playsinline preload="metadata" aria-label="GIF" />
      </Show>
      <button class="gif-star" classList={{ on: isFav(fav().url) }} aria-pressed={isFav(fav().url)} aria-label={isFav(fav().url) ? "Remove from favorite GIFs" : "Add to favorite GIFs"}
        title={isFav(fav().url) ? "Remove from favorites" : "Add to favorites"} onClick={() => toggleFav(fav())}><Icon name="star" size={16} /></button>
    </div>
  );
}

const SPECIAL_LABEL: Record<string, string> = { YouTube: "Watch on YouTube", Twitch: "Watch on Twitch", Spotify: "Open in Spotify", Soundcloud: "Listen on SoundCloud", Bandcamp: "Listen on Bandcamp", AppleMusic: "Open in Apple Music", Streamable: "Watch on Streamable", Lightspeed: "Watch on Lightspeed" };

function EmbedView(props: { e: Embed }) {
  const e = () => props.e;
  return (
    <Show when={!e().gif} fallback={<GifEmbed e={e()} />}>
      <Show when={e().kind === "website" || e().kind === "text"} fallback={
        <Show when={e().image} fallback={<Show when={e().video}><video class="media" controls preload="metadata" src={e().video!.url} /></Show>}>
          <img class="media embed-img" src={e().image!.url} alt="" loading="lazy" onClick={() => openLightbox(e().image!.url, e().url ?? "image")} />
        </Show>
      }>
        <div class="embed panel-inset" style={e().colour && /^#[0-9a-f]{3,8}$/i.test(e().colour!) ? { "--embed": e().colour } : {}}>
          <Show when={e().siteName}><div class="em-site"><Show when={e().iconUrl}><img src={e().iconUrl} alt="" /></Show>{e().siteName}</div></Show>
          <Show when={e().title}>
            <Show when={e().url} fallback={<div class="em-title">{e().title}</div>}>
              <a class="em-title" href={e().url} target="_blank" rel="noopener noreferrer nofollow">{e().title}</a>
            </Show>
          </Show>
          <Show when={e().description}><div class="em-desc">{e().description!.slice(0, 350)}</div></Show>
          <Show when={e().image && e().kind === "website"}>
            <Show when={e().special && e().url} fallback={<img class="em-img" src={e().image!.url} alt="" loading="lazy" onClick={() => openLightbox(e().image!.url, e().title ?? "image")} />}>
              <a class="em-player" href={e().url} target="_blank" rel="noopener noreferrer nofollow" aria-label={SPECIAL_LABEL[e().special!.type] ?? "Open link"}>
                <img class="em-img" src={e().image!.url} alt="" loading="lazy" />
                <span class="em-play"><Icon name="play" size={22} /></span>
              </a>
            </Show>
          </Show>
        </div>
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
          <NameText person={r().author} class="rr-name" />
          <span class="rr-text">{plain(r().text, { user: (id) => backend()!.person(id).name, channel: (id) => backend()!.channelName(id) }) || (r().attachments?.length ? "Sent an attachment" : "")}</span>
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
  const menu = (e: MouseEvent) => messageMenu(e, m(), { reply: props.act.onReply, edit: (x) => props.act.onEdit(x), askDelete: () => setConfirmDel(true) }, props.act.serverId);
  const fail = (e: unknown) => toast((e as Error)?.message || "That didn't work.", true);
  const react = (emoji: string, on: boolean) => void b().react(m().channelId, m().id, emoji, on).catch(fail);

  async function saveEdit() {
    const t = draft().trim();
    if (!t) { setConfirmDel(true); return; }
    if (t !== m().text) await b().edit(m().channelId, m().id, t).catch(fail);
    props.act.onEdit(null);
  }

  return (
    <Show when={!m().system} fallback={
      <div class="msg system" id={`msg-${m().id}`}><Icon name="arrow-in" size={16} /><span>{m().system}</span><time>{time(m().at)}</time></div>
    }>
      <article class="msg" id={`msg-${m().id}`} classList={{ head: head(), tight: compact(), mentioned: !!m().mentionsMe, pending: !!m().pending, hl: !!props.highlight }}
        data-own={mine() || undefined} onContextMenu={(e) => { if (props.editing || m().pending) return; menu(e); }}
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
                <NameText person={m().author} />
              </button>
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
            <div class="edit-box">
              <textarea class="field-input" value={m().text} ref={(el) => { setDraft(m().text); queueMicrotask(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }}
                onInput={(e) => setDraft(e.currentTarget.value)} aria-label="Edit message"
                onKeyDown={(e) => { if (e.key === "Escape") props.act.onEdit(null); else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void saveEdit(); } }} />
              <small class="muted">Escape to <button class="link" onClick={() => props.act.onEdit(null)}>cancel</button>, Enter to <button class="link" onClick={() => void saveEdit()}>save</button></small>
            </div>
          </Show>
          <Show when={m().attachments?.length}><div class="attachments"><For each={m().attachments}>{(a) => <AttachmentView a={a} />}</For></div></Show>
          <Show when={invites().length}><div class="embeds"><For each={invites()}>{(c) => <InviteCard code={c} />}</For></div></Show>
          <Show when={m().embeds?.length}><div class="embeds"><For each={m().embeds}>{(e) => <EmbedView e={e} />}</For></div></Show>
          <Show when={m().reactions?.length}>
            <div class="reactions">
              <For each={m().reactions}>{(r) => <ReactionChip r={r} onToggle={(on) => react(r.emoji, on)} />}</For>
              <button class="reaction add" aria-label="Add reaction" onClick={(e) => openEmojiPicker(e.currentTarget, ({ key }) => react(key, true))}><Icon name="smile-plus" size={16} /></button>
            </div>
          </Show>
          <Show when={m().failed}><small class="err">Couldn't send. Check your connection.</small></Show>
          <Show when={confirmDel()}>
            <div class="confirm panel-inset" role="alertdialog" aria-label="Delete message">
              <span>Delete this message?</span>
              <button class="btn small danger-fill" onClick={() => { setConfirmDel(false); props.act.onEdit(null); void b().remove(m().channelId, m().id).catch(fail); }}>Delete</button>
              <button class="btn small" onClick={() => setConfirmDel(false)}>Cancel</button>
            </div>
          </Show>
        </div>
        <Show when={!m().pending && !props.editing}>
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
