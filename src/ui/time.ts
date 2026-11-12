/** How long ago, short like Discord's search results: now, 5m, 3h, 25d, 3mo, 2y. */
export function shortAgo(d: Date, now = Date.now()) {
  const s = Math.max(0, (now - d.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30.44)}mo`;
  return `${Math.floor(days / 365.25)}y`;
}
