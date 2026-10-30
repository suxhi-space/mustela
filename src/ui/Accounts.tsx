import { createSignal, For, Show } from "solid-js";
import { activeAccount } from "../lib/session/book";
import type { Presence } from "../lib/backend/types";
import { backend, book, bumpMe, meNow, removeAccountById, setAddingAccount, switchAccount } from "./store";
import { Avatar } from "./Avatar";
import { Icon } from "./icons";
import { openEmojiPicker } from "./chat/overlays";

export const instanceLabel = (baseURL?: string) => {
  if (!baseURL) return "stoat.chat";
  try { return new URL(baseURL).host; } catch { return "custom instance"; }
};

const PRESENCE: { v: Presence; label: string }[] = [
  { v: "online", label: "Online" }, { v: "idle", label: "Idle" }, { v: "focus", label: "Focus" }, { v: "busy", label: "Busy" }, { v: "invisible", label: "Invisible" },
];

/** Popup above the user panel: every signed-in account, switch with one tap. */
export function AccountMenu(props: { onClose(): void; onSettings(): void }) {
  return (
    <div class="menu-scrim" onClick={props.onClose}>
      <div class="menu account-menu" role="menu" onClick={(e) => e.stopPropagation()}>
        <div class="presence-row" role="group" aria-label="Status">
          <For each={PRESENCE}>{(p) => (
            <button classList={{ on: (meNow()?.presence ?? "online") === p.v }} aria-pressed={(meNow()?.presence ?? "online") === p.v} title={p.label}
              onClick={() => void backend()?.updateMe({ presence: p.v }).then(bumpMe).catch(() => {})}>
              <span class={`pdot p-${p.v}`} />{p.label}
            </button>
          )}</For>
        </div>
        <StatusEditor />
        <div class="menu-sep" />
        <For each={book().accounts}>{(a) => {
          const active = () => a.id === activeAccount(book())?.id;
          return (
            <div class="menu-row" classList={{ active: active() }}>
              <button class="menu-main" role="menuitemradio" aria-checked={active()} onClick={() => { void switchAccount(a.id); props.onClose(); }}>
                <Avatar person={{ id: a.id, name: a.name, avatarUrl: a.avatarUrl }} size={30} profile={null} presence={false} />
                <span class="menu-text"><strong>{a.name}</strong><small>{a.kind === "demo" ? "Demo account" : instanceLabel(a.baseURL)}</small></span>
                <Show when={active()}><Icon name="check" size={16} /></Show>
              </button>
              <button class="icon-btn" aria-label={`Remove ${a.name}`} title="Remove account" onClick={() => void removeAccountById(a.id)}><Icon name="logout" size={16} /></button>
            </div>
          );
        }}</For>
        <button class="menu-item" role="menuitem" onClick={() => { setAddingAccount(true); props.onClose(); }}><Icon name="plus" size={18} />Add account</button>
        <button class="menu-item" role="menuitem" onClick={() => { props.onSettings(); props.onClose(); }}><Icon name="gear" size={18} />Settings</button>
      </div>
    </div>
  );
}

/** Custom status message, right in the account menu. Enter saves, Escape clears the field. */
export function StatusEditor() {
  const [text, setText] = createSignal(meNow()?.status ?? "");
  const [state, setState] = createSignal<"" | "saving" | "saved" | "err">("");
  const dirty = () => text().trim() !== (meNow()?.status ?? "");
  let input!: HTMLInputElement;
  async function save(v = text()) {
    setState("saving");
    try { await backend()!.updateMe({ status: v.trim() }); bumpMe(); setText(v.trim()); setState("saved"); setTimeout(() => state() === "saved" && setState(""), 1400); }
    catch { setState("err"); }
  }
  return (
    <form class="status-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <button type="button" class="icon-btn se-emoji" aria-label="Add an emoji" title="Add an emoji"
        onClick={(e) => openEmojiPicker(e.currentTarget, ({ text: t }) => {
          // Put it where the caret was (or at the end), then keep typing.
          const at = input.selectionStart ?? text().length;
          const next = (text().slice(0, at) + t + text().slice(at)).slice(0, 128);
          setText(next); setState("");
          queueMicrotask(() => { input.focus(); const p = Math.min(next.length, at + t.length); input.setSelectionRange(p, p); });
        })}><Icon name="smile" size={18} /></button>
      <input ref={input} value={text()} maxLength={128} placeholder="Set a status message" aria-label="Status message"
        onInput={(e) => { setText(e.currentTarget.value); setState(""); }}
        onKeyDown={(e) => { if (e.key === "Escape" && text()) { e.stopPropagation(); setText(meNow()?.status ?? ""); } }} />
      <Show when={dirty()} fallback={<Show when={meNow()?.status}><button type="button" class="icon-btn" aria-label="Clear status message" title="Clear" onClick={() => void save("")}><Icon name="close" size={15} /></button></Show>}>
        <button class="btn small primary" disabled={state() === "saving"}>{state() === "saving" ? "Saving…" : "Save"}</button>
      </Show>
      <Show when={state() === "saved"}><Icon name="check" size={16} class="ok-ic" /></Show>
      <Show when={state() === "err"}><small class="err">Couldn't save</small></Show>
    </form>
  );
}

export const meOrNull = () => backend()?.me ?? null;
