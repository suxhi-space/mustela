import { PACKED_EMOJI_RE } from "../../lib/emoji";
import { UEmoji } from "./UEmoji";
import { createEffect, createMemo, createSignal, For, Match, Switch, type JSX } from "solid-js";
import { stillOf } from "../stillImage";
import { formatTime, isJumbo, parse, type Block, type Inline } from "../../lib/markdown";
import { backend, device } from "../store";

export interface MdCtx {
  onUser?(id: string): void;
  onChannel?(id: string): void;
}

function Spoiler(props: { children: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  return (
    <span class="spoiler" classList={{ open: open() }} role="button" tabindex="0" aria-label={open() ? undefined : "Spoiler, activate to reveal"}
      onClick={(e) => { e.stopPropagation(); setOpen(true); }} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}>
      {props.children}
    </span>
  );
}

/** Wraps unicode emoji in spans so hovering one can say what it is, drawn in your emoji style. */
export function TextWithEmoji(props: { v: string }) {
  const parts = createMemo(() => {
    const out: { t: string; e?: boolean }[] = [];
    let last = 0;
    for (const m of props.v.matchAll(PACKED_EMOJI_RE)) {
      if (m.index! > last) out.push({ t: props.v.slice(last, m.index) });
      out.push({ t: m[0], e: true });
      last = m.index! + m[0].length;
    }
    if (last < props.v.length) out.push({ t: props.v.slice(last) });
    return out;
  });
  return <For each={parts()}>{(p) => (p.e ? <span class="uemoji" data-emoji={p.t.replace(/^[\uE0E0-\uE0E6]/, "")}><UEmoji e={p.t} /></span> : p.t.replace(/[\uE0E0-\uE0E6]/g, ""))}</For>;
}
const customName = (id: string) => backend()?.emojis().find((e) => e.id === id)?.name ?? "emoji";

/** A custom emoji. Animated ones hold still when Performance says so, and play while you point at them. */
function CustomEmoji(props: { id: string }) {
  const url = () => backend()?.emojiUrl(props.id) ?? "";
  const animated = () => !!backend()?.emojis().find((e) => e.id === props.id)?.animated;
  const [still, setStill] = createSignal<string | null>(null);
  const [hover, setHover] = createSignal(false);
  createEffect(() => { if (animated() && !device().perf.gifs) void stillOf(url()).then(setStill); });
  const src = () => (animated() && !device().perf.gifs && !hover() && still()) || url();
  return <img class="cemoji" data-emoji-id={props.id} src={src()} alt={`:${customName(props.id)}:`} loading="lazy" draggable={false}
    onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} />;
}

function Inlines(props: { nodes: Inline[]; ctx: MdCtx }): JSX.Element {
  return (
    <For each={props.nodes}>{(n) => (
      <Switch>
        <Match when={n.t === "text"}><TextWithEmoji v={(n as { v: string }).v} /></Match>
        <Match when={n.t === "br"}><br /></Match>
        <Match when={n.t === "b"}><strong><Inlines nodes={(n as any).c} ctx={props.ctx} /></strong></Match>
        <Match when={n.t === "i"}><em><Inlines nodes={(n as any).c} ctx={props.ctx} /></em></Match>
        <Match when={n.t === "s"}><s><Inlines nodes={(n as any).c} ctx={props.ctx} /></s></Match>
        <Match when={n.t === "spoiler"}><Spoiler><Inlines nodes={(n as any).c} ctx={props.ctx} /></Spoiler></Match>
        <Match when={n.t === "code"}><code class="icode">{(n as any).v}</code></Match>
        <Match when={n.t === "link"}>
          <a href={(n as any).href} target="_blank" rel="noopener noreferrer nofollow" title={(n as any).href}><Inlines nodes={(n as any).c} ctx={props.ctx} /></a>
        </Match>
        <Match when={n.t === "user"}>
          <button class="mention" onClick={(e) => { e.stopPropagation(); props.ctx.onUser?.((n as any).id); }}>@{backend()?.person((n as any).id).name ?? "user"}</button>
        </Match>
        <Match when={n.t === "channel"}>
          <button class="mention" onClick={(e) => { e.stopPropagation(); props.ctx.onChannel?.((n as any).id); }}>#{backend()?.channelName((n as any).id) ?? "channel"}</button>
        </Match>
        <Match when={n.t === "role"}>
          {(() => { const r = backend()?.role((n as any).id); const c = r?.colour && !r.colour.includes("gradient") ? r.colour : undefined; return <span class="mention role" style={c ? { color: c } : undefined}>@{r?.name ?? "role"}</span>; })()}
        </Match>
        <Match when={n.t === "emoji"}><CustomEmoji id={(n as any).id} /></Match>
        <Match when={n.t === "time"}>
          <time class="ts" title={new Date((n as any).unix * 1000).toLocaleString()}>{formatTime((n as any).unix, (n as any).style)}</time>
        </Match>
      </Switch>
    )}</For>
  );
}

function Blocks(props: { blocks: Block[]; ctx: MdCtx }): JSX.Element {
  return (
    <For each={props.blocks}>{(b) => (
      <Switch>
        <Match when={b.t === "p"}><p><Inlines nodes={(b as any).c} ctx={props.ctx} /></p></Match>
        <Match when={b.t === "h"}>
          {(() => { const h = b as Extract<Block, { t: "h" }>; return <div class={`mdh mdh${h.level}`} role="heading" aria-level={h.level + 2}><Inlines nodes={h.c} ctx={props.ctx} /></div>; })()}
        </Match>
        <Match when={b.t === "pre"}>
          <pre class="codeblock" data-lang={(b as any).lang || undefined}><code>{(b as any).v}</code></pre>
        </Match>
        <Match when={b.t === "quote"}><blockquote><Blocks blocks={(b as any).c} ctx={props.ctx} /></blockquote></Match>
        <Match when={b.t === "list"}>
          {(() => {
            const l = b as Extract<Block, { t: "list" }>;
            const items = <For each={l.items}>{(it) => <li><Inlines nodes={it} ctx={props.ctx} /></li>}</For>;
            return l.ordered ? <ol start={l.start}>{items}</ol> : <ul>{items}</ul>;
          })()}
        </Match>
      </Switch>
    )}</For>
  );
}

/** Renders Stoat markdown as DOM. No innerHTML anywhere, so message text can't inject markup. */
export function Markdown(props: { text: string; ctx?: MdCtx; class?: string }) {
  const blocks = createMemo(() => parse(props.text));
  const jumbo = createMemo(() => isJumbo(props.text));
  return <div class={`md ${props.class ?? ""}`} classList={{ jumbo: jumbo() }}><Blocks blocks={blocks()} ctx={props.ctx ?? {}} /></div>;
}
