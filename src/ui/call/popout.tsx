import { DelegatedEvents, delegateEvents, render } from "solid-js/web";
import { inTauri } from "../../lib/platform";
import { installGlobalContextMenu } from "../menu";
import { CallWindow } from "./CallWindow";
import { setPopped } from "./state";

/**
 * The call pop-out, the way Discord and Vesktop do it: this window opens a second one with
 * window.open and draws the call into it. The call (LiveKit, microphone, screen share) never
 * leaves this window, so popping out and back in doesn't reconnect, and nobody sees you leave.
 *
 * On desktop the shell makes the new window frameless (src-tauri/src/lib.rs, popout_window);
 * in a browser it's an ordinary pop-up.
 */
let win: Window | null = null;
let dispose: (() => void) | null = null;
let watch: ReturnType<typeof setInterval> | undefined;
let attrs: MutationObserver | null = null;

/**
 * The pop-out shows the main window's look: same styles, theme and colours. Everything is handed
 * over as text and bytes rather than links: on Windows the pop-out is WebView2's own window,
 * which can't load the app's files by address.
 */
function dress(d: Document, w: Window) {
  d.title = "Mustela call";
  const head = d.head;
  head.replaceChildren();
  const meta = d.createElement("meta"); meta.setAttribute("charset", "utf-8"); head.append(meta);
  const css: string[] = [];
  const faces: CSSFontFaceRule[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of rules) {
      if (r instanceof CSSFontFaceRule) faces.push(r);
      else if (r instanceof CSSImportRule && r.styleSheet) walk(r.styleSheet.cssRules);
      else css.push(r.cssText);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* not ours */ } }
  const style = d.createElement("style"); style.textContent = css.join("\n"); head.append(style);
  void loadFonts(faces, w);
  const copy = () => {
    const to = d.documentElement, from = document.documentElement;
    for (const a of [...to.attributes]) to.removeAttribute(a.name);
    for (const a of from.attributes) if (a.name !== "data-material" && a.name !== "data-titlebar") to.setAttribute(a.name, a.value);
    to.dataset.popout = "";
  };
  copy();
  attrs?.disconnect();
  attrs = new MutationObserver(copy);
  attrs.observe(document.documentElement, { attributes: true });
}

/** The fonts the main window has actually loaded, given to the pop-out from their bytes. */
async function loadFonts(faces: CSSFontFaceRule[], w: Window) {
  // Families in use here (each comes in a few small character-set files; the pop-out gets them all).
  const clean = (f: string) => f.replace(/["']/g, "").trim();
  const want = new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => clean(f.family)));
  for (const r of faces) {
    const st = r.style;
    const family = st.getPropertyValue("font-family").trim(), weight = st.getPropertyValue("font-weight").trim() || "normal";
    const fstyle = st.getPropertyValue("font-style").trim() || "normal", range = st.getPropertyValue("unicode-range").trim() || "U+0-10FFFF";
    if (!want.has(clean(family))) continue;
    const url = /url\(["']?([^"')]+)["']?\)/.exec(st.getPropertyValue("src"))?.[1];
    if (!url) continue;
    try {
      const bytes = await (await fetch(new URL(url, r.parentStyleSheet?.href ?? location.href))).arrayBuffer();
      const Face = (w as unknown as typeof globalThis).FontFace;
      const face = new Face(family.replace(/["']/g, ""), bytes, { weight, style: fstyle, unicodeRange: range });
      await face.load();
      (w.document.fonts as unknown as { add(f: FontFace): void }).add(face);
    } catch { /* the pop-out falls back to a system font */ }
  }
}

/** Draws the call into the pop-out's page (again, if the window replaced its blank page after opening). */
function mount(w: Window) {
  const d = w.document;
  if (d.getElementById("mustela-popout")) return;
  dispose?.();
  dress(d, w);
  d.body.replaceChildren();
  const root = d.createElement("div");
  root.id = "mustela-popout";
  d.body.append(root);
  // Solid listens for clicks and the like on the document; the pop-out is another document.
  delegateEvents([...DelegatedEvents], d);
  if (!(w as any).__mustelaMenu) { (w as any).__mustelaMenu = true; installGlobalContextMenu(w); }
  dispose = render(() => <CallWindow win={w} />, root);
}

function cleanup() {
  clearInterval(watch); watch = undefined;
  attrs?.disconnect(); attrs = null;
  dispose?.(); dispose = null;
  win = null;
  setPopped(false);
}

export async function showPopout() {
  if (win && !win.closed) { win.focus(); return; }
  const w = window.open("about:blank", "mustela-call", "popup,width=800,height=500");
  if (!w) throw new Error("The call window was blocked.");
  win = w;
  setPopped(true);
  try { mount(w); } catch { /* the window isn't ready yet: the check below draws it */ }
  // A new window can swap in its own blank page just after opening: draw again if so.
  let checks = 0;
  watch = setInterval(() => {
    if (!win || win.closed) return cleanup();
    if (++checks < 40) { try { mount(win); } catch { /* not ready yet */ } }
    // Still nothing drawn after a few seconds: close it rather than leave an empty window.
    else if (checks === 40) { let ok = false; try { ok = !!win.document.getElementById("mustela-popout"); } catch { /* not ours */ } if (!ok) void hidePopout(); }
  }, 100);
  w.addEventListener("pagehide", () => setTimeout(() => { if (!win || win.closed) cleanup(); }, 0));
}

export async function hidePopout() {
  const w = win;
  cleanup();
  try { w?.close(); } catch { /* already gone */ }
  // Desktop: make sure the shell's window goes too, and the main window comes forward.
  if (inTauri()) {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("close_popout"); } catch { /* fine */ }
  }
}
