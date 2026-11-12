import { createMemo, For, Show } from "solid-js";
import { DEFAULT_THEME, type Variant } from "../../lib/theme/palette";
import type { SavedTheme } from "../../lib/sync/ext";
import { sanitize } from "../../lib/sync/settings";
import { ulid } from "../../lib/ulid";
import { Group } from "../controls";
import { Icon } from "../icons";
import { confirmDialog, openMenu, promptDialog, toast } from "../menu";
import { backdropImage, device, ext, look, materials, setBackdropDataUrl, updateDevice, updateExt, updateLook } from "../store";
import { MOBILE_UI } from "../target";

/**
 * Themes, like Windows' (and Discord's): one tap sets a whole look.
 *
 * Mustela's own themes set the colours, how they spread (palette style), the gradient and its angle, how much it
 * tints the windows, a plain background (the gradient is the background) and no window material, with Pure black off;
 * The pastel ones are light themes, the rest dark. They leave alone the rest: depth (3D or flat), contrast, text size
 * and fonts, emoji and layout. Changing a setting afterwards doesn't change the theme itself; save the result as a theme of your own.
 *
 * Your saved themes keep the same look settings plus the background and panels (and the window material where this
 * device has it). Text size and layout are left out: they're for reading comfort, not a look. Saved themes follow
 * your account; a background picture stays on the device it was chosen on.
 */
export interface Preset { name: string; a: string; b: string; angle: number; variant: Variant; windows: number; /** the pastel ones are light themes */ mode?: "light" | "dark" }
export const PRESETS: Preset[] = [
  // Dark: deep, saturated colours across the whole window, panels darker on top so text stays easy to read.
  { name: "Coral", a: "#ff7a59", b: "#c13584", angle: 135, variant: "vibrant", windows: 70, mode: "dark" },
  { name: "Ocean", a: "#1a9bb0", b: "#2b4fd8", angle: 160, variant: "vibrant", windows: 70, mode: "dark" },
  { name: "Nebula", a: "#2bd9a0", b: "#8e4ff0", angle: 135, variant: "vibrant", windows: 70, mode: "dark" },
  { name: "Moss", a: "#4d8c3f", b: "#1f6f6a", angle: 150, variant: "tonal", windows: 72, mode: "dark" },
  { name: "Berry", a: "#f06fb0", b: "#8a7bff", angle: 120, variant: "vibrant", windows: 68, mode: "dark" },
  { name: "Ember", a: "#e0532f", b: "#7a1405", angle: 160, variant: "vibrant", windows: 72, mode: "dark" },
  { name: "Amber", a: "#e0532f", b: "#f0a12a", angle: 200, variant: "vibrant", windows: 68, mode: "dark" },
  { name: "Glow", a: "#6d3fc4", b: "#d6622e", angle: 135, variant: "vibrant", windows: 70, mode: "dark" },
  { name: "Tropic", a: "#c2187a", b: "#f5a524", angle: 135, variant: "vibrant", windows: 68, mode: "dark" },
  { name: "Lime", a: "#d4c21f", b: "#3fae5a", angle: 135, variant: "vibrant", windows: 66, mode: "dark" },
  { name: "Cosmos", a: "#4338ca", b: "#0b0a26", angle: 180, variant: "vibrant", windows: 72, mode: "dark" },
  { name: "Slate", a: "#6b7480", b: "#3a4a6b", angle: 160, variant: "neutral", windows: 70, mode: "dark" },
  // Light: soft pastels.
  { name: "Lavender", a: "#a78bfa", b: "#f0abfc", angle: 135, variant: "tonal", windows: 80, mode: "light" },
  { name: "Seafoam", a: "#8fdcb8", b: "#9fd8f5", angle: 150, variant: "tonal", windows: 80, mode: "light" },
  { name: "Pistachio", a: "#8fdcb8", b: "#f3e9a6", angle: 160, variant: "tonal", windows: 80, mode: "light" },
  { name: "Apricot", a: "#ffc88a", b: "#f59bb0", angle: 135, variant: "tonal", windows: 80, mode: "light" },
  { name: "Petal", a: "#f7b8d2", b: "#b9b6f5", angle: 135, variant: "tonal", windows: 80, mode: "light" },
  { name: "Cloud", a: "#9fd8f5", b: "#cdb8f5", angle: 160, variant: "tonal", windows: 80, mode: "light" },
];

/** Mustela's own look (grey, no gradient): always first, so there's a way back after trying the others. */
const DEFAULT_LOOK = { theme: DEFAULT_THEME, seed: "#6b7480", variant: "neutral" as Variant };
export function applyDefault() {
  updateDevice({ colorSource: "theme", backdrop: "plain", ...(device().material !== "none" ? { material: "none" as const } : {}) });
  updateLook({ ...DEFAULT_LOOK, amoled: false, gradient: { ...look().gradient, on: false } });
}
const isDefault = () => { const l = look(), d = device(); return d.colorSource === "theme" && l.theme === DEFAULT_LOOK.theme && l.variant === "neutral" && !l.gradient.on && !l.amoled && d.backdrop === "plain"; };

export function applyPreset(p: Preset) {
  updateDevice({ colorSource: "theme", backdrop: "plain", ...(device().material !== "none" ? { material: "none" as const } : {}) });
  updateLook({ theme: "custom", seed: p.a, variant: p.variant, amoled: false, ...(p.mode ? { mode: p.mode } : {}), gradient: { on: true, seed2: p.b, angle: p.angle, windows: p.windows } });
}
/** Is the look exactly this theme (nothing changed since)? */
const isPreset = (p: Preset) => {
  const l = look(), d = device();
  return d.colorSource === "theme" && l.theme === "custom" && l.seed === p.a && l.variant === p.variant && !l.amoled && l.gradient.on &&
    l.gradient.seed2 === p.b && l.gradient.angle === p.angle && l.gradient.windows === p.windows && d.backdrop === "plain" && (!p.mode || l.mode === p.mode);
};

const picKey = (id: string) => `mustela:theme-pic:${id}`;
const localPic = (id: string) => { try { return localStorage.getItem(picKey(id)); } catch { return null; } };

function capture(id: string, name: string): SavedTheme {
  const d = device();
  const hasPic = d.backdrop === "image" && !!backdropImage();
  if (hasPic) { try { localStorage.setItem(picKey(id), backdropImage()!); } catch { /* too big: it just asks again */ } }
  // (textSize is still written for older Mustelas reading it; it's never applied any more.)
  return { id, name, look: { ...look() }, picture: hasPic, at: Date.now(), window: { material: d.material, opacity: d.opacity },
    style: { backdrop: d.backdrop, backdropBlur: d.backdropBlur, panelOpacity: d.panelOpacity, panelBlur: d.panelBlur, depth: d.style, textSize: d.text.size } };
}

const setThemes = (f: (t: SavedTheme[]) => SavedTheme[]) => updateExt((x) => ({ ...x, themes: f(x.themes ?? []) }));

async function apply(t: SavedTheme, pickPicture: (then: () => void) => void) {
  // Cleaned like any synced look (it may come from another device or an older Mustela).
  updateLook(sanitize({ look: t.look }).look);
  const pic = t.picture ? localPic(t.id) : null;
  const usePic = t.style.backdrop === "image" && (!t.picture || !!pic);
  if (pic) setBackdropDataUrl(pic);
  // The window material too, where this device has it (Mica only exists on Windows 11, Vibrancy on a Mac).
  const w = t.window && (t.window.material === "none" || materials().includes(t.window.material)) ? { material: t.window.material, opacity: t.window.opacity } : {};
  // Not the text size or layout: those are for reading comfort (Accessibility), not part of a look.
  updateDevice({ colorSource: "theme", backdrop: usePic || t.style.backdrop !== "image" ? t.style.backdrop : device().backdrop, backdropBlur: t.style.backdropBlur, panelOpacity: t.style.panelOpacity, panelBlur: t.style.panelBlur, style: t.style.depth, ...w });
  toast(`${t.name} applied`);
  // Its picture was chosen on another device: everything else is on, the background stays until it's picked here.
  if (t.picture && !pic && await confirmDialog(`${t.name} has a background picture`, "It was chosen on another device. Pick it on this one too?", "Pick picture")) {
    pickPicture(() => { const now = backdropImage(); if (now) { try { localStorage.setItem(picKey(t.id), now); } catch { /* fine */ } } updateDevice({ backdrop: "image" }); });
  }
}

/** A saved theme's two colours (its accent, and the gradient's second colour when it has one). */
const colours = (t: SavedTheme) => { const l = t.look as { seed?: string; gradient?: { on?: boolean; seed2?: string } }; const a = l.seed ?? "#888"; return [a, l.gradient?.on ? l.gradient.seed2 ?? a : a] as const; };

export function Themes(props: { pickPicture(then: () => void): void }) {
  const themes = () => ext().themes ?? [];
  const save = async () => {
    const name = await promptDialog("Save this look as a theme", "Theme name", "Save theme", "", { placeholder: "Cosy night", max: 40 });
    if (!name?.trim()) return;
    const t = capture(ulid(), name.trim());
    setThemes((l) => [t, ...l].slice(0, 20));
    toast(`Saved ${t.name}`);
  };
  const menu = (el: Element, t: SavedTheme) => openMenu(el, [
    { label: "Update to my current look", icon: "check", onSelect: () => { setThemes((l) => l.map((x) => (x.id === t.id ? capture(t.id, t.name) : x))); toast(`${t.name} updated`); } },
    { label: "Rename", icon: "pencil", onSelect: async () => {
      const v = await promptDialog("Rename theme", "Theme name", "Save", t.name, { max: 40 });
      if (v?.trim()) setThemes((l) => l.map((x) => (x.id === t.id ? { ...x, name: v.trim() } : x)));
    } },
    { sep: true },
    { label: "Delete", icon: "trash", danger: true, onSelect: async () => {
      if (!(await confirmDialog(`Delete ${t.name}?`, "Your current look stays as it is.", "Delete theme", true))) return;
      setThemes((l) => l.filter((x) => x.id !== t.id));
      try { localStorage.removeItem(picKey(t.id)); } catch { /* fine */ }
    } },
  ]);
  /** Which saved theme is the current look (same colours and background) */
  const current = createMemo(() => JSON.stringify(look()) + device().backdrop);
  return (
    <Group title="Themes"
      hint="One tap sets colours, gradient and background (the pastel ones are light). Change anything below and save it as your own. Text size and layout stay yours.">
      <div class="theme-grid" role="radiogroup" aria-label="Themes" data-no-swipe>
        <button class="theme-tile default" role="radio" aria-checked={isDefault()} classList={{ on: isDefault() }} onClick={applyDefault}><span class="tt-name">Default</span></button>
        <For each={PRESETS}>{(p) => (
          <button class="theme-tile" role="radio" aria-checked={isPreset(p)} classList={{ on: isPreset(p) }} style={{ background: `linear-gradient(${p.angle}deg, ${p.a}, ${p.b})` }}
            onClick={() => applyPreset(p)}><span class="tt-name">{p.name}</span></button>
        )}</For>
      </div>
      {/* Your themes, with saving the current look as the first tile (where the saved one will appear) */}
      <p class="theme-sub">Your themes</p>
      <div class="theme-grid" role="radiogroup" aria-label="Your themes" data-no-swipe>
        <button class="theme-tile add" onClick={() => void save()}><Icon name="plus" size={18} /><span class="tt-name">Save look</span></button>
          <For each={themes()}>{(t) => {
            const pic = () => (t.picture ? localPic(t.id) : null);
            const [a, b] = colours(t);
            const on = () => current() === JSON.stringify(sanitize({ look: t.look }).look) + t.style.backdrop;
            return (
              <div class="theme-tile mine" role="radio" aria-checked={on()} classList={{ on: on(), pic: !!pic() }} tabIndex={0}
                style={pic() ? { "background-image": `url("${pic()}")` } : { background: `linear-gradient(135deg, ${a}, ${b})` }}
                onClick={() => void apply(t, props.pickPicture)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && void apply(t, props.pickPicture)}>
                {/* With a picture: the picture fills the tile, and a little circle shows the theme's colours */}
                <Show when={pic() || t.picture}><span class="tt-dot" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} /></Show>
                <span class="tt-name">{t.name}</span>
                <button class="tt-more" aria-label={`${t.name} options`} title="Options" onClick={(e) => { e.stopPropagation(); menu(e.currentTarget, t); }}><Icon name="dots" size={16} /></button>
              </div>
            );
          }}</For>
      </div>
    </Group>
  );
}
