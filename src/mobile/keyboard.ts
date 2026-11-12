/**
 * Phones and tablets: keep what you're typing in above the keyboard. Android reports the keyboard's height as
 * --keyboard (NativePlugin.kt); dialogs and the emoji card use it in CSS (mobile.css). Anything else with a text box
 * (a settings page, a long form) is scrolled so the box you tapped isn't left behind the keyboard.
 */
import { phoneLayout } from "../ui/hooks";
import { zoomNow } from "../ui/appSize";

export function installKeyboardFit() {
  const root = document.documentElement;
  const keyboard = () => parseFloat(getComputedStyle(root).getPropertyValue("--keyboard")) || 0;
  // Some Android tablets also shrink the page for the keyboard: then lifting the message box by the keyboard's
  // height as well left a big empty gap. data-kb-resized says the page already made room (mobile.css).
  const tallest: Record<string, number> = {};
  const typing = () => { const a = document.activeElement; return a instanceof HTMLElement && a.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable], .cm-content"); };
  const check = () => {
    const o = innerWidth > innerHeight ? "land" : "port", k = keyboard();
    if (!k) tallest[o] = Math.max(tallest[o] ?? 0, innerHeight);
    const shrunk = (tallest[o] ?? innerHeight) - innerHeight;
    // Some tablets shrink the page for the keyboard without reporting its height at all: then a page that lost a
    // good part of its height while you're typing in something counts too. (Before, only a reported height did, so
    // on those tablets everything squeezed in above the keyboard, the user bar and the message box included.)
    const resized = k > 0 ? shrunk > k * 0.5 : shrunk > 150 && typing();
    root.toggleAttribute("data-kb-resized", resized);
    // What's being typed in: the message box (or an edit box) lifts the chat; anything else (search) leaves it put.
    root.toggleAttribute("data-kb-chat", resized && !!document.activeElement?.closest(".composer, .edit-box"));
    // Tablets (side by side layout): only the chat moves for the keyboard. The app keeps its full height (the side
    // panels just run under the keyboard) and the chat column is lifted by what the page lost, instead of every
    // panel shrinking and jumping each time the keyboard comes up.
    const lift = resized && !phoneLayout();
    root.toggleAttribute("data-kb-lift", lift);
    if (lift) {
      const z = zoomNow();
      root.style.setProperty("--kb-full", `${(tallest[o] ?? innerHeight) / z}px`);
      root.style.setProperty("--kb-shrink", `${shrunk / z}px`);
    }
  };
  addEventListener("resize", check);
  // Moving from the message box to search (or back) with the keyboard staying up changes what should move.
  addEventListener("focusin", () => requestAnimationFrame(check));
  addEventListener("focusout", () => setTimeout(check, 60));
  new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ["style"] });
  check();
  const kb = () => (root.hasAttribute("data-kb-resized") ? 0 : keyboard());
  const fit = (el: Element | null) => {
    if (!(el instanceof HTMLElement) || !el.matches("input, textarea, [contenteditable], .cm-content")) return;
    // The message box moves with the keyboard by itself.
    if (el.closest(".composer, .edit-box")) return;
    const room = innerHeight - kb() - 12;
    const r = el.getBoundingClientRect();
    if (r.bottom > room || r.top < 0) el.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  // The keyboard takes a moment to come up (and report its height): check again once it has.
  addEventListener("focusin", (e) => { for (const t of [120, 420]) setTimeout(() => { if (document.activeElement === e.target) fit(e.target as Element); }, t); });
}
