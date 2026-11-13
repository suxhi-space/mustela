import { goBack } from "../ui/back";
import { zoomNow } from "../ui/appSize";
import { canStep, inSideScroller, tabRowAt, tabsOf } from "./swipeUtil";

/**
 * Two more swipes for touch screens, like Discord's app:
 *  - Tabs: on anything with tabs ([data-swipe-tabs]: Friends, Home search, the search and pins panel, full profiles,
 *    the reactions list), swiping the content sideways goes to the next or previous tab. The content follows the finger
 *    a little, then the new tab slides in from that side.
 *  - Settings (yours, a server's, a channel's) on phones and upright tablets: swiping right on a page goes back to the
 *    list, following the finger; on the list it closes Settings. The same as the back button.
 * Only clearly sideways swipes count, and never ones that start on something that moves sideways itself.
 */
const IGNORE = "input, textarea, select, [contenteditable], .cm-editor, pre, code, input[type=range], [role=slider], .cp-scrim, .color-picker, .cropper, .theme-strip, video, .em-frame, .lightbox, .gallery-view, [data-no-swipe]";
const COVER = ".pop-scrim, .menu-scrim, .cp-scrim, .modal, .lightbox, .gallery-view";

const still = () => document.documentElement.hasAttribute("data-reduce-motion");
const EASE = "cubic-bezier(.2, .8, .2, 1)";

type Tabs = { kind: "tabs"; box: HTMLElement; list: HTMLElement; body: HTMLElement[] };
type Back = { kind: "back"; move: HTMLElement };

/** The tab row of a swipe-tabs area, and what's under it (everything after the part that holds the row). */
function tabsAt(t: Element): Tabs | null {
  const row = tabRowAt(t);
  if (!row) return null;
  const { box, list } = row;
  if (tabsOf(list).tabs.length < 2) return null;
  const body = bodyOf(box, list);
  return body.length ? { kind: "tabs", box, list, body } : null;
}
function bodyOf(box: HTMLElement, list: HTMLElement): HTMLElement[] {
  let branch: Element = list;
  while (branch.parentElement && branch.parentElement !== box) branch = branch.parentElement;
  const body: HTMLElement[] = [];
  for (let e = branch.nextElementSibling; e; e = e.nextElementSibling) if (e instanceof HTMLElement) body.push(e);
  return body;
}

/** A settings window shown one step at a time (phones, upright tablets): what a back swipe slides away. */
function backAt(t: Element): Back | null {
  const s = t.closest<HTMLElement>(".settings");
  if (!s) return null;
  const nav = s.querySelector<HTMLElement>(".snav"), page = s.querySelector<HTMLElement>(".spage");
  const stepped = !!nav && !!page && (nav.offsetParent === null || page.offsetParent === null);
  if (!stepped) return null;
  const move = s.dataset.narrow === "page" ? page : s.querySelector<HTMLElement>(".settings-card");
  return move ? { kind: "back", move } : null;
}

function step(list: HTMLElement, dir: 1 | -1): boolean {
  const { tabs, at: i } = tabsOf(list);
  const next = tabs[i + dir];
  if (i < 0 || !next) return false;
  next.click();
  next.scrollIntoView({ block: "nearest", inline: "center", behavior: still() ? "auto" : "smooth" });
  return true;
}

export function installTabSwipe() {
  let start: { x: number; y: number; t: number } | null = null;
  let target: Tabs | Back | null = null;
  let on = false, dx = 0, raf = 0;

  const paint = () => {
    raf = 0;
    if (!target || !on) return;
    const z = zoomNow();
    if (target.kind === "tabs") {
      // A little give, not a full drag: the next tab isn't drawn yet.
      const give = Math.sign(dx) * Math.min(56, Math.abs(dx) * 0.3) / z;
      for (const el of target.body) { el.style.transition = "none"; el.style.transform = `translateX(${give}px)`; }
    } else {
      target.move.style.transition = "none";
      target.move.style.transform = `translateX(${Math.max(0, dx) / z}px)`;
    }
  };
  const clear = (els: HTMLElement[]) => { for (const el of els) { el.style.transition = ""; el.style.transform = ""; } };
  const reset = () => { cancelAnimationFrame(raf); raf = 0; start = null; target = null; on = false; dx = 0; };

  addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.target as Element | null;
    if (!t || t.closest(IGNORE) || inSideScroller(t)) return;
    target = tabsAt(t) ?? backAt(t);
    if (!target) return;
    // Something on top of it (a menu, a dialog, the colour picker) gets the touch instead.
    const over = document.querySelector(COVER);
    if (over && !over.contains(target.kind === "tabs" ? target.box : target.move)) { target = null; return; }
    const p = e.touches[0]!;
    start = { x: p.clientX, y: p.clientY, t: Date.now() };
  }, { passive: true });

  addEventListener("touchmove", (e) => {
    if (!start || !target) return;
    const p = e.touches[0]!;
    const x = p.clientX - start.x, y = p.clientY - start.y;
    if (!on) {
      if (Math.abs(x) < 14 && Math.abs(y) < 14) return;
      // Only clearly sideways; a back swipe only goes right.
      if (Math.abs(x) < Math.abs(y) * 1.4 || (target.kind === "back" && x < 0)) { reset(); return; }
      // No tab that way (swiping right on the first one): left to the screen swipes (gestures.ts).
      if (target.kind === "tabs" && !canStep(target.list, x < 0 ? 1 : -1)) { reset(); return; }
      on = true;
    }
    dx = x;
    if (!still() && !raf) raf = requestAnimationFrame(paint);
  }, { passive: true });

  addEventListener("touchend", () => {
    if (!start || !target || !on) { reset(); return; }
    const w = innerWidth, fast = Math.abs(dx) / Math.max(1, Date.now() - start.t) > 0.5;
    const t = target;
    cancelAnimationFrame(raf); raf = 0;
    if (t.kind === "tabs") {
      const go = Math.abs(dx) > w * 0.22 || (fast && Math.abs(dx) > 40);
      const dir: 1 | -1 = dx < 0 ? 1 : -1; // swipe left: the next tab
      const moved = go && step(t.list, dir);
      if (still()) clear(t.body);
      else if (moved) {
        // The new tab's content comes in from the side the finger went towards.
        clear(t.body);
        const fresh = bodyOf(t.box, t.list); // the new tab's parts (some are new elements)
        for (const el of fresh) el.animate([{ transform: `translateX(${dir * 48}px)`, opacity: 0.35 }, { transform: "none", opacity: 1 }], { duration: 220, easing: EASE });
      } else {
        for (const el of t.body) { el.style.transition = `transform .2s ${EASE}`; el.style.transform = ""; }
        setTimeout(() => clear(t.body), 220);
      }
    } else {
      const go = dx > w * 0.3 || (fast && dx > 50);
      const m = t.move;
      if (still()) { m.style.transform = ""; if (go) goBack(); }
      else {
        m.style.transition = `transform .2s ${EASE}`;
        m.style.transform = go ? `translateX(${w / zoomNow()}px)` : "";
        setTimeout(() => {
          if (go) goBack();
          // Next frame: the screen behind has taken over, so the page doesn't flash back in before going.
          requestAnimationFrame(() => { m.style.transition = ""; m.style.transform = ""; });
        }, 190);
      }
    }
    reset();
  }, { passive: true });

  addEventListener("touchcancel", () => {
    if (target?.kind === "tabs") clear(target.body);
    else if (target) { target.move.style.transition = ""; target.move.style.transform = ""; }
    reset();
  }, { passive: true });
}
