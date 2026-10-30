import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { useBack } from "./back";
import { Icon } from "./icons";

/* ============================================================ context menus */

export type MenuItem =
  | { label: string; icon?: string; danger?: boolean; disabled?: boolean; checked?: boolean; hint?: string; onSelect(): unknown; sub?: undefined }
  | { label: string; icon?: string; sub: MenuItem[] }
  | { sep: true }
  | { header: string }
  | { custom: () => JSX.Element };

/** `doc`: the window it was opened in (the call pop-out draws its own menus). */
type Open = { x: number; y: number; items: MenuItem[]; doc: Document; width?: number; sheet?: boolean; head?: () => JSX.Element };
const [menu, setMenu] = createSignal<Open | null>(null);

/** Opens a menu at the pointer (or under an element). Returns false so it can end an event handler. */
/** `width`: at least this wide (a dropdown's menu matches its button). */
/** `sheet`: phones, a card that comes up from the bottom (with `head` drawn at its top) instead of a small menu. */
export function openMenu(at: MouseEvent | Element, items: MenuItem[], opts: { width?: number; sheet?: boolean; head?: () => JSX.Element } = {}) {
  const clean = items.filter((it, i, a) => !("sep" in it) || (i > 0 && i < a.length - 1 && !("sep" in a[i - 1]!)));
  const extra = { sheet: opts.sheet, head: opts.head };
  if ("getBoundingClientRect" in at) { const r = at.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: clean, doc: at.ownerDocument, width: opts.width, ...extra }); }
  else { at.preventDefault(); at.stopPropagation(); setMenu({ x: at.clientX, y: at.clientY, items: clean, doc: (at.target as Node | null)?.ownerDocument ?? document, ...extra }); }
  return false;
}
export const closeMenu = () => setMenu(null);

function MenuList(props: { items: MenuItem[]; x: number; y: number; sub?: boolean; width?: number; sheet?: boolean; head?: () => JSX.Element }) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ left: props.x, top: props.y });
  const [openSub, setOpenSub] = createSignal<{ i: number; x: number; y: number } | null>(null);
  onMount(() => {
    // Keep the menu on screen: flip left/up when it would overflow.
    const r = el.getBoundingClientRect();
    const { innerWidth, innerHeight } = el.ownerDocument.defaultView ?? window;
    let left = props.x, top = props.y;
    if (left + r.width > innerWidth - 8) left = props.sub ? props.x - r.width - 220 : innerWidth - r.width - 8;
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top });
    if (!props.sub) (el.querySelector(".ctx-item:not([disabled])") as HTMLElement | null)?.focus({ focusVisible: false } as FocusOptions);
  });
  const keys = (e: KeyboardEvent) => {
    const btns = [...el.querySelectorAll<HTMLButtonElement>(":scope > button:not([disabled])")];
    const i = btns.indexOf(el.ownerDocument.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  return (
    <>
    <div ref={el} class="ctx panel" classList={{ "ctx-sheet": !!props.sheet }} role="menu" style={props.sheet ? {} : { left: `${pos().left}px`, top: `${pos().top}px`, ...(props.width ? { "min-width": `${props.width}px`, "max-width": `${Math.max(280, props.width)}px` } : {}) }} onKeyDown={keys} onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}>
      <Show when={props.sheet}><span class="ctx-grab" aria-hidden="true" /></Show>
      <Show when={props.head}>{(h) => h()()}</Show>
      <For each={props.items}>{(it, i) => {
        if ("sep" in it) return <div class="ctx-sep" role="separator" />;
        if ("header" in it) return <div class="ctx-head">{it.header}</div>;
        if ("custom" in it) return it.custom();
        if (it.sub) return (
          <button role="menuitem" aria-haspopup="menu" class="ctx-item" onMouseEnter={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpenSub({ i: i(), x: r.right + 2, y: r.top - 6 }); }}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setOpenSub({ i: i(), x: r.right + 2, y: r.top - 6 }); }}>
            <Show when={it.icon}><Icon name={it.icon!} size={16} /></Show><span class="ctx-label">{it.label}</span><Icon name="right" size={14} class="muted" />
          </button>
        );
        return (
          <button role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} class="ctx-item" classList={{ danger: !!it.danger }} disabled={it.disabled}
            onMouseEnter={() => setOpenSub(null)}
            onClick={() => { closeMenu(); void it.onSelect(); }}>
            <Show when={it.icon} fallback={<Show when={it.checked !== undefined}><span class="ctx-check">{it.checked ? "✓" : ""}</span></Show>}><Icon name={it.icon!} size={16} /></Show>
            <span class="ctx-label">{it.label}</span>
            <Show when={it.hint}><span class="ctx-hint">{it.hint}</span></Show>
          </button>
        );
      }}</For>
    </div>
    {/* A sibling, not a child: the menu's blur would otherwise clip it */}
    <Show when={openSub()} keyed>{(s) => {
      const it = props.items[s.i] as { sub: MenuItem[] };
      return <MenuList items={it.sub} x={s.x} y={s.y} sub />;
    }}</Show>
    </>
  );
}

/** Draws menus opened in this window: the main one, or (with `win`) the call pop-out. */
export function ContextMenu(props: { win?: Window }) {
  const w = () => props.win ?? window;
  const esc = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
  const away = () => closeMenu();
  onMount(() => { const v = w(); v.addEventListener("keydown", esc); v.addEventListener("resize", away); v.addEventListener("blur", away); });
  onCleanup(() => { const v = w(); v.removeEventListener("keydown", esc); v.removeEventListener("resize", away); v.removeEventListener("blur", away); });
  return (
    <Show when={menu()?.doc === w().document ? menu() : null}>{(m) => { useBack(closeMenu); return (
      <div class="ctx-scrim" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} onWheel={closeMenu}>
        <MenuList items={m().items} x={m().x} y={m().y} width={m().width} sheet={m().sheet} head={m().head} />
      </div>
    ); }}</Show>
  );
}

/* ============================================================ toast */

const [toastMsg, setToastMsg] = createSignal<{ text: string; err?: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, err = false) {
  setToastMsg({ text, err });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setToastMsg(null), err ? 4500 : 2200);
}
export function Toast() {
  return <Show when={toastMsg()}>{(t) => <div class="toast panel" classList={{ err: !!t().err }} role="status">{t().text}</div>}</Show>;
}

export async function copy(text: string, what = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(what); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(what); } catch { toast("Couldn't copy.", true); }
    ta.remove();
  }
}

/** Runs an action and reports its error as a toast. */
export async function attempt(f: () => Promise<unknown>, done?: string) {
  try { await f(); if (done) toast(done); } catch (e) { toast(e instanceof Error && e.message ? e.message : "That didn't work.", true); }
}

/* ============================================================ dialogs (no browser alert/confirm: they block the app) */

export interface Field { key: string; label: string; type?: "text" | "password" | "email" | "url"; value?: string; placeholder?: string; max?: number; hint?: string; autocomplete?: string }
type Ask = {
  title: string; body?: string; confirm: string; danger?: boolean; fields: Field[];
  /** Alternative field sets, picked with tabs (used for "password / authenticator / recovery code") */
  modes?: { label: string; fields: Field[] }[];
  validate?(v: Record<string, string>): string | null;
  resolve(v: Record<string, string> | false, mode: number): void;
};
const [ask, setAsk] = createSignal<Ask | null>(null);

export const confirmDialog = (title: string, body: string, confirm: string, danger = false) =>
  new Promise<boolean>((resolve) => setAsk({ title, body, confirm, danger, fields: [], resolve: (v) => resolve(v !== false) }));
export const promptDialog = (title: string, label: string, confirm: string, value = "", opts: { body?: string; placeholder?: string; max?: number; danger?: boolean } = {}) =>
  new Promise<string | null>((resolve) => setAsk({ title, body: opts.body, confirm, danger: opts.danger, fields: [{ key: "v", label, value, placeholder: opts.placeholder, max: opts.max }], resolve: (v) => resolve(v === false ? null : v.v ?? "") }));
/** Several inputs at once. Resolves to the values by key, or null if cancelled. */
export const formDialog = (title: string, fields: Field[], confirm: string, opts: { body?: string; danger?: boolean; validate?(v: Record<string, string>): string | null } = {}) =>
  new Promise<Record<string, string> | null>((resolve) => setAsk({ title, confirm, fields, ...opts, resolve: (v) => resolve(v === false ? null : v) }));
/** Asks for proof before a protected account change: password, or an authenticator / recovery code. */
export const proofDialog = (title: string, body: string, confirm: string, opts: { danger?: boolean; totp?: boolean } = {}) =>
  new Promise<{ password: string } | { totp_code: string } | { recovery_code: string } | null>((resolve) => {
    const pw: Field[] = [{ key: "password", label: "Current password", type: "password", autocomplete: "current-password" }];
    const modes = [{ label: "Password", fields: pw }];
    if (opts.totp) modes.push({ label: "Authenticator", fields: [{ key: "totp_code", label: "6-digit code", placeholder: "123 456", max: 12, autocomplete: "one-time-code" }] },
      { label: "Recovery code", fields: [{ key: "recovery_code", label: "Recovery code", placeholder: "xxxxx-xxxxx", max: 20 }] });
    setAsk({ title, body, confirm, danger: opts.danger, fields: pw, modes: modes.length > 1 ? modes : undefined, resolve: (v) => {
      if (v === false) return resolve(null);
      if (v.totp_code !== undefined) return resolve({ totp_code: v.totp_code.replace(/\s/g, "") });
      if (v.recovery_code !== undefined) return resolve({ recovery_code: v.recovery_code.trim() });
      resolve({ password: v.password ?? "" });
    } });
  });

export function Dialogs() {
  return (
    <Show when={ask()}>{(a) => {
      const [mode, setMode] = createSignal(0);
      const fields = () => a().modes?.[mode()]?.fields ?? a().fields;
      const [vals, setVals] = createSignal<Record<string, string>>({});
      const [err, setErr] = createSignal("");
      const val = (f: Field) => vals()[f.key] ?? f.value ?? "";
      const done = (r: Record<string, string> | false) => { a().resolve(r, mode()); setAsk(null); };
      useBack(() => done(false));
      const submit = () => {
        const out = Object.fromEntries(fields().map((f) => [f.key, val(f)]));
        const bad = a().validate?.(out);
        if (bad) { setErr(bad); return; }
        done(out);
      };
      return (
        <div class="scrim" style={{ "z-index": 95 }} onClick={(e) => e.target === e.currentTarget && done(false)} onKeyDown={(e) => e.key === "Escape" && done(false)}>
          <form class="modal dialog" role="alertdialog" aria-label={a().title} onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <h2>{a().title}</h2>
            <Show when={a().body}><p class="muted">{a().body}</p></Show>
            <Show when={a().modes}>
              <div class="seg dialog-modes" role="radiogroup" aria-label="Verify with">
                <For each={a().modes}>{(m, i) => <button type="button" role="radio" aria-checked={mode() === i()} classList={{ on: mode() === i() }} onClick={() => { setMode(i()); setErr(""); }}>{m.label}</button>}</For>
              </div>
            </Show>
            <For each={fields()}>{(f, i) => (
              <label class="field">{f.label}
                <input type={f.type ?? "text"} value={val(f)} maxLength={f.max ?? 200} placeholder={f.placeholder} autocomplete={f.autocomplete ?? "off"}
                  onInput={(e) => { setVals({ ...vals(), [f.key]: e.currentTarget.value }); setErr(""); }} autofocus={i() === 0} />
                <Show when={f.hint}><small class="field-hint">{f.hint}</small></Show>
              </label>
            )}</For>
            <Show when={err()}><p class="err" role="alert">{err()}</p></Show>
            <div class="dialog-actions">
              <button type="button" class="btn" onClick={() => done(false)}>Cancel</button>
              <button class="btn" classList={{ primary: !a().danger, "danger-fill": !!a().danger }} autofocus={!fields().length}>{a().confirm}</button>
            </div>
          </form>
        </div>
      );
    }}</Show>
  );
}

/* ============================================================ the browser's own menu */

/**
 * Replaces the webview's default right-click menu (Reload, Inspect…) with ours.
 * Text fields keep the native menu so cut/copy/paste and spellcheck work.
 * Elements with their own menus stop the event before it gets here.
 */
/** `w`: the window to cover (the call pop-out installs it too). */
export function installGlobalContextMenu(w: Window = window) {
  w.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("input, textarea, [contenteditable=true]")) return;
    e.preventDefault();
    const sel = getSelection()?.toString() ?? "";
    const a = t.closest("a[href]") as HTMLAnchorElement | null;
    const img = t.closest("img, video") as HTMLImageElement | HTMLVideoElement | null;
    const items: MenuItem[] = [];
    if (sel.trim()) items.push({ label: "Copy", icon: "copy", onSelect: () => copy(sel) });
    if (a && /^https?:/i.test(a.href)) {
      items.push({ label: "Open link", icon: "popout", onSelect: () => { a.click(); } }, { label: "Copy link", icon: "copy", onSelect: () => copy(a.href, "Link copied") });
    }
    const src = img && ((img as HTMLImageElement).currentSrc || img.src);
    if (src && /^https?:/i.test(src)) {
      items.push({ label: "Open image", icon: "popout", onSelect: () => { const l = document.createElement("a"); l.href = src; l.target = "_blank"; l.rel = "noopener noreferrer"; l.click(); } },
        { label: "Copy image link", icon: "copy", onSelect: () => copy(src, "Link copied") });
    }
    if (items.length) openMenu(e, items);
  });
}
