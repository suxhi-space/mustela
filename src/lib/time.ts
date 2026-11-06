/**
 * Time and date display following Settings > Language. Kept free of UI
 * imports: the active preference is pushed in with setTimePrefs().
 */
export interface TimePrefs { time: "auto" | "12" | "24"; date: "auto" | "us" | "eu" | "iso" }
let prefs: TimePrefs = { time: "auto", date: "auto" };
export const setTimePrefs = (p: TimePrefs) => { prefs = p; fmts.clear(); };

// Making a formatter is slow (toLocaleTimeString builds a new one on every call, and every message shows a time):
// make each kind once and reuse it.
const fmts = new Map<string, Intl.DateTimeFormat>();
const fmt = (key: string, o: Intl.DateTimeFormatOptions) => {
  let f = fmts.get(key);
  if (!f) { f = new Intl.DateTimeFormat(undefined, o); fmts.set(key, f); }
  return f;
};

const hour12 = () => (prefs.time === "auto" ? undefined : prefs.time === "12");

export function fmtTime(d: Date, seconds = false) {
  return fmt(`t${seconds ? "s" : ""}`, { hour: "numeric", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: hour12() }).format(d);
}

/** Short numeric date: 10/24/2026, 24/10/2026 or 2026-10-24. */
export function fmtDate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  if (prefs.date === "iso") return `${y}-${m}-${day}`;
  if (prefs.date === "us") return `${d.getMonth() + 1}/${d.getDate()}/${y}`;
  if (prefs.date === "eu") return `${day}/${m}/${y}`;
  return fmt("d", {}).format(d);
}

/** "Today at 3:04 PM", "Yesterday at…", or the date. */
export function fmtStamp(d: Date) {
  const today = new Date(), y = new Date(Date.now() - 86_400_000);
  const day = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === y.toDateString() ? "Yesterday" : fmtDate(d);
  return `${day} at ${fmtTime(d)}`;
}
