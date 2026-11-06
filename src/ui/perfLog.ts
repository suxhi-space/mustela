/**
 * A record of the app freezing, for Settings > Advanced > "Copy performance report". Any time the screen can't
 * update for more than a tenth of a second while you're looking at it, the length and what was going on at the
 * time are kept (the last 60). Nothing leaves the device unless you copy the report.
 *
 * Measured with animation frames rather than the browser's long-task reports, so it works the same on every
 * platform (Windows, macOS, Linux and Android web views).
 */
type Freeze = { at: number; ms: number; where: string; events: number; nodes: number };

const freezes: Freeze[] = [];
const eventTimes: number[] = [];
let where = () => "";
let started = false;

/** Say what's on screen, for the report (the shell sets this). */
export function setPerfWhere(f: () => string) { where = f; }

/** Count a chat event (a message, an update): how busy things were is part of the report. */
export function perfEvent() {
  const now = performance.now();
  eventTimes.push(now);
  if (eventTimes.length > 400) eventTimes.splice(0, eventTimes.length - 400);
}
const eventsLast5s = () => { const since = performance.now() - 5000; return eventTimes.filter((t) => t >= since).length; };

export function startPerfLog() {
  if (started || typeof requestAnimationFrame !== "function") return;
  started = true;
  let last = 0;
  const frame = (t: number) => {
    // Frames stop while the app is hidden: that isn't a freeze.
    if (last && document.visibilityState === "visible") {
      const gap = t - last;
      if (gap > 100) {
        let w = "";
        try { w = where(); } catch { /* best effort */ }
        freezes.push({ at: Date.now(), ms: Math.round(gap), where: w, events: eventsLast5s(), nodes: document.getElementsByTagName("*").length });
        if (freezes.length > 60) freezes.shift();
      }
    }
    last = document.visibilityState === "visible" ? t : 0;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener("visibilitychange", () => { last = 0; });
}

/** The report: a summary, then each freeze, newest first. */
export function perfReport(header: string) {
  const total = freezes.reduce((a, f) => a + f.ms, 0);
  const worst = freezes.reduce((a, f) => Math.max(a, f.ms), 0);
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const lines = [
    header,
    `Freezes over 100ms: ${freezes.length} (total ${total}ms, worst ${worst}ms)`,
    `Chat events in the last 5s: ${eventsLast5s()}`,
    mem ? `Memory in use: ${Math.round(mem.usedJSHeapSize / 1048576)} MB` : "",
    `Page elements now: ${document.getElementsByTagName("*").length}`,
    "",
    ...[...freezes].reverse().map((f) => `${new Date(f.at).toLocaleTimeString()}  ${String(f.ms).padStart(5)}ms  events/5s ${String(f.events).padStart(3)}  elements ${f.nodes}  ${f.where}`),
  ];
  return lines.filter((l, i) => l || i > 3).join("\n");
}
