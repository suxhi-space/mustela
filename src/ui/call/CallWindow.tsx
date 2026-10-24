import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Avatar } from "../Avatar";
import { Icon } from "../icons";
import { openBridge, type Cmd, type Snapshot } from "./bridge";

const EMPTY: Snapshot = { active: false, channelName: "", mic: false, cam: false, screen: false, people: [], speaking: [], error: "" };

/**
 * The pop-out window. It owns no call: it shows what the main window sends
 * and sends back button presses. If the main window goes away, it says so.
 */
export function CallWindow() {
  const [s, setS] = createSignal<Snapshot>(EMPTY);
  const [seen, setSeen] = createSignal(false);
  const bridge = openBridge((m) => { if (m.t === "state") { setS(m.s); setSeen(true); if (!m.s.active) void close(); } });
  onCleanup(() => bridge.close());
  onMount(() => { bridge.send({ t: "hello" }); });
  const cmd = (c: Cmd) => bridge.send({ t: "cmd", c });
  async function close() {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("close_popout"); } catch { window.close(); }
  }
  const btn = (c: Exclude<Cmd, "leave">, icon: string, label: string) => (
    <button class="ctl" classList={{ on: s()[c] }} aria-pressed={s()[c]} onClick={() => cmd(c)}><Icon name={icon} />{label}</button>
  );
  return (
    <main class="popout">
      <header class="bar"><Icon name="speaker" size={18} class="muted" /><h2>{s().channelName || "Call"}</h2><span class="grow" />
        <button class="btn small" onClick={() => void close()}>Bring back</button></header>
      <Show when={seen()} fallback={<p class="empty center">Waiting for the call…</p>}>
        <div class="people mini">
          <For each={s().people}>{(p) => (
            <div class="tile" classList={{ talking: s().speaking.includes(p.id) }}>
              <Avatar person={{ id: p.id, name: p.name, avatarUrl: p.avatarUrl }} size={48} profile={null} presence={false} />
              <span class="name">{p.name}</span>
            </div>
          )}</For>
        </div>
        <Show when={s().error}><p class="err center">{s().error}</p></Show>
        <div class="controls" role="toolbar" aria-label="Call controls">
          {btn("mic", "mic", "Mic")}{btn("cam", "video", "Camera")}{btn("screen", "screen", "Share")}
          <button class="ctl danger" onClick={() => cmd("leave")}><Icon name="hangup" />Leave</button>
        </div>
      </Show>
    </main>
  );
}
