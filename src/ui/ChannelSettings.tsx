import { createMemo, createResource, createSignal, For, Match, Show, Switch as Pick } from "solid-js";
import { useBack } from "./back";
import type { ChannelDetails, Override } from "../lib/backend/types";
import { Group, Row, Select, Switch } from "./controls";
import { Icon } from "./icons";
import { attempt, confirmDialog, copy, promptDialog } from "./menu";
import { setChannelSettings } from "./nav";
import { OverrideEditor } from "./Permissions";
import { backend } from "./store";

const b = () => backend()!;
type Tab = "overview" | "permissions" | "webhooks";

/** Stoat's slowmode choices. */
const SLOW = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600];
const slowLabel = (s: number) => (s === 0 ? "Off" : s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minute${s === 60 ? "" : "s"}` : `${s / 3600} hour${s === 3600 ? "" : "s"}`);

function Overview(props: { d: ChannelDetails; bump(): void }) {
  const [name, setName] = createSignal(props.d.name);
  const [desc, setDesc] = createSignal(props.d.description ?? "");
  const [slow, setSlow] = createSignal(String(props.d.slowmode));
  const can = () => props.d.canManage;
  const dirty = () => name().trim() !== props.d.name || desc() !== (props.d.description ?? "") || Number(slow()) !== props.d.slowmode;
  const pickIcon = () => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = "image/*";
    i.onchange = () => { const f = i.files?.[0]; if (f) void attempt(() => b().editChannel(props.d.id, { icon: f }), "Icon saved").then(props.bump); };
    i.click();
  };
  return (
    <div class="page">
      <Group title="Channel">
        <Row label="Icon" hint="Shown next to the channel name. Square pictures look best.">
          <span class="cs-icon-prev">
            <Show when={props.d.iconUrl} fallback={<Icon name={props.d.kind === "voice" ? "speaker" : "hash"} size={20} />}><img src={props.d.iconUrl} alt="" /></Show>
          </span>
          <Show when={can()}>
            <button class="btn small" onClick={pickIcon}>Change</button>
            <Show when={props.d.iconUrl}><button class="btn small danger" onClick={() => void attempt(() => b().editChannel(props.d.id, { icon: null }), "Icon removed").then(props.bump)}>Remove</button></Show>
          </Show>
        </Row>
        <div class="row col"><label class="field">Channel name<input value={name()} maxLength={32} disabled={!can()} onInput={(e) => setName(e.currentTarget.value)} /></label></div>
        <div class="row col"><label class="field">Description<textarea class="text-input area" maxLength={1024} disabled={!can()} value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} placeholder="Tell people what this channel is for" /></label></div>
        <Show when={props.d.kind === "text"}>
          <Row label="Slowmode" hint="How long people wait between messages. People who can skip slowmode aren't affected.">
            <Select label="Slowmode" value={slow()} options={SLOW.map((s) => ({ v: String(s), label: slowLabel(s) }))} onChange={setSlow} />
          </Row>
        </Show>
        <Row label="Mature" hint="People are asked to confirm their age before opening this channel.">
          <Switch label="Mature channel" on={props.d.mature} disabled={!can()} onChange={(mature) => void attempt(() => b().editChannel(props.d.id, { mature })).then(props.bump)} />
        </Row>
      </Group>
      <Show when={can()}>
        <div class="dialog-actions">
          <button class="btn" disabled={!dirty()} onClick={() => { setName(props.d.name); setDesc(props.d.description ?? ""); setSlow(String(props.d.slowmode)); }}>Reset</button>
          <button class="btn primary" disabled={!dirty() || !name().trim()} onClick={() => void attempt(() => b().editChannel(props.d.id, {
            ...(name().trim() !== props.d.name ? { name: name().trim() } : {}),
            ...(desc() !== (props.d.description ?? "") ? { description: desc() } : {}),
            ...(Number(slow()) !== props.d.slowmode ? { slowmode: Number(slow()) } : {}),
          }), "Saved").then(props.bump)}>Save changes</button>
        </div>
      </Show>
      <Group title="About">
        <Row label="Channel ID"><button class="btn small" onClick={() => void copy(props.d.id, "ID copied")}><Icon name="copy" size={14} />Copy</button></Row>
      </Group>
    </div>
  );
}

function Permissions(props: { d: ChannelDetails; bump(): void }) {
  const roles = createMemo(() => [...b().roles(props.d.serverId)].sort((a, c) => a.rank - c.rank));
  const [pick, setPick] = createSignal<string>("default");
  const [draft, setDraft] = createSignal<Override | null>(null);
  const current = (): Override => draft() ?? (pick() === "default" ? props.d.defaultPerms : props.d.rolePerms[pick()] ?? { allow: 0, deny: 0 });
  const overridden = (id: string) => { const o = props.d.rolePerms[id]; return !!o && (o.allow !== 0 || o.deny !== 0); };
  const choose = (id: string) => { setPick(id); setDraft(null); };
  return (
    <div class="page perm-page">
      <nav class="perm-roles" aria-label="Roles">
        <button classList={{ on: pick() === "default" }} onClick={() => choose("default")}><i class="role-dot" />Everyone<small>Default for everyone</small></button>
        <For each={roles()}>{(r) => (
          <button classList={{ on: pick() === r.id }} onClick={() => choose(r.id)}>
            <i class="role-dot" style={{ background: r.colour && !/gradient/.test(r.colour) ? r.colour : undefined }} />{r.name}
            <small>{overridden(r.id) ? "Has overrides" : "No overrides"}</small>
          </button>
        )}</For>
      </nav>
      <div class="perm-main">
        <p class="group-hint">✓ allows it in this channel, ✕ denies it, and / leaves it to the server and role settings.</p>
        <OverrideEditor value={current()} channel disabled={!props.d.canManagePerms} onChange={setDraft} />
        <Show when={props.d.canManagePerms}>
          <div class="dialog-actions sticky">
            <button class="btn" disabled={!draft()} onClick={() => setDraft(null)}>Reset</button>
            <button class="btn primary" disabled={!draft()} onClick={() => void attempt(() => b().setChannelPermissions(props.d.id, pick(), draft()!), "Permissions saved").then(() => { setDraft(null); props.bump(); })}>Save changes</button>
          </div>
        </Show>
      </div>
    </div>
  );
}

function Webhooks(props: { d: ChannelDetails }) {
  const [list, { refetch }] = createResource(() => b().webhooks(props.d.id).catch(() => null));
  return (
    <div class="page">
      <Show when={props.d.canManageWebhooks}>
        <div class="dialog-actions start">
          <button class="btn small primary" onClick={async () => {
            const n = await promptDialog("Create webhook", "Name", "Create", "", { max: 32, placeholder: "Deploy bot" });
            if (n?.trim()) await attempt(async () => { const w = await b().createWebhook(props.d.id, n.trim()); await copy(w.url, "Webhook created. Its link is copied."); }).then(refetch);
          }}><Icon name="plus" size={14} />New webhook</button>
        </div>
      </Show>
      <Group title="Webhooks" count={list()?.length ?? 0} hint="Webhooks let other apps post here. Keep their links secret: anyone with one can send messages.">
        <For each={list() ?? []} fallback={<Row label={<span class="muted">{list() === null ? "You can't see this channel's webhooks." : "No webhooks yet."}</span>} />}>{(w) => (
          <Row label={<span class="ss-member"><Show when={w.avatarUrl} fallback={<Icon name="bot" size={22} />}><img class="wh-av" src={w.avatarUrl} alt="" /></Show>{w.name}</span>}>
            <button class="btn small" onClick={() => void copy(w.url, "Webhook link copied")}><Icon name="copy" size={14} />Copy link</button>
            <Show when={props.d.canManageWebhooks}>
              <button class="icon-btn danger" aria-label={`Delete ${w.name}`} title="Delete" onClick={async () => {
                if (await confirmDialog(`Delete ${w.name}?`, "Apps using its link can't post any more.", "Delete webhook", true)) await attempt(() => b().deleteWebhook(props.d.id, w.id), "Webhook deleted").then(refetch);
              }}><Icon name="trash" size={16} /></button>
            </Show>
          </Row>
        )}</For>
      </Group>
    </div>
  );
}

/** A channel's settings, like Stoat's: Overview, Permissions, Webhooks, Delete. */
export function ChannelSettings(props: { id: string; tab?: Tab }) {
  const [tick, setTick] = createSignal(0);
  const bump = () => setTick(tick() + 1);
  // The channel object updates over the socket; read it again shortly after a change.
  const d = createMemo(() => { tick(); return b().channelDetails(props.id); });
  const later = () => { bump(); setTimeout(bump, 600); };
  const [tab, setTab] = createSignal<Tab>(props.tab ?? "overview");
  const close = () => setChannelSettings(null);
  useBack(close);
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "info" },
    { id: "permissions", label: "Permissions", icon: "shield" },
    { id: "webhooks", label: "Webhooks", icon: "bot" },
  ];
  return (
    <div class="settings" role="dialog" aria-label="Channel settings" onKeyDown={(e) => e.key === "Escape" && close()} onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="settings-card">
        <header class="bar settings-bar panel">
          <h2>{d() ? `${d()!.kind === "voice" ? "" : "#"}${d()!.name}` : "Channel"} settings</h2>
          <span class="grow" />
          <button class="icon-btn" onClick={close} aria-label="Close channel settings"><Icon name="close" size={20} /></button>
        </header>
        <Show when={d()} fallback={<p class="empty center">This channel isn't available.</p>}>{(c) => (
          <div class="settings-body">
            <nav class="snav panel" role="tablist" aria-label="Channel settings sections">
              <h3 class="snav-head">{c().kind === "voice" ? c().name : `#${c().name}`}</h3>
              <For each={tabs}>{(t) => (
                <button role="tab" aria-selected={tab() === t.id} classList={{ on: tab() === t.id }} onClick={() => setTab(t.id)}><Icon name={t.icon} size={18} />{t.label}</button>
              )}</For>
              <span class="grow" />
              <Show when={c().canManage}>
                <button class="danger" onClick={async () => {
                  if (await confirmDialog(`Delete ${c().kind === "voice" ? c().name : `#${c().name}`}?`, "Every message in it is deleted too. This can't be undone.", "Delete channel", true)) await attempt(() => b().deleteChannel(c().id), "Channel deleted").then(close);
                }}><Icon name="trash" size={18} />Delete channel</button>
              </Show>
            </nav>
            <div class="spage panel" role="tabpanel">
              <Pick>
                <Match when={tab() === "overview"}><Overview d={c()} bump={later} /></Match>
                <Match when={tab() === "permissions"}><Permissions d={c()} bump={later} /></Match>
                <Match when={tab() === "webhooks"}><Webhooks d={c()} /></Match>
              </Pick>
            </div>
          </div>
        )}</Show>
      </div>
    </div>
  );
}
