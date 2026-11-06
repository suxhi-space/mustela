/** The quick choices, like Discord's: in an hour, tonight, tomorrow morning… */
export function quickTimes(now = new Date()): { label: string; at: number }[] {
  const at = (h: number, m = 0, dayOffset = 0) => { const d = new Date(now); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.getTime(); };
  const out = [
    { label: "In 30 minutes", at: now.getTime() + 30 * 60_000 },
    { label: "In 1 hour", at: now.getTime() + 60 * 60_000 },
    { label: "In 3 hours", at: now.getTime() + 3 * 60 * 60_000 },
  ];
  if (now.getHours() < 18) out.push({ label: "Tonight at 8 PM", at: at(20) });
  out.push({ label: "Tomorrow at 9 AM", at: at(9, 0, 1) });
  return out;
}
