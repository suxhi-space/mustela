/**
 * Stoat-flavoured markdown -> a small AST. Rendering happens in the UI by
 * building DOM nodes from this tree, never with innerHTML, so message text
 * can't inject markup. Link targets are limited to http(s) and mailto.
 *
 * Supported (the subset Stoat clients render):
 *   blocks:  paragraphs, ```code fences```, > quotes, # headings (1-3), - / 1. lists
 *   inline:  **bold** __bold__ *italic* _italic_ ~~strike~~ `code` ||spoiler||
 *            [label](https://url) bare https:// links  <@user> <#channel> <%role>
 *            :custom_emoji_id: :shortcode: <t:unix:style> timestamps, line breaks
 */
import { shortcodeToEmoji } from "./emoji";

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "b" | "i" | "s" | "spoiler"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "user" | "channel" | "role"; id: string }
  | { t: "emoji"; id: string }
  | { t: "time"; unix: number; style: string };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "pre"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "h"; level: 1 | 2 | 3; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Inline[][] };

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX_DEPTH = 6;

export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.href : null;
  } catch {
    return null;
  }
}

/* ---------------- blocks ---------------- */

export function parse(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ t: "p", c: inline(para.join("\n"), depth) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^\s*```(\w*)\s*$/.exec(line) ?? /^\s*```(\w*)(.*)$/.exec(line);
    if (fence) {
      // Find the closing fence. Without one, treat the line as text.
      const rest = fence[2] ?? "";
      if (rest.includes("```")) {
        flush();
        out.push({ t: "pre", lang: "", v: (fence[1] ?? "") + rest.slice(0, rest.indexOf("```")) });
        continue;
      }
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j]!)) j++;
      if (j < lines.length) {
        flush();
        const body = [rest, ...lines.slice(i + 1, j)].filter((x, k) => k > 0 || x !== "").join("\n");
        out.push({ t: "pre", lang: fence[1] ?? "", v: body });
        i = j;
        continue;
      }
    }
    if (/^>\s?/.test(line) && depth < MAX_DEPTH) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) q.push(lines[i++]!.replace(/^>\s?/, ""));
      i--;
      out.push({ t: "quote", c: parse(q.join("\n"), depth + 1) });
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      flush();
      out.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, c: inline(h[2]!, depth) });
      continue;
    }
    const li = /^\s*(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/.exec(line);
    if (li) {
      flush();
      const ordered = !!li[2];
      const items: Inline[][] = [];
      const start = ordered ? Number(li[2]) : 1;
      while (i < lines.length) {
        const m = /^\s*(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m || !!m[2] !== ordered) break;
        items.push(inline(m[3]!, depth));
        i++;
      }
      i--;
      out.push({ t: "list", ordered, start, items });
      continue;
    }
    if (line.trim() === "") { flush(); continue; }
    para.push(line);
  }
  flush();
  return out;
}

/* ---------------- inline ---------------- */

const PAIRS: [string, "b" | "i" | "s" | "spoiler"][] = [
  ["**", "b"], ["__", "b"], ["~~", "s"], ["||", "spoiler"], ["*", "i"], ["_", "i"],
];

export function inline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const text = () => { if (buf) { pushText(out, buf); buf = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);

    if (ch === "\\" && i + 1 < src.length && /[\\*_~`|<>:\[\]#-]/.test(src[i + 1]!)) { buf += src[i + 1]; i += 2; continue; }
    if (ch === "\n") { text(); out.push({ t: "br" }); i++; continue; }

    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { text(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }

    if (ch === "<") {
      const m = /^<([@#%])([0-9A-Za-z]{1,32})>/.exec(rest);
      if (m) { text(); out.push({ t: m[1] === "@" ? "user" : m[1] === "#" ? "channel" : "role", id: m[2]! }); i += m[0].length; continue; }
      const tm = /^<t:(-?\d{1,12})(?::([tTdDfFR]))?>/.exec(rest);
      if (tm) { text(); out.push({ t: "time", unix: Number(tm[1]), style: tm[2] ?? "f" }); i += tm[0].length; continue; }
      const al = /^<(https?:\/\/[^\s>]+)>/.exec(rest); // <url> = link without embed
      if (al && safeHref(al[1]!)) { text(); out.push({ t: "link", href: safeHref(al[1]!)!, c: [{ t: "text", v: al[1]! }] }); i += al[0].length; continue; }
    }

    if (ch === ":") {
      const m = /^:([a-zA-Z0-9_+-]{1,32}):/.exec(rest);
      if (m) {
        if (ULID.test(m[1]!)) { text(); out.push({ t: "emoji", id: m[1]! }); i += m[0].length; continue; }
        const u = shortcodeToEmoji(m[1]!);
        if (u) { buf += u; i += m[0].length; continue; }
      }
    }

    if (ch === "[" && depth < MAX_DEPTH) {
      const m = /^\[([^\]\n]{1,300})\]\(((?:[^()\s]|\([^()\s]*\)){1,2000})\)/.exec(rest);
      const href = m ? safeHref(m[2]!) : null;
      if (m && href) { text(); out.push({ t: "link", href, c: inline(m[1]!, depth + 1) }); i += m[0].length; continue; }
    }

    if ((ch === "h" || ch === "H") && /^https?:\/\//i.test(rest)) {
      let url = /^https?:\/\/[^\s<]+/i.exec(rest)![0];
      const count = (c: string) => url.split(c).length - 1;
      // Trailing punctuation belongs to the sentence, and a ")" only belongs to the URL if it closes a "(" in it.
      while (/[.,!?;:'"\]]$/.test(url) || (url.endsWith(")") && count("(") < count(")"))) url = url.slice(0, -1);
      const prev = src[i - 1];
      const href = safeHref(url);
      if (href && (prev === undefined || /[\s(<]/.test(prev))) { text(); out.push({ t: "link", href, c: [{ t: "text", v: url }] }); i += url.length; continue; }
    }

    if (depth < MAX_DEPTH) {
      let matched = false;
      for (const [d, t] of PAIRS) {
        if (!rest.startsWith(d)) continue;
        const after = src[i + d.length];
        if (after === undefined || /\s/.test(after)) continue; // "a * b" is not emphasis
        if (d.length === 1 && d === "_" && /\w/.test(src[i - 1] ?? "")) continue; // snake_case_words
        const end = findClose(src, i + d.length, d);
        if (end < 0) continue;
        text();
        out.push({ t, c: inline(src.slice(i + d.length, end), depth + 1) });
        i = end + d.length;
        matched = true;
        break;
      }
      if (matched) continue;
    }

    buf += ch;
    i++;
  }
  text();
  return out;
}

/** Index of the closing delimiter, skipping code spans; -1 if none. */
function findClose(src: string, from: number, d: string): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\\") { j++; continue; }
    if (src[j] === "`") { const e = src.indexOf("`", j + 1); if (e > 0) { j = e; continue; } }
    if (src[j] === "\n" && src[j + 1] === "\n") return -1;
    if (d.length === 1 && src[j] === d && src[j + 1] === d) { j++; continue; } // "**" inside "*...*" belongs to bold
    if (src.startsWith(d, j) && j > from && !/\s/.test(src[j - 1]!)) {
      if (d === "_" && /\w/.test(src[j + 1] ?? "")) continue;
      return j;
    }
  }
  return -1;
}

function pushText(out: Inline[], v: string) {
  const last = out[out.length - 1];
  if (last && last.t === "text") last.v += v;
  else out.push({ t: "text", v });
}

/* ---------------- helpers ---------------- */

const EMOJI_ONLY = /^(?:\s|\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|:[0-9A-HJKMNP-TV-Z]{26}:|:[a-z0-9_+-]{1,32}:)+$/u;

/** Messages made only of emoji (up to ~27) are shown large, like Stoat and Discord. */
export function isJumbo(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 200 || !EMOJI_ONLY.test(t)) return false;
  const tokens = t.match(/:[A-Za-z0-9_+-]{1,32}:|\p{Extended_Pictographic}/gu) ?? [];
  if (!tokens.length || tokens.length > 27) return false;
  return tokens.every((x) => !x.startsWith(":") || ULID.test(x.slice(1, -1)) || shortcodeToEmoji(x.slice(1, -1)) !== null);
}

/** Plain text for notifications and reply previews: markup removed, ids resolved. */
export function plain(text: string, names: { user?(id: string): string; channel?(id: string): string | undefined } = {}): string {
  const walk = (n: Inline[]): string => n.map((x) => {
    switch (x.t) {
      case "text": case "code": return x.v;
      case "br": return " ";
      case "user": return "@" + (names.user?.(x.id) ?? "user");
      case "channel": return "#" + (names.channel?.(x.id) ?? "channel");
      case "role": return "@role";
      case "emoji": return ":emoji:";
      case "time": return new Date(x.unix * 1000).toLocaleString();
      case "spoiler": return "▒▒▒";
      default: return walk(x.c);
    }
  }).join("");
  return parse(text).map((b) => {
    switch (b.t) {
      case "p": case "h": return walk(b.c);
      case "pre": return b.v;
      case "quote": return b.c.map((q) => (q.t === "p" ? walk(q.c) : "")).join(" ");
      case "list": return b.items.map(walk).join(", ");
    }
  }).join(" ").replace(/\s+/g, " ").trim();
}

/** Formats a <t:unix:style> timestamp the way Stoat/Discord do. */
export function formatTime(unix: number, style: string, now = Date.now()): string {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  switch (style) {
    case "t": return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    case "T": return d.toLocaleTimeString();
    case "d": return d.toLocaleDateString();
    case "D": return d.toLocaleDateString([], { dateStyle: "long" });
    case "F": return d.toLocaleString([], { dateStyle: "full", timeStyle: "short" });
    case "R": {
      const s = Math.round((d.getTime() - now) / 1000);
      const abs = Math.abs(s);
      const rtf = new Intl.RelativeTimeFormat([], { numeric: "auto" });
      if (abs < 60) return rtf.format(s, "second");
      if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
      if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
      if (abs < 2592000) return rtf.format(Math.round(s / 86400), "day");
      if (abs < 31536000) return rtf.format(Math.round(s / 2592000), "month");
      return rtf.format(Math.round(s / 31536000), "year");
    }
    default: return d.toLocaleString([], { dateStyle: "long", timeStyle: "short" });
  }
}
