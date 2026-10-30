import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js";
import { createLoop } from "../lib/render/loop";
import { drawFrame as drawDecor } from "../lib/decor/draw";
import { layersFor } from "../lib/decor/presets";
import type { SlotConfig } from "../lib/decor/spec";
import { drawEffect, EFFECT_STATIC_T, makeParticles } from "../lib/profile/effects";
import { PAINT_STATIC_T, paintFrame, paintPlate } from "../lib/profile/paint";

/** A canvas that redraws when its inputs change and animates only when allowed. */
export function PaintCanvas(props: {
  w: number; h: number; animate: boolean; staticT?: number; class?: string;
  draw: (ctx: CanvasRenderingContext2D, t: number) => void;
}) {
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    const w = props.w, h = props.h;
    if (w < 2 || h < 2) return;
    const r = createLoop(canvas, { width: w, height: h, staticOnly: !props.animate, staticT: props.staticT, draw: props.draw });
    r.start();
    onCleanup(() => r.destroy());
  });
  return <canvas ref={canvas} class={props.class} aria-hidden="true" />;
}

/** Avatar decoration: a square canvas 1.5x the avatar, centered on it. */
export function DecorCanvas(props: { slot: Accessor<SlotConfig>; size: number; animate: boolean }) {
  const layers = createMemo(() => layersFor(props.slot()));
  // Sparkles (Stardust and friends) are laid out once per decoration, not every frame.
  const parts = createMemo(() => { layers(); return new Map<any, any>(); });
  const S = () => Math.round(props.size * 1.5);
  return <PaintCanvas class="decor" w={S()} h={S()} animate={props.animate} draw={(ctx, t) => drawDecor(ctx, layers(), t, S(), parts())} />;
}

export function EffectCanvas(props: { slot: Accessor<SlotConfig>; w: number; h: number; animate: boolean }) {
  const parts = createMemo(() => makeParticles(props.slot()));
  return <PaintCanvas class="fx" w={props.w} h={props.h} animate={props.animate} staticT={EFFECT_STATIC_T}
    draw={(ctx, t) => drawEffect(ctx, props.slot(), parts(), t, props.w, props.h)} />;
}

export function FrameCanvas(props: { slot: Accessor<SlotConfig>; w: number; h: number; animate: boolean; radius?: number }) {
  return <PaintCanvas class="frame" w={props.w} h={props.h} animate={props.animate} staticT={PAINT_STATIC_T}
    draw={(ctx, t) => paintFrame(ctx, props.slot(), t, props.w, props.h, props.radius)} />;
}

export function PlateCanvas(props: { slot: Accessor<SlotConfig>; w: number; h: number; animate: boolean }) {
  return <PaintCanvas class="plate" w={props.w} h={props.h} animate={props.animate} staticT={PAINT_STATIC_T}
    draw={(ctx, t) => paintPlate(ctx, props.slot(), t, props.w, props.h)} />;
}
