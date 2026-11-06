import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { joinChips, splitChips } from "../../lib/searchQuery";
import type { ChannelInfo, Person } from "../../lib/backend/types";
import { Icon } from "../icons";
import { backend } from "../store";
import type { Panel } from "./MessagePanel";
import { SearchSuggest } from "./SearchSuggest";
import { rememberSearch, searchDraft, searchPeople, setSearchDraft } from "./searchState";

/**
 * The search box in the chat's top bar on computers, like Discord's: clicking it lists the filters and your recent
 * searches, typing a filter suggests what goes in it, and Enter opens the results beside the chat.
 */
export function HeaderSearch(props: { channel: ChannelInfo; spaceId?: string; panel: Panel | null; setPanel: (p: Panel | null) => void }) {
  let input: HTMLInputElement | undefined;
  const [asked, setAsked] = createSignal(false);
  // People filters can name, before the results panel (which knows more) has opened.
  const [members] = createResource(() => (asked() && props.spaceId && props.spaceId !== "home" ? props.spaceId : null), (sid) => backend()!.members(sid).catch(() => []));
  const people = createMemo(() => {
    const seen = new Map<string, Person>();
    for (const p of searchPeople()) seen.set(p.id, p);
    for (const g of members() ?? []) for (const p of g.people) if (!seen.has(p.id)) seen.set(p.id, p);
    for (const p of [props.channel.peer, backend()?.me]) if (p && !seen.has(p.id)) seen.set(p.id, p);
    return [...seen.values()];
  });
  const run = (q: string) => {
    q = q.trim();
    if (!q) return;
    rememberSearch(q);
    setSearchDraft(`${q} `);
    props.setPanel({ kind: "search", q });
    input?.blur();
  };
  const parts = createMemo(() => splitChips(searchDraft()));
  const clear = () => { setSearchDraft(""); if (props.panel?.kind === "search") props.setPanel(null); input?.focus(); };
  return (
    <form class="search-box top-search desk-only" classList={{ "has-chips": parts().chips.length > 0 }} role="search" onSubmit={(e) => { e.preventDefault(); run(searchDraft()); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input?.focus(); } }}>
      <Icon name="search" size={16} />
      {/* Finished filters as boxes, like Discord's; what's still being typed stays text. */}
      <For each={parts().chips}>{(c, i) => (
        <span class="sq-chip" title={c.raw}><b>{c.key}:</b>{c.value}
          <button type="button" aria-label={`Remove ${c.key}: ${c.value}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { const ch = parts().chips.filter((_, j) => j !== i()); setSearchDraft(joinChips(ch, parts().rest)); if (props.panel?.kind === "search") run(joinChips(ch, parts().rest)); }}><Icon name="close" size={10} /></button>
        </span>
      )}</For>
      <input ref={input} name="q" value={parts().rest} placeholder={parts().chips.length ? "" : `Search ${props.channel.kind === "dm" ? props.channel.name : props.channel.kind === "group" ? props.channel.name : `#${props.channel.name}`}`}
        aria-label={`Search in ${props.channel.name}`} autocomplete="off" onFocus={() => setAsked(true)}
        onInput={(e) => setSearchDraft(joinChips(parts().chips, e.currentTarget.value))}
        onKeyDown={(e) => {
          if (e.key === "Backspace" && !e.currentTarget.value && parts().chips.length) { e.preventDefault(); setSearchDraft(joinChips(parts().chips.slice(0, -1), "")); return; }
          if (e.key === "Escape" && !document.querySelector(".ss-pop")) { e.preventDefault(); clear(); input?.blur(); }
        }} />
      <Show when={searchDraft().trim()}><button type="button" class="mp-clear" aria-label="Clear search" onClick={clear}><Icon name="close" size={14} /></button></Show>
      <SearchSuggest input={() => input} value={searchDraft} setValue={setSearchDraft} people={people} onSearch={run}
        onMore={() => props.setPanel({ kind: "search", q: searchDraft().trim(), filters: true })} />
    </form>
  );
}
