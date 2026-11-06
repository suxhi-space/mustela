import { zoomNow } from "./appSize";
/**
 * Drag a bottom card down to close it (touch), like Discord's and Stoat's apps: grab it anywhere while its contents
 * are scrolled to the top (or by the top edge) and pull down. Let go past a third of its height, or flick it, and it
 * slides away; otherwise it springs back. Pulling it up (or scrolling it) grows it to full height first.
 */
export function dragToClose(card: HTMLElement, close: () => void, opts: { full?: boolean } = {}) {
  let y0 = 0, t0 = 0, dy = 0, dragging = false, armed = false;
  // Only when the contents are taller than the card. A short card stays its own height (no empty
  // space under the text). A tall one eases up to just under the status bar, and you can still
  // scroll to the top of what's in it. `full` (your own card, like Discord's): pulling up always opens it full height.
  const overflowing = () => card.scrollHeight > card.clientHeight + 12;
  const grow = () => { if (opts.full) card.classList.add("sheet-full"); else if (overflowing()) card.classList.add("sheet-tall"); };
  card.addEventListener("scroll", () => { if (card.scrollTop > 4) grow(); }, { passive: true });
  const watch = new ResizeObserver(() => grow());
  watch.observe(card);
  for (const child of card.children) watch.observe(child);
  const scroller = () => (card.scrollTop > 0 ? card : (card.querySelector<HTMLElement>("[data-sheet-scroll]") ?? card));
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const top = card.getBoundingClientRect().top;
    // From the top edge always; from anywhere else only when there's nothing above to scroll back to.
    armed = e.touches[0]!.clientY - top < 48 || scroller().scrollTop <= 0;
    y0 = e.touches[0]!.clientY; t0 = Date.now(); dy = 0; dragging = false;
  }, { passive: true });
  // The move and the lift are watched on the window: what's under the finger can be redrawn mid-drag, and a
  // touch on something no longer in the page doesn't reach the card any more.
  const move = (e: TouchEvent) => {
    if (!armed) return;
    const d = e.touches[0]!.clientY - y0;
    if (!dragging) {
      if (d < 8) { if (d < -4) { armed = false; grow(); } return; } // pulling up: the card grows, then the list scrolls
      dragging = true;
      card.style.transition = "none";
    }
    dy = Math.max(0, d);
    card.style.transform = `translateY(${dy / zoomNow()}px)`; // in the app's own (zoomed) pixels
    if (e.cancelable) e.preventDefault(); // the card moves, the page behind it doesn't scroll
  };
  addEventListener("touchmove", move, { passive: false });
  const end = () => {
    if (!dragging) { armed = false; return; }
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    const go = dy > card.offsetHeight / 3 || (fast && dy > 50);
    card.style.transition = "transform .18s ease-out";
    card.style.transform = go ? "translateY(110%)" : "";
    dragging = false; armed = false;
    if (go) setTimeout(close, 170);
    else setTimeout(() => { card.style.transition = ""; }, 200);
  };
  addEventListener("touchend", end);
  addEventListener("touchcancel", end);
  // Gone with the card: stop listening.
  const gone = new MutationObserver(() => { if (!card.isConnected) { removeEventListener("touchmove", move); removeEventListener("touchend", end); removeEventListener("touchcancel", end); gone.disconnect(); watch.disconnect(); } });
  gone.observe(document.body, { childList: true, subtree: true });
}
