import { createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { openChannel } from "./nav";

/** A message while you're in Mustela: a little card from the top instead of a system notification. */
export type BannerNote = { channel: string; name: string; where?: string; text: string; icon?: string; color?: string };

const [note, setNote] = createSignal<(BannerNote & { key: number; count: number }) | null>(null);
let key = 0;

export function showBanner(n: BannerNote) {
  const cur = note();
  // More from the same conversation updates the card (with a count) instead of stacking cards.
  const count = cur && cur.channel === n.channel ? cur.count + 1 : 1;
  setNote({ ...n, key: ++key, count });
}

export function BannerHost() {
  return (
    <Portal>
      <Show when={note()} keyed>{(n) => <Card n={n} />}</Show>
    </Portal>
  );
}

function Card(props: { n: BannerNote & { key: number; count: number } }) {
  const [leaving, setLeaving] = createSignal(false);
  const [drag, setDrag] = createSignal(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { if (leaving()) return; setLeaving(true); setTimeout(() => { if (note()?.key === props.n.key) setNote(null); }, 220); };
  const arm = (ms = 5000) => { clearTimeout(timer); timer = setTimeout(close, ms); };
  arm();
  onCleanup(() => clearTimeout(timer));
  const open = () => { openChannel(props.n.channel); close(); };

  // Swipe it up to dismiss (or tap it to open the chat).
  let startY = 0, moved = false, id = -1;
  const down = (e: PointerEvent) => { id = e.pointerId; startY = e.clientY; moved = false; clearTimeout(timer); (e.currentTarget as HTMLElement).setPointerCapture?.(id); };
  const move = (e: PointerEvent) => { if (e.pointerId !== id) return; const d = Math.min(0, e.clientY - startY); if (d < -4) moved = true; setDrag(d); };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== id) return; id = -1;
    if (drag() < -28) { close(); return; }
    setDrag(0);
    if (!moved) open(); else arm(3000);
  };

  return (
    <div class="ibn" classList={{ out: leaving() }} role="status" aria-live="polite"
      style={{ transform: drag() ? `translate(-50%, ${drag()}px)` : undefined, opacity: drag() ? String(1 + drag() / 120) : undefined }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { id = -1; setDrag(0); arm(3000); }}
      onMouseEnter={() => clearTimeout(timer)} onMouseLeave={() => arm(2500)}>
      <span class="ibn-av" style={props.n.color ? { "--ring": props.n.color } : undefined}>
        <Show when={props.n.icon} fallback={<span>{props.n.name.slice(0, 1).toUpperCase()}</span>}><img src={props.n.icon} alt="" draggable={false} /></Show>
      </span>
      <span class="ibn-body">
        <span class="ibn-top">
          <b>{props.n.name}</b>
          <Show when={props.n.where}><small>{props.n.where}</small></Show>
          <Show when={props.n.count > 1}><em class="ibn-count">{props.n.count}</em></Show>
        </span>
        <span class="ibn-text">{props.n.text}</span>
      </span>
      <button class="ibn-x" aria-label="Dismiss" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); close(); }}>×</button>
    </div>
  );
}
