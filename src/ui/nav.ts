import { createSignal } from "solid-js";
import type { Person } from "../lib/backend/types";

/**
 * App-wide navigation requests, so a menu deep in a message can open a profile,
 * a DM or server settings without threading callbacks through every component.
 * Shell owns the actual views and reads these.
 */
export type ServerTab = "overview" | "identity" | "channels" | "roles" | "discover" | "emojis" | "members" | "invites" | "bans";
export const [channelSettings, setChannelSettings] = createSignal<{ id: string; tab?: "overview" | "permissions" | "webhooks" } | null>(null);
export const [serverSettings, setServerSettings] = createSignal<{ id: string; tab?: ServerTab; channel?: string } | null>(null);
/** Profile on screen: a popout next to where you clicked (like Discord), or the full profile. */
export const [profileView, setProfileView] = createSignal<{ person: Person; full: boolean; x: number; y: number } | null>(null);
let lastPointer = { x: 0, y: 0, t: 0 };
if (typeof addEventListener !== "undefined") addEventListener("pointerdown", (e) => { lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
/** Opens someone's profile next to the pointer; without a recent click (keyboard), the full profile. */
export const openProfile = (p: Person, full = false) => {
  const near = Date.now() - lastPointer.t < 1000;
  setProfileView({ person: p, full: full || !near, x: lastPointer.x, y: lastPointer.y });
};
export const profileOpen = () => profileView()?.person ?? null;
export const setProfileOpen = (p: Person | null) => (p ? openProfile(p) : setProfileView(null));
export const [settingsOpen, setSettingsOpen] = createSignal<string | false>(false);

type Go = { channel(id: string): void; reply(m: { id: string }): void };
let go: Partial<Go> = {};
export const registerNav = (g: Partial<Go>) => { go = { ...go, ...g }; };
export const openChannel = (id: string) => go.channel?.(id);

/** The server you're looking at (null on Home), so profiles can show roles and "Member since" there. */
export const [currentServer, setCurrentServer] = createSignal<string | null>(null);

/** The profile editor window (Settings > Profile, "Edit profile" buttons) */
/** The profile editor: `server` opens it on your profile in that server instead of your main one. */
export const [profileEditorOpen, setProfileEditorOpen] = createSignal<{ server?: string } | null>(null);
export const openProfileEditor = (server?: string) => setProfileEditorOpen({ server });

/** Ask the open chat to scroll to (and load, if needed) a message. */
export const [jumpRequest, setJumpRequest] = createSignal<{ channelId: string; id: string; at: number } | null>(null);
export const requestJump = (channelId: string, id: string) => { setJumpRequest({ channelId, id, at: Date.now() }); openChannel(channelId); };

/** What the title bar shows in its middle: where you are (like Discord). */
export const [location, setLocation] = createSignal<{ text: string; icon?: string }>({ text: "Mustela" });
/** The inbox popover (unreads and mentions), opened from the title bar or the channel header. */
export const [inboxOpen, setInboxOpen] = createSignal(false);
export const [inboxBadge, setInboxBadge] = createSignal(0);
