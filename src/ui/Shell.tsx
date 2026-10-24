import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { ChannelInfo, Person, Space } from "../lib/backend/types";
import { plain } from "../lib/markdown";
import { notify } from "../lib/notify";
import { AccountMenu } from "./Accounts";
import { Avatar } from "./Avatar";
import { CallPanel } from "./call/CallPanel";
import { call } from "./call/state";
import { Chat } from "./Chat";
import { EmojiPicker, Lightbox } from "./chat/overlays";
import { Friends, JoinServer } from "./Friends";
import { Icon } from "./icons";
import { Members } from "./Members";
import { ProfileModal } from "./Profile";
import { Settings } from "./Settings";
import { backend, bumpMe, device, meNow, settings, syncState, updateDevice } from "./store";
import { Voice } from "./Voice";

const STATUS: Record<string, string> = { synced: "Synced", syncing: "Syncing…", error: "Sync paused", local: "On this device" };

/** Groups a server's ordered channels into their categories, keeping order. */
function byCategory(chs: ChannelInfo[]) {
  const out: { title?: string; channels: ChannelInfo[] }[] = [];
  for (const c of chs) {
    const last = out[out.length - 1];
    if (last && last.title === c.category) last.channels.push(c);
    else out.push({ title: c.category, channels: [c] });
  }
  return out;
}

export function Shell() {
  const [spaces, { refetch }] = createResource(() => backend(), (b) => b.spaces());
  const [spaceId, setSpaceId] = createSignal<string>("home");
  const [channelId, setChannelId] = createSignal<string | undefined>();
  const [view, setView] = createSignal<"nav" | "chat">("nav");
  const [menu, setMenu] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [profile, setProfile] = createSignal<Person | null>(null);
  const [sheetMembers, setSheetMembers] = createSignal(false);
  const [joining, setJoining] = createSignal(false);

  const space = createMemo<Space | undefined>(() => spaces()?.find((s) => s.id === spaceId()) ?? spaces()?.[0]);
  /** Home with nothing picked shows Friends, like Stoat. Servers fall back to their first text channel. */
  const channel = createMemo<ChannelInfo | undefined>(() => {
    const s = space();
    if (!s) return undefined;
    const picked = s.channels.find((c) => c.id === channelId());
    if (picked || s.home) return picked;
    return s.channels.find((c) => c.kind !== "voice") ?? s.channels[0];
  });
  const me = () => meNow()!;
  const canMembers = () => !!space() && !space()!.home && channel()?.kind !== "voice";

  const unread = (s: Space) => s.channels.some((c) => c.unread && !c.muted);
  const mentions = (s: Space) => s.channels.reduce((n, c) => n + (c.mentions ?? 0), 0);

  const open = (sid: string, cid?: string) => { setSpaceId(sid); setChannelId(cid); setView(cid || sid !== "home" ? "chat" : "nav"); };
  const openChannelById = (cid: string) => {
    const s = spaces()?.find((x) => x.channels.some((c) => c.id === cid));
    if (s) open(s.id, cid);
  };
  const pick = (c: ChannelInfo) => { setChannelId(c.id); setView("chat"); };
  const collapsed = (title?: string) => !!title && device().collapsed.includes(`${space()?.id}/${title}`);
  const toggleCat = (title: string) => {
    const k = `${space()?.id}/${title}`;
    updateDevice({ collapsed: device().collapsed.includes(k) ? device().collapsed.filter((x) => x !== k) : [...device().collapsed, k] });
  };

  // Unread badges and notifications.
  const off = backend()!.onEvent((e) => {
    if (e.t === "activity" || e.t === "message") void refetch();
    if (e.t === "activity") bumpMe();
    if (e.t !== "message" || e.m.author.id === me().id || !device().notifications) return;
    const where = spaces()?.flatMap((s) => s.channels.map((c) => ({ s, c }))).find((x) => x.c.id === e.m.channelId);
    const direct = where?.c.kind === "dm" || where?.c.kind === "group";
    const looking = document.hasFocus() && !document.hidden && channel()?.id === e.m.channelId;
    if (looking || where?.c.muted || !(direct || e.m.mentionsMe)) return;
    const title = direct ? e.m.author.name : `${e.m.author.name} in #${where?.c.name ?? "channel"}`;
    const body = plain(e.m.text, { user: (id) => backend()!.person(id).name, channel: (id) => backend()!.channelName(id) }) || "Sent an attachment";
    void notify(title, body.slice(0, 180));
  });
  onCleanup(off);

  return (
    <div class="app" data-view={view()} classList={{ "no-members": !device().showMembers }}>
      <nav class="rail" aria-label="Servers">
        <For each={spaces()?.filter((s) => s.home)}>{(s) => (
          <button class="orb home" classList={{ on: space()?.id === s.id }} title="Home" aria-label="Home" aria-current={space()?.id === s.id ? "true" : undefined}
            onClick={() => open("home")}>
            <Icon name="home" size={24} />
            <Show when={mentions(s)}><span class="badge orb-badge">{mentions(s)}</span></Show>
          </button>
        )}</For>
        <div class="rail-sep" />
        <For each={spaces()?.filter((s) => !s.home)}>{(s) => (
          <button class="orb" classList={{ on: space()?.id === s.id, unread: unread(s) && space()?.id !== s.id }} title={s.name} aria-label={s.name}
            aria-current={space()?.id === s.id ? "true" : undefined} onClick={() => open(s.id)}>
            <Show when={s.iconUrl} fallback={<span>{s.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3)}</span>}><img src={s.iconUrl} alt="" /></Show>
            <Show when={mentions(s)}><span class="badge orb-badge">{mentions(s)}</span></Show>
          </button>
        )}</For>
        <button class="orb add" title="Join a server" aria-label="Join a server" onClick={() => setJoining(true)}><Icon name="plus" size={22} /></button>
      </nav>

      <aside class="side panel">
        <Show when={space() && !space()!.home} fallback={
          <header class="bar side-bar"><h2>Home</h2></header>
        }>
          <Show when={space()!.bannerUrl} fallback={<header class="bar side-bar"><h2>{space()!.name}</h2></header>}>
            <header class="server-banner" style={{ "background-image": `url("${space()!.bannerUrl!.replace(/"/g, "%22")}")` }}><h2>{space()!.name}</h2></header>
          </Show>
        </Show>
        <div class="chans">
          <Show when={space()?.home}>
            <button class="chan big" classList={{ on: !channel() }} onClick={() => { setChannelId(undefined); setView("chat"); }}>
              <Icon name="friends" size={20} class="chan-ic" /><span class="chan-name">Friends</span>
            </button>
            <h3 class="cat static">Conversations</h3>
          </Show>
          <Show when={space()?.channels.length === 0}><p class="empty small">No conversations yet.</p></Show>
          <For each={byCategory(space()?.channels ?? [])}>{(g) => (
            <>
              <Show when={g.title}>
                <button class="cat" aria-expanded={!collapsed(g.title)} onClick={() => toggleCat(g.title!)}>
                  <Icon name="down" size={12} class={collapsed(g.title) ? "rot" : ""} />{g.title}
                </button>
              </Show>
              <For each={g.channels.filter((c) => !collapsed(g.title) || c.id === channel()?.id || c.unread)}>{(c) => (
                <button class="chan" classList={{ on: channel()?.id === c.id, unread: !!c.unread, muted: !!c.muted, dm: c.kind === "dm" || c.kind === "group" }} onClick={() => pick(c)}>
                  <Show when={c.kind === "dm" && c.peer} fallback={
                    <Show when={c.iconUrl && c.kind === "group"} fallback={<Icon name={c.kind === "voice" ? "speaker" : c.kind === "group" ? "users" : c.id === "saved" || c.name === "Saved Notes" ? "note" : "hash"} size={c.kind === "group" ? 20 : 18} class="chan-ic" />}>
                      <img class="chan-icon" src={c.iconUrl} alt="" />
                    </Show>
                  }>
                    <Avatar person={c.peer!} size={28} still />
                  </Show>
                  <span class="chan-name">{c.name}</span>
                  <Show when={call.active() && call.channel()?.id === c.id}><Icon name="speaker" size={14} class="live-ic" /></Show>
                  <Show when={c.mentions}><span class="badge">{c.mentions}</span></Show>
                </button>
              )}</For>
            </>
          )}</For>
        </div>
        <CallPanel onOpen={() => { const c = call.channel(); if (c) openChannelById(c.id); }} />
        <div class="userbar">
          <button class="user" onClick={() => setMenu(true)} aria-haspopup="menu" aria-label="Accounts and status">
            <Avatar person={me()} size={34} profile={settings().profile} />
            <span class="user-text"><strong>{me().name}</strong><small>{STATUS[syncState()]}</small></span>
            <Icon name="swap" size={16} class="muted" />
          </button>
          <button class="icon-btn" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings"><Icon name="gear" size={20} /></button>
        </div>
      </aside>

      <main class="main panel">
        <Show when={channel()} fallback={
          <Show when={space()?.home} fallback={<p class="empty center">Pick a channel.</p>}>
            <Friends onMessage={openChannelById} onProfile={setProfile} onBack={() => setView("nav")} />
          </Show>
        }>
          {(c) => (
            <>
              <header class="bar main-bar">
                <button class="icon-btn back" onClick={() => setView("nav")} aria-label="Back"><Icon name="back" size={20} /></button>
                <Show when={c().kind === "dm" && c().peer} fallback={<Icon name={c().kind === "voice" ? "speaker" : c().kind === "group" ? "users" : "hash"} size={20} class="muted" />}>
                  <Avatar person={c().peer!} size={26} />
                </Show>
                <h2>{c().name}</h2>
                <Show when={c().description}><span class="topic" title={c().description}>{c().description}</span></Show>
                <span class="grow" />
                <Show when={canMembers()}>
                  <button class="icon-btn" classList={{ on: device().showMembers }} aria-pressed={device().showMembers} aria-label="Members" title="Members"
                    onClick={() => (matchMedia("(max-width: 900px)").matches ? setSheetMembers(true) : updateDevice({ showMembers: !device().showMembers }))}>
                    <Icon name="users" size={20} />
                  </button>
                </Show>
              </header>
              <div class="main-body">
                <div class="main-col">
                  <Show when={c().kind === "voice"} fallback={<Chat channel={c()} spaceId={space()?.id} onProfile={setProfile} onOpenChannel={openChannelById} />}>
                    <Voice channel={c()} />
                  </Show>
                </div>
                <Show when={canMembers() && device().showMembers}><div class="members-col"><Members spaceId={space()!.id} onOpen={setProfile} /></div></Show>
              </div>
            </>
          )}
        </Show>
      </main>

      <Show when={sheetMembers() && space()}>
        <div class="scrim" onClick={() => setSheetMembers(false)}>
          <div class="modal sheet panel" onClick={(e) => e.stopPropagation()}>
            <Members spaceId={space()!.id} onOpen={(p) => { setSheetMembers(false); setProfile(p); }} />
          </div>
        </div>
      </Show>
      <Show when={menu()}><AccountMenu onClose={() => setMenu(false)} onSettings={() => setShowSettings(true)} /></Show>
      <Show when={profile()}>{(p) => <ProfileModal person={p()} onClose={() => setProfile(null)} onMessage={(cid) => { setProfile(null); openChannelById(cid); }} />}</Show>
      <Show when={joining()}><JoinServer onClose={() => setJoining(false)} onJoined={(sid) => { void refetch(); if (sid) open(sid); }} /></Show>
      <Show when={showSettings()}><Settings onClose={() => setShowSettings(false)} /></Show>
      <EmojiPicker />
      <Lightbox />
    </div>
  );
}
