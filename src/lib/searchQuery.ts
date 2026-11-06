/**
 * Search filters typed into the search box, the way Discord does it: `from:Mika has:link before:2026-10-01 hello`.
 * The filters come out of the text; what's left is the words to search for.
 */
export type SearchHas = "" | "media" | "link" | "file";
export type SearchWhen = "" | "on" | "before" | "after";
export type SearchKind = "" | "people" | "bots";
export interface SearchFilters { from: string; mentions: string; has: SearchHas; when: SearchWhen; day: string; kind: SearchKind }
export const NO_FILTERS: SearchFilters = { from: "", mentions: "", has: "", when: "", day: "", kind: "" };

/** Someone a from: or mentions: filter can name. */
export interface Named { id: string; name: string; username?: string }

/** The filters you can type, in the order the search box suggests them. */
export const FILTER_KEYS = ["from", "mentions", "has", "before", "during", "after", "authortype"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

const TOKEN = /(?:^|\s)(from|mentions|has|before|after|during|on|authortype|author|in):(?:"([^"]*)"|(\S*))/gi;

const HAS: Record<string, SearchHas> = { link: "link", links: "link", url: "link", file: "file", files: "file", attachment: "file", media: "media", image: "media", images: "media", video: "media", videos: "media", embed: "media", gif: "media", picture: "media" };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A typed day: 2026-10-01, today, yesterday, or anything Date understands. */
export function parseDay(s: string, now = new Date()): string {
  const v = s.trim().toLowerCase();
  if (!v) return "";
  if (v === "today") return iso(now);
  if (v === "yesterday") return iso(new Date(now.getTime() - 86_400_000));
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : iso(d);
}

/** Who a name in a filter means: an exact name or username first, then the first that starts with it. */
export function findNamed(people: Named[], text: string): Named | undefined {
  const t = text.trim().toLowerCase().replace(/^@/, "");
  if (!t) return undefined;
  return people.find((p) => p.name.toLowerCase() === t || p.username?.toLowerCase() === t)
    ?? people.find((p) => p.name.toLowerCase().startsWith(t) || p.username?.toLowerCase().startsWith(t));
}

/** Split typed text into the words to search for and the filters. Filters that don't match anyone are left as words. */
export function parseSearch(text: string, people: Named[]): { words: string; filters: SearchFilters } {
  const filters: SearchFilters = { ...NO_FILTERS };
  const words = text.replace(TOKEN, (whole, key: string, quoted: string | undefined, bare: string | undefined) => {
    const v = (quoted ?? bare ?? "").trim();
    const k = key.toLowerCase();
    if (!v) return " ";
    if (k === "from" || k === "mentions") {
      const p = findNamed(people, v);
      if (!p) return whole;
      filters[k] = p.id;
      return " ";
    }
    if (k === "has") { const h = HAS[v.toLowerCase()]; if (!h) return whole; filters.has = h; return " "; }
    if (k === "before" || k === "after" || k === "during" || k === "on") {
      const d = parseDay(v);
      if (!d) return whole;
      filters.when = k === "during" || k === "on" ? "on" : k;
      filters.day = d;
      return " ";
    }
    if (k === "authortype" || k === "author") {
      const t = v.toLowerCase();
      if (t.startsWith("bot")) filters.kind = "bots";
      else if (t.startsWith("user") || t.startsWith("people") || t.startsWith("person")) filters.kind = "people";
      else return whole;
      return " ";
    }
    return whole;
  });
  return { words: words.replace(/\s+/g, " ").trim(), filters };
}

/** A name as a filter value: quoted when it has a space. */
export const filterValue = (name: string) => (/\s/.test(name) ? `"${name.replace(/"/g, "")}"` : name);

/** The filter being typed at the end of the text (for suggestions), or null. */
export function typingFilter(text: string): { key: FilterKey | "on"; value: string; start: number } | null {
  const m = /(?:^|\s)(from|mentions|has|before|after|during|on|authortype):("?[^"\s]*)$/i.exec(text);
  if (!m) return null;
  return { key: m[1]!.toLowerCase() as FilterKey, value: m[2]!.replace(/^"/, ""), start: m.index + (m[0].startsWith(" ") ? 1 : 0) };
}

/** Filters written back as text for the search box (after picking them in the Filters window), words first. */
export function searchText(words: string, f: SearchFilters, nameOf: (id: string) => string): string {
  const parts = [words.trim()];
  if (f.from) parts.push(`from:${filterValue(nameOf(f.from))}`);
  if (f.mentions) parts.push(`mentions:${filterValue(nameOf(f.mentions))}`);
  if (f.has) parts.push(`has:${f.has}`);
  if (f.when && f.day) parts.push(`${f.when === "on" ? "during" : f.when}:${f.day}`);
  if (f.kind) parts.push(`authorType:${f.kind === "bots" ? "bot" : "user"}`);
  return parts.filter(Boolean).join(" ");
}

/** A finished filter shown as a box in the search bar (like Discord's), and the text it stands for. */
export interface SearchChip { key: string; value: string; raw: string }

/**
 * The search bar's text split for showing: finished filters (a value and then a space) become boxes; the rest (words,
 * and a filter still being typed) stays as text. `joinChips` puts them back together.
 */
export function splitChips(text: string): { chips: SearchChip[]; rest: string } {
  const chips: SearchChip[] = [];
  const re = /(^|\s)(from|mentions|has|before|after|during|on|authortype):(?:"([^"]+)"|([^\s"]+))(?=\s)/gi;
  const rest = text.replace(re, (_all, lead: string, key: string, quoted: string | undefined, bare: string | undefined) => {
    const value = (quoted ?? bare ?? "").trim();
    chips.push({ key: key.toLowerCase(), value, raw: `${key.toLowerCase()}:${quoted !== undefined ? `"${quoted}"` : bare}` });
    return lead;
  });
  return { chips, rest: rest.replace(/^\s+/, "").replace(/\s{2,}/g, " ") };
}
export const joinChips = (chips: SearchChip[], rest: string) => [...chips.map((c) => c.raw), rest].filter((x, i, a) => x || i === a.length - 1).join(" ").replace(/^\s+/, "");
