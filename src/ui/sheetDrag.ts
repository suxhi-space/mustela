import { zoomNow } from "./appSize";
/**
 * Drag a bottom card down to close it (touch), like Discord's and Stoat's apps: grab it anywhere while its contents
 * are scrolled to the top (or by the top edge) and pull down. Let go past a third of its height, or flick it, and it
 * slides away; otherwise it springs back.
 */
export function dragToClose(card: HTMLElement, close: () => void) {
  let y0 = 0, t0 = 0, dy = 0, dragging = false, armed = false;
  const scroller = () => (card.scrollTop > 0 ? card : (card.querySelector<HTMLElement>("[data-sheet-scroll]") ?? card));
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const top = card.getBoundingClientRect().top;
    // From the top edge always; from anywhere else only when there's nothing above to scroll back to.
    armed = e.touches[0]!.clientY - top < 48 || scroller().scrollTop <= 0;
    y0 = e.touches[0]!.clientY; t0 = Date.now(); dy = 0; dragging = false;
  }, { passive: true });
  card.addEventListener("touchmove", (e) => {
    if (!armed) return;
    const d = e.touches[0]!.clientY - y0;
    if (!dragging) {
      if (d < 8) { if (d < -4) armed = false; return; } // scrolling up: leave it to the list
      dragging = true;
      card.style.transition = "none";
    }
    dy = Math.max(0, d);
    card.style.transform = `translateY(${dy / zoomNow()}px)`; // in the app's own (zoomed) pixels
    if (e.cancelable) e.preventDefault(); // the card moves, the page behind it doesn't scroll
  }, { passive: false });
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
  card.addEventListener("touchend", end);
  card.addEventListener("touchcancel", end);
}
