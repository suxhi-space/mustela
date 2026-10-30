import { createEffect, createMemo, createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { CategoryInfo, ChannelInfo, Space } from "../lib/backend/types";
import { plain } from "../lib/markdown";
import { notify } from "../lib/notify";
import { NotifyPrompt } from "./NotifyPrompt";
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
import { MiniCall, PipView } from "./call/MiniCall";
import { createProfileInfo } from "./hooks";
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
import { favGroupItems, groupItems, movePin, newFavGroup, newPinGroup, reorderPinned, setChannelPinned, setFavGroup, setPin } from "./pins";
import { moveCategory, moveChannel } from "../lib/channelOrder";
import { hasTitleBar } from "./TitleBar";
import { attempt, openMenu } from "./menu";
import { Settings } from "./Settings";
import { backend, book, bumpMe, device, ext, meNow, platform, settings, updateDevice, updateExt } from "./store";
import { activeAccount } from "../lib/session/book";
import { Voice, VoiceMembers } from "./Voice";
import { Soundboard } from "./call/Soundboard";
import { categoryMenu, channelListMenu, channelMenu, favoriteMenu, inviteTo, serverMenu } from "./menus";
import { startActivity } from "./activity";
import { startDesktop } from "./desktop";
import { ProfileEditorHost } from "./ProfileEditor";
import { EmojiInfo } from "./chat/EmojiInfo";
import { MessagePanel, type Panel } from "./chat/MessagePanel";
import { channelSettings, setChannelSettings, setCurrentServer, setProfileView, inboxBadge, inboxOpen, setInboxOpen, setInboxBadge, setLocation, profileOpen, registerNav, serverSettings, setProfileOpen, setServerSettings, setSettingsOpen, settingsOpen } from "./nav";
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

  /** Favorite channels from every server (for Home, or the Favorites button under it). */
  const favourites = createMemo(() => {
    const all = spaces() ?? [];
    return ext().favourites.flatMap((id) => { for (const sp of all) { const c = sp.channels.find((x) => x.id === id); if (c && !sp.home) return [{ c, s: sp }]; } return []; });
  });
  /** Favorites as a server of their own, when that button is on. */
  const favSpace = createMemo<Space>(() => ({ id: "favs", name: "Favorites", channels: favourites().map((f) => f.c) }));
  const space = createMemo<Space | undefined>(() => (spaceId() === "favs" && ext().favRail ? favSpace() : spaces()?.find((s) => s.id === spaceId()) ?? spaces()?.[0]));
  const isFavs = () => space()?.id === "favs";
  /** Home with nothing picked shows Friends, like Stoat. Servers fall back to their first text channel. */
  const channel = createMemo<ChannelInfo | undefined>(() => {
    const s = space();
    if (!s) return undefined;
    const picked = s.channels.find((c) => c.id === channelId());
    // A favorite opens right where it's listed (Home or Favorites), without going to its server.
    if (s.home && !picked) return favourites().find((f) => f.c.id === channelId())?.c;
    if (picked || s.home || s.id === "favs") return picked;
    return s.channels.find((c) => c.kind !== "voice") ?? s.channels[0];
  });
  /** The server the open channel really belongs to (differs from space() for a favorite opened in place). */
  const chanSpace = createMemo<Space | undefined>(() => {
    const c = channel(), s = space();
    if (!c || !s || (!s.home && s.id !== "favs")) return s;
    return spaces()?.find((x) => !x.home && x.channels.some((y) => y.id === c.id)) ?? s;
  });
  const me = () => meNow()!;
  /** The call preview (from the mockup): in a call, looking at a different chat, not on a phone, not popped out. */
  const [previewH, setPreviewH] = createSignal(0);
  const [wide, setWide] = createSignal(matchMedia("(min-width: 901px)").matches);
  { const mq = matchMedia("(min-width: 901px)"); const f = () => setWide(mq.matches); mq.addEventListener("change", f); onCleanup(() => mq.removeEventListener("change", f)); }
  const showPreview = () => wide() && call.active() && !call.popped() && !!channel() && call.channel()?.id !== channel()?.id && !panel();
  // The DM partner's banner, blurred behind the call preview so it blends into their profile.
  const peerInfo = createProfileInfo(() => channel()?.peer?.id ?? "", () => !!channel()?.peer && showPreview());
  const peerBanner = () => (channel()?.peer ? peerInfo()?.bannerUrl : undefined);
  // Picture-in-picture (Android shrinks the whole app into a small floating window).
  const [pip, setPip] = createSignal(false);
  { const mq = matchMedia("(max-width: 520px) and (max-height: 520px)"); const f = () => setPip(mq.matches); f(); mq.addEventListener("change", f); onCleanup(() => mq.removeEventListener("change", f)); }
  /** Phones and tablets: the small call tile, whenever the call itself isn't what's on screen. */
  const showMini = () => !wide() && call.active() && !call.popped()
    && !(view() === "chat" && channel()?.id === call.channel()?.id && !phoneVoiceChat());
  const sideWidth = () => (matchMedia("(max-width: 1100px)").matches ? 214 : 244);
  const canMembers = () => !!chanSpace() && !chanSpace()!.home && chanSpace()!.id !== "favs";
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
  // Clicking a desktop notification (Windows) opens its chat.
  let offNotify: (() => void) | undefined;
  onCleanup(() => offNotify?.());
  if (inTauri()) void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("mustela:notify-open", (e) => { if (typeof e.payload === "string") openChannelById(e.payload); })).then((off) => { offNotify = off; }).catch(() => {});
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
    // "Mika", "Mika (Weekend plans)" for a group, "Mika (#general, Glass Garden)" in a server.
    const title = where?.c.kind === "dm" ? e.m.author.name
      : where?.c.kind === "group" ? `${e.m.author.name} (${where.c.name})`
      : `${e.m.author.name} (#${where?.c.name ?? "channel"}${where && !where.s.home ? `, ${where.s.name}` : ""})`;
    const body = plain(e.m.text, { user: (id) => backend()!.person(id).name, channel: (id) => backend()!.channelName(id) }) || "Sent an attachment";
    void notify(title, device().notifyPreview ? body.slice(0, 180) : direct ? "Sent you a message" : "Mentioned you", { icon: e.m.author.avatarUrl, channel: e.m.channelId });
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

  createEffect(() => { const cs = chanSpace(); setCurrentServer(cs && !cs.home && cs.id !== "favs" ? cs.id : null); });
  createEffect(() => {
    const s = space(), c = channel();
    if (!s || !c) return;
    if (s.home) { if (c.kind === "dm" || c.kind === "group") lastDm = c.id; }
    else if (s.id !== "favs") rememberChannel(s.id, c.id);
  });

  // The title bar says where you are, like Discord's.
  createEffect(() => {
    const s = space(), c = channel();
    if (!s) return;
    if (s.id === "favs") return setLocation({ text: c ? c.name : "Favorites" });
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

  /* ---- drag to rearrange: channels and categories (if you can manage them), pinned channels, favorites, pinned DMs ---- */
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

  type RowOpts = { fav?: () => void; saved?: boolean; drag?: Drag; drop?: ReturnType<typeof dropTo>; key?: string; sub?: string; onOpen?: () => void; server?: string };
  const row = (c: ChannelInfo, o: RowOpts = {}) => (
    <>
      <div class="chan-wrap" classList={{ "drop-line": !!o.key && dropAt() === o.key, dragging: !!o.drag && drag()?.id === o.drag.id }} {...(o.drop ?? {})}>
      <button class="chan" classList={{ on: channel()?.id === c.id, big: o.saved, unread: !!c.unread, muted: !!c.muted, dm: c.kind === "dm" || c.kind === "group" }} onClick={() => { setDiscover(false); if (o.onOpen) o.onOpen(); else pick(c); }}
        {...(o.drag ? dragFrom(o.drag) : {})}
        onContextMenu={(e) => (o.fav ? favoriteMenu(e, c, o.fav) : channelMenu(e, c, o.server ?? (space()?.home ? undefined : space()?.id)))}>
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
  /** Your favorites: the plain list, then your own categories. Each opens where it is, without leaving. */
  const favMenu = (e: MouseEvent) => openMenu(e, [
    { label: "New category…", icon: "plus", onSelect: () => newFavGroup() },
    { label: ext().favRail ? "Show on Home instead" : "Show as a button under Home", icon: "star", onSelect: () => updateExt((s) => ({ ...s, favRail: !s.favRail })) },
  ]);
  const favSection = () => {
    const plain = () => favourites().filter((f) => !ext().favIn[f.c.id]);
    const favRow = (f: { c: ChannelInfo; s: Space }, group: string | null) => row(f.c, {
      sub: f.s.name, server: f.s.id, onOpen: () => pick(f.c), fav: () => open(f.s.id, f.c.id),
      drag: { kind: "fav", id: f.c.id }, key: `fav:${f.c.id}`,
      drop: dropTo(`fav:${f.c.id}`, (d) => d.kind === "fav", (d) => { setFavGroup(d.id, group); reorderPinned("favourites", d.id, f.c.id); }),
    });
    return (
      <>
        {/* In the Favorites view the top bar is already the heading: just the list, the + and ⋯ live up there. */}
        <Show when={isFavs()}>
          <Show when={!favourites().length}><p class="empty small">Right-click a channel in any server and pick "Add to Favorites".</p></Show>
          <Show when={drag()?.kind === "fav" && ext().favGroups.length}><div class="chan-tail" classList={{ "drop-line": dropAt() === "fgrp:" }} {...dropTo("fgrp:", (d) => d.kind === "fav", (d) => setFavGroup(d.id, null))} /></Show>
          <For each={plain()}>{(f) => favRow(f, null)}</For>
        </Show>
        <Show when={!isFavs() && (plain().length || !ext().favGroups.length || drag()?.kind === "fav")}>
          <div class="cat pin-cat fav-cat" classList={{ "drop-into": dropAt() === "fgrp:" }} style={{ "--pin": "#f0b232" }} onContextMenu={favMenu}
            {...dropTo("fgrp:", (d) => d.kind === "fav", (d) => setFavGroup(d.id, null))}>
            <button class="fav-toggle" aria-expanded={!collapsed("\u2605favs")} onClick={() => toggleCat("\u2605favs")}>
              <Icon name="down" size={12} class={collapsed("\u2605favs") ? "rot" : ""} /><Icon name="star" size={12} />Favorites
            </button>
            <span class="grow" />
            <button class="cat-add" title="Favorites options" aria-label="Favorites options" onClick={(e) => favMenu(e)}><Icon name="dots" size={14} /></button>
            <button class="cat-add" title="New category" aria-label="New favorites category" onClick={() => newFavGroup()}><Icon name="plus" size={14} /></button>
          </div>
          <Show when={!favourites().length}><p class="empty small">Right-click a channel in any server and pick "Add to Favorites".</p></Show>
          <For each={plain().filter((f) => !collapsed("\u2605favs") || f.c.unread || f.c.id === channel()?.id)}>{(f) => favRow(f, null)}</For>
        </Show>
        <For each={ext().favGroups}>{(g) => {
          const list = () => favourites().filter((f) => ext().favIn[f.c.id] === g.id);
          const key = `\u2605fav:${g.id}`;
          return (
            <>
              <button class="cat pin-cat" classList={{ "drop-into": dropAt() === `fgrp:${g.id}` }} style={{ "--pin": g.color }} aria-expanded={!collapsed(key)} onClick={() => toggleCat(key)} onContextMenu={(e) => openMenu(e, favGroupItems(g))}
                {...dropTo(`fgrp:${g.id}`, (d) => d.kind === "fav", (d) => setFavGroup(d.id, g.id))}>
                <Icon name="down" size={12} class={collapsed(key) ? "rot" : ""} /><i class="pin-dot" />{g.name}
              </button>
              <Show when={!list().length && !collapsed(key)}><p class="empty small fav-empty">Drag favorites here.</p></Show>
              <For each={list().filter((f) => !collapsed(key) || f.c.unread || f.c.id === channel()?.id)}>{(f) => favRow(f, g.id)}</For>
            </>
          );
        }}</For>
      </>
    );
  };
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
          <button class="orb home" classList={{ on: space()?.id === s.id }} title="Home" aria-label="Home" aria-current={space()?.id === s.id ? "true" : undefined} onContextMenu={favMenu}
            onClick={() => open("home")}>
            <Icon name="home" size={24} />
            <Show when={mentions(s)}><span class="badge orb-badge">{mentions(s)}</span></Show>
          </button>
        )}</For>
        <Show when={ext().favRail}>
          <button class="orb home fav-orb" classList={{ on: isFavs() }} title="Favorites" aria-label="Favorites" aria-current={isFavs() ? "true" : undefined}
            onClick={() => { setDiscover(false); open("favs"); }} onContextMenu={favMenu}>
            <Icon name="star" size={24} />
            <Show when={favourites().reduce((n, f) => n + (f.c.mentions ?? 0), 0)}>{(n) => <span class="badge orb-badge">{n()}</span>}</Show>
          </button>
        </Show>
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
        <Show when={space() && !space()!.home && !isFavs()} fallback={
          <header class="bar side-bar" onContextMenu={(e) => isFavs() && favMenu(e)}><h2>{isFavs() ? "Favorites" : "Home"}</h2>
            <Show when={isFavs()}><span class="grow" />
              <button class="icon-btn" aria-label="New favorites category" title="New category" onClick={() => newFavGroup()}><Icon name="plus" size={18} /></button>
              <button class="icon-btn" aria-label="Favorites options" title="Favorites options" onClick={(e) => favMenu(e)}><Icon name="dots" size={18} /></button>
            </Show>
          </header>
        }>
          <Show when={space()!.bannerUrl} fallback={
            <header class="bar side-bar" onContextMenu={(e) => serverMenu(e, space()!)}><h2>{space()!.name}</h2><span class="grow" />
              <button class="icon-btn" aria-label="Server settings" title="Server settings" onClick={() => setServerSettings({ id: space()!.id })}><Icon name="gear" size={18} /></button></header>
          }>
            <header class="server-banner" onContextMenu={(e) => serverMenu(e, space()!)} style={{ "background-image": `url("${space()!.bannerUrl!.replace(/"/g, "%22")}")` }}><h2>{space()!.name}</h2>
              <button class="icon-btn sb-gear" aria-label="Server settings" title="Server settings" onClick={() => setServerSettings({ id: space()!.id })}><Icon name="gear" size={18} /></button></header>
          </Show>
        </Show>
        <div class="chans" onContextMenu={(e) => { if (space() && !space()!.home && !isFavs() && e.target === e.currentTarget) channelListMenu(e, space()!.id); }}>
          <Show when={!isFavs()} fallback={favSection()}>
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
            <Show when={!ext().favRail && favourites().length}>{favSection()}</Show>
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
                  <button class="icon-btn phone-only" classList={{ on: panel()?.kind === "search" }} aria-label="Search" title="Search"
                    onClick={() => setPanel(panel()?.kind === "search" ? null : { kind: "search", q: "" })}><Icon name="search" size={20} /></button>
                  <form class="search-box desk-only" role="search" onSubmit={(e) => { e.preventDefault(); const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim(); if (q) setPanel({ kind: "search", q }); }}>
                    <Icon name="search" size={16} />
                    <input name="q" placeholder="Search messages…" aria-label={`Search in ${c().name}`} autocomplete="off" onKeyDown={(e) => e.key === "Escape" && (e.currentTarget.value = "", setPanel(null))} />
                  </form>
                <Show when={direct(c())}>
                  <button class="icon-btn not-phone" aria-label={c().kind === "group" ? "Add friends to group" : "Add friends to DM"} title={c().kind === "group" ? "Add friends to group" : "Add friends to DM"} onClick={() => setGroupInvite(c())}><Icon name="user-plus" size={20} /></button>
                </Show>
                <Show when={c().kind === "dm" && c().peer}>
                  <button class="icon-btn" classList={{ on: device().dmProfile }} aria-pressed={device().dmProfile} aria-label="User profile" title={device().dmProfile ? "Hide user profile" : "Show user profile"}
                    onClick={() => (matchMedia("(max-width: 700px)").matches ? setProfileView({ person: c().peer!, full: false, x: 0, y: 0 }) : updateDevice({ dmProfile: !device().dmProfile }))}><Icon name="profile-side" size={20} /></button>
                </Show>
                <Show when={!hasTitleBar()}>
                  <button class="icon-btn inbox-btn not-phone" classList={{ on: inboxOpen() }} aria-label="Inbox" title="Inbox" onClick={() => setInboxOpen(!inboxOpen())}><Icon name="inbox" size={20} /><Show when={inboxBadge()}><span class="tb-dot" /></Show></button>
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
                  <Show when={c().kind === "voice"} fallback={<Chat channel={c()} spaceId={chanSpace()?.id} onProfile={setProfile} onOpenChannel={openChannelById} />}>
                    <Voice channel={c()} spaceId={chanSpace()?.id} onProfile={setProfile} onOpenChannel={openChannelById} />
                  </Show>
                </div>
                <Show when={showPreview()}>
                  <CallPreview minWidth={sideWidth()} onHeight={setPreviewH} onOpen={() => { const cc = call.channel(); if (cc) openChannelById(cc.id); }} />
                </Show>
                <Show when={panel()} fallback={
                  <Switch>
                    <Match when={canMembers() && device().showMembers && c().kind !== "voice"}><div class="members-col" style={{ "padding-top": showPreview() ? `${previewH() + 16}px` : undefined }}><Members spaceId={chanSpace()!.id} onOpen={setProfile} /></div></Match>
                    <Match when={c().kind === "dm" && c().peer && device().dmProfile}><div class="members-col dmp-col" classList={{ "has-cpv": showPreview() && !!peerBanner() }}
                      style={{ "padding-top": showPreview() ? `${previewH() + 16}px` : undefined, "--cpv-h": `${previewH()}px`, ...(peerBanner() ? { "--cpv-banner": `url("${peerBanner()!.replace(/"/g, "%22")}")` } : {}) }}><DmProfile person={c().peer!} /></div></Match>
                  </Switch>
                }>
                  {(pn) => <div class="members-col panel-col"><MessagePanel panel={pn()} channel={c()} onClose={() => setPanel(null)} /></div>}
                </Show>
              </div>
            </>
          )}
        </Show>
      </main>

      <Show when={sheetMembers() && chanSpace()}>
        <div class="scrim" onClick={() => setSheetMembers(false)}>
          <div class="modal sheet panel" onClick={(e) => e.stopPropagation()}>
            <Members spaceId={chanSpace()!.id} onOpen={(p) => { setSheetMembers(false); setProfile(p); }} />
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
      <NotifyPrompt />
      <Show when={pip() && call.active()}><PipView /></Show>
    </div>
  );
}
