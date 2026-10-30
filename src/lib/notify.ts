import { inTauri } from "./platform";

/**
 * Shows a system notification. Uses the Tauri notification plugin in the app
 * (works on Windows, macOS, Linux and Android) and the Web Notification API in
 * a browser. Asks for permission the first time; never throws.
 */
export async function notify(title: string, body: string, extra: { icon?: string; channel?: string } = {}): Promise<boolean> {
  try {
    if (inTauri()) {
      const n = await import("@tauri-apps/plugin-notification");
      let ok = await n.isPermissionGranted();
      if (!ok) ok = (await n.requestPermission()) === "granted";
      if (!ok) return false;
      // Desktop: Mustela's own, with the sender's picture (and on Windows, a click opens the chat).
      if (!/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("notify_rich", { title, body, icon: extra.icon ?? null, channel: extra.channel ?? null });
          return true;
        } catch { /* fall back to the plain one */ }
      }
      n.sendNotification({ title, body });
      return true;
    }
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return false;
    new Notification(title, { body, silent: false });
    return true;
  } catch {
    return false;
  }
}

/** Opens http(s) links in the system browser when running as the app. */
export function routeExternalLinks() {
  if (!inTauri()) return;
  addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || !/^https?:/i.test(a.href)) return;
    e.preventDefault();
    void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(a.href)).catch(() => {});
  }, true);
}
