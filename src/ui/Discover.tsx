import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { InviteCard } from "./chat/Message";
import { Icon } from "./icons";
import { toast } from "./menu";
import { backend } from "./store";

const ORIGIN = "https://stt.gg";

/**
 * Stoat's Discover (servers and bots), the same page the official client
 * embeds. Joining and adding bots open here instead of in a browser.
 */
export function Discover(props: { onBack(): void; onJoined(serverId: string): void }) {
  let frame!: HTMLIFrameElement;
  const [invite, setInvite] = createSignal<string | null>(null);
  const [bot, setBot] = createSignal<string | null>(null);
  // Shown once the page has loaded (or says hello). Stoat's client shows it straight away; we wait for the
  // load so a blank frame never appears, but never for the hello alone, which some versions don't send.
  const [loaded, setLoaded] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [n, setN] = createSignal(0);
  let timer = 0;
  const arm = () => { clearTimeout(timer); setFailed(false); timer = window.setTimeout(() => !loaded() && setFailed(true), 12000); };
  arm();
  onCleanup(() => clearTimeout(timer));

  function onMessage(m: MessageEvent) {
    if (m.origin !== ORIGIN || m.source !== frame?.contentWindow) return;
    let data: any;
    try { data = typeof m.data === "string" ? JSON.parse(m.data) : m.data; } catch { return; }
    if (data?.source !== "discover") return;
    if (data.type === "init") setLoaded(true);
    if (data.type === "init") frame.contentWindow?.postMessage(JSON.stringify({ source: "revolt", type: "theme", theme: {} }), ORIGIN);
    if (data.type === "path" && typeof data.path === "string") { /* the embedded page moved between tabs; nothing to do */ }
    if (data.type === "navigate" && typeof data.url === "string") {
      let u: URL;
      try { u = new URL(data.url); } catch { return; }
      const inv = u.pathname.match(/^\/(?:invite\/)?([A-Za-z0-9]{4,32})$/), b = u.pathname.match(/^\/bot\/([A-Z0-9]{26})$/i);
      if (b) setBot(b[1]!);
      else if (inv) setInvite(inv[1]!);
    }
  }
  addEventListener("message", onMessage);
  onCleanup(() => removeEventListener("message", onMessage));

  return (
    <section class="discover">
      <header class="bar main-bar">
        <button class="icon-btn back" onClick={props.onBack} aria-label="Back"><Icon name="back" size={20} /></button>
        <Icon name="compass" size={20} class="muted" /><h2>Discover</h2>
      </header>
      <div class="discover-body">
        <Show when={!loaded()}>
          <div class="empty center">
            <Show when={failed()} fallback={<p>Loading Discover…</p>}>
              <div class="discover-fail">
                <Icon name="compass" size={36} />
                <p>Discover didn't load. Check your connection and try again.</p>
                <button class="btn primary" onClick={() => { setN(n() + 1); arm(); }}>Try again</button>
              </div>
            </Show>
          </div>
        </Show>
        <Show keyed when={n() + 1}>
          <iframe ref={frame} src={`${ORIGIN}/discover/servers?embedded=true`} title="Discover servers and bots" classList={{ ready: loaded() }}
            referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" onLoad={() => { setLoaded(true); clearTimeout(timer); }} />
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
