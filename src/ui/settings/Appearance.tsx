import { createSignal, For, Show } from "solid-js";
import { RATING_ORDER, type Rating } from "../../lib/decor/spec";
import { THEMES, buildRoles, type Variant } from "../../lib/theme/palette";
import { Icon } from "../icons";
import { UEmoji } from "../chat/UEmoji";
import type { EmojiPack } from "../../lib/sync/settings";

const VARIANT_INFO: { id: Variant; label: string }[] = [
  { id: "monochrome", label: "Monochrome" }, { id: "neutral", label: "Neutral" }, { id: "tonal", label: "Tonal spot" },
  { id: "vibrant", label: "Vibrant" }, { id: "expressive", label: "Expressive" }, { id: "fidelity", label: "Fidelity" },
  { id: "content", label: "Content" }, { id: "rainbow", label: "Rainbow" }, { id: "fruit", label: "Fruit salad" },
];
import { inTauri } from "../../lib/platform";
import { ColorInput, Group, Row, Seg, Select, Slider, Switch } from "../controls";
import { backdropImage, device, ext, pictureSeed, materials, platform, setBackdropImage, settings, systemSeed, updateDevice, updateExt, updateSettings } from "../store";

const PACKS: { id: EmojiPack; label: string }[] = [
  { id: "fluent-3d", label: "Fluent 3D" }, { id: "fluent-color", label: "Fluent Color" }, { id: "fluent-flat", label: "Fluent Flat" },
  { id: "mutant", label: "Mutant Remix" }, { id: "noto", label: "Noto" }, { id: "twemoji", label: "Twemoji" }, { id: "system", label: "System" },
];
const SAMPLE = ["😃", "😂", "🤨", "🤔", "🦦"];

const MATERIAL_LABEL: Record<string, string> = { none: "None", mica: "Mica", acrylic: "Acrylic", blur: "Blur", vibrancy: "Vibrancy" };
const MATERIAL_HINT: Record<string, string> = {
  windows: "Mica follows your wallpaper. Acrylic and Blur show what's behind the window.",
  mac: "Vibrancy uses the system's translucent window material.",
  linux: "See-through only looks blurred if your desktop's compositor blurs windows behind it (KDE can).",
};

/** Gradient themes, like Discord's: an accent and a second colour that run across the app. */
const GRADIENTS = [
  { name: "Sunset", a: "#ff7a59", b: "#c13584", angle: 135 },
  { name: "Ocean", a: "#1a9bb0", b: "#2b4fd8", angle: 160 },
  { name: "Aurora", a: "#2bd9a0", b: "#8e4ff0", angle: 135 },
  { name: "Forest", a: "#4d8c3f", b: "#1f6f6a", angle: 150 },
  { name: "Candy", a: "#f06fb0", b: "#8a7bff", angle: 120 },
  { name: "Ember", a: "#e0532f", b: "#f0a12a", angle: 200 },
  { name: "Midnight", a: "#3d4bb8", b: "#151a3a", angle: 180 },
  { name: "Lavender", a: "#a78bfa", b: "#f0abfc", angle: 135 },
  { name: "Citrus", a: "#d4c21f", b: "#3fae5a", angle: 135 },
  { name: "Storm", a: "#6b7480", b: "#3a4a6b", angle: 160 },
];

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
  const mode = () => (look(), document.documentElement.dataset.mode === "light" ? "light" : "dark") as "light" | "dark";
  const curSeed = () => (device().colorSource === "system" && systemSeed()) || (device().colorSource === "picture" && pictureSeed()) || (look().theme === "custom" ? look().seed : THEMES.find((t) => t.id === look().theme)?.seed ?? look().seed);
  /** Swatches show the seed itself (saturated); the scheme then derives readable tones from it. */
  const swatch = (seed: string) => seed;
  const previewDots = (v: Variant) => { const r = buildRoles(curSeed(), mode(), { variant: v, contrast: look().contrast }); return [r.primary!, r.tertiary!, r.secondaryContainer!, r.surfaceContainerHighest!]; };
  const systemHint = () => systemOk()
    ? "Colors follow your system accent."
    : platform === "android"
      ? "Not available in this build yet. Android's wallpaper colors need a small native plugin."
      : "Your system doesn't share an accent color with apps.";

  return (
    <div class="page">
      <Group title="Colors" hint="Colors follow your account to every device. Style, layout and window settings stay on this one.">
        <Row label="Mode">
          <Seg label="Mode" value={look().mode} onChange={(mode) => setLook({ mode })} options={[{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }, { v: "auto", label: "System" }]} />
        </Row>
        <div class="row col">
          <div class="swatches" role="radiogroup" aria-label="Accent color">
            <button class="swatch-tile sys" role="radio" aria-checked={device().colorSource === "system"} classList={{ on: device().colorSource === "system" }} disabled={!systemOk()}
              title={systemHint()} onClick={() => updateDevice({ colorSource: "system" })}><Icon name="palette" size={20} /></button>
            <Show when={backdropImage()}>
              <button class="swatch-tile pic" role="radio" aria-label="Colors from your background picture" title="Colors from your background picture"
                aria-checked={device().colorSource === "picture"} classList={{ on: device().colorSource === "picture" }}
                style={{ "background-image": `url("${backdropImage()}")` }} onClick={() => { updateDevice({ colorSource: "picture" }); if (look().variant === "neutral" || look().variant === "monochrome") setLook({ variant: "vibrant" }); }}><Icon name="image" size={18} /></button>
            </Show>
            <For each={THEMES}>{(t) => (
              <button class="swatch-tile" role="radio" aria-label={t.name} title={t.name} aria-checked={device().colorSource === "theme" && look().theme === t.id}
                classList={{ on: device().colorSource === "theme" && look().theme === t.id }} style={{ background: swatch(t.seed) }}
                onClick={() => { updateDevice({ colorSource: "theme" }); setLook({ theme: t.id }); }} />
            )}</For>
            <label class="swatch-tile custom" classList={{ on: device().colorSource === "theme" && look().theme === "custom" }} title="Pick any color" style={{ background: swatch(look().seed) }}>
              <input type="color" value={look().seed} aria-label="Custom accent color" onInput={(e) => { updateDevice({ colorSource: "theme" }); setLook({ theme: "custom", seed: e.currentTarget.value }); }} />
              <Icon name="plus" size={18} />
            </label>
          </div>
        </div>
        <Row label="Contrast">
          <Seg label="Contrast" value={String(look().contrast)} onChange={(c) => setLook({ contrast: +c })}
            options={[{ v: "-1", label: "Reduced" }, { v: "0", label: "Normal" }, { v: "0.5", label: "More" }, { v: "1", label: "High" }]} />
        </Row>
        <div class="row col">
          <span class="row-label">Palette style<small>How much color spreads from your accent into everything else.</small></span>
          <div class="variants" role="radiogroup" aria-label="Palette style">
            <For each={VARIANT_INFO}>{(v) => (
              <button class="variant" role="radio" aria-checked={look().variant === v.id} classList={{ on: look().variant === v.id }} onClick={() => setLook({ variant: v.id })}>
                <span class="v-dots">{previewDots(v.id).map((c) => <i style={{ background: c }} />)}</span>{v.label}
              </button>
            )}</For>
          </div>
        </div>
        <div class="row col">
          <span class="row-label">Gradient themes<small>Two colours across buttons, windows and the background. Tap one, then fine-tune it below.</small></span>
          <div class="grad-presets" role="radiogroup" aria-label="Gradient themes">
            <For each={GRADIENTS}>{(g) => {
              const on = () => look().gradient.on && look().theme === "custom" && look().seed === g.a && look().gradient.seed2 === g.b;
              return (
                <button class="grad-preset" role="radio" aria-checked={on()} classList={{ on: on() }} style={{ background: `linear-gradient(135deg, ${g.a}, ${g.b})` }}
                  onClick={() => { updateDevice({ colorSource: "theme" }); setLook({ theme: "custom", seed: g.a, ...(look().variant === "neutral" || look().variant === "monochrome" ? { variant: "vibrant" as const } : {}), gradient: { ...look().gradient, on: true, seed2: g.b, angle: g.angle, windows: look().gradient.windows || 35 } }); }}>
                  <span>{g.name}</span>
                </button>
              );
            }}</For>
          </div>
        </div>
        <Row label="Gradient accent" hint="Buttons, switches and selections blend into a second color">
          <Show when={look().gradient.on}><ColorInput label="Gradient end color" value={look().gradient.seed2} onChange={(seed2) => setLook({ gradient: { ...look().gradient, seed2 } })} /></Show>
          <Switch label="Gradient accent" on={look().gradient.on} onChange={(on) => setLook({ gradient: { ...look().gradient, on } })} />
        </Row>
        <Show when={look().gradient.on}>
          <Row label="Gradient angle"><Slider label="Gradient angle" min={0} max={360} value={look().gradient.angle} suffix="°" onChange={(angle) => setLook({ gradient: { ...look().gradient, angle } })} /></Row>
          <Row label="Gradient on windows" hint="How strongly the gradient tints windows, panels and the background. 0 keeps it to buttons."><Slider label="Gradient on windows" min={0} max={100} value={look().gradient.windows} suffix="%" onChange={(windows) => setLook({ gradient: { ...look().gradient, windows } })} /></Row>
        </Show>
        <Row label="Pure black" hint="Saves battery on OLED screens. Dark mode only."><Switch label="Pure black" on={look().amoled} onChange={(amoled) => setLook({ amoled })} /></Row>
        <div class="look-preview" aria-hidden="true">
          <div class="lp-msg"><span class="lp-av" /><span><b>Mika</b> <small>Today at 11:39</small><br />Sphinx of black quartz, judge my vow</span></div>
          <div class="lp-row"><button class="btn small primary" tabIndex={-1}>Primary</button><button class="btn small" tabIndex={-1}>Button</button><span class="switch" role="presentation" aria-checked="true"><span class="knob" /></span><span class="lp-chip">#general</span></div>
        </div>
      </Group>

      <Group title="Style">
        <Row label="Depth" hint="3D gives floating panels and chunky buttons. Flat removes the shadows and edges.">
          <Seg label="Depth" value={device().style} onChange={(style) => updateDevice({ style })} options={[{ v: "classic", label: "3D" }, { v: "flat", label: "Flat" }]} />
        </Row>
        <Row label="Favorites button" hint="Your favorite channels get their own button under Home, like a server. Off: they're listed on Home.">
          <Switch label="Favorites button under Home" on={ext().favRail} onChange={(favRail) => updateExt((s) => ({ ...s, favRail }))} />
        </Row>
        <Row label="Background" hint={device().backdrop === "image" ? "Your picture stays on this device." : "What's behind the panels."}>
          <Seg label="Background" value={device().backdrop} onChange={(backdrop) => { if (backdrop === "image" && !backdropImage()) pickBackdrop(); else updateDevice({ backdrop }); }}
            options={[{ v: "plain", label: "Plain" }, { v: "stars", label: "Stars" }, { v: "gradient", label: "Gradient" }, { v: "image", label: "Picture" }]} />
        </Row>
        <Show when={device().backdrop === "gradient" && !look().gradient.on}>
          <Row label={<small class="muted">Uses your accent colour. Turn on a gradient theme above for two colours.</small>} />
        </Show>
        <Show when={device().backdrop === "image" && backdropImage()}>
          <Row label="Picture">
            <span class="bd-thumb" style={{ "background-image": `url("${backdropImage()}")` }} />
            <button class="btn small" onClick={pickBackdrop}>Change</button>
            <button class="btn small danger" onClick={() => { void setBackdropImage(null); updateDevice({ backdrop: "plain" }); }}>Remove</button>
          </Row>
          <Row label="Blur the picture" hint="Soft and out of focus, so text stays easy to read."><Switch label="Blur the picture" on={device().backdropBlur} onChange={(backdropBlur) => updateDevice({ backdropBlur })} /></Row>
        </Show>
        <Show when={device().backdrop === "image" || device().backdrop === "gradient"}>
          <Row label="Panel see-through" hint="Lower lets more of the background show through the panels and windows.">
            <Slider label="Panel see-through" min={0} max={85} value={100 - device().panelOpacity} suffix="%" onChange={(v) => updateDevice({ panelOpacity: 100 - v })} />
          </Row>
          <Row label="Blur behind panels" hint="Frosted glass. Off: the background shows through sharp."><Switch label="Blur behind panels" on={device().panelBlur} onChange={(panelBlur) => updateDevice({ panelBlur })} /></Row>
        </Show>
        <Show when={bdErr()}><Row label={<span class="err">{bdErr()}</span>} /></Show>
      </Group>

      <Group title="Emoji" hint="How emoji look for you, like Stoat's packs. Emoji you send carry your pack, so other Stoat users see it too.">
        <div class="emoji-packs" role="radiogroup" aria-label="Emoji pack">
          <For each={PACKS}>{(p) => (
            <button class="emoji-pack" role="radio" aria-checked={settings().emojiPack === p.id} classList={{ on: settings().emojiPack === p.id }}
              onClick={() => updateSettings((s) => ({ ...s, emojiPack: p.id }))}>
              <span class="ep-row"><For each={SAMPLE}>{(e) => <UEmoji e={e} pack={p.id} />}</For></span>
              {p.label}
            </button>
          )}</For>
        </div>
      </Group>

      <Group title="Display & text">
        <div class="text-preview" aria-hidden="true">
          <article class="msg head"><span class="msg-gutter" /><div class="msg-body"><div class="md">Sphinx of black quartz, judge my vow 🦦</div></div></article>
          <article class="msg head"><span class="msg-gutter" /><div class="msg-body"><div class="md"><code class="icode">The quick brown fox jumped over the lazy dog</code></div></div></article>
        </div>
        <Row label="Message size"><Slider label="Message size" min={12} max={20} value={device().text.size} onChange={(size) => updateDevice({ text: { ...device().text, size } })} suffix="px" /></Row>
        <Row label="Message group spacing"><Slider label="Message group spacing" min={0} max={24} value={device().text.spacing} onChange={(spacing) => updateDevice({ text: { ...device().text, spacing } })} suffix="px" /></Row>
        <Row label="Font">
          <Select label="Interface font" value={device().text.font || "default"} onChange={(f) => updateDevice({ text: { ...device().text, font: f === "default" ? "" : f } })}
            options={[{ v: "default", label: "Mustela" }, { v: "system", label: "System" }, { v: "rounded", label: "Rounded" }, { v: "serif", label: "Serif messages" }]} />
        </Row>
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

    </div>
  );
}
