/**
 * Settings that belong to one device and are never synced: a phone and a
 * desktop want different density, and window materials only exist on desktop.
 */
export type Density = "compact" | "default" | "comfy";
export type MessageLayout = "cozy" | "compact";
export type Style = "classic" | "flat";
/** Android calls: native keeps running when the app is swiped away (voice only); web has camera and screen share. */
export type CallEngine = "native" | "web";
export type Material = "none" | "mica" | "acrylic" | "blur" | "vibrancy" | "see-through";

export interface DeviceSettings {
  v: 1;
  density: Density;
  layout: MessageLayout;
  /** classic = iOS 6 bevels and gloss on top of Material You; flat = plain Material You */
  style: Style;
  /** theme = the chosen/custom seed; system = OS accent / Android dynamic color */
  colorSource: "theme" | "system";
  material: Material;
  /** Surface opacity 40-100 when a material is active */
  opacity: number;
  showMembers: boolean;
  callEngine: CallEngine;
  /** Desktop/phone notifications for DMs and mentions */
  notifications: boolean;
  /** What's drawn behind the panels: a starfield, a plain color, or your own picture */
  backdrop: "stars" | "plain" | "image";
  /** Collapsed channel categories, by "serverId/category" */
  collapsed: string[];
}

export const DEFAULT_DEVICE: DeviceSettings = {
  v: 1, density: "default", layout: "cozy", style: "classic",
  colorSource: "theme", material: "none", opacity: 82, showMembers: true, callEngine: "native", notifications: true, collapsed: [], backdrop: "stars",
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
    colorSource: oneOf(r.colorSource, ["theme", "system"], d.colorSource),
    material: oneOf(r.material, ["none", "mica", "acrylic", "blur", "vibrancy", "see-through"], d.material),
    opacity: typeof r.opacity === "number" && Number.isFinite(r.opacity) ? Math.min(100, Math.max(40, Math.round(r.opacity))) : d.opacity,
    showMembers: r.showMembers !== false,
    callEngine: oneOf(r.callEngine, ["native", "web"], d.callEngine),
    notifications: r.notifications !== false,
    backdrop: oneOf(r.backdrop, ["stars", "plain", "image"], d.backdrop),
    collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((x): x is string => typeof x === "string").slice(0, 200) : [],
  };
}

/** CSS variables for density. Everything in the stylesheet scales from these. */
export const DENSITY_VARS: Record<Density, Record<string, string>> = {
  compact: { "--row": "30px", "--pad": "6px", "--gap": "2px", "--avatar": "30px", "--font": "14px", "--rail": "60px", "--chan": "216px", "--bar": "42px", "--gapx": "5px" },
  default: { "--row": "38px", "--pad": "10px", "--gap": "4px", "--avatar": "40px", "--font": "15px", "--rail": "72px", "--chan": "240px", "--bar": "50px", "--gapx": "8px" },
  comfy: { "--row": "46px", "--pad": "14px", "--gap": "8px", "--avatar": "46px", "--font": "16px", "--rail": "78px", "--chan": "260px", "--bar": "56px", "--gapx": "10px" },
};
