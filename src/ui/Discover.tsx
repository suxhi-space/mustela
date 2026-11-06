import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { InviteCard } from "./chat/Message";
import { Icon } from "./icons";
import { toast } from "./menu";
import { backend } from "./store";
import { inTauri } from "../lib/platform";
import { zoomNow } from "./appSize";

const ORIGIN = "https://stt.gg";

/**
 * Stoat's Discover (servers and bots), the same page the official client
 * embeds. Joining and adding bots open here instead of in a browser.
 */
export function Discover(props: { onBack(): void; onJoined(serverId: string): void }) {
  const [invite, setInvite] = createSignal<string | null>(null);
  const [bot, setBot] = createSignal<string | null>(null);
  // stt.gg only lets Stoat's own site show Discover in a frame, so on computers Mustela lays a web view of its own
  // over this page's content area (discover_embed in lib.rs); phones open it in the browser.
  const desktop = inTauri() && !/Android|iPhone|iPad/i.test(navigator.userAgent);
  const handle = (url: string) => {
    let u: URL;
    try { u = new URL(url); } catch { return; }
    const inv = u.pathname.match(/^\/(?:invite\/)?([A-Za-z0-9]{4,32})\/?$/), b = u.pathname.match(/^\/bot\/([A-Z0-9]{26})\/?$/i);
    if (b) setBot(b[1]!);
    else if (inv) setInvite(inv[1]!);
  };
  const openBrowser = async () => {
    const url = `${ORIGIN}/discover/servers`;
    try { if (inTauri()) { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(url); } else window.open(url, "_blank", "noopener"); }
    catch { toast("Couldn't open the browser.", true); }
  };
  const openWindow = async () => {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("open_discover"); }
    catch (e) { toast((e as Error)?.message || "Couldn't open Discover.", true); }
  };
  let host: HTMLDivElement | undefined;
  const [failed, setFailed] = createSignal(false);
  if (desktop) {
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<string>("mustela:discover-link", (e) => handle(e.payload))).then((f) => { off = f; });
    const call = (args: { x: number; y: number; w: number; h: number; show: boolean; close: boolean }) =>
      import("@tauri-apps/api/core").then(({ invoke }) => invoke("discover_embed", args)).catch(() => { if (!args.close) setFailed(true); });
    // Menus, dialogs, Settings and the like are drawn by Mustela's own page, under the Discover view: hide it while one is open.
    const covered = () => !!document.querySelector(".scrim, .menu-scrim, .pop-scrim, .ctx, .menu, .settings-card, .settings, .inbox, .gallery-view, .profile-full, .modal");
    let queued = false, last = "";
    const place = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        if (!host || failed()) return;
        const r = host.getBoundingClientRect();
        // Text size zooms Mustela's page (CSS zoom); the web view is placed in window units. A 100px probe says how
        // this web view reports sizes under that zoom, so the view lands exactly on this space.
        const probe = document.createElement("div");
        probe.style.cssText = "position:fixed;left:0;top:0;width:100px;height:100px;visibility:hidden;pointer-events:none";
        document.body.appendChild(probe);
        const pw = probe.getBoundingClientRect().width || 100;
        probe.remove();
        const k = (100 * zoomNow()) / pw;
        const show = !covered() && r.width > 20 && r.height > 20;
        const args = { x: Math.round(r.left * k), y: Math.round(r.top * k), w: Math.floor(Math.min(r.width * k, innerWidth - r.left * k)), h: Math.floor(Math.min(r.height * k, innerHeight - r.top * k)), show, close: false };
        const key = JSON.stringify(args);
        if (key !== last) { last = key; void call(args); }
      });
    };
    onMount(() => {
      place();
      const ro = new ResizeObserver(place);
      if (host) ro.observe(host);
      const mo = new MutationObserver(place);
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
      addEventListener("resize", place);
      onCleanup(() => { ro.disconnect(); mo.disconnect(); removeEventListener("resize", place); });
    });
    onCleanup(() => { off?.(); void call({ x: 0, y: 0, w: 0, h: 0, show: false, close: true }); });
  }

  return (
    <section class="discover">
      <header class="bar main-bar">
        <button class="icon-btn back" onClick={props.onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <Icon name="compass" size={20} class="muted" /><h2>Discover</h2>
      </header>
      <div class="discover-body">
        <Show when={desktop && !failed()} fallback={
          <div class="empty center">
            <div class="discover-fail">
              <Icon name="compass" size={40} />
              <Show when={desktop} fallback={<>
                <p>Discover opens in your browser. When you find a server, copy its invite link and paste it into <b>Join a server</b> (the + on the server list).</p>
                <button class="btn primary" onClick={() => void openBrowser()}>Open Discover</button>
              </>}>
                <p>Discover couldn't be shown here, so it opens in a window of its own. Joining a server or adding a bot there brings you back here to finish.</p>
                <button class="btn primary" onClick={() => void openWindow()}>Open Discover</button>
              </Show>
            </div>
          </div>
        }>
          {/* Stoat's Discover is shown right over this space. */}
          <div class="discover-host" ref={host}><div class="loading-row"><div class="spinner small" /></div></div>
        </Show>
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
