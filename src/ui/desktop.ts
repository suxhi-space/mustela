import { createEffect, createRoot } from "solid-js";
import { inTauri } from "../lib/platform";
import { call, leaveCall, toggleCall } from "./call/state";
import { setSettingsOpen } from "./nav";
import { device, platform } from "./store";

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
export async function relaunchInstalled() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("relaunch_installed");
}
