import { createSignal, onMount, Show } from "solid-js";
import type { ChannelInfo } from "../../lib/backend/types";
import { inTauri } from "../../lib/platform";
import { Icon } from "../icons";
import { ContextMenu } from "../menu";
import { platform } from "../store";
import { CallStage } from "./CallStage";
import { ScreenPickerHost } from "./ScreenPicker";
import { Soundboard } from "./Soundboard";
import { call, closePopout } from "./state";

/**
 * What the pop-out window shows. It's drawn by the main window (see popout.tsx), which keeps
 * the call. A thin title bar like Discord's: the channel, keep-on-top, and the window buttons.
 * Closing it puts the call back in the main window, without reconnecting.
 */
export function CallWindow(props: { win: Window }) {
  const [onTop, setOnTop] = createSignal(false);
  // The shell's window for the pop-out, for moving, sizing and keep-on-top (macOS and Linux).
  // On Windows (and in a browser) the pop-out is the web view's own window with a normal frame,
  // so this bar isn't needed there.
  const [tw, setTw] = createSignal<any>(null);
  onMount(async () => {
    if (!inTauri()) return;
    const { Window } = await import("@tauri-apps/api/window");
    setTw(await Window.getByLabel("call").catch(() => null));
  });
  const framed = () => platform !== "mac"; // macOS keeps its traffic lights
  const ch = (): ChannelInfo => call.channel() ?? { id: "", name: "Call", kind: "voice" };
  const drag = (e: MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    if (e.detail === 2) { void tw()?.toggleMaximize(); return; }
    void tw()?.startDragging();
  };
  return (
    <main class="popout">
      <Show when={tw()}>
        <header class="pop-bar" onMouseDown={drag}>
          <Icon name="speaker" size={14} />
          <span class="pop-title">{call.channel()?.name ?? "Call"}</span>
          <span class="grow" />
          <button class="tb-tool" classList={{ on: onTop() }} title={onTop() ? "Stop keeping on top" : "Keep on top"} aria-pressed={onTop()}
            onClick={() => { const v = !onTop(); setOnTop(v); void tw()?.setAlwaysOnTop(v); }}><Icon name="pin" size={14} /></button>
          <Show when={framed()}>
            <button class="tb-win" aria-label="Minimize" onClick={() => void tw()?.minimize()}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8" /></svg></button>
            <button class="tb-win" aria-label="Maximize" onClick={() => void tw()?.toggleMaximize()}><svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg></button>
            <button class="tb-win tb-close" aria-label="Close and bring the call back" title="Bring the call back" onClick={() => void closePopout()}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="m2 2 6 6M8 2 2 8" /></svg></button>
          </Show>
        </header>
      </Show>
      <ScreenPickerHost />
      <ContextMenu win={props.win} />
      <Soundboard win={props.win} />
      <Show when={call.channel()} fallback={<div class="cstage-idle"><p class="muted">The call ended.</p></div>}>
        <CallStage channel={ch()} popout />
      </Show>
    </main>
  );
}
