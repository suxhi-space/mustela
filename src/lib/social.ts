/**
 * Links to posts that get Mustela's own preview: the sites themselves and every "fix the embed" mirror people paste
 * instead (fxtwitter, kkinstagram, rxddit…). Keep in step with SITES in src-tauri/src/preview.rs.
 */
const HOSTS = [
  "x.com", "twitter.com", "fxtwitter.com", "fixupx.com", "vxtwitter.com", "fixvx.com", "twittpr.com", "d.fxtwitter.com", "d.fixupx.com", "nitter.net", "xcancel.com",
  "instagram.com", "kkinstagram.com", "ddinstagram.com", "d.ddinstagram.com", "instagramez.com", "vxinstagram.com", "uuinstagram.com", "eeinstagram.com", "g.ddinstagram.com",
  "tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "tnktok.com", "tiktxk.com", "vxtiktok.com", "kktiktok.com", "tfxktok.com",
  "reddit.com", "old.reddit.com", "new.reddit.com", "rxddit.com", "old.rxddit.com", "vxreddit.com", "rxyddit.com",
  "bsky.app", "fxbsky.app", "bskx.app", "bsyy.app", "xbsky.app", "cbsky.app", "bskye.app", "vxbsky.app",
  "furaffinity.net", "fxfuraffinity.net", "xfuraffinity.net", "vxfuraffinity.net", "fxraffinity.net",
  "pixiv.net", "phixiv.net", "ppxiv.net",
  "deviantart.com", "fixdeviantart.com", "fxdeviantart.com",
  "tumblr.com", "tpmblr.com", "txtumblr.com",
  "threads.net", "threads.com", "fixthreads.net", "vxthreads.net", "fixthreads.seria.moe",
];
const SET = new Set(HOSTS);
/** Posts on these are often videos, so Stoat's still picture isn't enough. */
const VIDEO = new Set(["x.com", "twitter.com", "instagram.com", "tiktok.com", "reddit.com", "bsky.app", "threads.net"]);
const FAMILY: Record<string, string> = {};
for (const h of HOSTS) {
  FAMILY[h] = /twitt|^x\.com|fixupx|fixvx|nitter|xcancel/.test(h) ? "x.com" : /insta/.test(h) ? "instagram.com" : /tiktok|tnktok|tiktxk|tfxktok/.test(h) ? "tiktok.com"
    : /r[xy]?y?ddit|reddit/.test(h) ? "reddit.com" : /bsk|bsyy/.test(h) ? "bsky.app" : /threads/.test(h) ? "threads.net"
    : /furaffinity|fxraffinity/.test(h) ? "furaffinity.net" : /pixiv|ppxiv/.test(h) ? "pixiv.net" : /deviantart/.test(h) ? "deviantart.com" : /tumblr|tpmblr/.test(h) ? "tumblr.com" : h;
}

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, ""); } catch { return ""; } };
const known = (h: string) => SET.has(h) || h.endsWith(".tumblr.com");

/** The part of a post's address that names the post (the same on every mirror). */
function postId(fam: string, parts: string[]): string {
  if (fam === "reddit.com") { const i = parts.indexOf("comments"); if (i >= 0 && parts[i + 1]) return parts[i + 1]!; }
  // name.tumblr.com/post/123/slug and tumblr.com/name/123 are the same post: its number.
  if (fam === "tumblr.com") { const n = parts.find((x) => /^\d{6,}$/.test(x)); if (n) return n; }
  return parts[parts.length - 1] ?? "";
}

/** One reel pasted as instagram.com and again as a mirror is still one post. */
export function postKey(url: string): string {
  const fam = FAMILY[host(url)] ?? (host(url).endsWith(".tumblr.com") ? "tumblr.com" : host(url));
  let parts: string[] = [];
  try { parts = new URL(url).pathname.split("/").filter(Boolean).map((x) => x.toLowerCase()); } catch { /* not a url */ }
  return `${fam}:${postId(fam, parts)}`;
}

/** Stoat's card and Mustela's preview of the same post, even when one of them went through a mirror. */
export function sameEmbed(embedUrl: string, postUrl: string): boolean {
  if (samePost(embedUrl, postUrl)) return true;
  const [fa, ia] = postKey(embedUrl).split(":");
  const [fb, ib] = postKey(postUrl).split(":");
  return !!fa && fa === fb && !!ia && ia.length > 2 && ia === ib;
}

/** Post links in a message that Mustela previews itself (up to 3, one card per post). */
export function socialLinks(text: string): string[] {
  const urls = linksIn(text).map((l) => l.url).filter((u) => u.startsWith("https://"));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    let path = "";
    try { path = new URL(u).pathname; } catch { continue; }
    if (!known(host(u)) || path.length <= 1) continue;
    const key = postKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length === 3) break;
  }
  return out;
}

/** Whether posts on this link's site are often videos. */
export const videoSite = (u: string) => VIDEO.has(FAMILY[host(u)] ?? "");

/** Whether two links are the same post, even on different mirrors (xfuraffinity.net vs furaffinity.net). */
export function samePost(a: string, b: string) {
  try {
    const x = new URL(a), y = new URL(b);
    const fa = FAMILY[host(a)] ?? host(a), fb = FAMILY[host(b)] ?? host(b);
    const strip = (fam: string) => fam.replace(/^(fx|vx|x|d\.)/, "");
    const path = (u: URL) => u.pathname.replace(/\/+$/, "").toLowerCase();
    return (fa === fb || strip(fa) === strip(fb)) && path(x) === path(y);
  } catch { return false; }
}

/** A link pasted in a message, and whether it was inside ||spoiler|| marks or <angle brackets> (no preview). */
export interface Link { url: string; spoiler: boolean; noEmbed: boolean }

/** Every link in a message, once each, in order. "|" never belongs to a link, so ||link|| works. */
export function linksIn(text: string): Link[] {
  const spoilers = [...text.matchAll(/\|\|([\s\S]+?)\|\|/g)].map((m) => [m.index!, m.index! + m[0].length] as const);
  const code = [...text.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => [m.index!, m.index! + m[0].length] as const);
  const inside = (i: number, ranges: (readonly [number, number])[]) => ranges.some(([a, b]) => i >= a && i < b);
  const out: Link[] = [];
  const byKey = new Map<string, Link>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>|`]+/gi)) {
    if (inside(m.index!, code)) continue;
    let url = m[0];
    const count = (c: string) => url.split(c).length - 1;
    while (/[.,!?;:'"\]>*_~]$/.test(url) || (url.endsWith(")") && count("(") < count(")"))) url = url.slice(0, -1);
    try { new URL(url); } catch { continue; }
    const spoiler = inside(m.index!, spoilers);
    const noEmbed = text[m.index! - 1] === "<" && text[m.index! + url.length] === ">";
    const key = linkKey(url);
    const had = byKey.get(key);
    if (had) { had.spoiler ||= spoiler; had.noEmbed &&= noEmbed; continue; }
    const l = { url, spoiler, noEmbed };
    byKey.set(key, l);
    out.push(l);
  }
  return out;
}

/** Whether this is a post link Mustela previews itself. */
export const isSocial = (u: string) => { try { return known(host(u)) && new URL(u).pathname.length > 1; } catch { return false; } };

/** What makes two links the same page: the post for social sites, otherwise the address without www or a trailing slash. */
export function linkKey(u: string): string {
  if (isSocial(u)) return `post:${postKey(u)}`;
  try { const x = new URL(u); return `${host(u)}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase(); } catch { return u; }
}

/** Whether Stoat's card (by its address) is for this link. */
export function embedFor(embedUrl: string, link: string): boolean {
  return embedUrl === link || linkKey(embedUrl) === linkKey(link) || samePost(embedUrl, link) || sameEmbed(embedUrl, link);
}

/** What a message shows under its text: one card per link. */
export type Card<E> =
  | { kind: "embed"; e: E; spoiler: boolean }
  | { kind: "social"; url: string; fallback?: E; spoiler: boolean };

interface EmbedLike { url?: string; kind: string; gif?: boolean; title?: string; description?: string; image?: unknown; video?: unknown; special?: unknown }
const score = (e: EmbedLike) => {
  if (e.gif) return 5;
  if (!e.title && !e.description && !e.image && !e.video && !e.special) return -1; // only a site name
  return e.video ? 4 : e.image && e.kind === "website" ? 3 : e.image ? 2 : 1;
};
const best = <E extends EmbedLike>(list: E[]) => list.reduce<E | undefined>((a, e) => (!a || score(e) > score(a) ? e : a), undefined);

/**
 * One card for each link in the message, whatever Stoat and Mustela each came up with: Stoat sometimes sends two
 * cards for one link (after an edit, or a mirror that hands out the file itself), and Mustela's own preview of a post
 * replaces Stoat's when Stoat's has no video. A link inside ||spoiler|| marks covers its card.
 */
export function linkCards<E extends EmbedLike>(text: string, embeds: E[], skip: (url: string) => boolean = () => false): Card<E>[] {
  const links = linksIn(text);
  const slots = links.map((l) => ({ l, es: [] as E[] }));
  const loose: E[] = [];
  for (const e of embeds) {
    const s = e.url ? slots.find((x) => embedFor(e.url!, x.l.url)) : undefined;
    if (s) s.es.push(e); else loose.push(e);
  }
  // A card whose address isn't any link in the text (a mirror that redirected to its picture or video) belongs
  // to a link of the same site that has none yet, or else the first link without a card.
  const fam = (u?: string) => (u ? postKey(u).split(":")[0] : "");
  const left: E[] = [];
  for (const e of loose) {
    const free = slots.filter((x) => !x.es.length && !x.l.noEmbed && !skip(x.l.url));
    const s = free.find((x) => e.url && fam(x.l.url) === fam(e.url)) ?? (e.url && !links.some((l) => l.url === e.url) ? free[0] : undefined);
    if (s) s.es.push(e); else if (!left.some((x) => x.url && x.url === e.url)) left.push(e);
  }
  const out: Card<E>[] = [];
  let social = 0;
  for (const { l, es } of slots) {
    if (skip(l.url)) continue;
    const e = best(es);
    if (isSocial(l.url) && !l.noEmbed && social < 3 && !(e && (e.video || (e.image && !videoSite(l.url))))) {
      social++;
      out.push({ kind: "social", url: l.url, fallback: e && score(e) >= 0 ? e : undefined, spoiler: l.spoiler });
    } else if (e && score(e) >= 0) out.push({ kind: "embed", e, spoiler: l.spoiler });
  }
  const anySpoiler = links.some((l) => l.spoiler);
  for (const e of left) if (score(e) >= 0) out.push({ kind: "embed", e, spoiler: anySpoiler });
  return out;
}
