import { createEffect, createRoot, createSignal } from "solid-js";
import { device } from "./store";

/**
 * App size (phones and tablets): the whole interface scaled together, text, buttons, icons and spacing, like a
 * browser's zoom. It follows the phone's own font size unless you pick a size in Accessibility.
 */

/** The phone's font size setting (Android tells the page, NativePlugin.kt: --font-scale); 1 elsewhere. */
const readScale = () => {
  const v = parseFloat(document.documentElement.style.getPropertyValue("--font-scale"));
  return Number.isFinite(v) && v > 0 ? Math.min(2, Math.max(0.8, v)) : 1;
};
const [scale, setScale] = createSignal(typeof document === "undefined" ? 1 : readScale());
export const phoneFontScale = scale;

/** The size in use now, as a factor (1 = 100%). */
export const appZoom = () => {
  const n = device().a11y.appSize;
  return n ? n / 100 : scale();
};
/** For code that turns pointer movement into positions: CSS pixels per screen pixel on a zoomed page. */
export const zoomNow = () => parseFloat(document.documentElement.style.zoom) || 1;

let started = false;
export function startAppSize() {
  if (started) return;
  started = true;
  new MutationObserver(() => setScale(readScale())).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  createRoot(() => createEffect(() => {
    const z = Math.round(appZoom() * 100) / 100;
    document.documentElement.style.zoom = z === 1 ? "" : String(z);
  }));
}
