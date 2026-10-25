import { createResource, createSignal, For, Show } from "solid-js";
import type { MfaProof } from "../../lib/backend/types";
import { Avatar } from "../Avatar";
import { Group, Row } from "../controls";
import { Icon } from "../icons";
import { attempt, copy, formDialog, proofDialog } from "../menu";
import { backend, bumpMe, meNow, settings } from "../store";
import { qrSvg } from "../../lib/qr";

const mask = (email: string) => email.replace(/^(.)(.*)(@.)(.*)(\..+)$/, (_, a, b, c, d, e) => a + "•".repeat(b.length) + c + "•".repeat(d.length) + e);

/** Stoat's "My Account": username, email, password, two-factor, disable/delete. */
export function MyAccount(props: { onEditProfile(): void }) {
  const b = () => backend()!;
  const [email, { refetch: refetchEmail }] = createResource(() => b().account.email().catch(() => ""));
  const [mfa, { refetch: refetchMfa }] = createResource(() => b().account.mfa().catch(() => ({ authenticator: false, recovery: false })));
  const [reveal, setReveal] = createSignal(false);
  const [codes, setCodes] = createSignal<string[] | null>(null);
  const [setup, setSetup] = createSignal<string | null>(null);
  const me = () => meNow()!;
  const [info] = createResource(() => b().profileOf(b().me.id));
  const banner = () => info()?.bannerUrl;
  const proof = (title: string, body: string, confirm: string, danger = false) => proofDialog(title, body, confirm, { danger, totp: mfa()?.authenticator });

  async function changeUsername() {
    const v = await formDialog("Change your username", [
      { key: "u", label: "New username", value: me().username ?? "", max: 32, hint: "Your number (#1234) may change if the name is taken." },
      { key: "p", label: "Current password", type: "password", autocomplete: "current-password" },
    ], "Change username", { validate: (v) => (v.u!.trim().length < 2 ? "Usernames need at least 2 characters." : !v.p ? "Enter your password." : null) });
    if (v) await attempt(async () => { await b().account.changeUsername(v.u!.trim(), v.p!); bumpMe(); }, "Username changed");
  }
  async function changeEmail() {
    const v = await formDialog("Change your email", [
      { key: "e", label: "New email", type: "email", autocomplete: "email" },
      { key: "p", label: "Current password", type: "password", autocomplete: "current-password" },
    ], "Send confirmation", { body: "Stoat sends a link to the new address. The change happens when you open it.", validate: (v) => (!/^\S+@\S+\.\S+$/.test(v.e!) ? "That doesn't look like an email address." : !v.p ? "Enter your password." : null) });
    if (v) await attempt(async () => { await b().account.changeEmail(v.e!, v.p!); void refetchEmail(); }, "Check your inbox to confirm");
  }
  async function changePassword() {
    const v = await formDialog("Change your password", [
      { key: "c", label: "Current password", type: "password", autocomplete: "current-password" },
      { key: "n", label: "New password", type: "password", autocomplete: "new-password", hint: "At least 8 characters." },
      { key: "r", label: "New password again", type: "password", autocomplete: "new-password" },
    ], "Change password", { validate: (v) => (v.n!.length < 8 ? "The new password needs at least 8 characters." : v.n !== v.r ? "The new passwords don't match." : null) });
    if (v) await attempt(() => b().account.changePassword(v.n!, v.c!), "Password changed");
  }
  async function showCodes(fresh: boolean) {
    const p = await proof(fresh ? "Make new recovery codes" : "View recovery codes", fresh ? "Your old codes stop working." : "Confirm it's you to see your codes.", fresh ? "Make new codes" : "Show codes");
    if (p) await attempt(async () => { setCodes(await b().account.recoveryCodes(p, fresh)); void refetchMfa(); });
  }
  async function startAuthenticator() {
    const p = await proof("Set up an authenticator", "Confirm it's you first.", "Continue");
    if (p) await attempt(async () => setSetup(await b().account.authenticatorSecret(p)));
  }
  async function finishAuthenticator(code: string) {
    await attempt(async () => { await b().account.enableAuthenticator(code); setSetup(null); void refetchMfa(); }, "Authenticator turned on");
  }
  async function guarded(title: string, body: string, confirm: string, f: (p: MfaProof) => Promise<void>, done: string) {
    const p = await proof(title, body, confirm, true);
    if (p) await attempt(() => f(p), done);
  }

  return (
    <div class="page">
      <div class="acct-card" style={banner() ? { "background-image": `url("${banner()!.replace(/"/g, "%22")}")` } : {}}>
        <Avatar person={me()} size={64} profile={settings().profile} />
        <span class="acct-names"><strong>{me().name}</strong><small>{me().username}{me().discriminator ? `#${me().discriminator}` : ""}</small></span>
        <button class="btn small primary" onClick={props.onEditProfile}><Icon name="pencil" size={15} />Edit profile</button>
      </div>

      <Group>
        <Row icon="at" label="Username" hint={`${me().username ?? ""}${me().discriminator ? `#${me().discriminator}` : ""}`} onClick={() => void changeUsername()} chevron />
        <Row icon="mail" label="Email" hint={email.loading ? "Loading…" : email() ? (reveal() ? email()! : mask(email()!)) : "Not available"} chevron onClick={() => void changeEmail()}>
          <Show when={email()}><button class="link small" onClick={(e) => { e.stopPropagation(); setReveal(!reveal()); }}>{reveal() ? "Hide" : "Reveal"}</button></Show>
        </Row>
        <Row icon="key" label="Password" hint="••••••••••" onClick={() => void changePassword()} chevron />
      </Group>

      <Group title="Two-factor authentication" hint="Recovery codes get you back in if you lose your authenticator. Keep them somewhere safe.">
        <Row icon="shield" label="Recovery codes" hint={mfa()?.recovery ? "Set up" : "Not set up"}>
          <Show when={mfa()?.recovery}><button class="btn small" onClick={() => void showCodes(false)}>View</button></Show>
          <button class="btn small" onClick={() => void showCodes(true)}>{mfa()?.recovery ? "Make new" : "Set up"}</button>
        </Row>
        <Show when={codes()}>
          <div class="codes">
            <For each={codes()}>{(c) => <code>{c}</code>}</For>
            <div class="dialog-actions start">
              <button class="btn small" onClick={() => void copy(codes()!.join("\n"), "Codes copied")}><Icon name="copy" size={15} />Copy</button>
              <button class="btn small" onClick={() => setCodes(null)}>Done</button>
            </div>
          </div>
        </Show>
        <Row icon="lock" label="Authenticator app" hint={mfa()?.authenticator ? "On" : "Off: use an app like Aegis, 2FAS or Google Authenticator"}>
          <Show when={mfa()?.authenticator} fallback={<button class="btn small" disabled={!mfa()?.recovery} title={mfa()?.recovery ? undefined : "Set up recovery codes first"} onClick={() => void startAuthenticator()}>Turn on</button>}>
            <button class="btn small danger" onClick={() => void guarded("Turn off the authenticator", "Signing in will only need your password.", "Turn off", (p) => b().account.disableAuthenticator(p).then(() => void refetchMfa()), "Authenticator turned off")}>Turn off</button>
          </Show>
        </Row>
        <Show when={setup()}>{(secret) => <TotpSetup secret={secret()} account={me().username ?? me().name} onDone={(c) => void finishAuthenticator(c)} onCancel={() => setSetup(null)} />}</Show>
      </Group>

      <Group title="Account removal">
        <Row icon="ban" label="Disable account" hint="You can't sign in until you contact support. Nothing is deleted." chevron
          onClick={() => void guarded("Disable your account?", "You'll be signed out everywhere and can't sign in until you contact Stoat support.", "Disable account", (p) => b().account.disableAccount(p), "Account disabled")} />
        <Row icon="trash" label="Delete account" hint="Your account and data are queued for deletion. You have 7 days to cancel by contacting support." chevron
          onClick={() => void guarded("Delete your account?", "Stoat emails you a confirmation link. Servers you own must be deleted or handed over first.", "Delete account", (p) => b().account.deleteAccount(p), "Check your email to confirm")} />
      </Group>
    </div>
  );
}

function TotpSetup(props: { secret: string; account: string; onDone(code: string): void; onCancel(): void }) {
  const [code, setCode] = createSignal("");
  const uri = () => `otpauth://totp/Stoat:${encodeURIComponent(props.account)}?secret=${props.secret}&issuer=Stoat`;
  return (
    <div class="totp">
      <div class="qr" innerHTML={qrSvg(uri())} aria-label="QR code for your authenticator app" role="img" />
      <div class="totp-text">
        <p>Scan this with your authenticator app, or type the key in.</p>
        <button class="code-chip" onClick={() => void copy(props.secret, "Key copied")} title="Copy key">{props.secret.replace(/(.{4})/g, "$1 ").trim()}</button>
        <label class="field">Code from the app
          <input value={code()} inputmode="numeric" autocomplete="one-time-code" maxLength={7} placeholder="123456" onInput={(e) => setCode(e.currentTarget.value)} />
        </label>
        <div class="dialog-actions start">
          <button class="btn small" onClick={props.onCancel}>Cancel</button>
          <button class="btn small primary" disabled={code().replace(/\s/g, "").length !== 6} onClick={() => props.onDone(code())}>Turn on</button>
        </div>
      </div>
    </div>
  );
}


