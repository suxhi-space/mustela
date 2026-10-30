import { createEffect, createMemo, createSignal, Show } from "solid-js";
import { Avatar } from "../Avatar";
import { Icon } from "../icons";
import { backend } from "../store";
import { VideoFill } from "./CallStage";
import { call, toggleCall } from "./state";

/**
 * Phones and tablets: while you're in a call and looking at something else, the call stays with you as a
 * small tile you can drag anywhere. It shows the stream you're watching, or whoever is talking (or spoke
 * last), with their ring. Tap it to go back to the call; the button mutes you.
 */
/** What a small view of the call shows: the stream you're watching, or whoever is talking (or spoke last). */
export function callFocus() {
  // Who spoke last (not you), so there's someone to show between sentences.
  const [lastSpoke, setLastSpoke] = createSignal<string | null>(null);
  createEffect(() => {
    const me = backend()?.me.id;
    const now = call.speaking().find((id) => id !== me);
    if (now) setLastSpoke(now);
  });
  const stream = createMemo(() => {
    call.tick();
    const s = call.streams().find((x) => x.watching && call.handle()?.video(x.id, "screen"));
    return s?.id ?? null;
  });
  const person = createMemo(() => {
    const people = call.people(), me = backend()?.me.id;
    const pick = call.speaking().find((id) => id !== me) ?? lastSpoke() ?? people.find((p) => p.id !== me)?.id ?? me;
    return people.find((p) => p.id === pick) ?? people[0];
  });
  const talking = () => !!person() && call.speaking().includes(person()!.id);
  return { stream, person, talking };
}

export function MiniCall(props: { onOpen(): void }) {
  const { stream, person, talking } = callFocus();

  /* drag anywhere; a touch that doesn't move is a tap */
  const [pos, setPos] = createSignal({ right: 12, top: 124 });
  let start: { x: number; y: number; right: number; top: number; moved: boolean } | null = null;
  let el!: HTMLDivElement;
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, ...pos(), moved: false };
  };
  const move = (e: PointerEvent) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 6) return;
    start.moved = true;
    const r = el.getBoundingClientRect();
    setPos({
      right: Math.max(4, Math.min(innerWidth - r.width - 4, start.right - dx)),
      top: Math.max(4, Math.min(innerHeight - r.height - 4, start.top + dy)),
    });
  };
  const up = () => { const s = start; start = null; if (s && !s.moved) props.onOpen(); };

  return (
    <div ref={el} class="minicall" classList={{ stream: !!stream(), talking: talking() && !stream() }} role="button" aria-label="Back to the call"
      style={{ right: `${pos().right}px`, top: `${pos().top}px` }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => (start = null)}>
      <Show when={stream()} fallback={
        <Show when={person()}>{(p) => (
          <span class="mc-person"><Avatar person={p()} size={52} presence={false} still={!talking()} /><small>{p().name}</small></span>
        )}</Show>
      }>{(id) => (
        <>
          <VideoFill id={id()} source="screen" fit="cover" />
          <span class="mc-live">LIVE</span>
        </>
      )}</Show>
      <button class="mc-mic" classList={{ off: !call.on().mic }} aria-label={call.on().mic ? "Mute" : "Unmute"} onClick={() => void toggleCall("mic")}>
        <Icon name={call.on().mic ? "mic" : "mic-off"} size={14} />
      </button>
    </div>
  );
}

/**
 * Android picture-in-picture: the whole app shrinks to a little window, far too small for the interface.
 * While it's that small, show just the call: the stream, or whoever is talking, big and centred.
 */
export function PipView() {
  const { stream, person, talking } = callFocus();
  return (
    <div class="pipview" classList={{ talking: talking() && !stream() }} aria-label="Call">
      <Show when={stream()} fallback={
        <Show when={person()}>{(p) => (
          <span class="pip-person"><Avatar person={p()} size={72} presence={false} still={!talking()} /><small>{p().name}</small></span>
        )}</Show>
      }>{(id) => <VideoFill id={id()} source="screen" fit="contain" />}</Show>
      <Show when={!call.on().mic}><span class="pip-muted"><Icon name="mic-off" size={14} /></span></Show>
    </div>
  );
}
