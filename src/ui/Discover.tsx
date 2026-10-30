import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { InviteCard } from "./chat/Message";
import { Icon } from "./icons";
import { toast } from "./menu";
import { backend } from "./store";
import { inTauri } from "../lib/platform";

const ORIGIN = "https://stt.gg";

/**
 * Stoat's Discover (servers and bots), the same page the official client
 * embeds. Joining and adding bots open here instead of in a browser.
 */
export function Discover(props: { onBack(): void; onJoined(serverId: string): void }) {
  const [invite, setInvite] = createSignal<string | null>(null);
  const [bot, setBot] = createSignal<string | null>(null);
  // stt.gg only lets Stoat's own site show Discover in a frame ("blocked by response" anywhere else), so the
  // desktop app opens it in a window of its own and gets invite and bot links back; phones use the browser.
  const desktop = inTauri() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  const handle = (url: string) => {
    let u: URL;
    try { u = new URL(url); } catch { return; }
    const inv = u.pathname.match(/^\/(?:invite\/)?([A-Za-z0-9]{4,32})\/?$/), b = u.pathname.match(/^\/bot\/([A-Z0-9]{26})\/?$/i);
    if (b) setBot(b[1]!);
    else if (inv) setInvite(inv[1]!);
  };
  const openWindow = async () => {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("open_discover"); }
    catch (e) { toast((e as Error)?.message || "Couldn't open Discover.", true); }
  };
  const openBrowser = async () => {
    const url = `${ORIGIN}/discover/servers`;
    try { if (inTauri()) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); } else window.open(url, "_blank", "noopener"); }
    catch { toast("Couldn't open the browser.", true); }
  };
  if (desktop) {
    void openWindow();
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("mustela:discover-link", (e) => handle(e.payload))).then((f) => { off = f; });
    onCleanup(() => off?.());
  }

  return (
    <section class="discover">
      <header class="bar main-bar">
        <button class="icon-btn back" onClick={props.onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <Icon name="compass" size={20} class="muted" /><h2>Discover</h2>
      </header>
      <div class="discover-body">
        <div class="empty center">
          <div class="discover-fail">
            <Icon name="compass" size={40} />
            <Show when={desktop} fallback={<>
              <p>Discover opens in your browser. When you find a server, copy its invite link and paste it into <b>Join a server</b> (the + on the server list).</p>
              <button class="btn primary" onClick={() => void openBrowser()}>Open Discover</button>
            </>}>
              <p>Discover opens in its own window. Joining a server or adding a bot there brings you back here to finish.</p>
              <button class="btn primary" onClick={() => void openWindow()}>Open Discover</button>
            </Show>
          </div>
        </div>
      </div>
      <Show when={invite()}>{(code) => (
        <div class="scrim" onClick={() => setInvite(null)}>
          <div class="modal panel discover-modal" onClick={(e) => e.stopPropagation()}><InviteCard code={code()} /></div>
        </div>
      )}</Show>
      <Show when={bot()}>{(id) => <AddBot id={id()} onClose={() => setBot(null)} />}</Show>
    </section>
  );
}

function AddBot(props: { id: string; onClose(): void }) {
  const [info] = createResource(() => props.id, (id) => backend()!.publicBot(id));
  const [servers] = createResource(async () => (await backend()!.spaces()).filter((s) => !s.home && backend()!.serverInfo(s.id)?.perms.manageServer));
  const [busy, setBusy] = createSignal<string | null>(null);
  async function add(sid: string, name: string) {
    setBusy(sid);
    try { await backend()!.addBot(props.id, sid); toast(`Added to ${name}`); props.onClose(); } catch (e) { toast((e as Error).message || "Couldn't add the bot.", true); } finally { setBusy(null); }
  }
  return (
    <div class="scrim" onClick={props.onClose}>
      <div class="modal panel discover-modal" role="dialog" aria-label="Add bot" onClick={(e) => e.stopPropagation()}>
        <Show when={info()} fallback={<p class="muted">{info.loading ? "Loading bot…" : "This bot isn't public."}</p>}>
          {(b) => (<>
            <div class="bot-head">
              <Show when={b().avatarUrl} fallback={<span class="bot-av">{b().name[0]}</span>}><img class="bot-av" src={b().avatarUrl} alt="" /></Show>
              <div><h2>{b().name}</h2><Show when={b().description}><p class="muted small">{b().description}</p></Show></div>
            </div>
            <p class="label">Add to a server you manage</p>
            <div class="bot-servers">
              <For each={servers()} fallback={<p class="muted small">You don't manage any servers.</p>}>{(s) => (
                <button class="me-row" disabled={!!busy()} onClick={() => void add(s.id, s.name)}>
                  <Show when={s.iconUrl} fallback={<span class="bs-ic">{s.name.slice(0, 2)}</span>}><img class="bs-ic" src={s.iconUrl} alt="" /></Show>
                  <span>{s.name}</span><span class="grow" />{busy() === s.id ? "Adding…" : ""}
                </button>
              )}</For>
            </div>
          </>)}
        </Show>
      </div>
    </div>
  );
}
