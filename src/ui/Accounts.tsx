import { createSignal, Show } from "solid-js";
import { backend, bumpMe, meNow } from "./store";
import { Icon } from "./icons";
import { openEmojiPicker } from "./chat/overlays";

export const instanceLabel = (baseURL?: string) => {
  if (!baseURL) return "stoat.chat";
  try { return new URL(baseURL).host; } catch { return "custom instance"; }
};

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
