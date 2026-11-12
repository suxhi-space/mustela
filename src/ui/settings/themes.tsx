import { For, Show } from "solid-js";
import type { SavedTheme } from "../../lib/sync/ext";
import { sanitize } from "../../lib/sync/settings";
import { ulid } from "../../lib/ulid";
import { Group, Row } from "../controls";
import { Icon } from "../icons";
import { confirmDialog, openMenu, promptDialog, toast } from "../menu";
import { backdropImage, device, ext, look, materials, setBackdropDataUrl, updateDevice, updateExt, updateLook } from "../store";

/**
 * Saved themes, like Windows themes: save your whole look (colours, gradient, depth, background, panels, text size,
 * window material)
 * under a name, update it later, and switch between them in one go. Themes follow your account to every device. The
 * background picture stays on the device it was chosen on: applied somewhere without it, everything else changes,
 * the current background stays, and it asks to pick the picture there (one tap).
 */
const picKey = (id: string) => `mustela:theme-pic:${id}`;
const localPic = (id: string) => { try { return localStorage.getItem(picKey(id)); } catch { return null; } };

function capture(id: string, name: string): SavedTheme {
  const d = device();
  const hasPic = d.backdrop === "image" && !!backdropImage();
  if (hasPic) { try { localStorage.setItem(picKey(id), backdropImage()!); } catch { /* too big: it just asks again */ } }
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
  updateDevice({ backdrop: usePic || t.style.backdrop !== "image" ? t.style.backdrop : device().backdrop, backdropBlur: t.style.backdropBlur, panelOpacity: t.style.panelOpacity, panelBlur: t.style.panelBlur, style: t.style.depth, text: { ...device().text, size: t.style.textSize }, ...w });
  toast(`${t.name} applied`);
  // Its picture was chosen on another device: everything else is on, the background stays until it's picked here.
  if (t.picture && !pic && await confirmDialog(`${t.name} has a background picture`, "It was chosen on another device. Pick it on this one too?", "Pick picture")) {
    pickPicture(() => { const now = backdropImage(); if (now) { try { localStorage.setItem(picKey(t.id), now); } catch { /* fine */ } } updateDevice({ backdrop: "image" }); });
  }
}

export function SavedThemes(props: { pickPicture(then: () => void): void }) {
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
  const dots = (t: SavedTheme) => { const l = t.look as { seed?: string; gradient?: { on?: boolean; seed2?: string } }; return [l.seed ?? "#888", l.gradient?.on ? l.gradient.seed2 ?? l.seed ?? "#888" : l.seed ?? "#888"]; };
  return (
    <Group title="Saved themes" hint="Save your whole look and switch back to it any time. Themes follow your account; a background picture stays on the device it was chosen on.">
      <For each={themes()}>{(t) => (
        <Row label={<span class="theme-name"><span class="theme-dots" style={{ background: `linear-gradient(135deg, ${dots(t)[0]}, ${dots(t)[1]})` }} />{t.name}<Show when={t.picture}><Icon name="image" size={14} class="muted" /></Show></span>}>
          <button class="btn small" onClick={() => void apply(t, props.pickPicture)}>Apply</button>
          <button class="icon-btn" aria-label={`${t.name} options`} title="Options" onClick={(e) => menu(e.currentTarget, t)}><Icon name="dots" size={18} /></button>
        </Row>
      )}</For>
      <Row label={themes().length ? <span class="muted">Save how things look right now</span> : <span class="muted">No saved themes yet</span>}>
        <button class="btn small primary" onClick={() => void save()}><Icon name="plus" size={14} />Save current look</button>
      </Row>
    </Group>
  );
}
