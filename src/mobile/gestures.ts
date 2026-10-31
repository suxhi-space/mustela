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
const IGNORE = "input, textarea, [contenteditable], .cm-editor, pre, code, input[type=range], .cstage, .reactions, .emoji-pop, .gif-pop, .soundboard, .scrim, .pop-scrim, .menu-scrim, .settings, .modal, .cp-scrim, .em-frame, video, .lightbox, [data-no-swipe]";

export function installGestures() {
  let start: { x: number; y: number; t: number; view: string } | null = null;
  let mode: "drawer" | "left" | null = null;
  let main: HTMLElement | null = null, app: HTMLElement | null = null;
  let dx = 0;

  const reset = () => {
    if (main) { main.style.transform = ""; main.style.transition = ""; }
    app?.classList.remove("swiping");
    start = null; mode = null; main = null; app = null; dx = 0;
  };

  addEventListener("touchstart", (e) => {
    // Only in the touch layout (phones, tablets held upright); sideways a tablet shows everything at once.
    if (e.touches.length !== 1 || !phoneLayout()) return;
    const t = e.target as Element | null;
    app = document.querySelector<HTMLElement>(".app");
    if (!app || !t || t.closest(IGNORE) || document.querySelector(".scrim, .pop-scrim, .menu-scrim, .settings, .modal")) { app = null; return; }
    const p = e.touches[0]!;
    start = { x: p.clientX, y: p.clientY, t: Date.now(), view: app.dataset.view ?? "nav" };
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
        app.classList.add("swiping"); // the channel list shows underneath
      } else if (x < 0) mode = "left";
      else { start = null; return; }
    }
    if (mode === "drawer" && main) {
      dx = Math.max(0, x);
      main.style.transition = "none";
      main.style.transform = `translateX(${dx / zoomNow()}px)`; // finger movement in the app's own (zoomed) pixels
    } else dx = x;
  }, { passive: true });

  const end = () => {
    if (!start || !mode) { reset(); return; }
    const fast = Math.abs(dx) / Math.max(1, Date.now() - start.t) > 0.5; // a flick counts even if short
    const w = innerWidth;
    if (mode === "drawer" && main) {
      const go = dx > w * 0.25 || (fast && dx > 40);
      const m = main, a = app;
      m.style.transition = "transform .18s ease-out";
      m.style.transform = go ? `translateX(${w / zoomNow()}px)` : "translateX(0)";
      start = null; mode = null; main = null; app = null; dx = 0;
      setTimeout(() => {
        if (go) backToList();
        m.style.transition = ""; m.style.transform = "";
        a?.classList.remove("swiping");
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
