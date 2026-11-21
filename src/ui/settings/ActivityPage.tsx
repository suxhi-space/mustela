import { createSignal, For, onCleanup, Show } from "solid-js";
import { activity, desktopActivity, elapsed, verb } from "../activity";
import { Group, Row, Seg, Switch } from "../controls";
import type { CustomProgram } from "../../lib/device";
import { Icon } from "../icons";
import { device, settings, updateDevice } from "../store";

/** Mustela's take on Discord's "Activity privacy" and "Registered games". */
export function ActivityPage() {
  const a = () => device().activity;
  const set = (p: Partial<ReturnType<typeof a>>) => updateDevice({ activity: { ...a(), ...p } });
  const [now, setNow] = createSignal(Date.now());
  const t = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(t));
  const hide = (name: string) => set({ hidden: [...new Set([...a().hidden, name])] });
  const unhide = (name: string) => set({ hidden: a().hidden.filter((x) => x !== name) });
  const noServers = () => settings().cloud.servers.length === 0;

  // Add a program: pick from what's running now, name it, choose how it reads.
  type Running = { exe: string; name: string };
  const [picking, setPicking] = createSignal(false);
  const [running, setRunning] = createSignal<Running[] | null>(null);
  const [query, setQuery] = createSignal("");
  const [chosen, setChosen] = createSignal<Running | null>(null);
  const [name, setName] = createSignal("");
  const [kind, setKind] = createSignal<CustomProgram["kind"]>("playing");
  async function openPicker() {
    setPicking(true); setRunning(null); setChosen(null); setQuery(""); setKind("playing");
    try { const { invoke } = await import("@tauri-apps/api/core"); setRunning(await invoke<Running[]>("running_programs")); } catch { setRunning([]); }
  }
  const found = () => {
    const q = query().trim().toLowerCase(), have = new Set(a().custom.map((c) => c.exe.toLowerCase()));
    return (running() ?? []).filter((r) => !have.has(r.exe.toLowerCase()) && (!q || r.name.toLowerCase().includes(q) || r.exe.toLowerCase().includes(q))).slice(0, 200);
  };
  function addChosen() {
    const c = chosen(); if (!c || !name().trim()) return;
    set({ custom: [...a().custom.filter((x) => x.exe.toLowerCase() !== c.exe.toLowerCase()), { exe: c.exe, name: name().trim(), kind: kind() }] });
    setPicking(false);
  }

  return (
    <div class="page">
      <Show when={desktopActivity()} fallback={<p class="group-hint">Activity comes from the desktop app (Windows, macOS, Linux). On this device you can still see other people's.</p>}>
        <Group title="Right now" hint="Everything you're doing shows at once, like Discord: a game and music, for example.">
          <For each={activity.list()} fallback={<Row icon="gamepad" label="Nothing detected" hint="Start a game, an app with Discord Rich Presence, or one of your own programs below." />}>
            {(cur) => (
              <div class="act-now">
                <Show when={cur.image} fallback={<span class="act-img blank"><Icon name="gamepad" size={26} /></span>}><img class="act-img" src={cur.image} alt="" /></Show>
                <span class="act-text">
                  <small>{verb(cur.kind)}</small>
                  <strong>{cur.name}</strong>
                  <Show when={cur.details}><span>{cur.details}</span></Show>
                  <Show when={cur.state}><span>{cur.state}</span></Show>
                  <Show when={cur.startedAt}><span class="muted">{elapsed(cur.startedAt, now())} elapsed</span></Show>
                </span>
                <button class="btn small" onClick={() => hide(cur.name)}>Hide this</button>
              </div>
            )}
          </For>
        </Group>

        <Group title="Your games and apps" hint="Programs Discord's list doesn't know (a drawing app, an indie game): Mustela shows them while they're open.">
          <For each={a().custom}>{(c) => (
            <Row icon="gamepad" label={c.name} hint={`${verb(c.kind)} ${c.name} · ${c.exe}`}>
              <button class="icon-btn" aria-label={`Remove ${c.name}`} title="Remove" onClick={() => set({ custom: a().custom.filter((x) => x.exe !== c.exe) })}><Icon name="trash" size={16} /></button>
            </Row>
          )}</For>
          <Show when={picking()} fallback={<Row icon="plus" label="Add a program" hint="Pick it from what's running now" onClick={() => void openPicker()} chevron />}>
            <div class="act-pick">
              <input class="text-input" placeholder="Search running programs" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search running programs" />
              <div class="act-pick-list" role="listbox">
                <For each={found()} fallback={<p class="muted small pad">{running() === null ? "Looking…" : "Nothing running matches."}</p>}>{(r) => (
                  <button class="act-pick-row" classList={{ on: chosen()?.exe === r.exe }} role="option" aria-selected={chosen()?.exe === r.exe} onClick={() => { setChosen(r); setName(r.name); }}>
                    <strong>{r.name}</strong><small class="muted">{r.exe}</small>
                  </button>
                )}</For>
              </div>
              <Show when={chosen()}>
                <div class="act-pick-opts">
                  <input class="text-input" value={name()} maxLength={64} onInput={(e) => setName(e.currentTarget.value)} aria-label="What to call it" placeholder="What to call it" />
                  <Seg label="Shows as" value={kind()} onChange={setKind} options={[{ v: "playing", label: "Playing" }, { v: "listening", label: "Listening to" }, { v: "watching", label: "Watching" }]} />
                </div>
              </Show>
              <div class="dialog-actions">
                <button class="btn" onClick={() => setPicking(false)}>Cancel</button>
                <button class="btn primary" disabled={!chosen() || !name().trim()} onClick={addChosen}>Add</button>
              </div>
            </div>
          </Show>
        </Group>

        <Group title="Sources" hint="Rich Presence uses the same local socket Discord does, so it only works while Discord itself is closed.">
          <Row label="Detect running games" hint={activity.status().detect === "unsupported" ? "Not available on this system" : "Matches programs against Discord's list of known games"}>
            <Switch label="Detect running games" on={a().detect} disabled={activity.status().detect === "unsupported"} onChange={(detect) => set({ detect })} />
          </Row>
          <Row label="Discord Rich Presence" hint={activity.status().rpc === "busy" ? "Discord started first, so games are talking to it. Mustela takes over the next time Discord restarts, and passes everything on to Discord so both see it. Turn on Start with your computer (Desktop settings) so Mustela starts first." : activity.status().rpc === "listening" ? `Listening, and passing it on to Discord when it's open${activity.rpcApp() ? `. Connected to ${activity.rpcApp()}` : ""}` : activity.status().rpc === "unsupported" ? "Not available on this system" : "Off"}>
            <Switch label="Discord Rich Presence" on={a().rpc} disabled={activity.status().rpc === "unsupported"} onChange={(rpc) => set({ rpc })} />
          </Row>
        </Group>
      </Show>

      <Group title="Privacy" hint={noServers() ? "Add a Mustela server under Sync & servers: that's where activity is shared from." : "Your status and status message stay separate. Activity is shown on your profile and in member lists, to Mustela users."}>
        <Row label="Share my activity"><Switch label="Share my activity" on={a().share} onChange={(share) => set({ share })} /></Row>
      </Group>

      <Show when={activity.games().length || a().hidden.length}>
        <Group title="Games" hint="Hidden games are never shown or shared.">
          <For each={activity.games()}>{(g) => (
            <Row label={g.name} hint={a().hidden.includes(g.name) ? "Hidden" : "Running"}>
              <Show when={a().hidden.includes(g.name)} fallback={<button class="btn small" onClick={() => hide(g.name)}>Hide</button>}>
                <button class="btn small" onClick={() => unhide(g.name)}>Show</button>
              </Show>
            </Row>
          )}</For>
          <For each={a().hidden.filter((h) => !activity.games().some((g) => g.name === h))}>{(h) => (
            <Row label={h} hint="Hidden"><button class="btn small" onClick={() => unhide(h)}>Show</button></Row>
          )}</For>
        </Group>
      </Show>
    </div>
  );
}
