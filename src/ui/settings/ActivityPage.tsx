import { createSignal, For, onCleanup, Show } from "solid-js";
import { activity, desktopActivity, elapsed, verb } from "../activity";
import { Group, Row, Switch } from "../controls";
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

  return (
    <div class="page">
      <Show when={desktopActivity()} fallback={<p class="group-hint">Activity comes from the desktop app (Windows, macOS, Linux). On this device you can still see other people's.</p>}>
        <Group title="Right now">
          <Show when={activity.current()} fallback={<Row icon="gamepad" label="Nothing detected" hint="Start a game, or an app with Discord Rich Presence." />}>
            {(cur) => (
              <div class="act-now">
                <Show when={cur().image} fallback={<span class="act-img blank"><Icon name="gamepad" size={26} /></span>}><img class="act-img" src={cur().image} alt="" /></Show>
                <span class="act-text">
                  <small>{verb(cur().kind)}</small>
                  <strong>{cur().name}</strong>
                  <Show when={cur().details}><span>{cur().details}</span></Show>
                  <Show when={cur().state}><span>{cur().state}</span></Show>
                  <Show when={cur().startedAt}><span class="muted">{elapsed(cur().startedAt, now())} elapsed</span></Show>
                </span>
                <button class="btn small" onClick={() => hide(cur().name)}>Hide this</button>
              </div>
            )}
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

      <Group title="Privacy" hint={noServers() ? "Add a sync server under Sync & servers: that's where activity is shared from." : "Your status and status message stay separate. Activity is shown on your profile and in member lists, to Mustela users."}>
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
