import { createEffect, createRoot } from "solid-js";
import { device } from "./store";

/**
 * App size (phones and tablets): the whole interface scaled together, text, buttons, icons and spacing, like a
 * browser's zoom. 100% unless you pick a size in Accessibility.
 */

/**
 * The size in use now, as a factor (1 = 100%): 100% unless you pick another. (There used to be "Match my phone",
 * following the phone's font size; it made the app come back from the background bigger than it started.)
 */
export const appZoom = () => {
  const n = device().a11y.appSize;
  return n ? n / 100 : 1;
};
/** For code that turns pointer movement into positions: CSS pixels per screen pixel on a zoomed page. */
export const zoomNow = () => parseFloat(document.documentElement.style.zoom) || 1;

/**
 * Put the page back to the chosen size. Android stacks another zoom on the root each time the app
 * returns from the background or from picture-in-picture, and it stays until the process starts over.
 * Clearing the zoom and writing the real size again drops that extra layer.
 */
function setZoom() {
  const el = document.documentElement;
  // Picture-in-picture is a tiny window: the call there is sized to the window itself, not the app's text size.
  const z = el.hasAttribute("data-pip") ? 1 : Math.round(appZoom() * 100) / 100;
  // Only written when it's wrong (Android's extra layer shows up here): rewriting it every time the app came back
  // (and going through 100% on the way) laid the whole page out again, which flashed.
  const want = z === 1 ? (el.style.zoom ? "1" : "") : String(z);
  if (el.style.zoom !== want) el.style.zoom = want;
}
// Coming back calls this up to three times at once (the page, the phone side, pageshow): once per frame is enough.
let queued = false;
function applyAppZoom() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; setZoom(); });
}

let started = false;
export function startAppSize() {
  if (started) return;
  started = true;
  (window as unknown as { __mustelaRefit?: () => void }).__mustelaRefit = applyAppZoom;
  createRoot(() => createEffect(() => { appZoom(); applyAppZoom(); }));
  setZoom(); // the right size from the very first frame
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") applyAppZoom(); });
  addEventListener("mustela:pip", () => applyAppZoom());
  addEventListener("pageshow", () => applyAppZoom());
}
