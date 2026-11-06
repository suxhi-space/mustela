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

/**
 * Put the page back to the chosen size. Android stacks another zoom on the root each time the app
 * returns from the background or from picture-in-picture, and it stays until the process starts over.
 * Clearing the zoom and writing the real size again drops that extra layer.
 */
function applyAppZoom() {
  const z = Math.round(appZoom() * 100) / 100;
  const el = document.documentElement;
  el.style.zoom = "1";
  if (z !== 1) el.style.zoom = String(z);
}

let started = false;
export function startAppSize() {
  if (started) return;
  started = true;
  (window as unknown as { __mustelaRefit?: () => void }).__mustelaRefit = applyAppZoom;
  new MutationObserver(() => setScale(readScale())).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  createRoot(() => createEffect(applyAppZoom));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") applyAppZoom(); });
  addEventListener("mustela:pip", () => applyAppZoom());
  addEventListener("pageshow", () => applyAppZoom());
}
