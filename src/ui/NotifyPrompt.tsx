import { createSignal, onMount, Show } from "solid-js";
import { inTauri } from "../lib/platform";
import { Icon } from "./icons";
import { platform } from "./store";

const ASKED = "mustela:asked-notify";
const mobile = () => platform === "android" || /iPhone|iPad|iPod/i.test(navigator.userAgent);

/** The first time Mustela opens on a phone or tablet: a card asking to turn on notifications, so DMs and
 * mentions reach you when the app is closed. Shown once; Settings > Notifications has it after that. */
export function NotifyPrompt() {
  const [show, setShow] = createSignal(false);
  const done = () => { try { localStorage.setItem(ASKED, "1"); } catch {} setShow(false); };
  onMount(async () => {
    if (!mobile()) return;
    try { if (localStorage.getItem(ASKED)) return; } catch { return; }
    try {
      if (inTauri()) { const n = await import("@tauri-apps/plugin-notification"); if (await n.isPermissionGranted()) return done(); }
      else if (typeof Notification === "undefined" || Notification.permission !== "default") return done();
    } catch { return; }
    setShow(true);
  });
  const allow = async () => {
    try {
      if (inTauri()) await (await import("@tauri-apps/plugin-notification")).requestPermission();
      else await Notification.requestPermission();
    } catch {}
    done();
  };
  return (
    <Show when={show()}>
      <div class="scrim" onClick={done}>
        <div class="modal panel notify-prompt" role="dialog" aria-label="Turn on notifications" onClick={(e) => e.stopPropagation()}>
          <span class="np-icon"><Icon name="bell" size={30} /></span>
          <h2>Don't miss a message</h2>
          <p class="muted">Turn on notifications to hear about DMs, mentions and calls while Mustela is closed. You can change this any time in Settings.</p>
          <div class="np-actions">
            <button class="btn primary" onClick={() => void allow()}>Turn on notifications</button>
            <button class="btn" onClick={done}>Not now</button>
          </div>
        </div>
      </div>
    </Show>
  );
}
