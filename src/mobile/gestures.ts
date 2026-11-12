import { zoomNow } from "../ui/appSize";
import { phoneLayout } from "../ui/hooks";
import { backToChat, backToList, openMembersSheet } from "../ui/nav";

/**
 * Swipes in the touch layout (phones, and tablets held upright), like Discord's and Stoat's apps:
 *  - in a chat, swipe right: the chat slides away (following your finger) and the channel list is underneath
 *  - in a chat, swipe left: the members list
 *  - on the channel list, swipe left: back into the chat you had open
 * Only sideways swipes count (scrolling up and down is left alone), and never when they start on something that
 * moves sideways itself (a slider, a code block, the message box, a call, an open sheet or menu).
 */
const IGNORE = "input, textarea, [contenteditable], .cm-editor, pre, code, input[type=range], .cstage, .reactions, .emoji-pop, .gif-pop, .soundboard, .scrim, .pop-scrim, .menu-scrim, .settings, .modal, .cp-scrim, .em-frame, video, .lightbox, .gallery-view, [data-no-swipe]";

/** .swiped comes off once the screen changes again (into a chat), so later visits to the list animate as usual. */
function untilViewChanges(app: HTMLElement) {
  const was = app.dataset.view === "nav" ? "nav" : null;
  const mo = new MutationObserver(() => {
    if (app.dataset.view !== "nav" && (was === "nav" || app.dataset.view === "chat")) { app.classList.remove("swiped"); mo.disconnect(); }
  });
  mo.observe(app, { attributes: true, attributeFilter: ["data-view"] });
}

/** Something under the finger that scrolls sideways itself (the "active now" strip, filter chips, a row of pictures). */
function inSideScroller(t: Element | null): boolean {
  for (let e = t; e && e !== document.body; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 2) { const o = getComputedStyle(e).overflowX; if (o === "auto" || o === "scroll") return true; }
  }
  return false;
}

/** How far a swipe goes before the chat starts moving (in screen pixels). */
const DEAD = 24;

export function installGestures() {
  let start: { x: number; y: number; t: number; view: string } | null = null;
  let mode: "drawer" | "left" | null = null;
  let main: HTMLElement | null = null, app: HTMLElement | null = null;
  let dx = 0, raf = 0;
  /** The list under your finger, held still while a sideways swipe moves the screen (so it doesn't wobble). */
  let frozen: HTMLElement | null = null, startEl: Element | null = null;
  const freeze = () => {
    for (let e = startEl; e && e !== document.body; e = e.parentElement) {
      if (e instanceof HTMLElement && e.scrollHeight > e.clientHeight + 2) { const o = getComputedStyle(e).overflowY; if (o === "auto" || o === "scroll") { frozen = e; e.style.overflowY = "hidden"; return; } }
    }
  };
  // Moves are drawn once per frame (touch events can come faster than the screen redraws).
  const draw = () => {
    raf = 0;
    if (mode !== "drawer" || !main || !app) return;
    const shown = Math.max(0, dx - DEAD);
    main.style.transform = `translateX(${shown / zoomNow()}px)`; // finger movement in the app's own (zoomed) pixels
    app.style.setProperty("--swipe", String(Math.min(1, shown / innerWidth)));
    app.classList.toggle("swiping", shown > 0); // the channel list shows underneath once the chat moves
  };

  const reset = () => {
    if (main) { main.style.transform = ""; main.style.transition = ""; }
    cancelAnimationFrame(raf); raf = 0;
    app?.classList.remove("swiping"); app?.style.removeProperty("--swipe");
    if (frozen) { frozen.style.overflowY = ""; frozen = null; }
    start = null; mode = null; main = null; app = null; dx = 0; startEl = null;
  };

  addEventListener("touchstart", (e) => {
    // Only in the touch layout (phones, tablets held upright); sideways a tablet shows everything at once.
    if (e.touches.length !== 1 || !phoneLayout()) return;
    const t = e.target as Element | null;
    app = document.querySelector<HTMLElement>(".app");
    if (!app || !t || t.closest(IGNORE) || inSideScroller(t) || document.querySelector(".scrim, .pop-scrim, .menu-scrim, .settings, .modal")) { app = null; return; }
    const p = e.touches[0]!;
    start = { x: p.clientX, y: p.clientY, t: Date.now(), view: app.dataset.view ?? "nav" };
    startEl = t;
  }, { passive: true });

  addEventListener("touchmove", (e) => {
    if (!start || !app) return;
    const p = e.touches[0]!;
    const x = p.clientX - start.x, y = p.clientY - start.y;
    if (!mode) {
      // Decide once it's clearly sideways; anything else is a scroll and is left alone.
      if (Math.abs(x) < 14 && Math.abs(y) < 14) return;
      if (Math.abs(x) < Math.abs(y) * 1.4) { start = null; return; }
      if (start.view === "chat" && x > 0) {
        mode = "drawer";
        main = app.querySelector<HTMLElement>(".main");
      } else if (x < 0) mode = "left";
      else { start = null; return; }
    }
    // A sideways swipe owns the touch from here on: the list underneath stops scrolling up and down with it (the chat
    // wobbled while sliding). Done by holding that list still, not by blocking the touch: a listener that may block
    // touches makes Android wait for Mustela before every scroll step, which made all scrolling less smooth.
    if (!frozen) freeze();
    if (mode === "drawer" && main) {
      dx = Math.max(0, x);
      // A short swipe doesn't move the chat at all: it only starts sliding once the swipe is long enough to mean it,
      // then follows the finger from there.
      main.style.transition = "none";
      if (!raf) raf = requestAnimationFrame(draw);
    } else dx = x;
  }, { passive: true });

  const end = () => {
    if (!start || !mode) { reset(); return; }
    const fast = Math.abs(dx) / Math.max(1, Date.now() - start.t) > 0.5; // a flick counts even if short
    const w = innerWidth;
    if (mode === "drawer" && main) {
      const go = dx - DEAD > w * 0.22 || (fast && dx > DEAD + 24);
      const m = main, a = app;
      cancelAnimationFrame(raf); raf = 0;
      m.style.transition = "transform .2s cubic-bezier(.2, .8, .2, 1)";
      m.style.transform = go ? `translateX(${w / zoomNow()}px)` : "translateX(0)";
      if (a) { a.style.setProperty("--swipe-t", ".2s"); a.style.setProperty("--swipe", go ? "1" : "0"); }
      if (frozen) { frozen.style.overflowY = ""; frozen = null; }
      start = null; mode = null; main = null; app = null; dx = 0; startEl = null;
      setTimeout(() => {
        // The list is already on screen under the chat you swiped away: switching to it must not play its
        // "slide in" again (it jumped left, faded and slid back). .settling holds the animations off for the switch.
        // It stays until you leave the list: taking it off any sooner starts the animation at that moment instead.
        if (go && a) { a.classList.add("swiped"); untilViewChanges(a); }
        if (go) backToList();
        m.style.transition = ""; m.style.transform = "";
        a?.classList.remove("swiping"); a?.style.removeProperty("--swipe"); a?.style.removeProperty("--swipe-t");
      }, 190);
      return;
    }
    if (mode === "left" && (dx < -w * 0.25 || (fast && dx < -40))) {
      if (start.view === "chat") openMembersSheet();
      else backToChat();
    }
    reset();
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", reset, { passive: true });
}
