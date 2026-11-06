/**
 * Tooltips in Mustela's style instead of the system's plain ones (computers only): hover anything with a title and,
 * after a moment, a small rounded label with an arrow appears above it (below when there's no room), like Discord's.
 * The title is moved to data-tip on first hover so the system's own tooltip doesn't show as well.
 */
let tip: HTMLDivElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let current: HTMLElement | null = null;

function hide() {
  clearTimeout(timer);
  current = null;
  if (tip) tip.classList.remove("on");
}

function show(el: HTMLElement) {
  const text = el.dataset.tip;
  if (!text || !el.isConnected) return;
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "m-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  tip.classList.remove("below", "on");
  const r = el.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const below = r.top - t.height - 10 < 4;
  const left = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + 9 : r.top - t.height - 9}px`;
  tip.style.setProperty("--arrow", `${Math.max(10, Math.min(t.width - 10, r.left + r.width / 2 - left))}px`);
  tip.classList.toggle("below", below);
  requestAnimationFrame(() => tip?.classList.add("on"));
}

export function installTooltips(w: Window = window) {
  if (!w.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  w.document.addEventListener("mouseover", (e) => {
    const el = (e.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
    if (el === current) return;
    hide();
    if (!el || el.closest(".m-tip")) return;
    const title = el.getAttribute("title");
    if (title) {
      el.dataset.tip = title;
      el.removeAttribute("title");
      // Screen readers keep the name the title gave a button that has no other label.
      if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title);
    }
    if (!el.dataset.tip) return;
    current = el;
    timer = setTimeout(() => current === el && show(el), 420);
  }, true);
  for (const ev of ["mousedown", "keydown", "wheel", "blur"] as const) w.addEventListener(ev, hide, true);
  w.document.addEventListener("mouseleave", hide);
}
