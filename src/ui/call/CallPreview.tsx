import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Avatar } from "../Avatar";
import { Icon } from "../icons";
import { backend } from "../store";
import { VideoFill } from "./CallStage";
import { call } from "./state";

const KEY = "mustela:call-preview-width";
const MIN = 214, MAX = 900;
const saved = () => { try { const n = Number(localStorage.getItem(KEY)); return n >= MIN && n <= MAX ? n : 0; } catch { return 0; } };
const [width, setWidthSig] = createSignal(saved());
/** The preview's width in CSS pixels (0 until you resize it: then it matches the side panel). */
export const previewWidth = width;
const setWidth = (w: number) => { setWidthSig(w); try { localStorage.setItem(KEY, String(Math.round(w))); } catch { /* fine */ } };

/**
 * While you're in a call and reading another chat: the call sits at the top of the
 * member list (or the DM profile) and pushes it down, from the user's mockup.
 * It shows the stream you're watching, else a camera, else who's there with their
 * talking rings. Drag its bottom-left corner to make it bigger; it never gets
 * narrower than the side panel. Click it to go back to the call.
 */
export function CallPreview(props: { minWidth: number; onOpen(): void; onHeight(h: number): void }) {
  let el!: HTMLDivElement;
  const me = () => backend()?.me.id;
  /** What to show: a watched stream first, then someone's camera. */
  const video = createMemo(() => {
    call.tick();
    const people = call.people();
    const watched = call.streams().find((s) => s.watching);
    if (watched) return { id: watched.id, source: "screen" as const };
    const own = people.find((p) => p.id === me() && p.screen);
    if (own) return { id: own.id, source: "screen" as const };
    const cam = people.find((p) => p.camera && p.id !== me()) ?? people.find((p) => p.camera);
    return cam ? { id: cam.id, source: "camera" as const } : null;
  });
  const w = () => Math.max(props.minWidth, width() || props.minWidth);

  const ro = new ResizeObserver(() => props.onHeight(el?.offsetHeight ?? 0));
  onCleanup(() => { ro.disconnect(); props.onHeight(0); });

  function drag(e: PointerEvent) {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, start = w();
    const move = (m: PointerEvent) => setWidth(Math.min(MAX, Math.max(props.minWidth, start + (startX - m.clientX))));
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  return (
    <div ref={(d) => { el = d; ro.observe(d); }} class="call-preview" style={{ width: `${w()}px` }} role="button" tabindex="0" aria-label={`Back to the call in ${call.channel()?.name ?? "voice"}`}
      onClick={props.onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onOpen()}>
      <Show when={video()} fallback={
        <div class="cpv-people">
          <For each={call.people().slice(0, 8)}>{(p) => (
            <span class="cpv-person" classList={{ talking: call.speaking().includes(p.id) && !call.soundboard().includes(p.id), sound: call.soundboard().includes(p.id) }}>
              <Avatar person={p} size={40} presence={false} still={!call.speaking().includes(p.id)} />
            </span>
          )}</For>
        </div>
      }>{(v) => <VideoFill id={v().id} source={v().source} fit="contain" />}</Show>
      <span class="cpv-label"><span class="cp-live" />{call.channel()?.name ?? "Voice"}<Show when={video()?.source === "screen"}><span class="live-pill">LIVE</span></Show></span>
      <span class="cpv-grip" title="Drag to resize" aria-hidden="true" onPointerDown={drag} onClick={(e) => e.stopPropagation()}><Icon name="expand" size={12} /></span>
    </div>
  );
}
