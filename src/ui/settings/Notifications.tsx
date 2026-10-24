import { createSignal, Show } from "solid-js";
import { notify } from "../../lib/notify";
import { Group, Row, Switch } from "../controls";
import { device, updateDevice } from "../store";

export function NotificationsPage() {
  const [test, setTest] = createSignal<"" | "ok" | "blocked">("");
  return (
    <div class="page">
      <Group title="Notifications" hint="Mustela notifies you about direct messages, group messages and mentions, unless you're already looking at that conversation or it's muted.">
        <Row label="Show notifications"><Switch label="Show notifications" on={device().notifications} onChange={(notifications) => updateDevice({ notifications })} /></Row>
        <Row label="Send a test notification" hint={test() === "blocked" ? "Notifications are blocked. Allow them for Mustela in your system settings." : test() === "ok" ? "Sent." : undefined}>
          <button class="btn small" onClick={async () => setTest((await notify("Mustela", "Notifications are working.")) ? "ok" : "blocked")}>Test</button>
        </Row>
      </Group>
      <Show when={!device().notifications}><p class="group-hint">You won't get any notifications on this device.</p></Show>
    </div>
  );
}
