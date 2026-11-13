import { createSignal, For, onMount, Show } from "solid-js";
import type { ChannelInfo } from "../../lib/backend/types";
import { inTauri } from "../../lib/platform";
import { Icon } from "../icons";
import { ContextMenu } from "../menu";
import { platform } from "../store";
import { systemFrame } from "../TitleBar";
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
  // macOS and Linux: the shell's window for the pop-out (moving, sizing, keep-on-top).
  const [tw, setTw] = createSignal<any>(null);
  // Windows: the pop-out is WebView2's own window; with Mustela's title bar its frame comes off and this page moves
  // and sizes it through popout_frame (src-tauri/src/popout_win.rs). If that fails, the system frame just stays.
  const [bare, setBare] = createSignal(false);
  type Rect = [number, number, number, number];
  let rect: Rect = [0, 0, 800, 500], before: Rect | null = null;
  const win = async (op: string, a: { x?: number; y?: number; w?: number; h?: number } = {}) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const r = await invoke<Rect | null>("popout_frame", { op, ...a }).catch(() => null);
    if (r && op !== "workarea") rect = r;
    return r;
  };
  onMount(async () => {
    if (!inTauri()) return;
    if (platform === "windows") {
      if (systemFrame) return;
      // The window takes a moment to appear and pick up its title.
      for (let i = 0; i < 25 && !props.win.closed; i++) {
        if (await win("frameless")) { setBare(true); return; }
        await new Promise((r) => setTimeout(r, 150));
      }
      return;
    }
    const { Window } = await import("@tauri-apps/api/window");
    const w = await Window.getByLabel("call").catch(() => null);
    if (w && systemFrame) {
      // "System's" title bar (Settings > Performance): the pop-out gets the system frame too.
      if (platform === "mac") await (w as any).setTitleBarStyle?.("visible").catch(() => {});
      else await w.setDecorations(true).catch(() => {});
      return;
    }
    setTw(w);
  });
  const framed = () => platform !== "mac"; // macOS keeps its traffic lights
  const ch = (): ChannelInfo => call.channel() ?? { id: "", name: "Call", kind: "voice" };

  // Moving a window whose frame we took off (Windows). Screen positions come in the page's units.
  let busy = false, next: (() => Promise<unknown>) | null = null;
  const queue = (f: () => Promise<unknown>) => {
    next = f;
    if (busy) return;
    busy = true;
    void (async () => { while (next) { const g = next; next = null; await g(); } busy = false; })();
  };
  const toggleMax = async () => {
    if (!bare()) return void tw()?.toggleMaximize();
    if (before) { const b = before; before = null; await win("move", { x: b[0], y: b[1], w: b[2], h: b[3] }); return; }
    const area = await win("workarea");
    if (!area) return;
    before = [...rect];
    await win("move", { x: area[0], y: area[1], w: area[2], h: area[3] });
  };
  const follow = (e: PointerEvent, place: (dx: number, dy: number, from: Rect) => Rect) => {
    const el = e.currentTarget as HTMLElement;
    const dpr = props.win.devicePixelRatio || 1, sx = e.screenX, sy = e.screenY, from: Rect = [...rect];
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      const [x, y, w, h] = place(Math.round((m.screenX - sx) * dpr), Math.round((m.screenY - sy) * dpr), from);
      queue(() => win("move", { x, y, w, h }));
    };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const drag = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    if (e.detail === 2) { void toggleMax(); return; }
    if (!bare()) { void tw()?.startDragging(); return; }
    if (before) {
      // Dragging a maximized window puts it back to its size, under the pointer, like Windows does.
      const b = before, dpr = props.win.devicePixelRatio || 1;
      before = null;
      rect = [Math.round(e.screenX * dpr - b[2] / 2), rect[1], b[2], b[3]];
    }
    follow(e, (dx, dy, f) => [f[0] + dx, f[1] + dy, f[2], f[3]]);
  };
  const MIN_W = 360, MIN_H = 240;
  const resize = (edge: string) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    before = null;
    const dpr = props.win.devicePixelRatio || 1, mw = MIN_W * dpr, mh = MIN_H * dpr;
    follow(e, (dx, dy, [x, y, w, h]) => {
      if (edge.includes("e")) w = Math.max(mw, w + dx);
      if (edge.includes("s")) h = Math.max(mh, h + dy);
      if (edge.includes("w")) { const nw = Math.max(mw, w - dx); x += w - nw; w = nw; }
      if (edge.includes("n")) { const nh = Math.max(mh, h - dy); y += h - nh; h = nh; }
      return [x, y, w, h];
    });
  };
  const minimize = () => void (bare() ? win("minimize") : tw()?.minimize());
  const keepOnTop = (v: boolean) => { setOnTop(v); void (bare() ? win("top", { x: v ? 1 : 0 }) : tw()?.setAlwaysOnTop(v)); };
  return (
    <main class="popout" classList={{ bare: bare() }}>
      <Show when={bare()}>
        <For each={["n", "s", "e", "w", "ne", "nw", "se", "sw"]}>{(edge) => <div class={`pop-edge ${edge}`} onPointerDown={resize(edge)} />}</For>
      </Show>
      <Show when={tw() || bare()}>
        <header class="pop-bar" onPointerDown={drag}>
          <Icon name="speaker" size={14} />
          <span class="pop-title">{call.channel()?.name ?? "Call"}</span>
          <span class="grow" />
          <button class="tb-tool" classList={{ on: onTop() }} title={onTop() ? "Stop keeping on top" : "Keep on top"} aria-pressed={onTop()}
            onClick={() => keepOnTop(!onTop())}><Icon name="pin" size={14} /></button>
          <Show when={framed()}>
            <button class="tb-win" aria-label="Minimize" onClick={minimize}><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8" /></svg></button>
            <button class="tb-win" aria-label="Maximize" onClick={() => void toggleMax()}><svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" /></svg></button>
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
