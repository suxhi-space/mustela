import { onMount, Match, Show, Switch } from "solid-js";
import { Login } from "./Login";
import { routeExternalLinks } from "../lib/notify";
import { startCallBridge } from "./call/state";
import { Shell } from "./Shell";
import { activeAccount } from "../lib/session/book";
import { addingAccount, book, boot, error, openAccount, phase, removeAccountById, setAddingAccount, startAppearance } from "./store";

export function App() {
  startAppearance();
  startCallBridge();
  routeExternalLinks();
  onMount(() => void boot());
  return (
    <Switch>
      <Match when={phase() === "boot" || phase() === "connecting"}>
        <main class="splash" aria-busy="true"><div class="spinner" /><p class="muted">{phase() === "boot" ? "Starting…" : "Connecting…"}</p></main>
      </Match>
      <Match when={phase() === "error"}>
        <main class="splash">
          <div class="login-card">
            <h1>Couldn't connect</h1>
            <p class="err" role="alert">{error()}</p>
            <Show when={activeAccount(book())}>{(a) => (
              <>
                <button class="btn primary" onClick={() => void openAccount(a())}>Try again</button>
                <button class="btn" onClick={() => setAddingAccount(true)}>Use another account</button>
                <button class="btn link" onClick={() => void removeAccountById(a().id)}>Remove {a().name}</button>
              </>
            )}</Show>
          </div>
          <Show when={addingAccount()}><div class="scrim"><Login /></div></Show>
        </main>
      </Match>
      <Match when={phase() === "login"}><Login /></Match>
      <Match when={phase() === "ready"}>
        <Shell />
        <Show when={addingAccount()}><div class="scrim full"><Login /></div></Show>
      </Match>
    </Switch>
  );
}
