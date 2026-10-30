import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { CategoryInfo, ChannelInfo, Space } from "../lib/backend/types";
import { plain } from "../lib/markdown";
import { notify } from "../lib/notify";
import { playSfx } from "../lib/sfx";
import { inTauri } from "../lib/platform";
import { MeCardHost, UserPanel } from "./UserPanel";
import { orderChanged, Rail } from "./Rail";
import { AppImagePrompt } from "./AppImagePrompt";
import { startUpdates, UpdatePrompt } from "./updates";
import { startPerf } from "./perf";
import { setScreenBack, startBackButton } from "./back";
import { Avatar } from "./Avatar";
import { CallPanel } from "./call/CallPanel";
import { CallPreview } from "./call/CallPreview";
import { MiniCall } from "./call/MiniCall";
import { phoneVoiceChat, setPhoneVoiceChat } from "./Voice";
import { ScreenPickerHost } from "./call/ScreenPicker";
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
import { groupItems, movePin, newPinGroup, reorderPinned, setChannelPinned, setPin } from "./pins";
import { moveCategory, moveChannel } from "../lib/channelOrder";
import { hasTitleBar } from "./TitleBar";
import { attempt, openMenu } from "./menu";
import { Settings } from "./Settings";
import { backend, book, bumpMe, device, ext, meNow, platform, settings, updateDevice } from "./store";
import { activeAccount } from "../lib/session/book";
import { Voice, VoiceMembers } from "./Voice";
import { Soundboard } from "./call/Soundboard";
import { categoryMenu, channelListMenu, channelMenu, inviteTo, serverMenu } from "./menus";
import { startActivity } from "./activity";
import { startDesktop } from "./desktop";
import { ProfileEditorHost } from "./ProfileEditor";
import { EmojiInfo } from "./chat/EmojiInfo";
import { MessagePanel, type Panel } from "./chat/MessagePanel";
import { channelSettings, setChannelSettings, setCurrentServer, inboxBadge, inboxOpen, setInboxOpen, setInboxBadge, setLocation, profileOpen, registerNav, serverSettings, setProfileOpen, setServerSettings, setSettingsOpen, settingsOpen } from "./nav";
import { ServerSettings } from "./ServerSettings";
import { ChannelSettings } from "./ChannelSettings";


/** The last DM you had open, for this session only (like the user asked: Home doesn't remember across restarts). */
let lastDm: string | undefined;
const lastKey = () => { const a = activeAccount(book()); return a ? `mustela:last-channel:${a.id}` : null; };
function lastChannels(): Record<string, string> {
  const k = lastKey();
  try { const v = k ? JSON.parse(localStorage.getItem(k) ?? "{}") : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function rememberChannel(serverId: string, channelId: string) {
  const k = lastKey();
  if (!k) return;
  const all = lastChannels();
  if (all[serverId] === channelId) return;
  all[serverId] = channelId;
  try { localStorage.setItem(k, JSON.stringify(all)); } catch { /* storage blocked: still works this session */ }
}

/** Groups a server's ordered channels into their categories, keeping order. */
function byCategory(chs: ChannelInfo[]) {
  const out: { title?: string; id?: string; channels: ChannelInfo[] }[] = [];
  for (const c of chs) {
    const last = out[out.length - 1];
    if (last && last.title === c.category) last.channels.push(c);
    else out.push({ title: c.category, id: c.categoryId, channels: [c] });
  }
  return out;
}

export function Shell() {
  // The server and channel lists live in a store that's updated in place (by id), so a new message
  // doesn't rebuild every row of every list, and refreshes are batched when messages arrive quickly.
  const [spacesRes, { refetch: refetchNow }] = createResource(() => backend(), (b) => b.spaces());
  const [spaceStore, setSpaceStore] = createStore<{ list: Space[]; ready: boolean }>({ list: [], ready: false });
  createEffect(() => { const v = spacesRes(); if (v) { setSpaceStore("list", reconcile(v, { key: "id", merge: true })); setSpaceStore("ready", true); orderChanged(); } });
  const spaces = () => (spaceStore.ready ? spaceStore.list : undefined);
  let refetchTimer: ReturnType<typeof setTimeout> | undefined;
  const refetch = () => { clearTimeout(refetchTimer); refetchTimer = setTimeout(() => void refetchNow(), 120); };
  onCleanup(() => clearTimeout(refetchTimer));
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
  /** The call preview (from the mockup): in a call, looking at a different chat, not on a phone, not popped out. */
  const [previewH, setPreviewH] = createSignal(0);
  const [wide, setWide] = createSignal(matchMedia("(min-width: 901px)").matches);
  { const mq = matchMedia("(min-width: 901px)"); const f = () => setWide(mq.matches); mq.addEventListener("change", f); onCleanup(() => mq.removeEventListener("change", f)); }
  const showPreview = () => wide() && call.active() && !call.popped() && !!channel() && call.channel()?.id !== channel()?.id && !panel();
  /** Phones and tablets: the small call tile, whenever the call itself isn't what's on screen. */
  const showMini = () => !wide() && call.active() && !call.popped()
    && !(view() === "chat" && channel()?.id === call.channel()?.id && !phoneVoiceChat());
  const sideWidth = () => (matchMedia("(max-width: 1100px)").matches ? 214 : 244);
  const canMembers = () => !!space() && !space()!.home;
  const direct = (c: ChannelInfo) => c.kind === "dm" || c.kind === "group";

  const mentions = (s: Space) => s.channels.reduce((n, c) => n + (c.mentions ?? 0), 0);
  /** Unread DMs and groups, shown as their own buttons under Home like Discord. */
  const unreadDms = createMemo(() => (spaces()?.find((s) => s.home)?.channels ?? [])
    .filter((c) => (c.kind === "dm" || c.kind === "group") && c.unread && !c.muted && !(space()?.home && channel()?.id === c.id)).slice(0, 8));

  /** Going back to a server opens the channel you were last in (kept after a restart); Home, the last DM this session. */
  const remembered = (sid: string) => {
    const want = sid === "home" ? lastDm : lastChannels()[sid];
    const s = spaces()?.find((x) => x.id === sid);
    return want && s?.channels.some((c) => c.id === want) ? want : undefined;
  };
  const open = (sid: string, cid?: string) => {
    const target = cid ?? remembered(sid);
    if (sid !== space()?.id || (target && target !== channel()?.id)) setPanel(null);
    setSpaceId(sid); setChannelId(target);
    // On a phone, tapping a server shows its channels; a channel you picked opens full screen.
    setView(cid ? "chat" : "nav");
  };
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
    // Busy (do not disturb) means no notifications; nothing from people you've blocked.
    const presence = me().presence;
    if (presence === "busy" || e.m.author.relation === "blocked") return;
    const where = spaces()?.flatMap((s) => s.channels.map((c) => ({ s, c }))).find((x) => x.c.id === e.m.channelId);
    const direct = where?.c.kind === "dm" || where?.c.kind === "group";
    const looking = document.hasFocus() && !document.hidden && channel()?.id === e.m.channelId;
    if (looking || where?.c.muted || (where && !where.s.home && backend()!.isMuted("server", where.s.id))) return;
    // Stoat's per-channel/per-server level; default is everything in DMs, mentions elsewhere.
    const level = backend()!.notifyLevel("channel", e.m.channelId) ?? (where && !where.s.home ? backend()!.notifyLevel("server", where.s.id) : undefined) ?? (direct ? "all" : "mention");
    if (level === "none" || (level === "mention" && !e.m.mentionsMe)) return;
    // Focus: only direct messages and mentions get through.
    if (presence === "focus" && !direct && !e.m.mentionsMe) return;
    const title = direct ? e.m.author.name : `${e.m.author.name} in #${where?.c.name ?? "channel"}`;
    const body = plain(e.m.text, { user: (id) => backend()!.person(id).name, channel: (id) => backend()!.channelName(id) }) || "Sent an attachment";
    void notify(title, device().notifyPreview ? body.slice(0, 180) : direct ? "Sent you a message" : "Mentioned you");
    if (device().sounds.message) playSfx("message");
  });
  onCleanup(off);
  startActivity();
  startDesktop();
  startUpdates();
  startPerf();
  void startBackButton(platform);
  // Back between screens on a phone: members sheet → chat → channel list → (leave the app).
  setScreenBack(() => {
    if (sheetMembers()) { setSheetMembers(false); return true; }
    if (discover() && view() === "chat") { setDiscover(false); setView("nav"); return true; }
    if (view() === "chat" && matchMedia("(max-width: 900px)").matches) { setView("nav"); return true; }
    return false;
  });
  onCleanup(() => setScreenBack(null));

  createEffect(() => setCurrentServer(space() && !space()!.home ? space()!.id : null));
  createEffect(() => {
    const s = space(), c = channel();
    if (!s || !c) return;
    if (s.home) { if (c.kind === "dm" || c.kind === "group") lastDm = c.id; }
    else rememberChannel(s.id, c.id);
  });

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
    setInboxBadge(all.reduce((t, sp) => t + sp.channels.reduce((m, c) => m + (c.muted ? 0 : c.mentions ?? 0), 0), 0));
    if (inTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setBadgeCount(n || undefined)).catch(() => {});
  });

  const serverPerms = createMemo(() => { const s = space(); return s && !s.home ? backend()!.serverInfo(s.id)?.perms : undefined; });

  /* ---- drag to rearrange: channels and categories (if you can manage them), pinned channels, favourites, pinned DMs ---- */
  type Drag = { kind: "chan" | "cat" | "spin" | "fav" | "dm"; id: string };
  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [dropAt, setDropAt] = createSignal<string | null>(null);
  const dragFrom = (d: Drag) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => { e.stopPropagation(); e.dataTransfer!.setData("text/x-mustela-chan", d.id); e.dataTransfer!.effectAllowed = "move"; setDrag(d); },
    onDragEnd: () => { setDrag(null); setDropAt(null); },
  });
  /** A drop target: `key` draws the line where it'll land. */
  const dropTo = (key: string, accept: (d: Drag) => boolean, done: (d: Drag) => void) => ({
    onDragOver: (e: DragEvent) => { const d = drag(); if (!d || d.id === key || !accept(d)) return; e.preventDefault(); e.stopPropagation(); setDropAt(key); },
    onDragLeave: () => { if (dropAt() === key) setDropAt(null); },
    onDrop: (e: DragEvent) => { const d = drag(); setDropAt(null); setDrag(null); if (!d || d.id === key || !accept(d)) return; e.preventDefault(); e.stopPropagation(); done(d); },
  });
  const canManage = () => !!serverPerms()?.manageChannels;
  const saveCats = (f: (cats: CategoryInfo[]) => CategoryInfo[]) => {
    const sid = space()!.id, b = backend()!;
    void attempt(() => b.saveCategories(sid, f(b.categories(sid)))).then(() => void refetch());
  };
  /** Dropping on the normal list: a pinned channel comes off the pin list; managers also put it there. */
  const toList = (target: { before: string } | { into: string | null }) => (d: Drag) => {
    if (d.kind === "spin") setChannelPinned(d.id, false);
    if (canManage()) saveCats((cats) => moveChannel(cats, d.id, target));
  };
  const listAccepts = (d: Drag) => d.kind === "spin" || (d.kind === "chan" && canManage());
  const pinnedHere = createMemo(() => {
    const s = space();
    if (!s || s.home) return [];
    return ext().channelPins.map((id) => s.channels.find((c) => c.id === id)).filter((c): c is ChannelInfo => !!c);
  });
  /** Favourite channels from every server, for Home. */
  const favourites = createMemo(() => {
    const all = spaces() ?? [];
    return ext().favourites.flatMap((id) => { for (const sp of all) { const c = sp.channels.find((x) => x.id === id); if (c && !sp.home) return [{ c, s: sp }]; } return []; });
  });

  type RowOpts = { saved?: boolean; drag?: Drag; drop?: ReturnType<typeof dropTo>; key?: string; sub?: string; onOpen?: () => void; server?: string };
  const row = (c: ChannelInfo, o: RowOpts = {}) => (
    <>
      <div class="chan-wrap" classList={{ "drop-line": !!o.key && dropAt() === o.key, dragging: !!o.drag && drag()?.id === o.drag.id }} {...(o.drop ?? {})}>
      <button class="chan" classList={{ on: channel()?.id === c.id, big: o.saved, unread: !!c.unread, muted: !!c.muted, dm: c.kind === "dm" || c.kind === "group" }} onClick={() => { setDiscover(false); if (o.onOpen) o.onOpen(); else pick(c); }}
        {...(o.drag ? dragFrom(o.drag) : {})}
        onContextMenu={(e) => channelMenu(e, c, o.server ?? (space()?.home ? undefined : space()?.id))}>
        <Show when={c.kind === "dm" && c.peer} fallback={
          <Show when={c.iconUrl && c.kind === "group"} fallback={<Icon name={c.kind === "voice" ? "speaker" : c.kind === "group" ? "users" : o.saved ? "note" : "hash"} size={c.kind === "group" || o.saved ? 20 : 18} class="chan-ic" />}>
            <img class="chan-icon" src={c.iconUrl} alt="" />
          </Show>
        }>
          <Avatar person={c.peer!} size={28} still />
        </Show>
        <span class="chan-name">{c.name}<Show when={o.sub}><small class="chan-sub">{o.sub}</small></Show></span>
        <Show when={call.active() && call.channel()?.id === c.id}><Icon name="speaker" size={14} class="live-ic" /></Show>
        <Show when={c.mentions}><span class="badge">{c.mentions}</span></Show>
      </button>
      <Show when={!o.server && !space()?.home && (serverPerms()?.invite || serverPerms()?.manageChannels)}>
        <span class="chan-acts">
          <Show when={serverPerms()?.invite}><button class="icon-btn" title="Create invite" aria-label={`Create invite to ${c.name}`} onClick={() => void inviteTo(c.id)}><Icon name="user-plus" size={15} /></button></Show>
          <Show when={serverPerms()?.manageChannels}><button class="icon-btn" title="Edit channel" aria-label={`Edit ${c.name}`} onClick={() => setChannelSettings({ id: c.id })}><Icon name="gear" size={15} /></button></Show>
        </span>
      </Show>
      </div>
      <Show when={c.voice?.length}><VoiceMembers members={c.voice!} channelId={c.id} /></Show>
    </>
  );
  /** Home, like Stoat: Saved Notes on top, then your pin groups, then everyone else. */
  const home = createMemo(() => {
    const all = space()?.home ? space()!.channels : [];
    const isSaved = (c: ChannelInfo) => c.id === "saved" || (c.kind === "text" && c.name === "Saved Notes");
    const pins = settings().pins;
    // In the order you put them (drag to rearrange); empty groups show while dragging, as drop targets.
    const groups = pins.groups.map((group) => ({ group, list: pins.items.filter((i) => i.group === group.id).map((i) => all.find((c) => c.id === i.channel && !isSaved(c))).filter((c): c is ChannelInfo => !!c) }))
      .filter((g) => g.list.length || drag()?.kind === "dm");
    const pinned = new Set(pins.items.map((i) => i.channel));
    return { saved: all.filter(isSaved), groups, rest: all.filter((c) => !isSaved(c) && !pinned.has(c.id)) };
  });

  return (
    <div class="app" data-view={view()} classList={{ "no-members": !device().showMembers, "in-call": call.active() }}>
      <nav class="rail" aria-label="Servers">
        <For each={spaces()?.filter((s) => s.home)}>{(s) => (
          <button class="orb home" classList={{ on: space()?.id === s.id }} title="Home" aria-label="Home" aria-current={space()?.id === s.id ? "true" : undefined}
            onClick={() => open("home")}>
            <Icon name="home" size={24} />
            <Show when={mentions(s)}><span class="badge orb-badge">{mentions(s)}</span></Show>
          </button>
        )}</For>
        <For each={unreadDms()}>{(c) => (
          <button class="orb dm-orb unread" title={c.name} aria-label={`${c.name}, unread`} onClick={() => { setDiscover(false); open("home", c.id); }} onContextMenu={(e) => channelMenu(e, c)}>
            <Show when={c.kind === "dm" && c.peer} fallback={<Show when={c.iconUrl} fallback={<span><Icon name="users" size={22} /></span>}><img src={c.iconUrl} alt="" /></Show>}>
              <Avatar person={c.peer!} size={48} presence={false} still />
            </Show>
            <span class="badge orb-badge">{c.mentions || 1}</span>
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
        <div class="chans" onContextMenu={(e) => { if (space() && !space()!.home && e.target === e.currentTarget) channelListMenu(e, space()!.id); }}>
          <Show when={space()?.home} fallback={
            <>
              <Show when={space()?.channels.length === 0}><p class="empty small">No channels yet.</p></Show>
              {/* Pinned to the top: yours only, synced. Drag a channel here to pin it. */}
              <Show when={pinnedHere().length || drag()?.kind === "chan"}>
                <button class="cat pin-cat" classList={{ "drop-into": dropAt() === "pinned-head" }} style={{ "--pin": "var(--pri)" }} aria-expanded={!collapsed("\u2605pinned")} onClick={() => toggleCat("\u2605pinned")}
                  {...dropTo("pinned-head", (d) => d.kind === "chan" || d.kind === "spin", (d) => reorderPinned("channelPins", d.id, null))}>
                  <Icon name="down" size={12} class={collapsed("\u2605pinned") ? "rot" : ""} /><Icon name="pin" size={12} />Pinned
                </button>
                <For each={pinnedHere().filter((c) => !collapsed("\u2605pinned") || c.id === channel()?.id || c.unread)}>{(c) => row(c, {
                  drag: { kind: "spin", id: c.id }, key: `spin:${c.id}`,
                  drop: dropTo(`spin:${c.id}`, (d) => (d.kind === "chan" || d.kind === "spin") && d.id !== c.id, (d) => reorderPinned("channelPins", d.id, c.id)),
                })}</For>
              </Show>
              <For each={byCategory((space()?.channels ?? []).filter((c) => !ext().channelPins.includes(c.id)))}>{(g) => (
                <>
                  <Show when={g.title}>
                    <button class="cat" classList={{ "drop-into": dropAt() === `cat:${g.id}`, dragging: drag()?.id === g.id }} aria-expanded={!collapsed(g.title)} onClick={() => toggleCat(g.title!)} onContextMenu={(e) => { e.stopPropagation(); categoryMenu(e, space()!.id, g.id, g.title!, g.channels); }}
                      {...(canManage() && g.id ? dragFrom({ kind: "cat", id: g.id }) : {})}
                      {...dropTo(`cat:${g.id}`, (d) => listAccepts(d) || (d.kind === "cat" && canManage()), (d) => (d.kind === "cat" ? saveCats((cats) => moveCategory(cats, d.id, g.id!)) : toList({ into: g.id ?? null })(d)))}>
                      <Icon name="down" size={12} class={collapsed(g.title) ? "rot" : ""} />{g.title}
                    </button>
                  </Show>
                  <For each={g.channels.filter((c) => !collapsed(g.title) || c.id === channel()?.id || c.unread)}>{(c) => row(c, {
                    drag: { kind: "chan", id: c.id }, key: `chan:${c.id}`,
                    drop: dropTo(`chan:${c.id}`, (d) => listAccepts(d) && d.id !== c.id, toList({ before: c.id })),
                  })}</For>
                </>
              )}</For>
              {/* The empty space below the list: drop a category to send it last, or a pinned channel to unpin it. */}
              <Show when={drag()}><div class="chan-tail" classList={{ "drop-line": dropAt() === "tail" }}
                {...dropTo("tail", (d) => d.kind === "spin" || (d.kind === "cat" && canManage()), (d) => (d.kind === "cat" ? saveCats((cats) => moveCategory(cats, d.id, null)) : setChannelPinned(d.id, false)))} /></Show>
            </>
          }>
            <button class="chan big" classList={{ on: !channel() && !discover() }} onClick={() => { setDiscover(false); setChannelId(undefined); setView("chat"); }}>
              <Icon name="friends" size={20} class="chan-ic" /><span class="chan-name">Friends</span>
            </button>
            <button class="chan big" classList={{ on: discover() }} onClick={() => { setDiscover(true); setChannelId(undefined); setView("chat"); }}>
              <Icon name="compass" size={20} class="chan-ic" /><span class="chan-name">Discover</span>
            </button>
            <For each={home().saved}>{(c) => row(c, { saved: true })}</For>
            <Show when={favourites().length}>
              <button class="cat pin-cat" style={{ "--pin": "#f0b232" }} aria-expanded={!collapsed("\u2605favs")} onClick={() => toggleCat("\u2605favs")}>
                <Icon name="down" size={12} class={collapsed("\u2605favs") ? "rot" : ""} /><Icon name="star" size={12} />Favourites
              </button>
              <For each={favourites().filter((f) => !collapsed("\u2605favs") || f.c.unread)}>{(f) => row(f.c, {
                sub: f.s.name, server: f.s.id, onOpen: () => open(f.s.id, f.c.id),
                drag: { kind: "fav", id: f.c.id }, key: `fav:${f.c.id}`,
                drop: dropTo(`fav:${f.c.id}`, (d) => d.kind === "fav", (d) => reorderPinned("favourites", d.id, f.c.id)),
              })}</For>
            </Show>
            <For each={home().groups}>{(g) => (
              <>
                <button class="cat pin-cat" classList={{ "drop-into": dropAt() === `grp:${g.group.id}` }} style={{ "--pin": g.group.color }} aria-expanded={!collapsed(`pin:${g.group.id}`)} onClick={() => toggleCat(`pin:${g.group.id}`)} onContextMenu={(e) => openMenu(e, groupItems(g.group))}
                  {...dropTo(`grp:${g.group.id}`, (d) => d.kind === "dm", (d) => movePin(d.id, g.group.id, null))}>
                  <Icon name="down" size={12} class={collapsed(`pin:${g.group.id}`) ? "rot" : ""} /><i class="pin-dot" />{g.group.name}
                </button>
                <For each={g.list.filter((c) => !collapsed(`pin:${g.group.id}`) || c.id === channel()?.id || c.unread)}>{(c) => row(c, {
                  drag: { kind: "dm", id: c.id }, key: `dm:${c.id}`,
                  drop: dropTo(`dm:${c.id}`, (d) => d.kind === "dm", (d) => movePin(d.id, g.group.id, c.id)),
                })}</For>
              </>
            )}</For>
            <h3 class="cat static" classList={{ "drop-into": dropAt() === "dms" }} {...dropTo("dms", (d) => d.kind === "dm" && settings().pins.items.some((i) => i.channel === d.id), (d) => setPin(d.id, null))}>Direct messages<span class="grow" /><button class="cat-add" title="New pin group" aria-label="New pin group" onClick={() => newPinGroup()}><Icon name="plus" size={14} /></button></h3>
            <Show when={home().rest.length === 0 && home().groups.length === 0}><p class="empty small">No conversations yet.</p></Show>
            <For each={home().rest}>{(c) => row(c, { drag: { kind: "dm", id: c.id } })}</For>
          </Show>
        </div>
      </aside>

      <CallPanel onOpen={() => { const c = call.channel(); if (c) openChannelById(c.id); }}
        where={(() => { const id = call.channel()?.id; const sp = id ? spaces()?.find((s) => s.channels.some((c) => c.id === id)) : undefined; return sp ? (sp.home ? "Direct message" : sp.name) : undefined; })()} />

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
                <Show when={showPreview()}>
                  <CallPreview minWidth={sideWidth()} onHeight={setPreviewH} onOpen={() => { const cc = call.channel(); if (cc) openChannelById(cc.id); }} />
                </Show>
                <Show when={panel()} fallback={
                  <Switch>
                    <Match when={canMembers() && device().showMembers && c().kind !== "voice"}><div class="members-col" style={{ "padding-top": showPreview() ? `${previewH() + 8}px` : undefined }}><Members spaceId={space()!.id} onOpen={setProfile} /></div></Match>
                    <Match when={c().kind === "dm" && c().peer && device().dmProfile}><div class="members-col dmp-col" style={{ "padding-top": showPreview() ? `${previewH() + 8}px` : undefined }}><DmProfile person={c().peer!} /></div></Match>
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
      <Show when={channelSettings()}>{(cs) => <ChannelSettings id={cs().id} tab={cs().tab} />}</Show>
      <EmojiPicker />
      <GifPicker />
      <Soundboard />
      <Lightbox />
      <ProfileEditorHost />
      <EmojiInfo />
      <MeCardHost />
      <ScreenPickerHost hidden={call.popped()} />
      <Show when={showMini()}>
        <MiniCall onOpen={() => { const cc = call.channel(); setPhoneVoiceChat(false); if (cc) openChannelById(cc.id); }} />
      </Show>
      <AppImagePrompt />
      <UpdatePrompt />
    </div>
  );
}
