/** Shared by the screen swipes (gestures.ts) and the tab and settings swipes (tabSwipe.ts). */

/** Something under the finger that scrolls sideways itself (the "active now" strip, filter chips, a row of pictures). */
export function inSideScroller(t: Element | null): boolean {
  for (let e = t; e && e !== document.body; e = e.parentElement) {
    if (e.scrollWidth > e.clientWidth + 2) { const o = getComputedStyle(e).overflowX; if (o === "auto" || o === "scroll") return true; }
  }
  return false;
}

/** The tab row a swipe starting here would switch ([data-swipe-tabs] areas, not on the row itself). */
export function tabRowAt(t: Element): { box: HTMLElement; list: HTMLElement } | null {
  const box = t.closest<HTMLElement>("[data-swipe-tabs]");
  const list = box?.querySelector<HTMLElement>("[role=tablist]");
  if (!box || !list || list.contains(t) || list.offsetParent === null) return null;
  return { box, list };
}

/** The tabs you can switch to, and which one is open. */
export function tabsOf(list: HTMLElement): { tabs: HTMLElement[]; at: number } {
  const tabs = [...list.querySelectorAll<HTMLElement>("[role=tab]")].filter((b) => b.offsetParent !== null && !(b as HTMLButtonElement).disabled);
  return { tabs, at: tabs.findIndex((b) => b.getAttribute("aria-selected") === "true" || b.classList.contains("on")) };
}

/** Whether a swipe this way (1: to the next tab, a swipe left; -1: the previous one) has a tab to go to. */
export function canStep(list: HTMLElement, dir: 1 | -1): boolean {
  const { tabs, at } = tabsOf(list);
  return at >= 0 && !!tabs[at + dir];
}
