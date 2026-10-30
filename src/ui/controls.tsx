import { For, Show, type JSX } from "solid-js";
import type { Rating } from "../lib/decor/spec";
import { Icon } from "./icons";
import { openMenu, type MenuItem } from "./menu";

/** iOS-style grouped table: an optional title, rounded container, hairline-separated rows. */
export function Group(props: { title?: string; count?: number; hint?: string; children: JSX.Element }) {
  return (
    <section class="group">
      <Show when={props.title}><h3 class="group-title">{props.title}<Show when={props.count}><span class="count">{props.count}</span></Show></h3></Show>
      <div class="group-body">{props.children}</div>
      <Show when={props.hint}><p class="group-hint">{props.hint}</p></Show>
    </section>
  );
}

export function Row(props: { label: JSX.Element; hint?: string; icon?: string; children?: JSX.Element; onClick?: () => void; chevron?: boolean; disabled?: boolean; danger?: boolean }) {
  const inner = (
    <>
      <Show when={props.icon}><span class="row-icon"><Icon name={props.icon!} size={18} /></span></Show>
      <span class="row-label">{props.label}<Show when={props.hint}><small>{props.hint}</small></Show></span>
      <span class="row-ctl">{props.children}</span>
      <Show when={props.chevron}><Icon name="right" size={16} class="row-chev" /></Show>
    </>
  );
  // A div acting as a button, so rows can hold their own small buttons (a real <button> can't contain one).
  return props.onClick
    ? <div class="row tap" classList={{ off: props.disabled, danger: !!props.danger }} role="button" tabIndex={props.disabled ? -1 : 0} aria-disabled={props.disabled}
        onClick={(e) => { if (!props.disabled && !(e.target as HTMLElement).closest(".row-ctl button, .row-ctl input, .row-ctl select")) props.onClick!(); }}
        onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && !props.disabled) { e.preventDefault(); props.onClick!(); } }}>{inner}</div>
    : <div class="row" classList={{ off: props.disabled, danger: !!props.danger }}>{inner}</div>;
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

/**
 * A dropdown that opens Mustela's own menu (the system's list doesn't follow the theme: light
 * grey text on white in dark mode on Windows). Arrow keys on the button step through the choices.
 */
export function Select<T extends string>(props: { value: T; options: { v: T; label: string }[]; onChange(v: T): void; label: string }) {
  const current = () => props.options.find((o) => o.v === props.value)?.label ?? "";
  const open = (el: HTMLElement) => openMenu(el, props.options.map((o): MenuItem => ({ label: o.label, checked: o.v === props.value, onSelect: () => props.onChange(o.v) })), { width: el.offsetWidth });
  const step = (d: number) => {
    const i = props.options.findIndex((o) => o.v === props.value);
    const n = props.options[Math.max(0, Math.min(props.options.length - 1, i + d))];
    if (n && n.v !== props.value) props.onChange(n.v);
  };
  return (
    <button type="button" class="select" aria-label={props.label} aria-haspopup="menu" data-value={props.value} onClick={(e) => open(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); step(e.key === "ArrowDown" ? 1 : -1); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e.currentTarget); }
      }}>
      <span class="select-label">{current()}</span><Icon name="down" size={14} class="select-chev" />
    </button>
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
