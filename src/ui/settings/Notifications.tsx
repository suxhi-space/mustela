import { createResource, createSignal, For, Show } from "solid-js";
import type { NotifyLevel } from "../../lib/backend/types";
import { notify } from "../../lib/notify";
import { playSfx } from "../../lib/sfx";
import { Group, Row, Select, Switch } from "../controls";
import { attempt } from "../menu";
import { backend, device, updateDevice } from "../store";

const LEVELS: { v: NotifyLevel | ""; label: string }[] = [
  { v: "", label: "Default (mentions)" }, { v: "all", label: "All messages" }, { v: "mention", label: "Mentions only" }, { v: "none", label: "Nothing" },
];

export function NotificationsPage() {
  const [test, setTest] = createSignal<"" | "ok" | "blocked">("");
  const b = () => backend()!;
  const [spaces, { refetch }] = createResource(() => b().spaces());
  const [tick, bump] = createSignal(0);
  const servers = () => (spaces() ?? []).filter((s) => !s.home);
  const sounds = () => device().sounds;
  const setSound = (k: keyof ReturnType<typeof sounds>, v: boolean) => updateDevice({ sounds: { ...sounds(), [k]: v } });

  return (
    <div class="page">
      <Group title="On this device" hint="Mustela notifies you about direct messages and mentions unless you're looking at that conversation or it's muted.">
        <Row icon="bell" label="Desktop notifications"><Switch label="Show notifications" on={device().notifications} onChange={(notifications) => updateDevice({ notifications })} /></Row>
        <Row label="Show message text" hint="Off shows only who sent it"><Switch label="Show message text" disabled={!device().notifications} on={device().notifyPreview} onChange={(notifyPreview) => updateDevice({ notifyPreview })} /></Row>
        <Row label="Unread badge" hint="Mention count on the app icon and window title"><Switch label="Unread badge" on={device().badge} onChange={(badge) => updateDevice({ badge })} /></Row>
        <Row label="Send a test notification" hint={test() === "blocked" ? "Notifications are blocked. Allow them for Mustela in your system settings." : test() === "ok" ? "Sent." : undefined}>
          <button class="btn small" onClick={async () => setTest((await notify("Mustela", "Notifications are working.")) ? "ok" : "blocked")}>Test</button>
        </Row>
      </Group>

      <Group title="Sounds">
        <Row icon="music" label="New message" hint="When a notification would show"><button class="btn small" onClick={() => playSfx("message")}>Play</button><Switch label="Message sound" on={sounds().message} onChange={(v) => setSound("message", v)} /></Row>
        <Row label="Someone joins or leaves your call"><button class="btn small" onClick={() => playSfx("join")}>Play</button><Switch label="Call sounds" on={sounds().call} onChange={(v) => setSound("call", v)} /></Row>
        <Row label="Mute and deafen"><button class="btn small" onClick={() => playSfx("mute")}>Play</button><Switch label="Mute sounds" on={sounds().toggles} onChange={(v) => setSound("toggles", v)} /></Row>
      </Group>

      <Group title="Servers" hint="Synced with your Stoat account, so the official app uses the same choices. Right-click a channel to set it there too.">
        <For each={servers()} fallback={<Row label={spaces.loading ? "Loading…" : "You're not in any servers yet."} />}>{(s) => {
          const muted = () => (tick(), b().isMuted("server", s.id));
          return (
            <Row label={<span class="acct"><span class="mini-orb">{s.iconUrl ? <img src={s.iconUrl} alt="" /> : s.name.slice(0, 2)}</span><span><strong>{s.name}</strong><Show when={muted()}><small>Muted</small></Show></span></span>}>
              <Select label={`Notifications for ${s.name}`} value={(tick(), b().notifyLevel("server", s.id) ?? "")} options={LEVELS}
                onChange={(lv) => void attempt(() => b().setNotifyLevel("server", s.id, (lv || undefined) as NotifyLevel | undefined)).then(() => bump((n) => n + 1))} />
              <button class="btn small" classList={{ on: muted() }} aria-pressed={muted()} onClick={() => void attempt(() => b().setMuted("server", s.id, muted() ? null : undefined)).then(() => { bump((n) => n + 1); void refetch(); })}>{muted() ? "Unmute" : "Mute"}</button>
            </Row>
          );
        }}</For>
      </Group>
    </div>
  );
}
