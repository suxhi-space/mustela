import { createEffect, createMemo, createResource, createSignal, For, Match, on, onCleanup, onMount, Show, Switch, type JSX } from "solid-js";
import { useBack } from "./back";
import type { Activity } from "../lib/cloud";
import { activity, elapsed, verb } from "./activity";
import { currentServer, openProfileEditor, profileView, setProfileView } from "./nav";
import { attempt, openMenu, toast } from "./menu";
import { userMenu } from "./menus";
import { call, joinCall } from "./call/state";
import type { Person } from "../lib/backend/types";
import { hex, mix, textOn, contrast } from "../lib/color";
import { CANONICAL_HEIGHT, CANONICAL_WIDTH, markerHeight } from "../lib/marker/codec";
import type { ProfileConfig } from "../lib/profile/model";
import { createAnim } from "./anim";
import { Avatar, createPerson, NameText } from "./Avatar";
import { createProfileInfo, createSize, refreshProfile } from "./hooks";
import { EffectCanvas, FrameCanvas } from "./Paint";
import { backend } from "./store";
import { Icon } from "./icons";
import { RatingBadge } from "./controls";
import { Markdown, TextWithEmoji } from "./chat/Markdown";
import { ratingOf } from "./anim";

const STRIP = markerHeight(CANONICAL_WIDTH);
const PRESENCE_LABEL: Record<string, string> = { online: "Online", idle: "Idle", focus: "Focus", busy: "Do Not Disturb", invisible: "Invisible", offline: "Offline" };

/**
 * The full profile card: banner, avatar with decoration, name, badges, bio,
 * with the person's effect drawn over it and their frame around it.
 * `profile` is passed directly for the live preview in settings.
 */
export function ProfileCard(props: { person: Person; profile?: ProfileConfig | null; bio?: string; banner?: string; children?: JSX.Element; showRating?: boolean; marked?: boolean; compact?: boolean }) {
  const { profile, info, ref: seenRef } = createPerson(() => props.person, () => props.profile);
  const [size, sizeRef] = createSize();
  const fxAnim = createAnim(profile, "effect");
  const frameAnim = createAnim(profile, "frame");
  const theme = createMemo(() => {
    const t = profile()?.theme;
    if (!t) return null;
    const bg = t.primary, fg = textOn(bg);
    return { "--pc-bg": hex(bg), "--pc-bg2": hex(mix(bg, t.accent, 0.55)), "--pc-fg": hex(fg), "--pc-accent": hex(t.accent),
      "--pc-sub": hex(mix(fg, bg, contrast(fg, bg) > 8 ? 0.35 : 0.2)) } as Record<string, string>;
  });
  const bannerUrl = () => props.banner ?? info()?.bannerUrl;
  const bio = () => props.bio ?? info()?.bio;
  const hasMarker = () => props.marked ?? (profile() !== null && !!info()?.bannerUrl); // our strip is in the bottom rows
  /**
   * Taller banners (960×480: the picture is the top 960×448, the strip below) show the picture's
   * middle 3:1 band, so Stoat's centred crop and ours land on the same part. `null`: a 3:1 banner.
   */
  const [tallPos, setTallPos] = createSignal<string | null>(null);
  const tallBanner = () => tallPos() !== null;
  const placeBanner = (img: HTMLImageElement) => {
    const w = img.naturalWidth || 1, h = img.naturalHeight;
    if (h / w <= 0.4) return setTallPos(null);
    const band = w / 3, picture = Math.min(h, (448 / 960) * w);
    setTallPos(`center ${Math.max(0, Math.min(100, (((picture - band) / 2) / Math.max(1, h - band)) * 100)).toFixed(1)}%`);
  };

  // Activity: yours comes straight from this app; other people's from their sync servers.
  const voice = () => (backend()?.me.id === props.person.id ? null : backend()?.voiceOf(props.person.id) ?? null);
  const act = () => (backend()?.me.id === props.person.id ? activity.current() : info()?.activity) ?? null;
  const [more, setMore] = createSignal(false);
  const long = () => (bio()?.length ?? 0) > 240 || (bio()?.split("\n").length ?? 0) > 5;
  const presence = () => (props.person.online ? props.person.presence ?? "online" : "offline");

  return (
    <article class="pcard" classList={{ themed: !!theme(), compact: !!props.compact }} style={theme() ?? {}} ref={(el) => { seenRef(el); sizeRef(el); }}>
      <div class="pc-banner" classList={{ top: tallBanner() }} style={hasMarker() && !tallBanner() ? { "aspect-ratio": `${CANONICAL_WIDTH} / ${CANONICAL_HEIGHT - STRIP}` } : {}}>
        <Show when={bannerUrl()} fallback={<div class="pc-banner-fill" />}>
          <img src={bannerUrl()} alt="" loading="lazy" style={tallPos() ? { "object-position": tallPos()! } : {}} onLoad={(e) => placeBanner(e.currentTarget)} />
        </Show>

      </div>
      <div class="pc-head">
        <div class="pc-avatar"><Avatar person={props.person} size={84} profile={profile()} presence={false} /><span class={`pc-dot pdot p-${presence()}`} title={PRESENCE_LABEL[presence()]} /></div>
        <Show when={props.person.online !== undefined || props.person.status}>
          {/* Custom status in a bubble beside the avatar (like Discord); without one, the presence itself */}
          <span class="pc-bubble" title={props.person.status ?? PRESENCE_LABEL[presence()]}>
            <span class={`pdot p-${presence()}`} /><TextWithEmoji v={props.person.status || (PRESENCE_LABEL[presence()] ?? "Online")} />
          </span>
        </Show>
      </div>
      <div class="pc-body">
        <h2 class="pc-name"><NameText person={props.person} profile={profile()} /></h2>
        <div class="pc-meta">
          <Show when={props.person.username}><span>{props.person.username}{props.person.discriminator ? `#${props.person.discriminator}` : ""}</span></Show>
          <Show when={props.person.bot}><span class="tag">Bot</span></Show>
          <For each={props.person.badges}>{(b) => <span class="pc-badge">{b}</span>}</For>
        </div>
        <Show when={voice()}>{(v) => (
          <section class="pc-section pc-voice">
            <h3 class="label">{v().screen ? "Streaming in voice" : "In voice"}</h3>
            <div class="pv-row">
              <span class="pv-ic" classList={{ live: v().screen }}><Icon name={v().screen ? "screen" : "speaker"} size={18} /></span>
              <span class="pv-text"><strong>{v().channelName}</strong><Show when={v().serverName}><small>{v().serverName}</small></Show></span>
              <Show when={v().screen}><span class="live-pill">LIVE</span></Show>
              <Show when={!(call.active() && call.channel()?.id === v().channelId)}>
                <button class="btn small" onClick={() => void joinCall({ id: v().channelId, name: v().channelName, kind: "voice" })}>Join</button>
              </Show>
            </div>
          </section>
        )}</Show>
        <Show when={act()}>{(a) => <ActivityCard a={a()} />}</Show>
        <Show when={bio()}>
          <section class="pc-section">
            <h3 class="label">About me</h3>
            <Markdown text={bio()!} class={`pc-bio ${long() && !more() ? "clamp" : ""}`} />
            <Show when={long()}><button class="link pc-more" onClick={() => setMore(!more())}>{more() ? "Show less" : "Read more"}</button></Show>
          </section>
        </Show>
        <Show when={props.showRating && profile()}>
          <section class="pc-section">
            <h3 class="label">Performance</h3>
            <RatingBadge rating={ratingOf(profile()!).total.rating} label={ratingOf(profile()!).total.label} />
          </section>
        </Show>
        {props.children}
      </div>
      <Show when={profile()?.effect.preset && size().w > 0}>
        <EffectCanvas slot={() => profile()!.effect} w={size().w} h={size().h} animate={fxAnim()} />
      </Show>
      <Show when={profile()?.frame.preset && size().w > 0}>
        <FrameCanvas slot={() => profile()!.frame} w={size().w} h={size().h} animate={frameAnim()} radius={18} />
      </Show>
    </article>
  );
}

/** Inside a server: "Member since" and their roles, which you can add or remove if you're allowed (like Discord). */
function ServerSection(props: { person: Person; serverId: string }) {
  const b = () => backend()!;
  const [since] = createResource(() => [props.serverId, props.person.id] as const, ([s, u]) => b().memberSince(s, u).catch(() => undefined));
  const [mine, { refetch }] = createResource(() => [props.serverId, props.person.id] as const, ([s, u]) => b().memberRoles(s, u).catch(() => [] as string[]));
  const roles = () => b().roles(props.serverId);
  const can = () => !!b().serverInfo(props.serverId)?.perms.manageRoles;
  const has = () => roles().filter((r) => (mine() ?? []).includes(r.id)).sort((a, c) => a.rank - c.rank);
  const setRoles = (ids: string[]) => void attempt(() => b().setMemberRoles(props.serverId, props.person.id, ids)).then(() => setTimeout(() => void refetch(), 300));
  const addMenu = (e: MouseEvent) => openMenu(e, roles().filter((r) => !(mine() ?? []).includes(r.id)).map((r) => ({ label: r.name, onSelect: () => setRoles([...(mine() ?? []), r.id]) })));
  const serverName = () => b().serverInfo(props.serverId)?.name;
  return (
    <Show when={since() || has().length || can()}>
      <section class="pc-section">
        <Show when={since()}>
          <h3 class="label">Member since</h3>
          <p class="pc-since"><span class="mini-orb tiny">{serverName()?.slice(0, 1)}</span>{since()!.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}</p>
        </Show>
        <Show when={has().length || can()}>
          <h3 class="label">Roles</h3>
          <div class="pc-roles">
            <For each={has()}>{(r) => (
              <span class="role-chip" style={{ "--role": r.colour && !/gradient/.test(r.colour) ? r.colour : undefined }}>
                <Show when={can()} fallback={<i />}><button class="rc-x" aria-label={`Remove ${r.name}`} title={`Remove ${r.name}`} onClick={() => setRoles((mine() ?? []).filter((x) => x !== r.id))}><i /></button></Show>{r.name}
              </span>
            )}</For>
            <Show when={can() && roles().length > has().length}><button class="role-chip add" aria-label="Add role" title="Add role" onClick={(e) => addMenu(e)}><Icon name="plus" size={13} /></button></Show>
          </div>
        </Show>
      </section>
    </Show>
  );
}

/** "Playing …" with art, details and a running timer. */
export function ActivityCard(props: { a: Activity; compact?: boolean }) {
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));
  return (
    <section class="pc-section pc-activity" classList={{ compact: !!props.compact }}>
      <h3 class="label">{verb(props.a.kind)}</h3>
      <div class="pa-row">
        <Show when={props.a.image} fallback={<span class="pa-img blank"><Icon name="gamepad" size={22} /></span>}><img class="pa-img" src={props.a.image} alt="" /></Show>
        <span class="pa-text">
          <strong>{props.a.name}</strong>
          <Show when={props.a.details}><span>{props.a.details}</span></Show>
          <Show when={props.a.state}><span>{props.a.state}</span></Show>
          <Show when={props.a.startedAt}><span class="pa-time">{elapsed(props.a.startedAt, now())} elapsed</span></Show>
        </span>
      </div>
    </section>
  );
}

/** Friend button that matches where you stand with them. */
function FriendButton(props: { person: Person; compact?: boolean }) {
  const [rel, setRel] = createSignal(backend()?.person(props.person.id).relation ?? props.person.relation ?? "none");
  const [busy, setBusy] = createSignal(false);
  const act = async (a: "add" | "accept" | "remove" | "unblock", next: typeof rel extends () => infer R ? R : never) => {
    setBusy(true);
    try { await backend()!.friendAction(props.person.id, a); setRel(next); } catch (e) { toast(e instanceof Error && e.message ? e.message : "That didn't work.", true); }
    finally { setBusy(false); }
  };
  return (
    <Switch>
      <Match when={rel() === "friend"}><button class="icon-btn pc-act" title="Friends" aria-label="Friends" onClick={(e) => openMenu(e.currentTarget, [{ label: "Remove friend", icon: "user-x", danger: true, onSelect: () => act("remove", "none") }])}><Icon name="friends" size={18} /></button></Match>
      <Match when={rel() === "incoming"}><button class="btn small primary" disabled={busy()} onClick={() => void act("accept", "friend")}>Accept request</button></Match>
      <Match when={rel() === "outgoing"}><button class="btn small" disabled={busy()} title="Cancel request" onClick={() => void act("remove", "none")}>Request sent</button></Match>
      <Match when={rel() === "blocked"}><button class="btn small" disabled={busy()} onClick={() => void act("unblock", "none")}>Unblock</button></Match>
      <Match when={rel() === "none"}><button class={props.compact ? "icon-btn pc-act" : "btn small"} title="Add friend" aria-label="Add friend" disabled={busy()} onClick={() => void act("add", "outgoing")}><Icon name="user-plus" size={18} />{props.compact ? "" : "Add friend"}</button></Match>
    </Switch>
  );
}

/** "Message @name" at the bottom of a profile popout, like Discord's. */
function QuickMessage(props: { person: Person; onSent(channelId: string): void }) {
  const [text, setText] = createSignal("");
  async function send() {
    const t = text().trim(); if (!t) return;
    try { const cid = await backend()!.openDM(props.person.id); await backend()!.send(cid, { text: t }); setText(""); props.onSent(cid); }
    catch { toast("Couldn't send that.", true); }
  }
  return (
    <form class="pc-quick" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <input value={text()} maxLength={2000} placeholder={`Message @${props.person.username ?? props.person.name}`} aria-label={`Message ${props.person.name}`} onInput={(e) => setText(e.currentTarget.value)} />
    </form>
  );
}

/** A profile next to where you clicked (like Discord's popout), or the full profile with tabs. */
export function ProfileView(props: { onMessage(channelId: string): void }) {
  return (
    <Show when={profileView()}>{(v) => (
      <Show when={!v().full} fallback={<ProfileFull person={v().person} onClose={() => setProfileView(null)} onMessage={props.onMessage} />}>
        <ProfilePopout person={v().person} x={v().x} y={v().y} onClose={() => setProfileView(null)} onMessage={props.onMessage} />
      </Show>
    )}</Show>
  );
}

function ProfilePopout(props: { person: Person; x: number; y: number; onClose(): void; onMessage(cid: string): void }) {
  let el!: HTMLDivElement;
  useBack(() => props.onClose());
  void refreshProfile(props.person.id);
  const self = () => backend()?.me.id === props.person.id;
  const [pos, setPos] = createSignal({ left: props.x + 16, top: props.y - 40 });
  const place = () => {
    const r = el.getBoundingClientRect(), W = 340;
    let left = props.x + 16;
    if (left + W > innerWidth - 10) left = props.x - W - 16;
    if (left < 10) left = Math.max(10, Math.min(innerWidth - W - 10, props.x - W / 2));
    const top = Math.max(10, Math.min(innerHeight - r.height - 10, props.y - 60));
    setPos({ left, top });
  };
  // The card grows as its voice status and mutuals arrive, so keep it on screen.
  onMount(() => { place(); const ro = new ResizeObserver(place); ro.observe(el); onCleanup(() => ro.disconnect()); });
  const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
  addEventListener("keydown", esc); onCleanup(() => removeEventListener("keydown", esc));
  async function message() {
    try { props.onMessage(await backend()!.openDM(props.person.id)); props.onClose(); } catch { toast("Couldn't open a conversation.", true); }
  }
  return (
    <div class="pop-scrim clear" onClick={props.onClose} onContextMenu={(e) => { e.preventDefault(); props.onClose(); }}>
      <div ref={el} class="profile-pop" role="dialog" aria-label={`${props.person.name}'s profile`} style={{ left: `${pos().left}px`, top: `${pos().top}px` }}
        onClick={(e) => {
          e.stopPropagation();
          // Clicking their picture or name opens the full profile, like Discord.
          if ((e.target as HTMLElement).closest(".pc-avatar, .pc-name")) setProfileView({ person: props.person, full: true, x: 0, y: 0 });
        }}>
        <ProfileCard person={props.person} compact>
          <Show when={!self()} fallback={
            <div class="pc-actions"><button class="btn small primary" onClick={() => { props.onClose(); openProfileEditor(); }}><Icon name="pencil" size={15} />Edit profile</button></div>
          }>
            <Show when={!props.person.bot}><QuickMessage person={props.person} onSent={(cid) => { props.onClose(); props.onMessage(cid); }} /></Show>
          </Show>
          <Show when={currentServer()}>{(sid) => <ServerSection person={props.person} serverId={sid()} />}</Show>
        </ProfileCard>
        <Show when={!self()}>
          <div class="pc-toprow">
            <Show when={!props.person.bot}><button class="icon-btn pc-act" title="Message" aria-label="Message" onClick={() => void message()}><Icon name="chat" size={18} /></button></Show>
            <Show when={!props.person.bot}><FriendButton person={props.person} compact /></Show>
            <button class="icon-btn pc-act" title="More" aria-label="More" onClick={(e) => userMenu(e as unknown as MouseEvent, props.person)}><Icon name="dots" size={18} /></button>
          </div>
        </Show>
      </div>
    </div>
  );
}

/** The full profile (Discord's "View full profile"): the card, and tabs for activity and what you share. */
function ProfileFull(props: { person: Person; onClose(): void; onMessage(cid: string): void }) {
  const self = () => backend()?.me.id === props.person.id;
  useBack(() => props.onClose());
  void refreshProfile(props.person.id);
  const [tab, setTab] = createSignal<"activity" | "friends" | "servers">("activity");
  const [mutual] = createResource(() => props.person.id, (id) => backend()!.mutual(id));
  const info = createProfileInfo(() => props.person.id);
  const act = () => (self() ? activity.current() : info()?.activity) ?? null;
  const voice = () => (self() ? null : backend()?.voiceOf(props.person.id) ?? null);
  async function message() {
    try { props.onMessage(await backend()!.openDM(props.person.id)); props.onClose(); } catch { toast("Couldn't open a conversation.", true); }
  }
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <div class="modal profile-full" role="dialog" aria-label={`${props.person.name}'s profile`}>
        <button class="icon-btn close" onClick={props.onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        <div class="pf-card">
          <ProfileCard person={props.person}>
            <Show when={currentServer()}>{(sid) => <ServerSection person={props.person} serverId={sid()} />}</Show>
            <div class="pc-actions">
              <Show when={!self()} fallback={<button class="btn small primary" onClick={() => { props.onClose(); openProfileEditor(); }}><Icon name="pencil" size={15} />Edit profile</button>}>
                <Show when={!props.person.bot}><button class="btn small primary" onClick={() => void message()}><Icon name="chat" size={15} />Message</button><FriendButton person={props.person} /></Show>
              </Show>
            </div>
          </ProfileCard>
        </div>
        <div class="pf-side">
          <nav class="pf-tabs" role="tablist">
            <button role="tab" aria-selected={tab() === "activity"} classList={{ on: tab() === "activity" }} onClick={() => setTab("activity")}>Activity</button>
            <Show when={!self()}>
              <button role="tab" aria-selected={tab() === "friends"} classList={{ on: tab() === "friends" }} onClick={() => setTab("friends")}>{mutual()?.friends.length ?? ""} Mutual friends</button>
              <button role="tab" aria-selected={tab() === "servers"} classList={{ on: tab() === "servers" }} onClick={() => setTab("servers")}>{mutual()?.servers.length ?? ""} Mutual servers</button>
            </Show>
          </nav>
          <div class="pf-body">
            <Switch>
              <Match when={tab() === "activity"}>
                <Show when={voice() || act()} fallback={<p class="empty">Nothing going on right now.</p>}>
                  <Show when={voice()}>{(v) => (
                    <div class="pf-item"><span class="pv-ic" classList={{ live: v().screen }}><Icon name={v().screen ? "screen" : "speaker"} size={20} /></span>
                      <span class="pv-text"><strong>{v().screen ? "Streaming in " : "In "}{v().channelName}</strong><Show when={v().serverName}><small>{v().serverName}</small></Show></span>
                      <button class="btn small" onClick={() => { props.onClose(); void joinCall({ id: v().channelId, name: v().channelName, kind: "voice" }); }}>Join</button></div>
                  )}</Show>
                  <Show when={act()}>{(a) => <ActivityCard a={a()} />}</Show>
                </Show>
              </Match>
              <Match when={tab() === "friends"}>
                <For each={mutual()?.friends} fallback={<p class="empty">{mutual.loading ? "Loading…" : "No friends in common."}</p>}>{(f) => (
                  <button class="pf-item tap" onClick={() => setProfileView({ person: f, full: true, x: 0, y: 0 })}><Avatar person={f} size={36} /><span class="pv-text"><strong>{f.name}</strong><Show when={f.status}><small>{f.status}</small></Show></span></button>
                )}</For>
              </Match>
              <Match when={tab() === "servers"}>
                <For each={mutual()?.servers} fallback={<p class="empty">{mutual.loading ? "Loading…" : "No servers in common."}</p>}>{(sv) => (
                  <div class="pf-item"><span class="mini-orb big">{sv.iconUrl ? <img src={sv.iconUrl} alt="" /> : sv.name.slice(0, 2)}</span><span class="pv-text"><strong>{sv.name}</strong></span></div>
                )}</For>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Beside a DM, like Discord: their card, what you share, and a way into the full profile. */
export function DmProfile(props: { person: Person }) {
  createEffect(on(() => props.person.id, (id) => void refreshProfile(id)));
  const [mutual] = createResource(() => props.person.id, (id) => backend()!.mutual(id));
  const [openList, setOpenList] = createSignal<"servers" | "friends" | null>(null);
  const toggle = (k: "servers" | "friends") => setOpenList(openList() === k ? null : k);
  return (
    <aside class="dm-profile" aria-label={`${props.person.name}'s profile`}>
      <ProfileCard person={props.person}>
        <div class="dmp-lists">
          <button class="dmp-row" aria-expanded={openList() === "servers"} onClick={() => toggle("servers")}>
            <span>Mutual servers — {mutual()?.servers.length ?? "…"}</span><Icon name="right" size={14} class={openList() === "servers" ? "rot90" : ""} />
          </button>
          <Show when={openList() === "servers"}>
            <For each={mutual()?.servers} fallback={<p class="empty small">No servers in common.</p>}>{(sv) => (
              <div class="dmp-item"><span class="mini-orb">{sv.iconUrl ? <img src={sv.iconUrl} alt="" /> : sv.name.slice(0, 2)}</span><span>{sv.name}</span></div>
            )}</For>
          </Show>
          <button class="dmp-row" aria-expanded={openList() === "friends"} onClick={() => toggle("friends")}>
            <span>Mutual friends — {mutual()?.friends.length ?? "…"}</span><Icon name="right" size={14} class={openList() === "friends" ? "rot90" : ""} />
          </button>
          <Show when={openList() === "friends"}>
            <For each={mutual()?.friends} fallback={<p class="empty small">No friends in common.</p>}>{(f) => (
              <button class="dmp-item tap" onClick={(e) => setProfileView({ person: f, full: false, x: e.clientX, y: e.clientY })}><Avatar person={f} size={24} /><span>{f.name}</span></button>
            )}</For>
          </Show>
        </div>
        <button class="btn dmp-full" onClick={() => setProfileView({ person: props.person, full: true, x: 0, y: 0 })}><Icon name="user" size={16} />View full profile</button>
      </ProfileCard>
    </aside>
  );
}
