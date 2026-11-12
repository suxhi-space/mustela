const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Settings search: every word typed has to start a word in `text` ("in vol" finds "Input volume"), and a plural
 * finds the singular ("sounds" finds "Sound"). Empty searches match nothing.
 */
export function searchHit(query: string, text: string): boolean {
  const qs = words(query);
  if (!qs.length) return false;
  const hs = words(text);
  return qs.every((q) => hs.some((h) => h.startsWith(q) || (q.length > 3 && q.endsWith("s") && h.startsWith(q.slice(0, -1)))));
}
