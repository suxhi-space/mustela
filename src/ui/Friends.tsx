import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { Friends as FriendList, Person } from "../lib/backend/types";
import { Avatar, NameText } from "./Avatar";
import { Icon } from "./icons";
import { backend } from "./store";

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
      <div class="friends-body">
        <Show when={tab() === "add"} fallback={
          <>
            <Show when={err()}><p class="err">{err()}</p></Show>
            <h3 class="mhead">{TABS.find((t) => t.id === tab())?.label} — {rows().length}</h3>
            <Show when={!data.loading && rows().length === 0}>
              <div class="stage-empty small"><Icon name="friends" size={36} />
                <p>{tab() === "online" ? "No friends are online right now." : tab() === "pending" ? "No pending requests." : tab() === "blocked" ? "You haven't blocked anyone." : "Add a friend by their username to start chatting."}</p>
                <Show when={tab() !== "blocked"}><button class="btn" onClick={() => setTab("add")}>Add friend</button></Show>
              </div>
            </Show>
            <div class="friend-list">
              <For each={rows()}>{(r) => (
                <div class="friend-row">
                  <button class="fr-main" onClick={() => props.onProfile(r.p)}>
                    <Avatar person={r.p} size={36} />
                    <span class="fr-text"><NameText person={r.p} /><small>{r.kind === "incoming" ? "Incoming request" : r.kind === "outgoing" ? "Outgoing request" : r.p.status ?? (r.p.online ? "Online" : "Offline")}</small></span>
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
    </div>
  );
}

/** Join a server from an invite link. */
export function JoinServer(props: { onClose(): void; onJoined(serverId: string): void }) {
  const [code, setCode] = createSignal("");
  const [err, setErr] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  async function join(e: Event) {
    e.preventDefault();
    setBusy(true); setErr("");
    try { props.onJoined(await backend()!.joinInvite(code())); props.onClose(); }
    catch (x) { setErr(x instanceof Error && x.message ? x.message : "Couldn't join. Check the invite and try again."); }
    finally { setBusy(false); }
  }
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="modal dialog panel" onSubmit={join} role="dialog" aria-label="Join a server">
        <h2>Join a server</h2>
        <p class="muted">Paste an invite link or code.</p>
        <label class="field">Invite<input value={code()} onInput={(e) => setCode(e.currentTarget.value)} placeholder="https://stt.gg/abc123" required autofocus /></label>
        <Show when={err()}><p class="err" role="alert">{err()}</p></Show>
        <div class="dialog-actions">
          <button type="button" class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn primary" disabled={busy()}>{busy() ? "Joining…" : "Join"}</button>
        </div>
      </form>
    </div>
  );
}
