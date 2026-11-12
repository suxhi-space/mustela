import { createSignal, Show } from "solid-js";
import { createLiveLevel } from "./micLevel";

/** A volume slider inside a menu (0-200%), optionally with your live mic level under it, like Discord's mic menu. */
export function VolumeRow(props: { label: string; value: number; onChange(v: number): void; micLevel?: boolean }) {
  const [v, setV] = createSignal(Math.round(props.value * 100));
  const meter = props.micLevel ? createLiveLevel(() => true) : null;
  return (
    <div class="ctx-volume" onClick={(e) => e.stopPropagation()}>
      <span class="ctx-label">{props.label}<b>{v()}%</b></span>
      <input type="range" min={0} max={200} step={5} value={v()} aria-label={props.label}
        onInput={(e) => { setV(+e.currentTarget.value); props.onChange(+e.currentTarget.value / 100); }} />
      <Show when={meter?.on()}>
        <div class="ctx-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, meter!.db() + 100))}%` }} /></div>
      </Show>
    </div>
  );
}
