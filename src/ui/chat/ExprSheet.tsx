import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { MOBILE_UI } from "../target";

/**
 * Phones: the emoji and GIF pickers are a card from the bottom, like Discord's: a handle you drag up for more room
 * (or down to close), Emoji and GIFs tabs when both make sense, and the chat with its message box moves up above the
 * card instead of being covered by it.
 */
/**
 * Tall or half height, shared by the Emoji and GIFs cards: switching tabs swaps one card for the other, and the new
 * one keeps the height you dragged it to. A real close (no other card taking over straight away) starts fresh.
 */
const [tall, setTall] = createSignal(false);
let handoff: ReturnType<typeof setTimeout> | undefined;
let gen = 0;

/*
 * The card is as tall as your keyboard, like Discord's: swapping between the keyboard and the card then leaves the
 * message box where it is instead of the whole chat jumping. Where the message box sits with the keyboard up is
 * measured whenever the keyboard settles (Android tells the page its height as --keyboard) and remembered.
 */
const KB_KEY = "mustela:xs-kb";
const kbNow = () => (typeof document === "undefined" ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard")) || 0);
let kbSpace = (() => { try { return Number(localStorage.getItem(KB_KEY)) || 0; } catch { return 0; } })();
function measureKeyboard() {
  const root = document.documentElement;
  if (kbNow() < 120 || root.classList.contains("xs-open")) return;
  const box = document.querySelector(".composer");
  if (!box) return;
  // The card's top sits 8px under the message box (see .xs-open in styles.css), so this keeps the box in place.
  const space = Math.round(innerHeight - box.getBoundingClientRect().bottom) - 8;
  if (space > 150 && space < innerHeight * 0.7 && Math.abs(space - kbSpace) > 2) {
    kbSpace = space;
    try { localStorage.setItem(KB_KEY, String(space)); } catch { /* remembered for this run only */ }
  }
}
if (MOBILE_UI && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  let t: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(measureKeyboard, 350); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
}

export function useExprSheet(close: () => void) {
  const half = () => (kbSpace > 0 ? Math.round(Math.min(Math.max(kbSpace, 220), innerHeight * 0.62)) : Math.round(Math.min(innerHeight * 0.48, 460)));
  const full = () => Math.round(innerHeight - 64 - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sa-top")) || 0));
  const big = tall, setBig = setTall;
  const [drag, setDrag] = createSignal(0);
  const height = () => Math.max(160, (big() ? full() : half()) - drag());
  const root = document.documentElement;
  const sync = () => root.style.setProperty("--xs-h", `${big() ? half() : height()}px`);
  // The chat above stays live: a tap anywhere outside the card closes it (a tap in the message box brings the
  // keyboard back), and the message box's keyboard button does its own thing.
  const outside = (e: PointerEvent) => {
    const t = e.target as Element | null;
    if (!t || t.closest(".emoji-pop, .gif-pop, .composer button[aria-label='Keyboard'], .menu, .ctx, .toast")) return;
    close();
  };
  onMount(() => {
    // Another tab's card just closed: take over its size (and the chat above doesn't jump). Otherwise a fresh card.
    gen++;
    if (handoff !== undefined) { clearTimeout(handoff); handoff = undefined; } else setTall(false);
    root.classList.add("xs-open"); sync(); document.addEventListener("pointerdown", outside, true);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", outside, true);
    handoff = setTimeout(() => {
      handoff = undefined;
      const mine = gen;
      const end = () => { if (gen !== mine) return; setTall(false); root.classList.remove("xs-open"); root.style.removeProperty("--xs-h"); };
      // Back to the keyboard: keep the room until the keyboard is up, so the message box doesn't drop and jump back.
      const typing = !!(document.activeElement as Element | null)?.closest?.(".composer");
      if (!MOBILE_UI || !typing || kbNow() > 120) return end();
      if (tall()) root.style.setProperty("--xs-h", `${half()}px`);
      const started = performance.now();
      const wait = () => { if (gen !== mine) return; if (kbNow() > 120 || performance.now() - started > 900) end(); else requestAnimationFrame(wait); };
      requestAnimationFrame(wait);
    }, 0);
  });
  let from: number | null = null, at = 0;
  const grip = {
    onPointerDown: (e: PointerEvent) => {
      if ((e.target as Element).closest("button, input")) return;
      from = e.clientY; at = performance.now();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent) => { if (from !== null) setDrag(e.clientY - from); },
    onPointerUp: () => {
      if (from === null) return;
      const d = drag(), fast = Math.abs(d) / Math.max(1, performance.now() - at) > 0.5;
      from = null; setDrag(0);
      if (d < -40 || (fast && d < -15)) setBig(true);
      else if (d > 60 || (fast && d > 20)) { if (big()) setBig(false); else close(); }
      else if (Math.abs(d) < 6) setBig(!big()); // a tap on the handle switches sizes
      sync();
    },
    onPointerCancel: () => { from = null; setDrag(0); },
  };
  /**
   * The whole card follows your finger, like Discord's: pulling up on the half-height card makes it taller (the
   * list doesn't scroll for that pull), pulling down with the list at its top makes it shorter or closes it, and
   * anything else scrolls the list. The handle and tabs use the grip above; the bottom bar of categories scrolls sideways.
   */
  let y0 = 0, t0 = 0, decided = true, active = false, scroller: HTMLElement | null = null;
  const settle = () => {
    const d = drag(), fast = Math.abs(d) / Math.max(1, performance.now() - t0) > 0.5;
    setDrag(0);
    if (d < -50 || (fast && d < -15)) setBig(true);
    else if (d > 70 || (fast && d > 20)) { if (big()) setBig(false); else close(); }
    sync();
  };
  const onStart = (e: TouchEvent) => {
    const t = e.target as Element;
    decided = false; active = false;
    if (e.touches.length !== 1 || t.closest(".xs-top, .emoji-rail, input")) { decided = true; return; }
    y0 = e.touches[0]!.clientY; t0 = performance.now();
    scroller = t.closest(".emoji-list, .gif-body") as HTMLElement | null;
  };
  const onMove = (e: TouchEvent) => {
    if (decided && !active) return;
    if (!e.touches[0] || (!decided && !t0)) return;
    const dy = e.touches[0]!.clientY - y0;
    if (!decided) {
      if (Math.abs(dy) < 8) return;
      decided = true;
      const atTop = !scroller || scroller.scrollTop <= 0;
      active = (!big() && dy < 0) || (dy > 0 && atTop);
      if (active) { y0 = e.touches[0]!.clientY; t0 = performance.now(); }
    }
    if (!active) return;
    e.preventDefault();
    setDrag(e.touches[0]!.clientY - y0);
  };
  const onEnd = () => { if (active) settle(); active = false; decided = true; t0 = 0; };
  // Moves and the lift are watched on the window: the emoji under your finger can be redrawn mid-drag, and a touch
  // on something no longer in the page doesn't reach the card any more.
  const bind = (el: HTMLElement) => el.addEventListener("touchstart", onStart, { passive: true });
  onMount(() => {
    addEventListener("touchmove", onMove, { passive: false });
    addEventListener("touchend", onEnd);
    addEventListener("touchcancel", onEnd);
  });
  onCleanup(() => { removeEventListener("touchmove", onMove); removeEventListener("touchend", onEnd); removeEventListener("touchcancel", onEnd); });
  /** Back to half height (after picking an emoji from the tall card, so the message box shows again). */
  const collapse = () => { if (big()) { setBig(false); sync(); } };
  return { height, dragging: () => drag() !== 0, grip, sync, bind, collapse };
}

/**
 * The top of the picker: on phones the handle, and the Emoji / GIFs tabs when both are offered (like Discord: Emoji
 * first on phones, GIFs first on computers, where there's no handle).
 */
export function SheetTop(props: { tab: "emoji" | "gif"; toEmoji?: () => void; toGif?: () => void; grip?: ReturnType<typeof useExprSheet>["grip"] }) {
  const tabs = () => {
    const e = <button role="tab" classList={{ on: props.tab === "emoji" }} aria-selected={props.tab === "emoji"} onClick={() => props.tab !== "emoji" && props.toEmoji?.()}>Emoji</button>;
    const g = <button role="tab" classList={{ on: props.tab === "gif" }} aria-selected={props.tab === "gif"} onClick={() => props.tab !== "gif" && props.toGif?.()}>GIFs</button>;
    return props.grip ? [e, g] : [g, e];
  };
  return (
    <Show when={props.grip || props.toEmoji || props.toGif}>
      <div class="xs-top" classList={{ "xs-desk": !props.grip }} {...(props.grip ?? {})}>
        <Show when={props.grip}><span class="xs-handle" aria-hidden="true" /></Show>
        <Show when={props.toEmoji || props.toGif}><div class="seg xs-tabs" role="tablist">{tabs()}</div></Show>
      </div>
    </Show>
  );
}
