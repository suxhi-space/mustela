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

/** Post links in a message that Mustela previews itself (up to 3). */
export function socialLinks(text: string): string[] {
  const urls = (text.match(/https:\/\/[^\s<>()]+/gi) ?? []).map((u) => u.replace(/[.,!?:;'")\]>]+$/, ""));
  return [...new Set(urls.filter((u) => known(host(u)) && new URL(u).pathname.length > 1))].slice(0, 3);
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
