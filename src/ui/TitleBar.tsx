import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { inTauri } from "../lib/platform";
import { Icon } from "./icons";
import { inboxBadge, inboxOpen, location, setInboxOpen } from "./nav";
import { phase } from "./store";
import { platform } from "./store";
import logo from "../../icons/app-icon.png";

/**
 * A thin title bar like Discord's: where you are in the middle, the inbox on
 * the right, then the window buttons. It's ours (not the system's) so window
 * materials and blur reach the top edge. macOS keeps its traffic lights.
 */
export const hasTitleBar = () => inTauri() && (platform === "windows" || platform === "mac" || platform === "linux");

export function TitleBar() {
  const [max, setMax] = createSignal(false);
  let win: any;
  onMount(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    win = getCurrentWindow();
    const sync = async () => setMax(await win.isMaximized().catch(() => false));
    void sync();
    const off = await win.onResized(() => void sync());
    onCleanup(off);
  });
  return (
    <header class="titlebar" data-tauri-drag-region onDblClick={(e) => { if ((e.target as HTMLElement).closest("button")) return; void win?.toggleMaximize(); }}>
      <span class="tb-mid" data-tauri-drag-region>
        <Show when={location().icon} fallback={<img src={logo} alt="" class="tb-icon" />}><img src={location().icon} alt="" class="tb-icon round" /></Show>
        <span data-tauri-drag-region>{location().text}</span>
      </span>
      <span class="tb-right">
        <Show when={phase() === "ready"}>
          <button class="tb-tool" classList={{ on: inboxOpen() }} aria-label="Inbox" title="Inbox" onClick={() => setInboxOpen(!inboxOpen())}>
            <Icon name="inbox" size={16} />
            <Show when={inboxBadge()}><span class="tb-dot" /></Show>
          </button>
        </Show>
        <Show when={platform !== "mac"}>
          <Show when={phase() === "ready"}><span class="tb-sep" /></Show>
          <button class="tb-win" aria-label="Minimize" onClick={() => void win?.minimize()}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8" /></svg></button>
          <button class="tb-win" aria-label={max() ? "Restore" : "Maximize"} onClick={() => void win?.toggleMaximize()}>
            <Show when={max()} fallback={<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg>}>
              <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 3V1.5h5.5V7H7M1.5 3h5.5v5.5H1.5z" /></svg>
            </Show>
          </button>
          <button class="tb-win tb-close" aria-label="Close" onClick={() => void win?.close()}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg></button>
        </Show>
      </span>
    </header>
  );
}
