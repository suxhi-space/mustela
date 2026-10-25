import { createSignal, For, onCleanup, Show } from "solid-js";
import { Avatar } from "../Avatar";
import { VideoFill } from "./CallStage";
import { call } from "./state";

/**
 * What the floating picture-in-picture window shows (Android): the shared
 * screen or a camera if anyone has one on, otherwise who's talking.
 * Android PiP windows are tiny and can't be tapped through, so it's display only.
 */
export function PipView() {
  const mq = matchMedia("(max-width: 420px) and (max-height: 320px)");
  const [tiny, setTiny] = createSignal(mq.matches);
  const f = () => setTiny(mq.matches);
  mq.addEventListener("change", f);
  onCleanup(() => mq.removeEventListener("change", f));
  const featured = () => call.people().find((p) => call.handle()?.video(p.id));
  return (
    <Show when={tiny() && call.active()}>
      <div class="pip-view">
        <Show when={featured()} fallback={
          <div class="pip-people">
            <For each={call.people().slice(0, 4)}>{(p) => (
              <span class="pip-person" classList={{ talking: call.speaking().includes(p.id) }}><Avatar person={p} size={44} presence={false} /></span>
            )}</For>
          </div>
        }>{(p) => <VideoFill id={p().id} fit="contain" />}</Show>
        <span class="pip-label">{call.channel()?.name}</span>
      </div>
    </Show>
  );
}
