import { createSignal, onMount, Show } from "solid-js";
import type { ChannelInfo, Person } from "../../lib/backend/types";
import { Icon } from "../icons";
import { CallStage } from "./CallStage";
import { call, startPopout } from "./state";

/**
 * The pop-out call window. It holds the call itself (picked up from the main
 * window), so cameras and shared screens play here. A thin title bar like
 * Discord's: the channel, keep-on-top, and the window buttons. Closing it
 * hands the call back to the main window.
 */
export function CallWindow() {
  const [, setMe] = createSignal<Person | null>(null);
  const [onTop, setOnTop] = createSignal(false);
  let win: any;
  onMount(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    win = getCurrentWindow();
    void startPopout(setMe, () => {});
  });
  const ch = (): ChannelInfo => call.channel() ?? { id: "", name: "Call", kind: "voice" };
  return (
    <main class="popout">
      <header class="pop-bar" data-tauri-drag-region>
        <Icon name="speaker" size={14} />
        <span class="pop-title" data-tauri-drag-region>{call.channel()?.name ?? "Connecting…"}</span>
        <span class="grow" data-tauri-drag-region />
        <button class="tb-tool" classList={{ on: onTop() }} title={onTop() ? "Stop keeping on top" : "Keep on top"} aria-pressed={onTop()}
          onClick={() => { const v = !onTop(); setOnTop(v); void win?.setAlwaysOnTop(v); }}><Icon name="pin" size={14} /></button>
        <button class="tb-win" aria-label="Minimize" onClick={() => void win?.minimize()}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8" /></svg></button>
        <button class="tb-win" aria-label="Maximize" onClick={() => void win?.toggleMaximize()}><svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg></button>
        <button class="tb-win tb-close" aria-label="Close and bring the call back" title="Bring the call back" onClick={() => void win?.close()}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg></button>
      </header>
      <Show when={call.channel()} fallback={<div class="cstage-idle"><div class="spinner" /><p class="muted">Moving the call here…</p></div>}>
        <CallStage channel={ch()} />
      </Show>
    </main>
  );
}
