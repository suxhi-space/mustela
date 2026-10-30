import { activeAccount } from "../../lib/session/book";
import { instanceLabel } from "../Accounts";
import { Group, Row } from "../controls";
import { confirmDialog, copy, toast } from "../menu";
import { backend, book, DEFAULT_DEVICE, platform, updateDevice } from "../store";
import { UpdatesGroup } from "../updates";

export const APP_VERSION = __APP_VERSION__;
const SOURCE = "https://github.com/stoatchat";

/** Troubleshooting and app details. */
export function AdvancedPage() {
  const acc = () => activeAccount(book());
  const info = () => [`Mustela ${APP_VERSION}`, `Platform: ${platform}`, `Instance: ${instanceLabel(acc()?.baseURL)}`, `User agent: ${navigator.userAgent}`].join("\n");
  return (
    <div class="page">
      <Group title="About">
        <Row icon="info" label="Version" hint={`Mustela ${APP_VERSION} on ${platform}`}><button class="btn small" onClick={() => void copy(info(), "Details copied")}>Copy details</button></Row>
        <Row icon="globe" label="Stoat instance" hint={instanceLabel(acc()?.baseURL)} />
        <Row icon="link" label="Stoat on GitHub" hint="The chat service Mustela connects to" onClick={() => window.open(SOURCE, "_blank", "noopener")} chevron />
      </Group>
      <UpdatesGroup />
      <Group title="Troubleshooting" hint="None of these sign you out or touch your account.">
        <Row label="Reload" hint="Reconnects and redraws everything" onClick={() => location.reload()} chevron />
        <Row label="Forget cached profiles" hint="Other people's profiles are fetched again" onClick={() => { (backend() as any)?.profiles?.clear?.(); toast("Profiles will refresh"); }} chevron />
        <Row label="Reset this device's settings" hint="Layout, window, sounds and voice settings go back to defaults" danger
          onClick={async () => { if (await confirmDialog("Reset this device's settings?", "Synced settings (colors, profile) are kept.", "Reset", true)) { updateDevice({ ...DEFAULT_DEVICE }); toast("Device settings reset"); } }} />
      </Group>
    </div>
  );
}
