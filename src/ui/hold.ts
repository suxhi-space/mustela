/**
 * Touch and hold: opens what right-click would. Android's web view sends a right-click on a long press by
 * itself, iPhones and iPads don't, so this does it everywhere; the tap that ends the hold doesn't count.
 */
let heldAt = 0;
/** A hold just opened a menu (the tap that ends the hold should do nothing). */
export const justHeld = () => Date.now() - heldAt < 800;
/** Note that a menu was opened by a hold (Android's own long-press right-click). */
export const markHeld = () => { heldAt = Date.now(); };
export function holdToOpen() {
  let timer: ReturnType<typeof setTimeout> | undefined, x = 0, y = 0;
  const cancel = () => clearTimeout(timer);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const el = e.currentTarget as HTMLElement;
      x = e.clientX; y = e.clientY; cancel();
      timer = setTimeout(() => {
        if (justHeld()) return; // Android already opened it
        heldAt = Date.now();
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }, 500);
    },
    onPointerMove: (e: PointerEvent) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel(); },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

