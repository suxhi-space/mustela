import { createSignal, Show } from "solid-js";
import logo from "../../icons/app-icon.png";
import { beginLogin, finishMfa } from "../lib/backend/login";
import { addStoatAccount, book, enterDemo, setAddingAccount } from "./store";

type Step = { kind: "creds" } | { kind: "mfa"; ticket: string; methods: string[] };

export function Login() {
  const [step, setStep] = createSignal<Step>({ kind: "creds" });
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [base, setBase] = createSignal("");
  const [code, setCode] = createSignal("");
  const [recovery, setRecovery] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");
  const canCancel = () => book().accounts.length > 0;

  async function run(f: () => Promise<void>) {
    setBusy(true); setErr("");
    try { await f(); } catch (e) { setErr(e instanceof Error && e.message ? e.message : "Couldn't sign in. Try again."); }
    finally { setBusy(false); }
  }
  const submit = (e: Event) => { e.preventDefault(); void run(async () => {
    const r = await beginLogin({ baseURL: base() || undefined, email: email().trim(), password: password() });
    if (r.kind === "mfa") { setStep({ kind: "mfa", ticket: r.ticket, methods: r.methods }); return; }
    setPassword("");
    await addStoatAccount(r.session, base() || undefined);
  }); };
  const submitMfa = (e: Event) => { e.preventDefault(); const s = step(); if (s.kind !== "mfa") return; void run(async () => {
    const r = await finishMfa({ baseURL: base() || undefined, ticket: s.ticket, method: recovery() ? "recovery" : "totp", code: code() });
    if (r.kind !== "ok") throw new Error("That code didn't work. Try the next one.");
    setPassword(""); setCode("");
    await addStoatAccount(r.session, base() || undefined);
  }); };

  return (
    <main class="login">
      <div class="login-card">
        <img class="login-logo" src={logo} alt="" width="64" height="64" />
        <h1>Mustela</h1>
        <p class="muted">{canCancel() ? "Add another account." : "Sign in with your Stoat account."}</p>
        <Show when={step().kind === "creds"} fallback={
          <form onSubmit={submitMfa}>
            <label class="field">{recovery() ? "Recovery code" : "Authenticator code"}
              <input inputmode={recovery() ? "text" : "numeric"} autocomplete="one-time-code" value={code()} onInput={(e) => setCode(e.currentTarget.value)} required autofocus />
            </label>
            <Show when={err()}><p class="err" role="alert">{err()}</p></Show>
            <button class="btn primary" disabled={busy()}>{busy() ? "Checking…" : "Verify"}</button>
            <button type="button" class="btn link" onClick={() => { setRecovery(!recovery()); setCode(""); }}>{recovery() ? "Use authenticator code" : "Use a recovery code"}</button>
            <button type="button" class="btn link" onClick={() => { setStep({ kind: "creds" }); setErr(""); }}>Back</button>
          </form>
        }>
          <form onSubmit={submit}>
            <label class="field">Email<input type="email" autocomplete="username" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} required /></label>
            <label class="field">Password<input type="password" autocomplete="current-password" value={password()} onInput={(e) => setPassword(e.currentTarget.value)} required /></label>
            <details>
              <summary>Self-hosted instance</summary>
              <label class="field">API address<input type="url" placeholder="https://chat.example.org/api" value={base()} onInput={(e) => setBase(e.currentTarget.value)} /></label>
            </details>
            <Show when={err()}><p class="err" role="alert">{err()}</p></Show>
            <button class="btn primary" disabled={busy()}>{busy() ? "Signing in…" : "Sign in"}</button>
          </form>
          <button type="button" class="btn link" onClick={enterDemo}>Explore the demo</button>
        </Show>
        <Show when={canCancel()}><button type="button" class="btn link" onClick={() => setAddingAccount(false)}>Cancel</button></Show>
      </div>
    </main>
  );
}
