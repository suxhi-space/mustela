import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import type { ChannelInfo, Space } from "../lib/backend/types";
import { plain } from "../lib/markdown";
import { notify } from "../lib/notify";
import { playSfx } from "../lib/sfx";
import { inTauri } from "../lib/platform";
import { UserPanel } from "./UserPanel";
import { Rail } from "./Rail";
import { AppImagePrompt } from "./AppImagePrompt";
import { Avatar } from "./Avatar";
import { CallPanel } from "./call/CallPanel";
import { call, joinCall, toggleCall } from "./call/state";
import { Chat } from "./Chat";
import { EmojiPicker, GifPicker, Lightbox } from "./chat/overlays";
import { Friends, JoinServer } from "./Friends";
import { Icon } from "./icons";
import { Members } from "./Members";
import { DmProfile, ProfileView } from "./Profile";
import { Discover } from "./Discover";
import { GroupInvite } from "./GroupInvite";
import { Inbox } from "./Inbox";
import { CallStage } from "./call/CallStage";
import { groupItems, newPinGroup } from "./pins";
import { hasTitleBar } from "./TitleBar";
import { openMenu } from "./menu";
import { Settings } from "./Settings";
import { backend, bumpMe, device, meNow, settings, updateDevice } from "./store";
import { Voice, VoiceMembers } from "./Voice";
import { Soundboard } from "./call/Soundboard";
import { channelMenu, serverMenu } from "./menus";
import { startActivity } from "./activity";
import { startDesktop } from "./desktop";
import { ProfileEditorHost } from "./ProfileEditor";
import { EmojiInfo } from "./chat/EmojiInfo";
import { MessagePanel, type Panel } from "./chat/MessagePanel";
import { inboxBadge, inboxOpen, setInboxOpen, setInboxBadge, setLocation, profileOpen, registerNav, serverSettings, setProfileOpen, setServerSettings, setSettingsOpen, settingsOpen } from "./nav";
import { ServerSettings } from "./ServerSettings";


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
  const showSettings = () => settingsOpen() !== false;
  const setShowSettings = (v: boolean) => setSettingsOpen(v ? "account" : false);
  const profile = profileOpen, setProfile = setProfileOpen;
  const [sheetMembers, setSheetMembers] = createSignal(false);
  const [joining, setJoining] = createSignal(false);
  const [panel, setPanel] = createSignal<Panel | null>(null);
  const [discover, setDiscover] = createSignal(false);
  const [groupInvite, setGroupInvite] = createSignal<ChannelInfo | null>(null);

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
  const canMembers = () => !!space() && !space()!.home;
  const direct = (c: ChannelInfo) => c.kind === "dm" || c.kind === "group";

  const mentions = (s: Space) => s.channels.reduce((n, c) => n + (c.mentions ?? 0), 0);

  const open = (sid: string, cid?: string) => { if (sid !== space()?.id || (cid && cid !== channel()?.id)) setPanel(null); setSpaceId(sid); setChannelId(cid); setView(cid || sid !== "home" ? "chat" : "nav"); };
  const openChannelById = (cid: string) => {
    const s = spaces()?.find((x) => x.channels.some((c) => c.id === cid));
    if (s) open(s.id, cid);
  };
  registerNav({ channel: (id) => { void refetch(); setTimeout(() => openChannelById(id), 150); } });
  const pick = (c: ChannelInfo) => { setChannelId(c.id); setView("chat"); setPanel(null); };
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
    if (looking || where?.c.muted || (where && !where.s.home && backend()!.isMuted("server", where.s.id))) return;
    // Stoat's per-channel/per-server level; default is everything in DMs, mentions elsewhere.
    const level = backend()!.notifyLevel("channel", e.m.channelId) ?? (where && !where.s.home ? backend()!.notifyLevel("server", where.s.id) : undefined) ?? (direct ? "all" : "mention");
    if (level === "none" || (level === "mention" && !e.m.mentionsMe)) return;
    const title = direct ? e.m.author.name : `${e.m.author.name} in #${where?.c.name ?? "channel"}`;
    const body = plain(e.m.text, { user: (id) => backend()!.person(id).name, channel: (id) => backend()!.channelName(id) }) || "Sent an attachment";
    void notify(title, device().notifyPreview ? body.slice(0, 180) : direct ? "Sent you a message" : "Mentioned you");
    if (device().sounds.message) playSfx("message");
  });
  onCleanup(off);
  startActivity();
  startDesktop();

  // The title bar says where you are, like Discord's.
  createEffect(() => {
    const s = space(), c = channel();
    if (!s) return;
    setLocation(s.home ? { text: c ? (c.kind === "dm" || c.kind === "group" ? c.name : c.name) : "Friends" } : { text: s.name, icon: s.iconUrl });
  });

  // Unread badge: mentions plus unread direct messages, on the window title and the app icon.
  createEffect(() => {
    const all = spaces() ?? [];
    const n = device().badge ? all.reduce((t, sp) => t + sp.channels.reduce((m, c) => m + (c.mentions ?? 0) + (sp.home && c.kind !== "text" && c.unread && !c.muted && !c.mentions ? 1 : 0), 0), 0) : 0;
    document.title = n ? `(${n}) Mustela` : "Mustela";
    setInboxBadge(n);
    if (inTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setBadgeCount(n || undefined)).catch(() => {});
  });

  const row = (c: ChannelInfo, saved = false) => (
    <>
      <button class="chan" classList={{ on: channel()?.id === c.id, big: saved, unread: !!c.unread, muted: !!c.muted, dm: c.kind === "dm" || c.kind === "group" }} onClick={() => { setDiscover(false); pick(c); }}
        onContextMenu={(e) => channelMenu(e, c, space()?.home ? undefined : space()?.id)}>
        <Show when={c.kind === "dm" && c.peer} fallback={
          <Show when={c.iconUrl && c.kind === "group"} fallback={<Icon name={c.kind === "voice" ? "speaker" : c.kind === "group" ? "users" : saved ? "note" : "hash"} size={c.kind === "group" || saved ? 20 : 18} class="chan-ic" />}>
            <img class="chan-icon" src={c.iconUrl} alt="" />
          </Show>
        }>
          <Avatar person={c.peer!} size={28} still />
        </Show>
        <span class="chan-name">{c.name}</span>
        <Show when={call.active() && call.channel()?.id === c.id}><Icon name="speaker" size={14} class="live-ic" /></Show>
        <Show when={c.mentions}><span class="badge">{c.mentions}</span></Show>
      </button>
      <Show when={c.voice?.length}><VoiceMembers members={c.voice!} channelId={c.id} /></Show>
    </>
  );
  /** Home, like Stoat: Saved Notes on top, then your pin groups, then everyone else. */
  const home = createMemo(() => {
    const all = space()?.home ? space()!.channels : [];
    const isSaved = (c: ChannelInfo) => c.id === "saved" || (c.kind === "text" && c.name === "Saved Notes");
    const pins = settings().pins;
    const groups = pins.groups.map((group) => ({ group, list: all.filter((c) => !isSaved(c) && pins.items.some((i) => i.channel === c.id && i.group === group.id)) })).filter((g) => g.list.length);
    const pinned = new Set(pins.items.map((i) => i.channel));
    return { saved: all.filter(isSaved), groups, rest: all.filter((c) => !isSaved(c) && !pinned.has(c.id)) };
  });

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
        <Rail spaces={spaces() ?? []} current={space()?.home ? undefined : space()?.id} onOpen={(id) => { setDiscover(false); open(id); }} onAdd={() => setJoining(true)} refetch={() => void refetch()} />
      </nav>

      <aside class="side panel">
        <Show when={space() && !space()!.home} fallback={
          <header class="bar side-bar"><h2>Home</h2></header>
        }>
          <Show when={space()!.bannerUrl} fallback={
            <header class="bar side-bar" onContextMenu={(e) => serverMenu(e, space()!)}><h2>{space()!.name}</h2><span class="grow" />
              <button class="icon-btn" aria-label="Server settings" title="Server settings" onClick={() => setServerSettings({ id: space()!.id })}><Icon name="gear" size={18} /></button></header>
          }>
            <header class="server-banner" onContextMenu={(e) => serverMenu(e, space()!)} style={{ "background-image": `url("${space()!.bannerUrl!.replace(/"/g, "%22")}")` }}><h2>{space()!.name}</h2>
              <button class="icon-btn sb-gear" aria-label="Server settings" title="Server settings" onClick={() => setServerSettings({ id: space()!.id })}><Icon name="gear" size={18} /></button></header>
          </Show>
        </Show>
        <div class="chans">
          <Show when={space()?.home} fallback={
            <>
              <Show when={space()?.channels.length === 0}><p class="empty small">No channels yet.</p></Show>
              <For each={byCategory(space()?.channels ?? [])}>{(g) => (
                <>
                  <Show when={g.title}>
                    <button class="cat" aria-expanded={!collapsed(g.title)} onClick={() => toggleCat(g.title!)}>
                      <Icon name="down" size={12} class={collapsed(g.title) ? "rot" : ""} />{g.title}
                    </button>
                  </Show>
                  <For each={g.channels.filter((c) => !collapsed(g.title) || c.id === channel()?.id || c.unread)}>{(c) => row(c)}</For>
                </>
              )}</For>
            </>
          }>
            <button class="chan big" classList={{ on: !channel() && !discover() }} onClick={() => { setDiscover(false); setChannelId(undefined); setView("chat"); }}>
              <Icon name="friends" size={20} class="chan-ic" /><span class="chan-name">Friends</span>
            </button>
            <button class="chan big" classList={{ on: discover() }} onClick={() => { setDiscover(true); setChannelId(undefined); setView("chat"); }}>
              <Icon name="compass" size={20} class="chan-ic" /><span class="chan-name">Discover</span>
            </button>
            <For each={home().saved}>{(c) => row(c, true)}</For>
            <For each={home().groups}>{(g) => (
              <>
                <button class="cat pin-cat" style={{ "--pin": g.group.color }} aria-expanded={!collapsed(`pin:${g.group.id}`)} onClick={() => toggleCat(`pin:${g.group.id}`)} onContextMenu={(e) => openMenu(e, groupItems(g.group))}>
                  <Icon name="down" size={12} class={collapsed(`pin:${g.group.id}`) ? "rot" : ""} /><i class="pin-dot" />{g.group.name}
                </button>
                <For each={g.list.filter((c) => !collapsed(`pin:${g.group.id}`) || c.id === channel()?.id || c.unread)}>{(c) => row(c)}</For>
              </>
            )}</For>
            <h3 class="cat static">Direct messages<span class="grow" /><button class="cat-add" title="New pin group" aria-label="New pin group" onClick={() => newPinGroup()}><Icon name="plus" size={14} /></button></h3>
            <Show when={home().rest.length === 0 && home().groups.length === 0}><p class="empty small">No conversations yet.</p></Show>
            <For each={home().rest}>{(c) => row(c)}</For>
          </Show>
        </div>
        <CallPanel onOpen={() => { const c = call.channel(); if (c) openChannelById(c.id); }} />
      </aside>

      <UserPanel />

      <main class="main panel">
        <Show when={channel()} fallback={
          <Show when={space()?.home} fallback={<p class="empty center">Pick a channel.</p>}>
            <Show when={discover()} fallback={<Friends onMessage={openChannelById} onProfile={setProfile} onBack={() => setView("nav")} />}>
              <Discover onBack={() => setView("nav")} onJoined={(sid) => { void refetch(); open(sid); }} />
            </Show>
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
                <Show when={direct(c())}>
                  <button class="icon-btn" classList={{ on: call.active() && call.channel()?.id === c().id }} aria-label="Start voice call" title="Start voice call" onClick={() => void joinCall(c())}><Icon name="phone" size={20} /></button>
                  <button class="icon-btn" aria-label="Start video call" title="Start video call" onClick={() => void joinCall(c()).then(() => { if (call.active() && !call.on().cam) void toggleCall("cam"); })}><Icon name="video" size={20} /></button>
                </Show>
                  <button class="icon-btn" classList={{ on: panel()?.kind === "pins" }} aria-pressed={panel()?.kind === "pins"} aria-label="Pinned messages" title="Pinned messages"
                    onClick={() => setPanel(panel()?.kind === "pins" ? null : { kind: "pins" })}><Icon name="pin" size={20} /></button>
                  <form class="search-box" role="search" onSubmit={(e) => { e.preventDefault(); const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim(); if (q) setPanel({ kind: "search", q }); }}>
                    <Icon name="search" size={16} />
                    <input name="q" placeholder="Search messages…" aria-label={`Search in ${c().name}`} autocomplete="off" onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.value = "", setPanel(null))} />
                  </form>
                <Show when={direct(c())}>
                  <button class="icon-btn" aria-label={c().kind === "group" ? "Add friends to group" : "Add friends to DM"} title={c().kind === "group" ? "Add friends to group" : "Add friends to DM"} onClick={() => setGroupInvite(c())}><Icon name="user-plus" size={20} /></button>
                </Show>
                <Show when={c().kind === "dm" && c().peer}>
                  <button class="icon-btn" classList={{ on: device().dmProfile }} aria-pressed={device().dmProfile} aria-label="User profile" title={device().dmProfile ? "Hide user profile" : "Show user profile"} onClick={() => updateDevice({ dmProfile: !device().dmProfile })}><Icon name="profile-side" size={20} /></button>
                </Show>
                <Show when={!hasTitleBar()}>
                  <button class="icon-btn inbox-btn" classList={{ on: inboxOpen() }} aria-label="Inbox" title="Inbox" onClick={() => setInboxOpen(!inboxOpen())}><Icon name="inbox" size={20} /><Show when={inboxBadge()}><span class="tb-dot" /></Show></button>
                </Show>
                <Show when={canMembers()}>
                  <button class="icon-btn" classList={{ on: device().showMembers }} aria-pressed={device().showMembers} aria-label="Members" title="Members"
                    onClick={() => (matchMedia("(max-width: 900px)").matches ? setSheetMembers(true) : updateDevice({ showMembers: !device().showMembers }))}>
                    <Icon name="users" size={20} />
                  </button>
                </Show>
              </header>
              <div class="main-body">
                <div class="main-col">
                  <Show when={direct(c()) && call.active() && call.channel()?.id === c().id}>
                    <div class="dm-call"><CallStage channel={c()} compact /></div>
                  </Show>
                  <Show when={c().kind === "voice"} fallback={<Chat channel={c()} spaceId={space()?.id} onProfile={setProfile} onOpenChannel={openChannelById} />}>
                    <Voice channel={c()} spaceId={space()?.id} onProfile={setProfile} onOpenChannel={openChannelById} />
                  </Show>
                </div>
                <Show when={panel()} fallback={
                  <Switch>
                    <Match when={canMembers() && device().showMembers && c().kind !== "voice"}><div class="members-col"><Members spaceId={space()!.id} onOpen={setProfile} /></div></Match>
                    <Match when={c().kind === "dm" && c().peer && device().dmProfile}><div class="members-col dmp-col"><DmProfile person={c().peer!} /></div></Match>
                  </Switch>
                }>
                  {(pn) => <div class="members-col panel-col"><MessagePanel panel={pn()} channel={c()} onClose={() => setPanel(null)} /></div>}
                </Show>
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
      <ProfileView onMessage={(cid) => { void refetch(); setTimeout(() => openChannelById(cid), 120); }} />
      <Show when={inboxOpen()}><Inbox spaces={spaces() ?? []} onOpen={(sid, cid) => { setDiscover(false); open(sid, cid); }} /></Show>
      <Show when={groupInvite()}>{(gc) => <GroupInvite channel={gc()} onClose={() => setGroupInvite(null)} onOpen={(id) => { void refetch(); setTimeout(() => openChannelById(id), 200); }} />}</Show>
      <Show when={joining()}><JoinServer onClose={() => setJoining(false)} onJoined={(sid) => { void refetch(); if (sid) open(sid); }} /></Show>
      <Show when={showSettings()}><Settings initial={settingsOpen() || undefined} onClose={() => setShowSettings(false)} /></Show>
      <Show when={serverSettings()}>{(ss) => <ServerSettings id={ss().id} tab={ss().tab} />}</Show>
      <EmojiPicker />
      <GifPicker />
      <Soundboard />
      <Lightbox />
      <ProfileEditorHost />
      <EmojiInfo />
      <AppImagePrompt />
    </div>
  );
}
