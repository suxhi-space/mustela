/** Plain text helpers for the message box, kept free of the DOM so they can be tested. */

/** The word being typed at the caret that can be completed: ":smi", "@mi", "#gen", "%mod". */
export function completionToken(before: string): { sigil: string; q: string; start: number } | null {
  const m = /(?:^|[\s(>])([:@#%])([\p{L}\p{N}_+-]{0,32})$/u.exec(before);
  if (!m) return null;
  // Emoji need two letters, like Stoat and Discord, so "a: b" doesn't pop up a list.
  if (m[1] === ":" && m[2]!.length < 2) return null;
  return { sigil: m[1]!, q: m[2]!, start: before.length - m[2]!.length - 1 };
}

/** A Stoat id (ULID). Mentions take any short id too, so the demo's ids work. */
const ID = "[0-9A-HJKMNP-TV-Z]{26}";
const REF = "[0-9A-Za-z_-]{1,32}";
/** Tokens that become chips. Message links are any https URL ending in /channel/<id>/<id>. */
export const CHIP_RE = new RegExp(`<@(${REF})>|<#(${REF})>|<%(${REF})>|:(${ID}):|(https:\\/\\/[^\\s<>]+\\/channel\\/${ID}\\/${ID})`, "g");

/** [start, end) of inline code and code blocks, so chips aren't drawn inside them. */
export function codeSpans(s: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /```[\s\S]*?(```|$)|`[^`\n]*`/g;
  for (const m of s.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

