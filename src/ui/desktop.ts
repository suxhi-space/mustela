import { createEffect, createRoot } from "solid-js";
import { inTauri } from "../lib/platform";
import { call, leaveCall, toggleCall } from "./call/state";
import { setSettingsOpen } from "./nav";
import { device, meNow, platform } from "./store";

/** The dot on the tray icon: your status colour (the same as everywhere else in the app). */
const DOT: Record<string, string> = { online: "#23a559", idle: "#e3a008", focus: "#4a86e8", busy: "#e5484d", invisible: "#80848e" };

/**
 * icons/tray/tray.svg with its dot in your status colour, as a PNG for the tray. In a call the dot gets a white
 * centre, like a "live" light, so you can tell at a glance.
 */
async function drawTray(status: string, inCall: boolean): Promise<Uint8Array | null> {
  // The size the tray actually shows. Larger bitmaps get padded down on Windows and look tiny;
  // 24px is the normal panel icon on Linux. The face is drawn a little bigger than the svg's margin.
  const size = platform === "linux" ? 24 : platform === "mac" ? 22 : 32;
  const ring = inCall ? '<circle cx="419.365" cy="443.942" r="24" style="fill:#fff"/>' : "";
  const traySvg = (await import("../../icons/tray/tray.svg?raw")).default; // computers only: not in the phone app
  const svg = traySvg
    .replace('width="100%" height="100%"', `width="${size}" height="${size}"`)
    .replace(/<circle ([^>]*?)\/>/, `<circle $1 style="fill:${DOT[status] ?? DOT.online};stroke:#353535;stroke-width:16px"/>${ring}`);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  try { await img.decode(); } catch { return null; }
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const fill = size * 1.12;
  ctx.drawImage(img, (size - fill) / 2, (size - fill) / 2, fill, fill);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

export const isDesktopApp = () => inTauri() && (platform === "windows" || platform === "mac" || platform === "linux");

/**
 * The tray icon (Rust side, src-tauri/src/desktop.rs) mirrors the call state,
 * and its menu drives mute, deafen, leave and settings here.
 */
export function startDesktop() {
  if (!isDesktopApp()) return;
  createRoot(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    createEffect(() => {
      const on = call.on();
      void invoke("tray_state", { inCall: call.active(), channel: call.channel()?.name ?? null, mic: on.mic, deaf: on.deaf }).catch(() => {});
    });
    createEffect(() => { void invoke("set_close_to_tray", { on: device().closeToTray }).catch(() => {}); });
    // The tray icon's dot follows your status, and shows when you're in a call.
    let drawn = "";
    createEffect(() => {
      const me = meNow();
      const status = !me ? "online" : me.online === false ? "invisible" : me.presence ?? "online";
      const key = `${status}:${call.active()}`;
      if (key === drawn) return;
      drawn = key;
      void drawTray(status, call.active()).then((png) => { if (png && drawn === key) void invoke("tray_image", { png: Array.from(png) }).catch(() => {}); });
    });
    await listen<string>("tray://action", (e) => {
      if (e.payload === "mute") void toggleCall("mic");
      else if (e.payload === "deafen") void toggleCall("deaf");
      else if (e.payload === "leave") void leaveCall();
      else if (e.payload === "settings") setSettingsOpen("account");
    });
  });
}

/** Start with the computer (minimized to the tray). */
export async function autostart(on?: boolean): Promise<boolean> {
  if (!isDesktopApp()) return false;
  const m = await import("@tauri-apps/plugin-autostart");
  if (on === true) await m.enable(); else if (on === false) await m.disable();
  return m.isEnabled();
}

/** Linux AppImage: offer to move into ~/Applications with a menu entry. */
export async function appImage(): Promise<{ isAppImage: boolean; installed: boolean; path?: string } | null> {
  if (!inTauri() || platform !== "linux") return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("appimage_status");
}
export async function installAppImage(desktopShortcut: boolean): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("appimage_install", { desktopShortcut });
}
