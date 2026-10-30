import type { VoicePrefs } from "./backend/types";

export interface A11yPrefs {
  /** Hold animations still: always, never, or when the system asks (Windows' animation effects off, etc.) */
  reduceMotion: "on" | "off" | "system";
  /** Touch screens: text a size up */
  touchText: boolean;
  /** Links in messages always underlined */
  underlineLinks: boolean;
  /** Names in their role's colour */
  roleColors: boolean;
  /** Messages a little heavier and more spaced out, easier to read */
  readable: boolean;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  inputDevice: "", outputDevice: "", videoDevice: "", echoCancellation: true, noiseSuppression: true, autoGain: true,
  outputVolume: 100, screenQuality: "720p30", joinMuted: false, joinDeafened: false, autoSensitivity: true, threshold: -55, soundboardVolume: 80, entrySound: "",
};

function sanitizeVoice(raw: unknown): VoicePrefs {
  const d = DEFAULT_VOICE_PREFS;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" && x.length < 300 ? x : "");
  return {
    inputDevice: str(r.inputDevice), outputDevice: str(r.outputDevice), videoDevice: str(r.videoDevice),
    echoCancellation: r.echoCancellation !== false, noiseSuppression: r.noiseSuppression !== false, autoGain: r.autoGain !== false,
    outputVolume: typeof r.outputVolume === "number" && Number.isFinite(r.outputVolume) ? Math.max(0, Math.min(200, Math.round(r.outputVolume))) : d.outputVolume,
    screenQuality: (["720p30", "1080p30", "1080p60"] as const).includes(r.screenQuality as any) ? (r.screenQuality as VoicePrefs["screenQuality"]) : d.screenQuality,
    joinMuted: r.joinMuted === true,
    joinDeafened: r.joinDeafened === true,
    autoSensitivity: r.autoSensitivity !== false,
    threshold: typeof r.threshold === "number" && Number.isFinite(r.threshold) ? Math.max(-100, Math.min(0, Math.round(r.threshold))) : d.threshold,
    soundboardVolume: typeof r.soundboardVolume === "number" && Number.isFinite(r.soundboardVolume) ? Math.max(0, Math.min(100, Math.round(r.soundboardVolume))) : d.soundboardVolume,
    entrySound: str(r.entrySound),
  };
}

/**
 * Settings that belong to one device and are never synced: a phone and a
 * desktop want different density, and window materials only exist on desktop.
 */
export type Density = "compact" | "default" | "comfy";
export type MessageLayout = "cozy" | "compact";
export type Style = "classic" | "flat";
/** Android calls: native keeps running when the app is swiped away (voice only); web has camera and screen share. */
export type CallEngine = "native" | "web";
export type Material = "none" | "mica" | "acrylic" | "blur" | "vibrancy";

export interface DeviceSettings {
  v: 1;
  density: Density;
  layout: MessageLayout;
  /** classic = iOS 6 bevels and gloss on top of Material You; flat = plain Material You */
  style: Style;
  /** theme = the chosen/custom seed; system = OS accent / Android dynamic color */
  colorSource: "theme" | "system" | "picture";
  material: Material;
  /** Surface opacity 40-100 when a material is active */
  opacity: number;
  showMembers: boolean;
  callEngine: CallEngine;
  /** Android: leaving the app mid-call shows the voice bubble, or floats the call (picture-in-picture) */
  callOverlay: "bubble" | "pip";
  /** Desktop/phone notifications for DMs and mentions */
  notifications: boolean;
  /** Show the message text in notifications (off = "New message" only) */
  notifyPreview: boolean;
  /** Sounds: new message, someone joins/leaves your call, mute/deafen clicks */
  sounds: { message: boolean; call: boolean; toggles: boolean };
  /** Flash the taskbar / dock badge for unread mentions */
  badge: boolean;
  /** What's drawn behind the panels: a starfield, a plain color, or your own picture */
  backdrop: "stars" | "plain" | "gradient" | "image";
  /** The picture behind the panels, blurred */
  backdropBlur: boolean;
  /** How solid the panels are over a picture or gradient (15-100): lower lets more of it through */
  panelOpacity: number;
  /** Frosted blur behind the panels over a picture or gradient */
  panelBlur: boolean;
  /** Microphone, speakers, camera and processing (Settings > Voice & Video) */
  voice: VoicePrefs;
  /** Phones: the small call tile that follows you around the app */
  miniCall: boolean;
  /** Settings > Accessibility */
  a11y: A11yPrefs;
  /** Off: this device keeps its own colours and theme instead of following your account's */
  syncLook: boolean;
  /** This device's own colours and theme, while syncLook is off (same shape as the synced look) */
  localLook: unknown;
  /** Game detection and Discord Rich Presence (desktop) */
  activity: { detect: boolean; rpc: boolean; share: boolean; hidden: string[] };
  /** Voice channels: show the text chat beside the call */
  voiceChat: boolean;
  /** Direct messages: show the other person's profile beside the chat */
  dmProfile: boolean;
  /** Text and message display, like Stoat's Appearance page */
  text: { size: number; spacing: number; font: string };
  /** Desktop: closing the window keeps Mustela running in the tray */
  closeToTray: boolean;
  /** Calls: show only cameras and streams (and you) */
  hideNoVideo: boolean;
  /** Settings > Mustela > Performance */
  perf: PerfPrefs;
  /** Desktop: Mustela's thin title bar, or the system's own window frame */
  titleBar: "mustela" | "system";
  /** Look for a new release on start and every few hours (builds made with an update repository) */
  autoUpdate: boolean;
  /** Collapsed channel categories, by "serverId/category" */
  collapsed: string[];
}

export interface PerfPrefs {
  /** Decorations, effects, frames and nameplates: moving, slower and lighter, or still */
  anim: "full" | "reduced" | "off";
  /** Animate less while you're in a call, and less again while sharing or watching a stream */
  lighterInCalls: boolean;
  /** Keep animating while another window (a game) is in front */
  background: boolean;
  /** GIFs and animated emoji play by themselves (off: they play when you point at them) */
  gifs: boolean;
  /** Blur behind menus, settings and pop-ups */
  blur: boolean;
  /** Hold everything still when the system asks for less motion (Windows' "Animation effects" off, and the like) */
  systemMotion: boolean;
}
/** Linux's WebKitGTK is the slowest engine at blur and canvas, and some GPU drivers crash with it, so it starts lighter. */
const isLinux = () => typeof navigator !== "undefined" && /Linux|X11/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
export const defaultPerf = (): PerfPrefs => ({ anim: isLinux() ? "reduced" : "full", lighterInCalls: true, background: false, gifs: true, blur: !isLinux(), systemMotion: false });

export const DEFAULT_DEVICE: DeviceSettings = {
  v: 1, density: "default", layout: "cozy", style: "classic",
  colorSource: "theme", material: "none", opacity: 82, showMembers: true, callEngine: "web", callOverlay: "bubble", notifications: true, notifyPreview: true, sounds: { message: true, call: true, toggles: true }, badge: true, activity: { detect: true, rpc: true, share: true, hidden: [] }, closeToTray: true, autoUpdate: true, hideNoVideo: false, perf: defaultPerf(), titleBar: "mustela", voiceChat: true, dmProfile: true, text: { size: 15, spacing: 8, font: "" }, collapsed: [], backdrop: "plain", backdropBlur: false, panelOpacity: 80, panelBlur: true, a11y: { reduceMotion: "off", touchText: true, underlineLinks: false, roleColors: true, readable: false }, syncLook: true, localLook: null, miniCall: true, voice: { ...DEFAULT_VOICE_PREFS },
};

const oneOf = <T extends string>(x: unknown, all: readonly T[], d: T): T => (all.includes(x as T) ? (x as T) : d);

export function sanitizeDevice(raw: unknown): DeviceSettings {
  const d = DEFAULT_DEVICE;
  if (!raw || typeof raw !== "object") return { ...d };
  const r = raw as Record<string, unknown>;
  return {
    v: 1,
    density: oneOf(r.density, ["compact", "default", "comfy"], d.density),
    layout: oneOf(r.layout, ["cozy", "compact"], d.layout),
    style: oneOf(r.style, ["classic", "flat"], d.style),
    colorSource: oneOf(r.colorSource, ["theme", "system", "picture"], d.colorSource),
    material: oneOf(r.material, ["none", "mica", "acrylic", "blur", "vibrancy"], d.material),
    opacity: typeof r.opacity === "number" && Number.isFinite(r.opacity) ? Math.min(100, Math.max(40, Math.round(r.opacity))) : d.opacity,
    showMembers: r.showMembers !== false,
    callEngine: oneOf(r.callEngine, ["native", "web"], d.callEngine),
    callOverlay: oneOf(r.callOverlay, ["bubble", "pip"], d.callOverlay),
    notifications: r.notifications !== false,
    notifyPreview: r.notifyPreview !== false,
    sounds: { message: (r.sounds as any)?.message !== false, call: (r.sounds as any)?.call !== false, toggles: (r.sounds as any)?.toggles !== false },
    badge: r.badge !== false,
    closeToTray: r.closeToTray !== false,
    autoUpdate: r.autoUpdate !== false,
    hideNoVideo: r.hideNoVideo === true,
    perf: (() => {
      const p = (r.perf ?? {}) as Record<string, unknown>, d0 = defaultPerf();
      return {
        anim: oneOf(p.anim, ["full", "reduced", "off"], d0.anim),
        lighterInCalls: typeof p.lighterInCalls === "boolean" ? p.lighterInCalls : d0.lighterInCalls,
        background: typeof p.background === "boolean" ? p.background : d0.background,
        gifs: typeof p.gifs === "boolean" ? p.gifs : d0.gifs,
        blur: typeof p.blur === "boolean" ? p.blur : d0.blur,
        systemMotion: typeof p.systemMotion === "boolean" ? p.systemMotion : d0.systemMotion,
      };
    })(),
    titleBar: oneOf(r.titleBar, ["mustela", "system"], d.titleBar),
    voiceChat: r.voiceChat !== false,
    dmProfile: r.dmProfile !== false,
    text: {
      size: typeof (r.text as any)?.size === "number" ? Math.min(20, Math.max(12, Math.round((r.text as any).size))) : d.text.size,
      spacing: typeof (r.text as any)?.spacing === "number" ? Math.min(24, Math.max(0, Math.round((r.text as any).spacing))) : d.text.spacing,
      font: typeof (r.text as any)?.font === "string" && ["system", "serif", "rounded"].includes((r.text as any).font) ? (r.text as any).font : "",
    },
    activity: {
      detect: (r.activity as any)?.detect !== false, rpc: (r.activity as any)?.rpc !== false, share: (r.activity as any)?.share !== false,
      hidden: Array.isArray((r.activity as any)?.hidden) ? ((r.activity as any).hidden as unknown[]).filter((x): x is string => typeof x === "string" && x.length < 200).slice(0, 200) : [],
    },
    backdrop: oneOf(r.backdrop, ["stars", "plain", "gradient", "image"], d.backdrop),
    backdropBlur: r.backdropBlur === true,
    panelBlur: r.panelBlur !== false,
    panelOpacity: typeof r.panelOpacity === "number" && Number.isFinite(r.panelOpacity) ? Math.round(Math.min(100, Math.max(15, r.panelOpacity))) : d.panelOpacity,
    voice: sanitizeVoice(r.voice),
    a11y: (() => {
      const a = (r.a11y ?? {}) as Record<string, unknown>;
      // Before this page existed, "follow the system's reduce motion" lived under Performance.
      const old = (r.perf as any)?.systemMotion === true ? "system" : "off";
      return {
        reduceMotion: oneOf(a.reduceMotion, ["on", "off", "system"], old),
        touchText: a.touchText !== false, underlineLinks: a.underlineLinks === true, roleColors: a.roleColors !== false, readable: a.readable === true,
      };
    })(),
    syncLook: r.syncLook !== false,
    miniCall: r.miniCall !== false,
    localLook: r.localLook && typeof r.localLook === "object" ? r.localLook : null,
    collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((x): x is string => typeof x === "string").slice(0, 200) : [],
  };
}

/** CSS variables for density. Everything in the stylesheet scales from these. */
export const DENSITY_VARS: Record<Density, Record<string, string>> = {
  compact: { "--row": "30px", "--pad": "6px", "--gap": "2px", "--avatar": "30px", "--font": "14px", "--rail": "60px", "--chan": "216px", "--bar": "42px", "--gapx": "5px" },
  default: { "--row": "38px", "--pad": "10px", "--gap": "4px", "--avatar": "40px", "--font": "15px", "--rail": "72px", "--chan": "240px", "--bar": "50px", "--gapx": "8px" },
  comfy: { "--row": "46px", "--pad": "14px", "--gap": "8px", "--avatar": "46px", "--font": "16px", "--rail": "78px", "--chan": "260px", "--bar": "56px", "--gapx": "10px" },
};
