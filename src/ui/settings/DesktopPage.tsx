import { createResource, createSignal, Show } from "solid-js";
import { appImage, autostart, installAppImage } from "../desktop";
import { Group, Row, Switch } from "../controls";
import { attempt, toast } from "../menu";
import { device, updateDevice } from "../store";

/** Stoat's desktop settings: tray, starting with the computer, and (Linux) installing the AppImage. */
export function DesktopPage() {
  const [auto, { mutate }] = createResource(() => autostart().catch(() => false));
  const [img, { refetch }] = createResource(() => appImage().catch(() => null));
  const [shortcut, setShortcut] = createSignal(true);
  const [moved, setMoved] = createSignal(false);
  return (
    <div class="page">
      <Group title="Window" hint="With the tray on, closing the window keeps Mustela (and your call) running. Quit from the tray icon.">
        <Row label="Close to the tray"><Switch label="Close to the tray" on={device().closeToTray} onChange={(closeToTray) => updateDevice({ closeToTray })} /></Row>
        <Row label="Start with your computer" hint="Opens quietly in the tray. Also lets Rich Presence start before Discord does.">
          <Switch label="Start with your computer" on={!!auto()} onChange={(v) => void attempt(async () => mutate(await autostart(v)))} />
        </Row>
      </Group>
      <Show when={img()?.isAppImage}>
        <Group title="Install" hint="Moves the AppImage to the Applications folder in your home, and adds Mustela to your app menu so you can find it like any other app.">
          <Show when={!img()!.installed && !moved()} fallback={
            <Row label="Installed" hint="~/Applications/Mustela.AppImage, with an app menu entry that follows it if it moves" />
          }>
            <Row label="Add a desktop shortcut too"><Switch label="Desktop shortcut" on={shortcut()} onChange={setShortcut} /></Row>
            <Row label="Install Mustela">
              <button class="btn small primary" onClick={() => void attempt(async () => { await installAppImage(shortcut()); setMoved(true); void refetch(); toast("Installed"); })}>Install</button>
            </Row>
          </Show>
        </Group>
      </Show>
    </div>
  );
}
