import { For, Show, type JSX } from "solid-js";
import type { Rating } from "../lib/decor/spec";
import { Icon } from "./icons";

/** iOS-style grouped table: an optional title, rounded container, hairline-separated rows. */
export function Group(props: { title?: string; hint?: string; children: JSX.Element }) {
  return (
    <section class="group">
      <Show when={props.title}><h3 class="group-title">{props.title}</h3></Show>
      <div class="group-body">{props.children}</div>
      <Show when={props.hint}><p class="group-hint">{props.hint}</p></Show>
    </section>
  );
}

export function Row(props: { label: JSX.Element; hint?: string; children?: JSX.Element; onClick?: () => void; chevron?: boolean; disabled?: boolean }) {
  const inner = (
    <>
      <span class="row-label">{props.label}<Show when={props.hint}><small>{props.hint}</small></Show></span>
      <span class="row-ctl">{props.children}</span>
      <Show when={props.chevron}><Icon name="right" size={16} class="row-chev" /></Show>
    </>
  );
  return props.onClick
    ? <button class="row tap" disabled={props.disabled} onClick={props.onClick}>{inner}</button>
    : <div class="row" classList={{ off: props.disabled }}>{inner}</div>;
}

export function Switch(props: { on: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button class="switch" role="switch" aria-checked={props.on} aria-label={props.label} disabled={props.disabled} onClick={() => props.onChange(!props.on)}>
      <span class="knob" />
    </button>
  );
}

/** Segmented control (iOS 6 in classic style, M3 in flat). */
export function Seg<T extends string>(props: { value: T; options: { v: T; label: string; disabled?: boolean }[]; onChange(v: T): void; label: string }) {
  return (
    <div class="seg" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>{(o) => (
        <button role="radio" aria-checked={props.value === o.v} disabled={o.disabled} classList={{ on: props.value === o.v }} onClick={() => props.onChange(o.v)}>{o.label}</button>
      )}</For>
    </div>
  );
}

export function Slider(props: { value: number; min: number; max: number; onChange(v: number): void; label: string; suffix?: string; hue?: boolean }) {
  return (
    <span class="slider" classList={{ hue: !!props.hue }}>
      <input type="range" min={props.min} max={props.max} value={props.value} aria-label={props.label} onInput={(e) => props.onChange(+e.currentTarget.value)} />
      <output>{props.value}{props.suffix ?? ""}</output>
    </span>
  );
}

export function Select<T extends string>(props: { value: T; options: { v: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <select class="select" aria-label={props.label} value={props.value} onChange={(e) => props.onChange(e.currentTarget.value as T)}>
      <For each={props.options}>{(o) => <option value={o.v}>{o.label}</option>}</For>
    </select>
  );
}

const RATING_GLYPH: Record<Rating, string> = { excellent: "●", good: "◐", heavy: "▲", "very-poor": "■" };
/** Shape + word + color: never color alone. */
export function RatingBadge(props: { rating: Rating; label: string }) {
  return <span class={`rating r-${props.rating}`}><i aria-hidden="true">{RATING_GLYPH[props.rating]}</i>{props.label}</span>;
}

export function ColorInput(props: { value: string; onChange(hex: string): void; label: string }) {
  return (
    <label class="swatch" style={{ background: props.value }}>
      <input type="color" value={props.value} aria-label={props.label} onInput={(e) => props.onChange(e.currentTarget.value)} />
      <Icon name="palette" size={16} />
    </label>
  );
}
