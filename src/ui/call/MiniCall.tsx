import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";
import { Avatar } from "../Avatar";
import { zoomNow } from "../appSize";
import { Icon } from "../icons";
import { backend } from "../store";
import { VideoFill } from "./CallStage";
import { call } from "./state";

/**
 * Phones and tablets: while you're in a call and looking at something else, the call stays with you as a
 * small tile you can drag anywhere (the same on phones and tablets: just the picture, no name): square with whoever is talking (you included, or whoever spoke last) and their ring, or wide
 * with the stream you're watching (never your own). Tap it to go back to the call.
 */
/** What a small view of the call shows: the stream you're watching, or whoever is talking (or spoke last). */
export function callFocus() {
  // Who is talking now: someone else first, else you (you light up too, not only when you're alone in the call).
  const speaker = () => { const me = backend()?.me.id, sp = call.speaking(); return sp.find((id) => id !== me) ?? (me && sp.includes(me) ? me : undefined); };
  // Who spoke last, so there's someone to show between sentences.
  const [lastSpoke, setLastSpoke] = createSignal<string | null>(null);
  createEffect(() => { const now = speaker(); if (now) setLastSpoke(now); });
  const stream = createMemo(() => {
    call.tick();
    const s = call.streams().find((x) => x.watching && call.handle()?.video(x.id, "screen"));
    return s?.id ?? null;
  });
  const person = createMemo(() => {
    const people = call.people(), me = backend()?.me.id;
    const pick = speaker() ?? lastSpoke() ?? people.find((p) => p.id !== me)?.id ?? me;
    return people.find((p) => p.id === pick) ?? people.find((p) => p.id !== me) ?? people[0];
  });
  const talking = () => !!person() && call.speaking().includes(person()!.id);
  return { stream, person, talking };
}

/** How big the mini view is (pinched bigger or smaller), kept while the app is open. */
const [miniScale, setMiniScale] = createSignal(1);

export function MiniCall(props: { onOpen(): void }) {
  const { stream, person, talking } = callFocus();

  /* drag anywhere; a touch that doesn't move is a tap; pinch with two fingers to resize (like picture-in-picture) */
  const [pos, setPos] = createSignal({ right: 12, top: 124 });
  let start: { x: number; y: number; right: number; top: number; moved: boolean } | null = null;
  let el!: HTMLDivElement;
  const fingers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; scale: number } | null = null;
  const spread = () => { const [a, b] = [...fingers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    el.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2) { pinch = { d: spread(), scale: miniScale() }; start = null; return; }
    start = { x: e.clientX, y: e.clientY, ...pos(), moved: false };
  };
  const move = (e: PointerEvent) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && fingers.size === 2) {
      // Bigger or smaller, up to the screen's width (it keeps its shape: square, or wide for a stream).
      const base = stream() ? 184 : 104;
      const most = Math.max(1, (innerWidth / zoomNow() - 16) / base);
      // Same smallest size on a phone and a tablet: about 72px square, or 108px wide for a stream.
      const floor = (stream() ? 108 : 72) / base;
      setMiniScale(Math.max(floor, Math.min(most, pinch.scale * spread() / Math.max(1, pinch.d))));
      keepOnScreen();
      return;
    }
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 6) return;
    start.moved = true;
    // Screen pixels to the app's own pixels (App size zooms the app on phones).
    const z = zoomNow(), r = el.getBoundingClientRect();
    setPos({
      right: Math.max(4, Math.min((innerWidth - r.width) / z - 4, start.right - dx / z)),
      top: Math.max(4, Math.min((innerHeight - r.height) / z - 4, start.top + dy / z)),
    });
  };
  const keepOnScreen = () => {
    const z = zoomNow(), r = el.getBoundingClientRect();
    setPos((p) => ({ right: Math.max(4, Math.min((innerWidth - r.width) / z - 4, p.right)), top: Math.max(4, Math.min((innerHeight - r.height) / z - 4, p.top)) }));
  };
  const up = (e: PointerEvent) => {
    fingers.delete(e.pointerId);
    if (pinch) { if (fingers.size === 0) pinch = null; return; } // the end of a pinch isn't a tap
    const s = start; start = null; if (s && !s.moved) props.onOpen();
  };

  return (
    <div ref={el} class="minicall" classList={{ stream: !!stream(), talking: talking() && !stream() }} role="button" aria-label="Back to the call"
      style={{ right: `${pos().right}px`, top: `${pos().top}px`, "--mc-scale": String(miniScale()) }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={(e) => { fingers.delete(e.pointerId); pinch = null; start = null; }}>
      <Show when={stream()} fallback={
        <Show when={person()}>{(p) => (
          <span class="mc-person" title={p().name}><Avatar person={p()} size={Math.round(64 * miniScale())} presence={false} still={!talking()} /></span>
        )}</Show>
      }>{(id) => (
        <>
          <VideoFill id={id()} source="screen" fit="cover" />
          <span class="mc-live">LIVE</span>
        </>
      )}</Show>
    </div>
  );
}

/**
 * Android picture-in-picture: the whole app shrinks to a little window, far too small for the interface.
 * While it's that small, show just the call: the stream, or whoever is talking, big and centred.
 */
export function PipView() {
  const { stream, person, talking } = callFocus();
  // Just the picture (no name under it, on phones and tablets alike), filling the floating window.
  const [size, setSize] = createSignal(72);
  // In the app's own pixels (App size zooms the app, and the window is measured on screen).
  const fit = () => { const z = zoomNow(); setSize(Math.max(28, Math.round(Math.min(innerWidth, innerHeight) / z * 0.6))); };
  fit(); addEventListener("resize", fit); onCleanup(() => removeEventListener("resize", fit));
  return (
    <div class="pipview" classList={{ talking: talking() && !stream(), stream: !!stream() }} aria-label="Call">
      <Show when={stream()} fallback={
        <Show when={person()}>{(p) => (
          <span class="pip-person" aria-label={p().name}><Avatar person={p()} size={size()} presence={false} still={!talking()} /></span>
        )}</Show>
      }>{(id) => <VideoFill id={id()} source="screen" fit="contain" />}</Show>
      <Show when={!call.on().mic}><span class="pip-muted"><Icon name="mic-off" size={14} /></span></Show>
    </div>
  );
}
