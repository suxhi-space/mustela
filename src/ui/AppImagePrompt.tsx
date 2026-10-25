import { createResource, createSignal, Show } from "solid-js";
import { appImage, installAppImage, relaunchInstalled } from "./desktop";
import { Icon } from "./icons";
import { toast } from "./menu";

const KEY = "mustela:appimage-prompt";
const dismissed = () => { try { return localStorage.getItem(KEY) === "never"; } catch { return false; } };

/**
 * Linux, running from a loose AppImage: offer to put it in ~/Applications with
 * an app-menu entry (and a desktop shortcut), like an installer would.
 */
export function AppImagePrompt() {
  const [st] = createResource(() => (dismissed() ? Promise.resolve(null) : appImage().catch(() => null)));
  const [hidden, setHidden] = createSignal(false);
  const [shortcut, setShortcut] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);
  async function install() {
    setBusy(true);
    try { await installAppImage(shortcut()); setDone(true); }
    catch (e) { toast(String((e as Error)?.message ?? e) || "Couldn't install Mustela.", true); }
    finally { setBusy(false); }
  }
  const never = () => { try { localStorage.setItem(KEY, "never"); } catch { /* private storage */ } setHidden(true); };
  return (
    <Show when={!hidden() && st()?.isAppImage && !st()?.installed}>
      <div class="ai-prompt" role="dialog" aria-label="Install Mustela">
        <Show when={!done()} fallback={<>
          <strong>Installed</strong>
          <p>Mustela is in your Applications folder and app menu. Restart it from there to finish.</p>
          <div class="row end"><button class="btn" onClick={() => setHidden(true)}>Later</button><button class="btn primary" onClick={() => void relaunchInstalled()}>Restart now</button></div>
        </>}>
          <span class="ai-ic"><Icon name="download" size={20} /></span>
          <strong>Install Mustela?</strong>
          <p>Move it to ~/Applications and add it to your app menu, so it stays put and opens like any other app.</p>
          <label class="ai-check"><input type="checkbox" checked={shortcut()} onChange={(e) => setShortcut(e.currentTarget.checked)} />Add a desktop shortcut too</label>
          <div class="row end">
            <button class="btn ghost" onClick={never}>Don't ask again</button>
            <button class="btn" onClick={() => setHidden(true)}>Not now</button>
            <button class="btn primary" disabled={busy()} onClick={() => void install()}>{busy() ? "Installing…" : "Install"}</button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
