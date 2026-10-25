import { createResource, For, Show } from "solid-js";
import { Group, Row } from "../controls";
import { attempt, promptDialog, proofDialog } from "../menu";
import { backend } from "../store";

const ago = (d?: Date) => {
  if (!d) return "";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return "within the last hour";
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)} days ago`;
  return d.toLocaleDateString();
};
const iconFor = (name: string) => (/android|ios|iphone|phone|mobile/i.test(name) ? "phone" : /mustela|desktop|windows|mac|linux/i.test(name) ? "laptop" : "globe");

/** Stoat's "Sessions": every device signed in to this account. */
export function SessionsPage() {
  const acc = () => backend()!.account;
  const [list, { refetch }] = createResource(() => acc().sessions());
  const mfa = createResource(() => acc().mfa().catch(() => ({ authenticator: false, recovery: false })))[0];
  const proof = (t: string, body: string) => proofDialog(t, body, "Log out", { danger: true, totp: mfa()?.authenticator });
  const current = () => list()?.filter((s) => s.current) ?? [];
  const others = () => list()?.filter((s) => !s.current) ?? [];

  return (
    <div class="page">
      <Show when={!list.error} fallback={<p class="err">Couldn't load your sessions. {String((list.error as Error)?.message ?? "")}</p>}>
        <Group title="This device">
          <For each={current()}>{(s) => <Row icon={iconFor(s.name)} label={s.name} hint={`Signed in ${ago(s.createdAt)}`}>
            <button class="btn small" onClick={async () => { const n = await promptDialog("Rename session", "Name", "Rename", s.name, { max: 72 }); if (n?.trim()) await attempt(() => acc().renameSession(s.id, n.trim()).then(refetch), "Renamed"); }}>Rename</button>
          </Row>}</For>
          <Show when={list.loading}><Row label="Loading…" /></Show>
        </Group>
        <Group title="Other sessions" count={others().length} hint="Log out anything you don't recognise, then change your password.">
          <For each={others()} fallback={<Show when={!list.loading}><Row label="No other sessions" hint="You're only signed in here." /></Show>}>{(s) => (
            <Row icon={iconFor(s.name)} label={s.name} hint={`Signed in ${ago(s.createdAt)}`}>
              <button class="btn small" onClick={async () => { const n = await promptDialog("Rename session", "Name", "Rename", s.name, { max: 72 }); if (n?.trim()) await attempt(() => acc().renameSession(s.id, n.trim()).then(refetch), "Renamed"); }}>Rename</button>
              <button class="btn small danger" onClick={async () => { const p = await proof(`Log out ${s.name}?`, "That device will need to sign in again."); if (p) await attempt(() => acc().logoutSession(s.id, p).then(refetch), "Logged out"); }}>Log out</button>
            </Row>
          )}</For>
          <Show when={others().length > 1}>
            <Row label="Log out of all other sessions" danger onClick={async () => { const p = await proof("Log out everywhere else?", "Every other device will need to sign in again."); if (p) await attempt(() => acc().logoutOtherSessions(p).then(refetch), "Logged out other sessions"); }} />
          </Show>
        </Group>
      </Show>
    </div>
  );
}
