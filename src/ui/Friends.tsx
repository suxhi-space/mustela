import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { userMenu } from "./menus";
import type { Friends as FriendList, Person } from "../lib/backend/types";
import { Avatar, NameText } from "./Avatar";
import { Icon } from "./icons";
import { backend } from "./store";
import { createProfileInfo } from "./hooks";
import { ActivityCard } from "./Profile";
import { joinCall } from "./call/state";

type Tab = "online" | "all" | "pending" | "blocked" | "add";

/** Home > Friends: who's online, requests, blocked, and adding someone by username. */
export function Friends(props: { onMessage(channelId: string): void; onProfile(p: Person): void; onBack?(): void }) {
  const [tab, setTab] = createSignal<Tab>("online");
  const [data, { refetch }] = createResource(() => backend(), (b) => b.friends());
  const off = backend()!.onEvent((e) => { if (e.t === "activity") void refetch(); });
  onCleanup(off);
  const [err, setErr] = createSignal("");
  const [ok, setOk] = createSignal("");
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const empty: FriendList = { friends: [], incoming: [], outgoing: [], blocked: [] };
  const d = () => data() ?? empty;
  const pending = () => d().incoming.length;

  const rows = createMemo((): { p: Person; kind: "friend" | "incoming" | "outgoing" | "blocked" }[] => {
    switch (tab()) {
      case "online": return d().friends.filter((p) => p.online).map((p) => ({ p, kind: "friend" }));
      case "all": return d().friends.map((p) => ({ p, kind: "friend" }));
      case "pending": return [...d().incoming.map((p) => ({ p, kind: "incoming" as const })), ...d().outgoing.map((p) => ({ p, kind: "outgoing" as const }))];
      case "blocked": return d().blocked.map((p) => ({ p, kind: "blocked" }));
      default: return [];
    }
  });

  async function act(target: string, action: "add" | "accept" | "remove" | "block" | "unblock") {
    setErr(""); setOk("");
    try { await backend()!.friendAction(target, action); await refetch(); return true; }
    catch (e) { setErr(e instanceof Error && e.message ? e.message : "That didn't work. Try again."); return false; }
  }
  async function message(p: Person) {
    try { props.onMessage(await backend()!.openDM(p.id)); } catch { setErr("Couldn't open a conversation with them."); }
  }
  async function add(e: Event) {
    e.preventDefault();
    const n = name().trim();
    if (!n) return;
    setBusy(true);
    if (await act(n, "add")) { setOk(`Friend request sent to ${n}.`); setName(""); }
    setBusy(false);
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "online", label: "Online" }, { id: "all", label: "All" }, { id: "pending", label: "Pending" }, { id: "blocked", label: "Blocked" },
  ];

  return (
    <div class="friends">
      <header class="bar main-bar">
        <Show when={props.onBack}><button class="icon-btn back" onClick={props.onBack} aria-label="Back"><Icon name="back" size={20} /></button></Show>
        <Icon name="friends" size={20} class="muted" />
        <h2>Friends</h2>
        <nav class="seg friends-tabs" role="tablist" aria-label="Friends">
          <For each={TABS}>{(t) => (
            <button role="tab" aria-selected={tab() === t.id} classList={{ on: tab() === t.id }} onClick={() => setTab(t.id)}>
              {t.label}<Show when={t.id === "pending" && pending()}><span class="badge">{pending()}</span></Show>
            </button>
          )}</For>
        </nav>
        <span class="grow" />
        <button class="btn small primary" classList={{ on: tab() === "add" }} onClick={() => setTab("add")}>Add friend</button>
      </header>
      <div class="friends-split">
      <div class="friends-body">
        <Show when={tab() === "add"} fallback={
          <>
            <Show when={err()}><p class="err">{err()}</p></Show>
            <h3 class="mhead">{TABS.find((t) => t.id === tab())?.label}<span class="count">{rows().length}</span></h3>
            <Show when={!data.loading && rows().length === 0}>
              <div class="stage-empty small"><Icon name="friends" size={36} />
                <p>{tab() === "online" ? "No friends are online right now." : tab() === "pending" ? "No pending requests." : tab() === "blocked" ? "You haven't blocked anyone." : "Add a friend by their username to start chatting."}</p>
                <Show when={tab() !== "blocked"}><button class="btn" onClick={() => setTab("add")}>Add friend</button></Show>
              </div>
            </Show>
            <div class="friend-list">
              <For each={rows()}>{(r) => (
                <div class="friend-row">
                  <button class="fr-main" onClick={() => props.onProfile(r.p)} onContextMenu={(e) => userMenu(e, r.p)}>
                    <Avatar person={r.p} size={36} />
                    <span class="fr-text"><NameText person={r.p} /><small>{r.kind === "incoming" ? "Incoming request" : r.kind === "outgoing" ? "Outgoing request" : r.p.status ?? (r.p.online ? "Online" : "Offline")}</small>
                      <Show when={r.kind === "friend" && backend()?.voiceOf(r.p.id)}>{(v) => (
                        <small class="fr-where" classList={{ live: v().screen }}><Icon name={v().screen ? "screen" : "speaker"} size={12} />{v().screen ? "Streaming in " : "In "}{v().channelName}<Show when={v().serverName}> · {v().serverName}</Show></small>
                      )}</Show>
                    </span>
                  </button>
                  <Show when={r.kind === "friend"}>
                    <button class="round-btn" aria-label={`Message ${r.p.name}`} title="Message" onClick={() => void message(r.p)}><Icon name="chat" size={18} /></button>
                    <button class="round-btn danger" aria-label={`Remove ${r.p.name}`} title="Remove friend" onClick={() => void act(r.p.id, "remove")}><Icon name="close" size={18} /></button>
                  </Show>
                  <Show when={r.kind === "incoming"}>
                    <button class="round-btn ok" aria-label={`Accept ${r.p.name}`} title="Accept" onClick={() => void act(r.p.id, "accept")}><Icon name="check" size={18} /></button>
                    <button class="round-btn danger" aria-label={`Ignore ${r.p.name}`} title="Ignore" onClick={() => void act(r.p.id, "remove")}><Icon name="close" size={18} /></button>
                  </Show>
                  <Show when={r.kind === "outgoing"}>
                    <button class="round-btn danger" aria-label={`Cancel request to ${r.p.name}`} title="Cancel request" onClick={() => void act(r.p.id, "remove")}><Icon name="close" size={18} /></button>
                  </Show>
                  <Show when={r.kind === "blocked"}>
                    <button class="btn small" onClick={() => void act(r.p.id, "unblock")}>Unblock</button>
                  </Show>
                </div>
              )}</For>
            </div>
          </>
        }>
          <form class="add-friend" onSubmit={add}>
            <h3>Add friend</h3>
            <p class="muted">Enter their username, like <code class="icode">mika#1234</code> or <code class="icode">mika</code>.</p>
            <div class="af-row panel-inset">
              <input value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Username" aria-label="Username" autocomplete="off" />
              <button class="btn primary" disabled={busy() || !name().trim()}>{busy() ? "Sending…" : "Send request"}</button>
            </div>
            <Show when={err()}><p class="err">{err()}</p></Show>
            <Show when={ok()}><p class="ok">{ok()}</p></Show>
          </form>
        </Show>
      </div>
      <ActiveNow friends={d().friends.filter((p) => p.online)} onProfile={props.onProfile} />
      </div>
    </div>
  );
}

/** Join a server from an invite link. */
export function JoinServer(props: { onClose(): void; onJoined(serverId: string): void }) {
  const [mode, setMode] = createSignal<"join" | "create">("join");
  const [code, setCode] = createSignal("");
  const [name, setName] = createSignal(`${backend()!.me.name}'s server`);
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const id = mode() === "join" ? await backend()!.joinInvite(code()) : await backend()!.createServer(name().trim());
      props.onJoined(id); props.onClose();
    } catch (x) {
      setErr(x instanceof Error && x.message ? x.message : mode() === "join" ? "Couldn't join. Check the invite and try again." : "Couldn't create the server.");
    } finally { setBusy(false); }
  }
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <form class="modal dialog panel" onSubmit={submit} role="dialog" aria-label="Add a server">
        <h2>Add a server</h2>
        <div class="seg dialog-modes" role="radiogroup" aria-label="Join or create">
          <button type="button" role="radio" aria-checked={mode() === "join"} classList={{ on: mode() === "join" }} onClick={() => { setMode("join"); setErr(""); }}>Join with an invite</button>
          <button type="button" role="radio" aria-checked={mode() === "create"} classList={{ on: mode() === "create" }} onClick={() => { setMode("create"); setErr(""); }}>Create my own</button>
        </div>
        <Show when={mode() === "join"} fallback={
          <>
            <p class="muted">Your server starts with a #general channel. You can add channels, roles and emoji in its settings.</p>
            <label class="field">Server name<input value={name()} maxLength={32} onInput={(e) => setName(e.currentTarget.value)} required autofocus /></label>
          </>
        }>
          <p class="muted">Paste an invite link or code.</p>
          <label class="field">Invite<input value={code()} onInput={(e) => setCode(e.currentTarget.value)} placeholder="https://stt.gg/abc123" required autofocus /></label>
        </Show>
        <Show when={err()}><p class="err" role="alert">{err()}</p></Show>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn primary" disabled={busy() || (mode() === "create" && !name().trim())}>{busy() ? (mode() === "join" ? "Joining…" : "Creating…") : mode() === "join" ? "Join server" : "Create server"}</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Discord's "Active now", with VRCX's habit of showing where your friends are:
 * who's in voice (and where), who's streaming, and what they're playing.
 */
function ActiveNow(props: { friends: Person[]; onProfile(p: Person): void }) {
  return (
    <aside class="active-now" aria-label="Active now">
      <h3 class="mhead">Active now</h3>
      <For each={props.friends.slice(0, 40)}>{(p) => <ActiveCard p={p} onProfile={props.onProfile} />}</For>
      <p class="an-empty">It's quiet for now. When friends play something or hop into voice, they'll show up here.</p>
    </aside>
  );
}

function ActiveCard(props: { p: Person; onProfile(p: Person): void }) {
  const info = createProfileInfo(() => props.p.id);
  const voice = () => backend()?.voiceOf(props.p.id) ?? null;
  const act = () => info()?.activity ?? null;
  return (
    <Show when={voice() || act()}>
      <div class="an-card">
        <button class="an-head" onClick={() => props.onProfile(props.p)}>
          <Avatar person={props.p} size={32} />
          <span class="fr-text"><NameText person={props.p} /><small>{voice() ? (voice()!.screen ? "Streaming" : "In voice") : ({ listening: "Listening", watching: "Watching", streaming: "Streaming", competing: "Competing" } as Record<string, string>)[act()!.kind] ?? "Playing"}</small></span>
        </button>
        <Show when={voice()}>{(v) => (
          <div class="an-voice" classList={{ live: v().screen }}>
            <Icon name={v().screen ? "screen" : "speaker"} size={16} />
            <span class="grow"><strong>{v().channelName}</strong><Show when={v().serverName}><small>{v().serverName}</small></Show></span>
            <button class="btn small" onClick={() => void joinCall({ id: v().channelId, name: v().channelName, kind: "voice" })}>Join</button>
          </div>
        )}</Show>
        <Show when={act()}>{(a) => <ActivityCard a={a()} compact />}</Show>
      </div>
    </Show>
  );
}
