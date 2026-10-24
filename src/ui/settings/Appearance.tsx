import { createSignal, For, Show } from "solid-js";
import { RATING_ORDER, type Rating } from "../../lib/decor/spec";
import { THEMES, getTheme } from "../../lib/theme/palette";
import { inTauri } from "../../lib/platform";
import { ColorInput, Group, Row, Seg, Select, Slider, Switch } from "../controls";
import { backdropImage, device, materials, platform, setBackdropImage, settings, systemSeed, updateDevice, updateSettings } from "../store";

const MATERIAL_LABEL: Record<string, string> = { none: "None", mica: "Mica", acrylic: "Acrylic", blur: "Blur", vibrancy: "Vibrancy", "see-through": "See-through" };
const MATERIAL_HINT: Record<string, string> = {
  windows: "Mica follows your wallpaper. Acrylic and Blur show what's behind the window.",
  mac: "Vibrancy uses the system's translucent window material.",
  linux: "See-through only looks blurred if your desktop's compositor blurs windows behind it (KDE can).",
};

export function Appearance() {
  const [bdErr, setBdErr] = createSignal("");
  function pickBackdrop() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setBdErr("");
      try {
        if (await setBackdropImage(f)) updateDevice({ backdrop: "image" });
        else setBdErr("That picture is too large to keep. Try a smaller one.");
      } catch { setBdErr("Couldn't read that picture."); }
    };
    input.click();
  }
  const look = () => settings().look;
  const setLook = (patch: Partial<ReturnType<typeof look>>) => updateSettings((s) => ({ ...s, look: { ...s.look, ...patch } }));
  const systemOk = () => systemSeed() !== null;
  const systemHint = () => systemOk()
    ? "Colors follow your system accent."
    : platform === "android"
      ? "Not available in this build yet. Android's wallpaper colors need a small native plugin."
      : "Your system doesn't share an accent color with apps.";

  return (
    <div class="page">
      <Group title="Color" hint="Color settings follow your account. Style, layout and window settings stay on this device.">
        <Row label="Mode">
          <Seg label="Mode" value={look().mode} onChange={(mode) => setLook({ mode })} options={[{ v: "auto", label: "Auto" }, { v: "light", label: "Light" }, { v: "dark", label: "Dark" }]} />
        </Row>
        <Row label="Colors from" hint={systemHint()}>
          <Seg label="Color source" value={device().colorSource} onChange={(colorSource) => updateDevice({ colorSource })}
            options={[{ v: "theme", label: "Theme" }, { v: "system", label: "System", disabled: !systemOk() }]} />
        </Row>
        <Show when={device().colorSource === "theme" || !systemOk()}>
          <div class="themes" role="radiogroup" aria-label="Theme">
            <For each={THEMES}>{(t) => (
              <button class="theme-chip" role="radio" aria-checked={look().theme === t.id} classList={{ on: look().theme === t.id }} onClick={() => setLook({ theme: t.id })}>
                <span class="dot" style={{ background: t.seed }} />{t.name}
              </button>
            )}</For>
            <button class="theme-chip" role="radio" aria-checked={look().theme === "custom"} classList={{ on: look().theme === "custom" }} onClick={() => setLook({ theme: "custom" })}>
              <span class="dot" style={{ background: look().theme === "custom" ? look().seed : getTheme(look().theme).seed }} />Custom
            </button>
          </div>
          <Show when={look().theme === "custom"}>
            <Row label="Custom color"><ColorInput label="Custom theme color" value={look().seed} onChange={(seed) => setLook({ seed })} /></Row>
          </Show>
        </Show>
        <Row label="Pure black" hint="Saves battery on OLED screens. Dark mode only."><Switch label="Pure black" on={look().amoled} onChange={(amoled) => setLook({ amoled })} /></Row>
      </Group>

      <Group title="Style">
        <Row label="Depth" hint="3D gives floating panels and chunky buttons. Flat removes the shadows and edges.">
          <Seg label="Depth" value={device().style} onChange={(style) => updateDevice({ style })} options={[{ v: "classic", label: "3D" }, { v: "flat", label: "Flat" }]} />
        </Row>
        <Row label="Background" hint={device().backdrop === "image" ? "Your picture stays on this device." : "What's behind the panels."}>
          <Seg label="Background" value={device().backdrop} onChange={(backdrop) => { if (backdrop === "image" && !backdropImage()) pickBackdrop(); else updateDevice({ backdrop }); }}
            options={[{ v: "stars", label: "Stars" }, { v: "plain", label: "Plain" }, { v: "image", label: "Picture" }]} />
        </Row>
        <Show when={device().backdrop === "image" && backdropImage()}>
          <Row label="Picture">
            <span class="bd-thumb" style={{ "background-image": `url("${backdropImage()}")` }} />
            <button class="btn small" onClick={pickBackdrop}>Change</button>
            <button class="btn small danger" onClick={() => { void setBackdropImage(null); updateDevice({ backdrop: "stars" }); }}>Remove</button>
          </Row>
        </Show>
        <Show when={bdErr()}><Row label={<span class="err">{bdErr()}</span>} /></Show>
      </Group>

      <Group title="Layout">
        <Row label="Density"><Seg label="Density" value={device().density} onChange={(density) => updateDevice({ density })} options={[{ v: "compact", label: "Compact" }, { v: "default", label: "Default" }, { v: "comfy", label: "Comfy" }]} /></Row>
        <Row label="Messages"><Seg label="Message layout" value={device().layout} onChange={(layout) => updateDevice({ layout })} options={[{ v: "cozy", label: "Cozy" }, { v: "compact", label: "Compact" }]} /></Row>
        <Row label="Member list"><Switch label="Show member list" on={device().showMembers} onChange={(showMembers) => updateDevice({ showMembers })} /></Row>
      </Group>

      <Show when={inTauri() && materials().length > 0}>
        <Group title="Window" hint={MATERIAL_HINT[platform]}>
          <Row label="Material"><Select label="Window material" value={device().material} onChange={(material) => updateDevice({ material })}
            options={[{ v: "none", label: "None" }, ...materials().map((m) => ({ v: m as typeof device extends () => infer D ? D extends { material: infer M } ? M : never : never, label: MATERIAL_LABEL[m] ?? m }))]} /></Row>
          <Show when={device().material !== "none"}>
            <Row label="Opacity" hint="Lower lets more of the material show through."><Slider label="Surface opacity" min={40} max={100} value={device().opacity} onChange={(opacity) => updateDevice({ opacity })} suffix="%" /></Row>
          </Show>
        </Group>
      </Show>

      <Show when={platform === "android" && inTauri()}>
        <Group title="Calls" hint="Background keeps your call connected if you swipe Mustela away, with a notification to leave. It is voice only. Web supports camera and screen share, but the call ends when Mustela is closed.">
          <Row label="Call engine"><Seg label="Call engine" value={device().callEngine} onChange={(callEngine) => updateDevice({ callEngine })}
            options={[{ v: "native", label: "Background" }, { v: "web", label: "Web" }]} /></Row>
        </Group>
      </Show>

      <Group title="Performance" hint="Profiles rated above this appear as still images. A total animation budget also applies, so busy lists stay smooth.">
        <Row label="Animate profiles up to">
          <Select<Rating> label="Animation limit" value={settings().maxRating} onChange={(maxRating) => updateSettings((s) => ({ ...s, maxRating }))}
            options={RATING_ORDER.map((r) => ({ v: r, label: r === "very-poor" ? "Everything" : r[0]!.toUpperCase() + r.slice(1) }))} />
        </Row>
      </Group>
    </div>
  );
}
