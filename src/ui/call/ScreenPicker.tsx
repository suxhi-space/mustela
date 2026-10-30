import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import type { VoicePrefs } from "../../lib/backend/types";
import type { ScreenSource } from "../../lib/voice/capture";
import { useBack } from "../back";
import { Seg } from "../controls";
import { Icon } from "../icons";
import { backend, device, platform, updateDevice } from "../store";

/** Screen share qualities, and why some are greyed out: only what Stoat allows can be picked. */
export const QUALITIES: { v: VoicePrefs["screenQuality"]; label: string }[] = [{ v: "720p30", label: "720p" }, { v: "1080p30", label: "1080p" }, { v: "1080p60", label: "1080p 60" }];
export const qualityHint = () => (backend()?.screenQualities() ?? []).includes("1080p30")
  ? "1080p needs a faster connection. 60 fps isn't in Stoat yet."
  : "Your Stoat account streams at 720p. Higher qualities aren't open to it yet.";

export interface ScreenChoice { source: ScreenSource | "system"; quality: VoicePrefs["screenQuality"]; audio: "off" | "app" | "system" }

const [req, setReq] = createSignal<((c: ScreenChoice | null) => void) | null>(null);
/** Opens Mustela's screen share picker. Resolves to what to share, or null if cancelled. */
export const pickScreen = () => new Promise<ScreenChoice | null>((resolve) => setReq(() => resolve));

/** `hidden`: the main window while the call is popped out (the picker opens over the pop-out instead). */
export function ScreenPickerHost(props: { hidden?: boolean }) {
  return <Show when={!props.hidden && req()}>{(r) => <ScreenPicker done={(c) => { r()(c); setReq(null); }} />}</Show>;
}

/**
 * Like Discord's "Go Live": screens and app windows with live previews, quality, and (on
 * Windows) sound from just that app, or from everything except Mustela.
 */
function ScreenPicker(props: { done(c: ScreenChoice | null): void }) {
  useBack(() => props.done(null));
  const [tab, setTab] = createSignal<"apps" | "screens">("apps");
  const [sources, { refetch }] = createResource(async () => (await import("../../lib/voice/capture")).listSources(true).catch(() => [] as ScreenSource[]));
  // Previews stay current while the picker is open, without hammering slow machines.
  const t = setInterval(() => void refetch(), 4000);
  onCleanup(() => clearInterval(t));
  const [pick, setPick] = createSignal<string | null>(null);
  // What Stoat allows: picking something it doesn't would be sent anyway, or refused. The rest are shown, greyed out.
  const allowed = () => backend()?.screenQualities() ?? ["720p30"];
  const quality = () => (allowed().includes(device().voice.screenQuality) ? device().voice.screenQuality : allowed()[allowed().length - 1]!);
  const setQuality = (screenQuality: VoicePrefs["screenQuality"]) => updateDevice({ voice: { ...device().voice, screenQuality } });
  const windows = platform === "windows";
  const [audio, setAudio] = createSignal<ScreenChoice["audio"]>(windows ? "app" : "off");
  const list = () => (sources() ?? []).filter((s) => (tab() === "screens" ? s.id.startsWith("screen:") : s.id.startsWith("window:")));
  const chosen = () => sources()?.find((s) => s.id === pick());
  const soundOptions = () => {
    // Whole screens share everything you hear, so "This app" only makes sense for app windows.
    const isScreen = chosen() ? chosen()!.id.startsWith("screen:") : tab() === "screens";
    return [{ v: "off" as const, label: "No sound" }, ...(isScreen ? [] : [{ v: "app" as const, label: "This app" }]), { v: "system" as const, label: "Everything but Mustela" }];
  };
  const go = () => {
    const c = chosen();
    if (!c) return;
    const a = !windows ? "off" : c.id.startsWith("screen:") && audio() === "app" ? "system" : audio();
    props.done({ source: c, quality: quality(), audio: a });
  };

  return (
    <div class="scrim" style={{ "z-index": 90 }} onClick={(e) => e.target === e.currentTarget && props.done(null)}>
      <div class="modal screen-picker" role="dialog" aria-label="Share your screen">
        <header class="sp-head">
          <h2>Share your screen</h2>
          <span class="grow" />
          <button class="icon-btn" aria-label="Close" onClick={() => props.done(null)}><Icon name="close" size={18} /></button>
        </header>
        <nav class="inbox-tabs" role="tablist">
          <button role="tab" aria-selected={tab() === "apps"} classList={{ on: tab() === "apps" }} onClick={() => setTab("apps")}>Applications</button>
          <button role="tab" aria-selected={tab() === "screens"} classList={{ on: tab() === "screens" }} onClick={() => setTab("screens")}>Screens</button>
        </nav>
        <div class="sp-grid">
          <Show when={sources()} fallback={<div class="loading-row"><div class="spinner small" /></div>}>
            <For each={list()} fallback={<p class="muted sp-empty">{tab() === "apps" ? "No app windows to share. Open the app (not minimised) and it appears here." : "No screens found."}</p>}>{(s) => (
              <button class="sp-tile" classList={{ on: pick() === s.id }} aria-pressed={pick() === s.id} onClick={() => setPick(s.id)} onDblClick={() => { setPick(s.id); go(); }}>
                <span class="sp-thumb"><Show when={s.thumb} fallback={<Icon name={s.id.startsWith("screen:") ? "screen" : "laptop"} size={30} />}><img src={`data:image/jpeg;base64,${s.thumb}`} alt="" /></Show></span>
                <span class="sp-name">{s.name}</span>
                <Show when={s.app && s.app !== s.name}><small class="muted">{s.app}</small></Show>
              </button>
            )}</For>
          </Show>
        </div>
        <div class="sp-opts">
          <label class="sp-opt"><span>Quality</span>
            <Seg label="Quality" value={quality()} onChange={setQuality} options={QUALITIES.map((o) => ({ ...o, disabled: !allowed().includes(o.v) }))} />
          </label>
          <p class="muted small">{qualityHint()}</p>
          <Show when={windows} fallback={<p class="muted small">Sharing sound works on Windows for now.</p>}>
            <label class="sp-opt"><span>Sound</span>
              <Seg label="Sound" value={(chosen() ? chosen()!.id.startsWith("screen:") : tab() === "screens") && audio() === "app" ? "system" : audio()} onChange={setAudio} options={soundOptions()} />
            </label>
          </Show>
        </div>
        <div class="dialog-actions">
          <button class="btn ghost" title="Use your system's own screen picker instead" onClick={() => props.done({ source: "system", quality: quality(), audio: "off" })}>System picker</button>
          <span class="grow" />
          <button class="btn" onClick={() => props.done(null)}>Cancel</button>
          <button class="btn primary" disabled={!chosen()} onClick={go}><Icon name="screen" size={16} />Go live</button>
        </div>
      </div>
    </div>
  );
}
