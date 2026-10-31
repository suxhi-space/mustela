import { zoomNow } from "./appSize";

/**
 * Drag a row by its handle to a new place in its list (mouse or finger). Start it from the handle's pointerdown:
 * the row follows the pointer, the rows it passes slide out of the way, and `onDrop(from, to)` gets the old and new
 * index when it's let go (nothing when it lands where it started). Rows are the list's children with `data-sort`.
 */
export function dragSort(e: PointerEvent, onDrop: (from: number, to: number) => void) {
  const handle = e.currentTarget as HTMLElement;
  const row = handle.closest<HTMLElement>("[data-sort]");
  const list = row?.parentElement;
  if (!row || !list || e.button > 0) return;
  e.preventDefault();
  const rows = [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-sort"));
  const from = rows.indexOf(row);
  const rects = rows.map((r) => r.getBoundingClientRect());
  const h = rects[from]!.height;
  const y0 = e.clientY;
  let to = from;
  handle.setPointerCapture(e.pointerId);
  row.classList.add("sorting");
  for (const r of rows) r.style.transition = r === row ? "none" : "transform .15s ease";

  const move = (ev: PointerEvent) => {
    const raw = ev.clientY - y0;
    // The row stays within the list; the new place follows the pointer (so dragging past either end still counts).
    const dy = Math.max(rects[0]!.top - rects[from]!.top, Math.min(rects[rects.length - 1]!.bottom - rects[from]!.bottom, raw));
    const z = zoomNow(); // screen pixels to the app's own (zoomed) pixels
    row.style.transform = `translateY(${dy / z}px)`;
    const mid = rects[from]!.top + h / 2 + raw;
    to = rects.filter((r, i) => i !== from && r.top + r.height / 2 < mid).length;
    rows.forEach((r, i) => {
      if (r === row) return;
      const shift = from < to && i > from && i <= to ? -h : from > to && i >= to && i < from ? h : 0;
      r.style.transform = shift ? `translateY(${shift / z}px)` : "";
    });
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    row.classList.remove("sorting");
    for (const r of rows) { r.style.transform = ""; r.style.transition = ""; }
    if (to !== from) onDrop(from, to);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

/** `list` with the item at `from` moved to `to`. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}
