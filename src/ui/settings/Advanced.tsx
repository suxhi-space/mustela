import { activeAccount } from "../../lib/session/book";
import { instanceLabel } from "../Accounts";
import { Group, Row } from "../controls";
import { confirmDialog, copy, toast } from "../menu";
import { backend, book, DEFAULT_DEVICE, platform, updateDevice } from "../store";
import { UpdatesGroup } from "../updates";
import { perfReport } from "../perfLog";
import { clearChatCache } from "../../lib/chatCache";
import { clearProfileCache } from "../../lib/profileCache";
import { createResource, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../../lib/platform";

export const APP_VERSION = __APP_VERSION__;
const SOURCE = "https://github.com/stoatchat";

/** Troubleshooting and app details. */
export function AdvancedPage() {
  const acc = () => activeAccount(book());
  const [emojiSize, { refetch: refetchEmojiSize }] = createResource(() => (inTauri() ? true : null), () => invoke<number>("emoji_store_size").catch(() => 0));
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
        <Row label="Copy performance report" hint="If Mustela freezes or feels slow, copy this right after and send it. It lists the freezes it noticed and what was going on; nothing is sent anywhere."
          onClick={() => void copy(perfReport(info()), "Performance report copied")} chevron />
        <Row label="Reload" hint="Reconnects and redraws everything" onClick={() => location.reload()} chevron />
        <Row label="Clear saved chats" hint="Mustela keeps the last 50 messages of your 20 most recent chats on this device so they open instantly. This removes that copy; nothing on Stoat changes."
          onClick={() => void clearChatCache().then(() => toast("Saved chats cleared"))} chevron />
        <Show when={inTauri()}>
          <Row label="Clear saved emoji" hint={`Emoji pictures are kept on this device after the first time, so they show instantly and offline${emojiSize() ? ` (${(emojiSize()! / 1048576).toFixed(1)} MB now)` : ""}. They download again as needed.`}
            onClick={() => void invoke("clear_emoji_store").then(() => { refetchEmojiSize(); toast("Saved emoji cleared"); })} chevron />
        </Show>
        <Row label="Forget cached profiles" hint="Other people's profiles are fetched again" onClick={() => { const b = backend() as any; if (b?.forgetProfiles) b.forgetProfiles(); else b?.profiles?.clear?.(); void clearProfileCache(); toast("Profiles will refresh"); }} chevron />
        <Row label="Reset this device's settings" hint="Layout, window, sounds and voice settings go back to defaults" danger
          onClick={async () => { if (await confirmDialog("Reset this device's settings?", "Synced settings (colors, profile) are kept.", "Reset", true)) { updateDevice({ ...DEFAULT_DEVICE }); toast("Device settings reset"); } }} />
      </Group>
    </div>
  );
}
