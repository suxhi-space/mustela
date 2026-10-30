import { createRoot, createSignal, onCleanup, Show } from "solid-js";
import { inTauri } from "../lib/platform";
import { Group, Row, Switch } from "./controls";
import { Icon } from "./icons";
import { toast } from "./menu";
import { device, updateDevice } from "./store";

/** What the Rust side (src-tauri/src/updater.rs) says about this build. */
export interface UpdateConfig { version: string; repo: string | null; kind: string }
export interface UpdateInfo { version: string; notes: string; page: string; file: string | null; size: number; selfInstalls: boolean }

const SKIP_KEY = "mustela:update-skip";

const [config, setConfig] = createSignal<UpdateConfig | null>(null);
const [available, setAvailable] = createSignal<UpdateInfo | null>(null);
const [checking, setChecking] = createSignal(false);
const [progress, setProgress] = createSignal<number | null>(null);
const [lastError, setLastError] = createSignal<string | null>(null);
export { available as updateAvailable, config as updateConfig };

async function invoke<T>(cmd: string): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd);
}

/** Asks GitHub for a newer release. Quiet unless `manual`. */
export async function checkForUpdate(manual = false): Promise<UpdateInfo | null> {
  if (!inTauri() || !config()?.repo || checking()) return available();
  setChecking(true);
  try {
    const info = await invoke<UpdateInfo | null>("check_update");
    setAvailable(info);
    setLastError(null);
    if (manual && !info) toast("Mustela is up to date");
    return info;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    setLastError(msg);
    if (manual) toast(msg || "Couldn't check for updates.", true);
    return null;
  } finally { setChecking(false); }
}

export async function openReleasePage() {
  const page = available()?.page ?? (config()?.repo ? `https://github.com/${config()!.repo}/releases/latest` : null);
  if (!page) return;
  try { const { openUrl } = await import("@tauri-apps/plugin-opener"); await openUrl(page); }
  catch { window.open(page, "_blank", "noopener"); }
}

/** Downloads and installs when this platform can; otherwise opens the release page. */
export async function installUpdate(quiet = false) {
  const u = available();
  if (!u) return;
  if (!u.file || !["windows-nsis", "linux-appimage", "macos-dmg", "linux-deb"].includes(config()?.kind ?? "")) return openReleasePage();
  const { listen } = await import("@tauri-apps/api/event");
  const off = await listen<[number, number]>("mustela:update-progress", (e) => setProgress(e.payload[1] ? e.payload[0] / e.payload[1] : null));
  setProgress(0);
  try { const msg = await invoke<string>("install_update"); if (!quiet) toast(msg); }
  catch (e) { toast(String((e as Error)?.message ?? e) || "The update didn't install.", true); }
  finally { off(); setProgress(null); }
}

/**
 * Like Discord: when Mustela starts (a real start, not a reload), it checks once. An update this system can
 * install itself is downloaded and installed straight away, with a small "Updating" screen, and Mustela
 * restarts on it. Anything else (a .deb, phones) shows the corner card instead. No checks while you use it.
 */
const BOOT_KEY = "mustela:update-checked";
const [updating, setUpdating] = createSignal(false);
let started = false;
export function startUpdates() {
  if (!inTauri() || started) return;
  started = true;
  let fresh = true;
  try { fresh = !sessionStorage.getItem(BOOT_KEY); sessionStorage.setItem(BOOT_KEY, "1"); } catch { /* no storage: treat as a start */ }
  createRoot(() => {
    void invoke<UpdateConfig>("update_config").then(async (c) => {
      setConfig(c);
      if (!c.repo || !fresh || !device().autoUpdate) return;
      const info = await checkForUpdate();
      if (!info?.selfInstalls || !/windows|macos|linux-appimage/.test(c.kind)) return;
      setUpdating(true);
      await installUpdate(true);
      setUpdating(false); // only reached if installing failed; the corner card offers it again
    }).catch(() => {});
  });
}

/** The screen shown while an update installs at start-up. */
export function UpdateSplash() {
  return (
    <Show when={updating()}>
      <div class="update-splash" role="status" aria-live="polite">
        <div class="us-card">
          <span class="us-ic"><Icon name="download" size={26} /></span>
          <strong>Updating Mustela</strong>
          <p class="muted">{available() ? `Getting ${available()!.version}. Mustela restarts on its own when it's ready.` : "Getting the new version…"}</p>
          <progress class="up-progress" value={progress() ?? 0} max={1} />
        </div>
      </div>
    </Show>
  );
}

const skipped = () => { try { return localStorage.getItem(SKIP_KEY); } catch { return null; } };

/** A small card in the corner when a new version is out, like the AppImage prompt. */
export function UpdatePrompt() {
  const [hidden, setHidden] = createSignal(false);
  const show = () => !hidden() && !updating() && !!available() && skipped() !== available()!.version;
  const skip = () => { try { localStorage.setItem(SKIP_KEY, available()!.version); } catch { /* private storage */ } setHidden(true); };
  return (
    <Show when={show()}>
      <div class="ai-prompt" role="dialog" aria-label="Update Mustela">
        <span class="ai-ic"><Icon name="download" size={20} /></span>
        <strong>Mustela {available()!.version} is out</strong>
        <p>{available()!.selfInstalls ? "Install it now and Mustela restarts on the new version. Your settings stay as they are." : "Download it from the release page. Your settings and profile stay as they are."}</p>
        <Show when={progress() !== null}><progress class="up-progress" value={progress() ?? 0} max={1} /></Show>
        <div class="row end">
          <button class="btn ghost" onClick={skip}>Skip this version</button>
          <button class="btn" onClick={() => setHidden(true)}>Later</button>
          <button class="btn primary" disabled={progress() !== null} onClick={() => void installUpdate()}>
            {progress() !== null ? "Downloading…" : available()!.selfInstalls ? "Install" : "Download"}
          </button>
        </div>
      </div>
    </Show>
  );
}

/** Settings > Advanced: version, the update repository and a manual check. */
export function UpdatesGroup() {
  const repo = () => config()?.repo;
  return (
    <Show when={inTauri()}>
      <Group title="Updates" hint={repo() ? `New versions come from github.com/${repo()}/releases.` : "This copy was built without an update repository, so it doesn't check for updates."}>
        <Show when={repo()}>
          <Row label="Update when Mustela starts" hint="Checks once each time you open Mustela and installs the update right away."><Switch label="Update when Mustela starts" on={device().autoUpdate} onChange={(autoUpdate) => updateDevice({ autoUpdate })} /></Row>
          <Row label={available() ? `Mustela ${available()!.version} is available` : "Check now"} hint={lastError() ?? undefined}>
            <Show when={available()} fallback={<button class="btn small" disabled={checking()} onClick={() => void checkForUpdate(true)}>{checking() ? "Checking…" : "Check"}</button>}>
              <button class="btn small primary" disabled={progress() !== null} onClick={() => void installUpdate()}>{available()!.selfInstalls ? "Install" : "Download"}</button>
            </Show>
          </Row>
        </Show>
      </Group>
    </Show>
  );
}
