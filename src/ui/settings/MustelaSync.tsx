import { createResource, createSignal, For, Show } from "solid-js";
import { activeAccount } from "../../lib/session/book";
import { OFFICIAL_SERVER as OFFICIAL, validServerUrl } from "../../lib/cloud";
import { parseRemote } from "../../lib/sync/settings";
import { Group, Row, Seg, Switch } from "../controls";
import { Icon } from "../icons";
import { attempt, confirmDialog, toast } from "../menu";
import { backend, book, ext, settings, syncState, updateExt, updateSettings } from "../store";

const SYNC_TEXT = { local: "Saved on this device", syncing: "Syncing…", synced: "Synced to your Stoat account", error: "Sync paused. It retries on your next change." } as const;

/** Mustela's own settings: where your extras are stored and how to back them up. */
/** Who your extras show to, for the server line (from "Who can see my profile"). */
const AUDIENCE: Record<string, string> = { everyone: "everyone", friends: "your friends", "friends+servers": "your friends and the servers you picked" };

export function MustelaSync() {
  const b = () => backend()!;
  /** Unlinking deletes what this server keeps about you, so it asks first. */
  async function unlinkAsk(s: string) {
    const name = s === OFFICIAL ? "Mustela's server" : new URL(s).host;
    if (!(await confirmDialog(`Unlink ${name}?`, "It deletes your decorations, banners and activity from that server, for all your devices. Your profile stays on this device, and you can link again any time.", "Unlink and delete", true))) return false;
    await b().cloud.unlink(s);
    toast(`Unlinked. Your data is deleted from ${name}.`);
    return true;
  }
  const [url, setUrl] = createSignal("");
  const [err, setErr] = createSignal("");
  const [tick, setTick] = createSignal(0);
  const servers = () => settings().cloud.servers;
  const isDemo = () => activeAccount(book())?.kind === "demo";
  const setCloud = (p: Partial<ReturnType<typeof settings>["cloud"]>) => updateSettings((s) => ({ ...s, cloud: { ...s.cloud, ...p } }));

  async function add(picked?: string) {
    const u = picked ?? validServerUrl(url());
    if (!u) { setErr("Use a full https:// address. Plain http:// only works for a server on this computer (localhost)."); return; }
    if (servers().includes(u)) { setErr("That server is already in the list."); return; }
    const h = await b().cloud.health(u);
    if (!h.ok) { setErr(h.error ?? "That isn't a Mustela server."); return; }
    setCloud({ servers: [...servers(), u] });
    setUrl(""); setErr("");
    if (!isDemo() && await confirmDialog(`Link ${h.name ?? "this server"}?`, "To confirm it's you, the server asks Stoat who owns your session once. It doesn't store your session. Only link servers you trust.", "Link")) {
      await attempt(() => b().cloud.link(u), "Linked");
    }
    setTick(tick() + 1);
  }

  function exportSettings() {
    const blob = new Blob([JSON.stringify(settings(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `mustela-settings-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importSettings() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      const parsed = parseRemote(await f.text());
      if (!parsed) { toast("That file isn't a Mustela settings backup.", true); return; }
      if (await confirmDialog("Replace your settings?", "Your colors, profile, favorite GIFs and Mustela servers are replaced with the ones in the file.", "Import")) {
        updateSettings(() => parsed); toast("Settings imported");
      }
    };
    input.click();
  }

  return (
    <div class="page">
      <PrivacyGroup />
      <Group title="Settings sync" hint="Colors, your profile, favorite GIFs, time format and Mustela servers are saved to your Stoat account, so every Mustela you sign in to matches. Window and sound settings stay on each device.">
        <Row icon="swap" label="Status" hint={SYNC_TEXT[syncState()]} />
      </Group>

      <Group title="Mustela servers" hint="Stoat has no place for decorations, frames, effects or what you're playing. Mustela servers hold them so other Mustela users can see them. Anyone can run one: see “Hosting a Mustela server” in the README.">
        <For each={servers()} fallback={<Row label="No servers yet" hint={OFFICIAL ? "Use Mustela's server below, or add your own. Until then your profile is only carried in your banner." : "Your profile is only carried in your banner (below)."} />}>{(s) => {
          const [h] = createResource(() => [s, tick()] as const, ([u]) => b().cloud.health(u));
          const linked = () => (tick(), b().cloud.linked(s));
          return (
            <Row icon="cloud" label={s === OFFICIAL ? "Mustela's server" : new URL(s).host} hint={h.loading ? "Checking…" : !h()?.ok ? h()?.error ?? "Not reachable" : `${h()?.name ?? "Mustela server"}${h()?.version ? ` ${h()!.version}` : ""}. ${linked() ? `Linked: your extras show to ${AUDIENCE[ext().privacy.mode] ?? "everyone"}` : "Not linked: press Link to see people's extras and share yours"}`}>
              <span class={`status-dot ${h()?.ok ? (linked() ? "ok" : "warn") : h.loading ? "" : "bad"}`} aria-hidden="true" />
              <Show when={!isDemo()}>
                <Show when={linked()} fallback={<button class="btn small" onClick={() => void attempt(() => b().cloud.link(s), "Linked").then(() => setTick(tick() + 1))}>Link</button>}>
                  <button class="btn small" onClick={() => void unlinkAsk(s).then((ok) => ok && setTick(tick() + 1))}>Unlink</button>
                </Show>
              </Show>
              <button class="icon-btn" aria-label={`Remove ${s}`} title="Remove" onClick={() => void (async () => { if (b().cloud.linked(s) && !(await unlinkAsk(s))) return; if (!b().cloud.linked(s)) void b().cloud.unlink(s); setCloud({ servers: servers().filter((x) => x !== s) }); })()}><Icon name="trash" size={16} /></button>
            </Row>
          );
        }}</For>
        <Show when={OFFICIAL && !servers().includes(OFFICIAL)}>
          <Row icon="cloud" label="Mustela's server" hint="Run by Mustela's developer, so you don't need your own. Your profile extras and what you're playing are kept there for other Mustela users.">
            <button class="btn small primary" onClick={() => void add(OFFICIAL)}>Use</button>
          </Row>
        </Show>
        <form class="row add-server" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <input class="text-input" type="url" placeholder="Your own server: https://servers.example.com" value={url()} onInput={(e) => { setUrl(e.currentTarget.value); setErr(""); }} aria-label="Mustela server address" />
          <button class="btn small" classList={{ primary: !OFFICIAL }} disabled={!url().trim()}>Add server</button>
        </form>
        <Show when={err()}><p class="err pad">{err()}</p></Show>
      </Group>

      <Group title="Profile in your banner" hint="Mustela can also hide your profile in a thin strip at the bottom of your Stoat banner. It works with no server at all, but other apps show the strip as a gray line.">
        <Row label="Keep a copy in my banner" hint="People who haven't linked a Mustela server still see your profile from it. Off: only through your Mustela servers."><Switch label="Keep a copy in my banner" on={settings().cloud.banner} onChange={(banner) => setCloud({ banner })} /></Row>
        <Show when={settings().cloud.banner}>
          <p class="set-warn" role="note"><Icon name="info" size={16} />
            <span><Show when={ext().privacy.mode === "everyone"} fallback={<><b>Not in your banner right now:</b> your profile is set to {ext().privacy.mode === "friends" ? "Friends" : "Friends + servers"}, and anyone can read a banner, so Mustela leaves it out. It goes back in if you choose Everyone.</>}>
              <b>Anyone can see the copy in your banner,</b> even without Mustela, so "Who can see my profile" can't limit it. Choosing Friends or Friends + servers takes it out of your banner.
            </Show></span>
          </p>
        </Show>
      </Group>

      <Group title="Backup" hint="A file with everything that syncs. Useful before trying lots of changes.">
        <Row icon="download" label="Export settings" onClick={exportSettings} chevron />
        <Row icon="file" label="Import settings" onClick={importSettings} chevron />
      </Group>
    </div>
  );
}

/**
 * Who can see my Mustela profile (decorations, effects, frames, colours). Anything other than
 * Everyone keeps it out of the public banner and sends it only to Mustela servers that can keep it
 * private, for your friends (and members of the servers you pick).
 */
function PrivacyGroup() {
  const p = () => ext().privacy;
  const servers = () => spacesList() ?? [];
  const [spacesList] = createResource(() => backend()?.spaces().then((all) => all.filter((x) => !x.home)).catch(() => []));
  const set = (privacy: ReturnType<typeof ext>["privacy"]) => {
    updateExt((e) => ({ ...e, privacy }));
    // Re-publish with the new audience, so it takes effect now.
    const b = backend();
    if (b && activeAccount(book())?.kind !== "demo") void attempt(() => b.publishProfile(settings().profile, undefined, { banner: settings().cloud.banner, privacy, servers: ext().serverLooks }), privacy.mode === "everyone" ? "Your profile is public" : "Your profile is private");
  };
  return (
    <Group title="Who can see my profile" hint="Your decorations, effects, frames and colours. Stoat's own profile (name, picture, bio) isn't affected.">
      <Row label="Visible to">
        <Seg label="Who can see my profile" value={p().mode} onChange={(mode) => set({ ...p(), mode })}
          options={[{ v: "everyone", label: "Everyone" }, { v: "friends", label: "Friends" }, { v: "friends+servers", label: "Friends + servers" }]} />
      </Row>
      <Show when={p().mode !== "everyone"}>
        <p class="group-hint">While it isn't public, nothing is hidden in your banner, and only Mustela servers that can keep it private get a copy. Other people need a Mustela server in common with you to see it.</p>
      </Show>
      <Show when={p().mode === "friends+servers"}>
        <div class="row ss-role-pick">
          <For each={servers()} fallback={<span class="muted small">You're not in any servers.</span>}>{(sv) => {
            const on = () => p().servers.includes(sv.id);
            return <button class="chip" classList={{ on: on() }} aria-pressed={on()} onClick={() => set({ ...p(), servers: on() ? p().servers.filter((x) => x !== sv.id) : [...p().servers, sv.id] })}>{sv.name}</button>;
          }}</For>
        </div>
      </Show>
    </Group>
  );
}

