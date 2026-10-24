import { For, Show } from "solid-js";
import { activeAccount } from "../../lib/session/book";
import { instanceLabel } from "../Accounts";
import { Avatar } from "../Avatar";
import { Group, Row } from "../controls";
import { book, setAddingAccount, removeAccountById, switchAccount, syncState } from "../store";

const SYNC_TEXT = { local: "Saved on this device", syncing: "Syncing…", synced: "Synced to your account", error: "Sync paused. It will retry on your next change." } as const;

export function AccountsPage(props: { onClose(): void }) {
  return (
    <div class="page">
      <Group title="Signed in" hint="Sessions are kept in this app's private storage on this device. Removing an account signs it out on the server too.">
        <For each={book().accounts}>{(a) => {
          const active = () => a.id === activeAccount(book())?.id;
          return (
            <Row label={<span class="acct"><Avatar person={{ id: a.id, name: a.name, avatarUrl: a.avatarUrl }} size={32} profile={null} presence={false} />
              <span><strong>{a.name}</strong><small>{a.kind === "demo" ? "Demo account" : instanceLabel(a.baseURL)}</small></span></span>}>
              <Show when={!active()} fallback={<span class="pill">Active</span>}>
                <button class="btn small" onClick={() => { void switchAccount(a.id); props.onClose(); }}>Switch</button>
              </Show>
              <button class="btn small danger" onClick={() => void removeAccountById(a.id)}>Remove</button>
            </Row>
          );
        }}</For>
        <Row label="Add another account"><button class="btn primary small" onClick={() => { setAddingAccount(true); props.onClose(); }}>Add account</button></Row>
      </Group>
      <Group title="Sync" hint="Colors, your profile and your animation limit follow this account to every device you sign in on.">
        <Row label="Settings sync">{SYNC_TEXT[syncState()]}</Row>
      </Group>
    </div>
  );
}
