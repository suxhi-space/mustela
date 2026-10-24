import { createMemo, createSignal, For, Match, Switch, type JSX } from "solid-js";
import { formatTime, isJumbo, parse, type Block, type Inline } from "../../lib/markdown";
import { backend } from "../store";

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

function Inlines(props: { nodes: Inline[]; ctx: MdCtx }): JSX.Element {
  return (
    <For each={props.nodes}>{(n) => (
      <Switch>
        <Match when={n.t === "text"}>{(n as { v: string }).v}</Match>
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
        <Match when={n.t === "role"}><span class="mention">@role</span></Match>
        <Match when={n.t === "emoji"}>
          <img class="cemoji" src={backend()?.emojiUrl((n as any).id)} alt={`:${(n as any).id}:`} loading="lazy" draggable={false} />
        </Match>
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
