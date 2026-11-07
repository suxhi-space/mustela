import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { MOBILE_UI } from "./target";
import { dragToClose } from "./sheetDrag";
import { useBack } from "./back";
import type { Presence } from "../lib/backend/types";
import { activeAccount } from "../lib/session/book";
import { instanceLabel, StatusEditor } from "./Accounts";
import { Avatar, createPerson, NameText } from "./Avatar";
import { call, toggleCall } from "./call/state";
import { createAnim } from "./anim";
import { createSize } from "./hooks";
import { Icon } from "./icons";
import { copy, openMenu, type MenuItem } from "./menu";
import { currentServer, inboxBadge, inboxOpen, openProfileEditor, setInboxOpen, setProfileView, setSettingsOpen } from "./nav";
import { createProfileInfo } from "./hooks";
import { TextWithEmoji } from "./chat/Markdown";
import { PlateCanvas } from "./Paint";
import { ProfileCard } from "./Profile";
import { backend, book, bumpMe, device, ext, meNow, removeAccountById, setAddingAccount, settings, switchAccount, updateDevice } from "./store";

const PRESENCE: { v: Presence; label: string; hint?: string }[] = [
  { v: "online", label: "Online" }, { v: "idle", label: "Idle" }, { v: "focus", label: "Focus", hint: "Quieter notifications" },
  { v: "busy", label: "Do Not Disturb", hint: "No notifications" }, { v: "invisible", label: "Invisible", hint: "You'll appear offline" },
];
const LABEL: Record<string, string> = { online: "Online", idle: "Idle", focus: "Focus", busy: "Do Not Disturb", invisible: "Invisible" };

async function devices(kind: MediaDeviceKind) {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications"); } catch { return []; }
}

/** The chevron menus beside mute and deafen: pick a device, or jump to voice settings. */
async function deviceMenu(el: Element, kind: "audioinput" | "audiooutput") {
  const list = await devices(kind);
  const v = device().voice, key = kind === "audioinput" ? "inputDevice" : "outputDevice";
  const items: MenuItem[] = [
    { header: kind === "audioinput" ? "Input device" : "Output device" },
    { label: "System default", checked: !v[key], onSelect: () => updateDevice({ voice: { ...device().voice, [key]: "" } }) },
    ...list.map((d, i): MenuItem => ({ label: d.label || `${kind === "audioinput" ? "Microphone" : "Speaker"} ${i + 1}`, checked: v[key] === d.deviceId, onSelect: () => updateDevice({ voice: { ...device().voice, [key]: d.deviceId } }) })),
    { sep: true },
    { label: "Voice settings", icon: "gear", onSelect: () => setSettingsOpen("voice") },
  ];
  openMenu(el, items);
}

/** Your card (status, accounts, edit profile): opened from the bottom-left panel, or "You" on a phone. */
export const [meCardOpen, setMeCardOpen] = createSignal(false);

/**
 * Bottom-left, like Discord: your nameplate behind you, your avatar (ringed
 * green while you talk), your name and custom status, mute, deafen, settings.
 * Click yourself for your card: edit profile, status, accounts.
 */
export function UserPanel() {
  const me = () => meNow()!;
  const open = meCardOpen, setOpen = setMeCardOpen;
  // Your look in the server you're in, if you made one; your main profile otherwise.
  const mine = () => { const sid = currentServer(); return (sid && ext().serverLooks[sid]?.config) || settings().profile; };
  const { profile } = createPerson(me, mine);
  const [size, sizeRef] = createSize();
  const anim = createAnim(profile, "plate");
  const talking = () => call.active() && call.speaking().includes(me().id);
  const sound = () => call.active() && call.soundboard().includes(me().id);
  // Outside a call the buttons set how you'll join, like Discord.
  // Like Discord: deafened means muted too, but undeafening gives you back your own mute choice.
  const micOff = () => (call.active() ? !call.on().mic : device().voice.joinMuted || device().voice.joinDeafened);
  const deaf = () => (call.active() ? call.on().deaf : device().voice.joinDeafened);
  const toggle = (k: "mic" | "deaf") => {
    if (call.active()) return void toggleCall(k);
    const v = device().voice;
    // Unmuting while deafened undeafens too.
    updateDevice({ voice: k === "mic" ? (v.joinDeafened ? { ...v, joinMuted: false, joinDeafened: false } : { ...v, joinMuted: !v.joinMuted }) : { ...v, joinDeafened: !v.joinDeafened } });
  };
  const sub = () => me().status || LABEL[me().online ? me().presence ?? "online" : "invisible"];
  return (
    <div class="userpanel" ref={sizeRef}>
      <Show when={profile()?.plate.preset && size().w > 0}>
        <PlateCanvas slot={() => profile()!.plate} w={size().w} h={size().h} animate={anim()} />
      </Show>
      <button class="up-me" onClick={() => { setInboxOpen(false); setOpen(!open()); }} aria-haspopup="dialog" aria-expanded={open()} aria-label="Your profile and status">
        <span class="up-av" classList={{ talking: talking() && !sound(), sound: sound() }}><Avatar person={me()} size={MOBILE_UI ? 40 : 34} profile={mine()} /></span>
        <span class="up-text"><NameText person={me()} profile={mine()} class="up-name" /><small><TextWithEmoji v={sub() ?? ""} /></small></span>
      </button>
      <span class="up-ctl">
        <button class="up-btn" classList={{ off: micOff() }} aria-pressed={micOff()} title={micOff() ? "Unmute" : "Mute"} onClick={() => toggle("mic")}><Icon name={micOff() ? "mic-off" : "mic"} size={18} /></button>
        <button class="up-chev" aria-label="Microphone options" onClick={(e) => void deviceMenu(e.currentTarget, "audioinput")}><Icon name="down" size={12} /></button>
        <button class="up-btn" classList={{ off: deaf() }} aria-pressed={deaf()} title={deaf() ? "Undeafen" : "Deafen"} onClick={() => toggle("deaf")}><Icon name={deaf() ? "headphones-off" : "headphones"} size={18} /></button>
        <button class="up-chev" aria-label="Output options" onClick={(e) => void deviceMenu(e.currentTarget, "audiooutput")}><Icon name="down" size={12} /></button>
        <button class="up-btn up-gear" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen("account")}><Icon name="gear" size={MOBILE_UI ? 22 : 18} /></button>
        {/* Phones and tablets (no title bar to hold it): the inbox bell, like Discord mobile's card. */}
        <button class="up-btn up-bell" classList={{ on: inboxOpen() }} aria-pressed={inboxOpen()} title="Inbox" aria-label="Inbox" onClick={() => { setMeCardOpen(false); setInboxOpen(!inboxOpen()); }}>
          <Icon name="bell" size={MOBILE_UI ? 22 : 20} /><Show when={inboxBadge()}><span class="badge up-badge">{inboxBadge() > 99 ? "99+" : inboxBadge()}</span></Show>
        </button>
      </span>
    </div>
  );
}

/** The card itself, outside the panel so the phone's bottom bar can open it too. */
export function MeCardHost() {
  return <Show when={meCardOpen()}><MeCard onClose={() => setMeCardOpen(false)} /></Show>;
}

/** Your own card above the panel: profile, edit, status, accounts. */
function MeCard(props: { onClose(): void }) {
  useBack(() => props.onClose());
  const me = () => meNow()!;
  const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
  addEventListener("keydown", esc); onCleanup(() => removeEventListener("keydown", esc));
  const setPresence = (v: Presence) => void backend()?.updateMe({ presence: v }).then(bumpMe).catch(() => {});
  const presence = () => (me().online ? me().presence ?? "online" : "invisible");
  // Your published card (banner and bio); decorations come straight from settings so edits show at once.
  const info = createProfileInfo(() => me().id);
  // "Edit profile" opens the editor: on desktop on this server's profile when you're in one, on phones and tablets
  // your main profile (pick a server inside the editor).
  const editTarget = () => (MOBILE_UI ? undefined : currentServer() ?? undefined);
  // Your picture or name: on computers your full profile (Edit profile is right there on the card already); on
  // phones and tablets the editor, as before.
  const edit = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest(".pc-avatar, .pc-name")) return;
    props.onClose();
    if (MOBILE_UI) openProfileEditor(editTarget());
    else setProfileView({ person: me(), full: true, x: 0, y: 0 });
  };
  // Phones and tablets: a sheet from the bottom; pull it down to close.
  let card!: HTMLDivElement;
  onMount(() => { if (MOBILE_UI) dragToClose(card, props.onClose, { full: true }); });
  // Computers: a click outside closes the card and still does what you clicked (a text box gets the cursor straight
  // away). Menus opened from the card and the nameplate itself (which toggles the card) don't count as outside.
  if (!MOBILE_UI) {
    const outside = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || card.contains(t) || t.closest(".up-me, .ctx, .ctx-scrim, .scrim, .modal, .toast")) return;
      props.onClose();
    };
    onMount(() => document.addEventListener("pointerdown", outside, true));
    onCleanup(() => document.removeEventListener("pointerdown", outside, true));
  }
  return (
    <div class="pop-scrim clear" classList={{ "pass-through": !MOBILE_UI }} onClick={props.onClose}>
      <div ref={card} class="mecard" role="dialog" aria-label="Your profile" onClick={(e) => { e.stopPropagation(); edit(e); }}>
        {/* Phones and tablets: a way out at the top too, besides swiping down */}
        <Show when={MOBILE_UI}><button class="icon-btn me-back" aria-label="Close" title="Close" onClick={(e) => { e.stopPropagation(); props.onClose(); }}><Icon name="back" size={22} /></button></Show>
        <ProfileCard person={me()} profile={info()?.config ?? settings().profile} bio={info()?.bio} banner={info()?.bannerUrl} marked={!!info()?.bannerUrl} compact>
          <div class="me-list">
            <button class="me-row" onClick={() => { props.onClose(); openProfileEditor(editTarget()); }}><Icon name="pencil" size={17} /><span>Edit profile</span></button>
            <button class="me-row" onClick={(e) => openMenu(e.currentTarget, PRESENCE.map((p) => ({ label: p.label, hint: p.hint, checked: presence() === p.v, onSelect: () => setPresence(p.v) })))}>
              <span class={`pdot p-${presence()}`} /><span>{LABEL[presence()]}</span><Icon name="right" size={14} class="muted" />
            </button>
            <div class="me-status"><StatusEditor /></div>
          </div>
          <div class="me-list">
            <button class="me-row" onClick={(e) => openMenu(e.currentTarget, [
              ...book().accounts.map((a): MenuItem => ({ label: `${a.name} (${a.kind === "demo" ? "demo" : instanceLabel(a.baseURL)})`, checked: a.id === activeAccount(book())?.id, onSelect: () => { props.onClose(); void switchAccount(a.id); } })),
              { sep: true },
              { label: "Add an account", icon: "plus", onSelect: () => { props.onClose(); setAddingAccount(true); } },
              { label: "Log out of this account", icon: "logout", danger: true, onSelect: () => { const a = activeAccount(book()); if (a) void removeAccountById(a.id); } },
            ])}><Icon name="swap" size={17} /><span>Switch accounts</span><Icon name="right" size={14} class="muted" /></button>
            <button class="me-row" onClick={() => { void copy(me().id, "User ID copied"); }}><Icon name="id" size={17} /><span>Copy user ID</span></button>
            <button class="me-row me-settings" onClick={() => { props.onClose(); setSettingsOpen("account"); }}><Icon name="gear" size={17} /><span>Settings</span></button>
          </div>
        </ProfileCard>
      </div>
    </div>
  );
}

