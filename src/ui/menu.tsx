import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { dragToClose } from "./sheetDrag";
import { useBack } from "./back";
import { justHeld } from "./hold";
import { Icon } from "./icons";

/* ============================================================ context menus */

export type MenuItem =
  | { label: string; icon?: string; danger?: boolean; disabled?: boolean; checked?: boolean; hint?: string; onSelect(): unknown; sub?: undefined }
  | { label: string; icon?: string; hint?: string; sub: MenuItem[] }
  | { sep: true }
  | { header: string }
  | { custom: () => JSX.Element };

/** `doc`: the window it was opened in (the call pop-out draws its own menus). */
type Open = { x: number; y: number; items: MenuItem[]; doc: Document; width?: number; sheet?: boolean; head?: () => JSX.Element; held?: HTMLElement; grouped?: boolean; bottom?: number };
const [menu, setMenu] = createSignal<Open | null>(null);

/** Opens a menu at the pointer (or under an element). Returns false so it can end an event handler. */
/** `width`: at least this wide (a dropdown's menu matches its button). */
/** `sheet`: phones, a card that comes up from the bottom (with `head` drawn at its top) instead of a small menu. */
/**
 * `held` (a card on touch screens): the message it's about. The card pushes the chat up instead of covering it, so
 * that message stays in view, highlighted, and its text can still be selected with the phone's own handles.
 * `grouped`: in a card, the rows between separators sit together in rounded blocks.
 */
/** `above`: open fully above this element (the mic and speaker menus stay clear of the nameplate). */
export function openMenu(at: MouseEvent | Element, items: MenuItem[], opts: { width?: number; sheet?: boolean; head?: () => JSX.Element; held?: HTMLElement; grouped?: boolean; above?: Element | null } = {}) {
  const clean = items.filter((it, i, a) => !("sep" in it) || (i > 0 && i < a.length - 1 && !("sep" in a[i - 1]!)));
  // Touch screens: every menu (hold menus, dropdowns) is a card from the bottom with big rows.
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const sheet = opts.sheet ?? touch;
  const extra = { sheet, head: opts.head, held: sheet ? opts.held : undefined, grouped: sheet && (opts.grouped ?? true), bottom: opts.above && !sheet ? opts.above.getBoundingClientRect().top - 6 : undefined };
  // Only a menu opened by touching and holding needs the lifted finger ignored; a mouse click right away is fine.
  const touched = justHeld() || (!("getBoundingClientRect" in at) && (at as PointerEvent).pointerType === "touch");
  openedAt = touched ? Date.now() : 0;
  if ("getBoundingClientRect" in at) { const r = at.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, items: clean, doc: at.ownerDocument, width: opts.width, ...extra }); }
  else { at.preventDefault(); at.stopPropagation(); setMenu({ x: at.clientX, y: at.clientY, items: clean, doc: (at.target as Node | null)?.ownerDocument ?? document, ...extra }); }
  return false;
}
export const closeMenu = () => setMenu(null);
/** The message a hold menu is open for (holding it again then selects text instead of reopening the menu). */
export const heldElement = () => menu()?.held ?? null;
/**
 * A menu opened by touching and holding: lifting the finger sends a tap to whatever is under it, which closed the
 * menu straight away (or picked a row). Taps in the first moment after a menu opens are ignored.
 */
let openedAt = 0;
const tooSoon = () => Date.now() - openedAt < 450;

function MenuList(props: { items: MenuItem[]; x: number; y: number; sub?: boolean; width?: number; sheet?: boolean; head?: () => JSX.Element; held?: boolean; grouped?: boolean; bottom?: number }) {
  let el!: HTMLDivElement;
  const [pos, setPos] = createSignal({ left: props.x, top: props.y });
  const [openSub, setOpenSub] = createSignal<{ i: number; x: number; y: number } | null>(null);
  onMount(() => {
    // Keep the menu on screen: flip left/up when it would overflow.
    const r = el.getBoundingClientRect();
    const { innerWidth, innerHeight } = el.ownerDocument.defaultView ?? window;
    let left = props.x, top = props.y;
    if (left + r.width > innerWidth - 8) left = props.sub ? props.x - r.width - 220 : innerWidth - r.width - 8;
    if (props.bottom !== undefined) top = Math.max(8, props.bottom - r.height);
    else if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    setPos({ left: Math.max(8, left), top });
    // Keyboard users start on the first row. Cards (touch) don't: focusing a row lit it up as if picked and
    // scrolled the card back to its top.
    if (!props.sub && !props.sheet) (el.querySelector(".ctx-item:not([disabled])") as HTMLElement | null)?.focus({ focusVisible: false } as FocusOptions);
    // Every card opens halfway at most, like the message one; pulling up opens the rest.
    if (props.sheet) dragToClose(el, closeMenu, { half: true });
  });
  const keys = (e: KeyboardEvent) => {
    const btns = [...el.querySelectorAll<HTMLButtonElement>("button.ctx-item:not([disabled])")];
    const i = btns.indexOf(el.ownerDocument.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  const row = (it: MenuItem, i: () => number): JSX.Element => {
      if ("sep" in it) return <div class="ctx-sep" role="separator" />;
      if ("header" in it) return <div class="ctx-head">{it.header}</div>;
      if ("custom" in it) return it.custom();
      if (it.sub) return (
        <button role="menuitem" aria-haspopup="menu" class="ctx-item" onMouseEnter={(e) => { if (props.sheet) return; const r = e.currentTarget.getBoundingClientRect(); setOpenSub({ i: i(), x: r.right + 2, y: r.top - 6 }); }}
          onClick={(e) => {
            // In a card, a submenu replaces the card's rows (with its name on top) instead of opening beside it.
            if (props.sheet) { const sub = it.sub!; setMenu((m) => (m ? { ...m, head: undefined, items: [{ header: it.label }, ...sub] } : m)); return; }
            const r = e.currentTarget.getBoundingClientRect(); setOpenSub({ i: i(), x: r.right + 2, y: r.top - 6 });
          }}>
          <Show when={it.icon}><Icon name={it.icon!} size={16} /></Show>
          {/* With a hint (the device in use, say), it sits under the name, like Discord's "Input Device / Microphone". */}
          <Show when={it.hint} fallback={<span class="ctx-label">{it.label}</span>}><span class="ctx-label ctx-stack">{it.label}<small>{it.hint}</small></span></Show>
          <Icon name="right" size={14} class="muted" />
        </button>
      );
      return (
        <button role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} class="ctx-item" classList={{ danger: !!it.danger }} disabled={it.disabled}
          onMouseEnter={() => setOpenSub(null)}
          onClick={() => { if (tooSoon()) return; closeMenu(); void it.onSelect(); }}>
          <Show when={it.icon} fallback={<Show when={it.checked !== undefined}><span class="ctx-check">{it.checked ? "✓" : ""}</span></Show>}><Icon name={it.icon!} size={16} /></Show>
          <span class="ctx-label">{it.label}</span>
          <Show when={it.hint}><span class="ctx-hint">{it.hint}</span></Show>
          {/* In a card, choices show as radio buttons on the right */}
          <Show when={props.sheet && it.checked !== undefined && it.icon}><span class="ctx-radio" classList={{ on: !!it.checked }} aria-hidden="true" /></Show>
        </button>
      );
  };
  return (
    <>
    <div ref={el} class="ctx panel" classList={{ "ctx-sheet": !!props.sheet, "ctx-held": !!props.held, "ctx-grouped": !!props.grouped }} role="menu" style={props.sheet ? {} : { left: `${pos().left}px`, top: `${pos().top}px`, ...(props.width ? { "min-width": `${props.width}px`, "max-width": `${Math.max(280, props.width)}px` } : {}) }} onKeyDown={keys} onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}>
      <Show when={props.sheet}><span class="ctx-grab" aria-hidden="true" /></Show>
      <Show when={props.head}>{(h) => h()()}</Show>
      <Show when={props.grouped} fallback={<For each={props.items}>{(it, i) => row(it, i)}</For>}>
        {/* Rounded blocks, one per run of rows between separators (a custom row, like the reactions, stays on its own). */}
        <For each={groupsOf(props.items)}>{(g) => (
          <div class="ctx-group" classList={{ plain: g.every(({ it }) => "custom" in it || "header" in it) }}>
            <For each={g}>{({ it, i }) => row(it, () => i)}</For>
          </div>
        )}</For>
      </Show>
    </div>
    {/* A sibling, not a child: the menu's blur would otherwise clip it */}
    <Show when={openSub()} keyed>{(s) => {
      const it = props.items[s.i] as { sub: MenuItem[] };
      return <MenuList items={it.sub} x={s.x} y={s.y} sub />;
    }}</Show>
    </>
  );
}

/** Rows split at separators, each with its place in the full list. */
function groupsOf(items: MenuItem[]) {
  const out: { it: MenuItem; i: number }[][] = [[]];
  items.forEach((it, i) => { if ("sep" in it) { if (out[out.length - 1]!.length) out.push([]); } else out[out.length - 1]!.push({ it, i }); });
  return out.filter((g) => g.length);
}

/**
 * A hold menu about a message: highlights it, makes room under the chat for the card (so the chat moves up instead
 * of being covered) and scrolls the message into view just above it. Taps elsewhere close the card; the message
 * itself stays live, so holding its text selects it with the phone's own handles and copy menu.
 */
function useHeld(held: HTMLElement, doc: Document) {
  const root = doc.documentElement;
  held.classList.add("held");
  let card: HTMLElement | null = null, pad = 0;
  // Lift the message just above the card (or to the top of the chat if it's taller than the room left), adding
  // only as much room under the chat as that needs: none when it's already in view.
  const fit = () => {
    card ??= doc.querySelector<HTMLElement>(".ctx.ctx-held");
    const list = held.closest<HTMLElement>(".messages");
    if (!card || !list) return;
    // Where the card's top ends up (measured without its slide-in, which moves it while it opens).
    const view = doc.defaultView ?? window;
    const room = view.innerHeight - card.getBoundingClientRect().height - 12;
    const top = list.getBoundingClientRect().top, r = held.getBoundingClientRect();
    const shift = r.height > room - top ? r.top - top - 8 : r.bottom - room;
    if (shift <= 0) return;
    const below = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (shift > below) { pad += Math.ceil(shift - below); root.style.setProperty("--hold-h", `${pad}px`); }
    list.scrollBy({ top: shift, behavior: "smooth" });
  };
  root.classList.add("hold-open");
  const ro = new ResizeObserver(() => fit());
  requestAnimationFrame(() => { fit(); if (card) ro.observe(card); });
  const away = (e: Event) => {
    const t = e.target as Node;
    if (card?.contains(t) || held.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    if (!tooSoon()) closeMenu();
  };
  doc.addEventListener("click", away, true);
  onCleanup(() => {
    ro.disconnect(); doc.removeEventListener("click", away, true);
    held.classList.remove("held"); root.classList.remove("hold-open"); root.style.removeProperty("--hold-h");
  });
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
      <Show when={m().held} keyed fallback={
        <div class="ctx-scrim" onClick={() => { if (!tooSoon()) closeMenu(); }} onContextMenu={(e) => { e.preventDefault(); if (!tooSoon()) closeMenu(); }} onWheel={closeMenu}>
          <MenuList items={m().items} x={m().x} y={m().y} width={m().width} sheet={m().sheet} head={m().head} grouped={m().grouped} bottom={m().bottom} />
        </div>
      }>{(held) => { useHeld(held, m().doc); return (
        // No dark cover: the chat stays live above the card (see useHeld).
        <div class="ctx-scrim held-scrim">
          <MenuList items={m().items} x={m().x} y={m().y} sheet head={m().head} held grouped={m().grouped} />
        </div>
      ); }}</Show>
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
/** The picture's bytes, through the app when it can (no cross-site limits there), else the web. */
async function imageBlob(url: string): Promise<Blob> {
  if ("__TAURI_INTERNALS__" in globalThis) {
    const { invoke } = await import("@tauri-apps/api/core");
    const buf = await invoke<ArrayBuffer>("fetch_image", { url });
    return new Blob([buf]);
  }
  return (await fetch(url)).blob();
}

/** Copy image: the picture itself on the clipboard (as PNG, which every app pastes). */
async function copyImage(url: string) {
  try {
    const bmp = await createImageBitmap(await imageBlob(url));
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    const png = await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("no image"))), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("Image copied");
  } catch { toast("Couldn't copy that picture.", true); }
}

/** Save image as…: the system's save window on computers; Downloads on Android. */
async function saveImage(url: string, name: string) {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    if (/Android/i.test(navigator.userAgent)) { await invoke("plugin:mustela-native|media_file", { payload: { url, name, share: false } }); toast("Saving to Downloads…"); return; }
    if ("__TAURI_INTERNALS__" in globalThis) { if (await invoke<boolean>("save_image", { url, name })) toast("Saved"); return; }
  } catch (e) { toast(String((e as Error)?.message ?? e) || "Couldn't save it.", true); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(await imageBlob(url)); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** `w`: the window to cover (the call pop-out installs it too). */
export function installGlobalContextMenu(w: Window = window) {
  w.addEventListener("contextmenu", (e) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("input, textarea, [contenteditable=true]")) return;
    // Holding the message a hold card is open for: the phone selects its text with its own handles and Copy/Share
    // bar. Cancelling here (as for everything else) stopped that from ever starting.
    if (heldElement()?.contains(t)) return;
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
      const isImg = img instanceof HTMLImageElement;
      const name = (() => { try { return decodeURIComponent(new URL(src).pathname.split("/").pop() || "") || "image"; } catch { return "image"; } })();
      if (isImg && !/Android/i.test(navigator.userAgent)) items.push({ label: "Copy image", icon: "copy", onSelect: () => void copyImage(src) });
      if (isImg) items.push({ label: /Android/i.test(navigator.userAgent) ? "Save image" : "Save image as…", icon: "download", onSelect: () => void saveImage(src, /\.\w{2,5}$/.test(name) ? name : `${name}.png`) });
      items.push({ label: "Copy image link", icon: "link", onSelect: () => copy(src, "Link copied") },
        { label: "Open image link", icon: "popout", onSelect: () => { const l = document.createElement("a"); l.href = src; l.target = "_blank"; l.rel = "noopener noreferrer"; l.click(); } });
    }
    if (items.length) openMenu(e, items);
  });
}
