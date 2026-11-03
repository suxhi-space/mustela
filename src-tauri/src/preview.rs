//! Previews for social posts Stoat doesn't preview well (X, Instagram, TikTok, Reddit, Bluesky, Fur Affinity, pixiv
//! and more): the post's picture or video, title and text, read from the page's Open Graph tags the way Discord does.
//! Most go through the "fix the embed" mirrors people paste anyway (fxtwitter.com, kkinstagram.com, rxddit.com and
//! so on), which exist to hand out playable previews. Only the sites listed here are ever asked, only https media is
//! kept, and pages are size-capped.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub site: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub video: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub colour: Option<String>,
}

/// The sites with posts worth previewing, every "fix the embed" mirror people paste instead of the real link,
/// and where to ask (in order: the mirror that's best at handing previews to bots first, then fallbacks).
/// (hosts, mirrors to try, name)
const SITES: &[(&[&str], &[&str], &str)] = &[
    (&["x.com", "twitter.com", "fxtwitter.com", "fixupx.com", "vxtwitter.com", "fixvx.com", "twittpr.com", "d.fxtwitter.com", "d.fixupx.com", "nitter.net", "xcancel.com"],
        &["fxtwitter.com", "vxtwitter.com"], "X"),
    (&["instagram.com", "kkinstagram.com", "ddinstagram.com", "d.ddinstagram.com", "instagramez.com", "vxinstagram.com", "uuinstagram.com", "eeinstagram.com", "g.ddinstagram.com"],
        // ddinstagram has shut down and the rest come and go, so ask several (all at once) and Instagram last.
        &["kkinstagram.com", "vxinstagram.com", "eeinstagram.com", "uuinstagram.com", "instagramez.com", "www.instagram.com"], "Instagram"),
    (&["tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "tnktok.com", "tiktxk.com", "vxtiktok.com", "kktiktok.com", "tfxktok.com"],
        &["tnktok.com", "vxtiktok.com", "tiktok.com"], "TikTok"),
    (&["reddit.com", "old.reddit.com", "new.reddit.com", "rxddit.com", "old.rxddit.com", "vxreddit.com", "rxyddit.com"],
        &["rxddit.com", "vxreddit.com", "reddit.com"], "Reddit"),
    (&["bsky.app", "fxbsky.app", "bskx.app", "bsyy.app", "xbsky.app", "cbsky.app", "bskye.app", "vxbsky.app"],
        &["fxbsky.app", "bskx.app", "bsky.app"], "Bluesky"),
    (&["furaffinity.net", "fxfuraffinity.net", "xfuraffinity.net", "vxfuraffinity.net", "fxraffinity.net"],
        &["www.furaffinity.net", "xfuraffinity.net", "fxfuraffinity.net"], "Fur Affinity"),
    (&["pixiv.net", "phixiv.net", "ppxiv.net"], &["phixiv.net", "ppxiv.net"], "pixiv"),
    (&["deviantart.com", "fixdeviantart.com", "fxdeviantart.com"], &["fixdeviantart.com", "www.deviantart.com"], "DeviantArt"),
    (&["tumblr.com", "tpmblr.com", "txtumblr.com"], &["tpmblr.com", "www.tumblr.com"], "Tumblr"),
    (&["threads.net", "threads.com", "fixthreads.net", "vxthreads.net", "fixthreads.seria.moe"], &["fixthreads.net", "vxthreads.net", "www.threads.net"], "Threads"),
];

/// Every host `sources_for` knows (the app uses the same list to spot these links).
pub fn known_host(host: &str) -> Option<usize> {
    let h = host.to_ascii_lowercase();
    let h = h.trim_start_matches("www.").trim_start_matches("m.").trim_start_matches("mobile.");
    SITES.iter().position(|(hosts, _, _)| hosts.contains(&h) || (h.ends_with(".tumblr.com") && hosts.contains(&"tumblr.com")))
}

/// Where to ask for a link's preview, in order to try, or None for sites this doesn't handle.
pub fn sources_for(url: &str) -> Option<(Vec<String>, &'static str)> {
    let u = reqwest::Url::parse(url).ok()?;
    if u.scheme() != "https" { return None; }
    let host = u.host_str()?.to_ascii_lowercase();
    let i = known_host(&host)?;
    let (_, mirrors, name) = SITES[i];
    let rest = format!("{}{}", u.path(), u.query().map(|q| format!("?{q}")).unwrap_or_default());
    // Tumblr blogs on their own subdomain (name.tumblr.com/post/…) become tumblr.com/name/…
    let rest = match host.strip_suffix(".tumblr.com") { Some(blog) if blog != "www" => format!("/{blog}{rest}"), _ => rest };
    Some((mirrors.iter().map(|m| format!("https://{m}{rest}")).collect(), name))
}

/// The first place to ask (kept for the tests and anything that only wants one).
pub fn source_for(url: &str) -> Option<(String, &'static str)> {
    sources_for(url).map(|(v, n)| (v[0].clone(), n))
}

fn decode(s: &str) -> String {
    s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&#x2F;", "/")
}

/// The Open Graph (and Twitter card) tags of a page.
pub fn parse_meta(html: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let lower = html.to_ascii_lowercase();
    let mut at = 0;
    while let Some(i) = lower[at..].find("<meta") {
        let start = at + i;
        let Some(end) = lower[start..].find('>') else { break };
        let tag = &html[start..start + end];
        at = start + end;
        let attr = |name: &str| -> Option<String> {
            let tl = tag.to_ascii_lowercase();
            let k = tl.find(&format!("{name}="))?;
            let rest = &tag[k + name.len() + 1..];
            let q = rest.chars().next()?;
            if q == '"' || q == '\'' { rest[1..].find(q).map(|e| rest[1..1 + e].to_string()) }
            else { Some(rest.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or("").to_string()) }
        };
        let key = attr("property").or_else(|| attr("name")).map(|k| k.to_ascii_lowercase());
        if let (Some(k), Some(v)) = (key, attr("content")) {
            if k.starts_with("og:") || k.starts_with("twitter:") || k == "theme-color" || k == "description" { out.entry(k).or_insert_with(|| decode(&v)); }
        }
    }
    out
}

fn https(v: Option<&String>) -> Option<String> {
    v.filter(|u| u.starts_with("https://") && u.len() < 2000).cloned()
}

/// Some sites give their media as "/videos/…" or "//cdn…": make those full https links against the page.
fn absolutise(m: &mut HashMap<String, String>, base: &str) {
    let Ok(base) = reqwest::Url::parse(base) else { return };
    for v in m.values_mut() {
        if v.starts_with('/') { if let Ok(u) = base.join(v) { *v = u.to_string(); } }
    }
}

pub fn build(url: &str, site: &str, m: &HashMap<String, String>) -> Option<LinkPreview> {
    let pick = |keys: &[&str]| keys.iter().find_map(|k| m.get(*k)).cloned();
    let text = |keys: &[&str], n: usize| pick(keys).map(|t| t.trim().chars().take(n).collect::<String>()).filter(|t| !t.is_empty());
    let video = https(m.get("og:video:secure_url")).or_else(|| https(m.get("og:video:url"))).or_else(|| https(m.get("og:video")))
        .or_else(|| https(m.get("twitter:player:stream")))
        .filter(|v| !v.contains("youtube.com/embed")); // players are pages, not videos
    let p = LinkPreview {
        url: url.to_string(),
        site: text(&["og:site_name"], 60).or(Some(site.to_string())),
        title: text(&["og:title", "twitter:title"], 200),
        description: text(&["og:description", "twitter:description", "description"], 600),
        image: https(m.get("og:image:secure_url")).or_else(|| https(m.get("og:image"))).or_else(|| https(m.get("twitter:image"))),
        width: pick(&["og:video:width", "og:image:width"]).and_then(|w| w.parse().ok()),
        height: pick(&["og:video:height", "og:image:height"]).and_then(|h| h.parse().ok()),
        colour: pick(&["theme-color"]).filter(|c| c.starts_with('#') && c.len() <= 9),
        video,
    };
    (p.title.is_some() || p.image.is_some() || p.video.is_some()).then_some(p)
}

static CACHE: Mutex<Option<HashMap<String, Option<LinkPreview>>>> = Mutex::new(None);

/// Bots the mirrors hand previews to. Discord's is the one they all know; some only answer Telegram's or Facebook's.
const BOTS: &[&str] = &[
    "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
    "TelegramBot (like TwitterBot)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
];

fn client(ua: &str) -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        // Redirects stay on https (the fixer sites redirect to their CDN); private addresses are refused.
        .redirect(reqwest::redirect::Policy::custom(|a| if a.previous().len() < 4 && crate::fetch::validate_url(a.url().as_str()).is_ok() { a.follow() } else { a.stop() }))
        .user_agent(ua)
        .build().ok()
}

/// A social post's preview, or None when there's nothing to show.
#[tauri::command]
pub async fn link_preview(url: String) -> Option<LinkPreview> {
    if let Some(hit) = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&url).cloned()) { return hit; }
    let (tries, site) = sources_for(&url)?;
    // Ask every mirror at once (one dead mirror shouldn't make the rest wait), as each bot in turn until one
    // hands out a video. Earlier mirrors in the list win ties.
    let mut best: Option<LinkPreview> = None;
    for ua in BOTS {
        let Some(c) = client(ua) else { continue };
        let found = futures_util::future::join_all(tries.iter().map(|f| fetch_one(&c, &url, f, site))).await;
        let rank = |p: &LinkPreview| if p.video.is_some() { 2 } else if p.image.is_some() { 1 } else { 0 };
        for p in found.into_iter().flatten() {
            if best.as_ref().map_or(true, |b| rank(&p) > rank(b)) { best = Some(p); }
        }
        if best.as_ref().is_some_and(|b| b.video.is_some()) { break; }
    }
    // Only keep answers: a miss (the mirrors down, no connection) is asked again next time.
    if best.is_some() {
        let mut c = CACHE.lock().unwrap();
        let map = c.get_or_insert_with(HashMap::new);
        if map.len() > 500 { map.clear(); }
        map.insert(url, best.clone());
    }
    best
}

async fn fetch_one(client: &reqwest::Client, url: &str, fetch: &str, site: &'static str) -> Option<LinkPreview> {
    let target = crate::fetch::validate_url(fetch).ok()?;
    let mut resp = client.get(target).send().await.ok()?;
    if !resp.status().is_success() { return None; }
    let mut html = Vec::new();
    while let Some(chunk) = resp.chunk().await.ok()? {
        html.extend_from_slice(&chunk);
        if html.len() > 1_500_000 { break; } // the tags are in <head>; no need for the rest
    }
    let page = resp.url().to_string();
    let mut meta = parse_meta(&String::from_utf8_lossy(&html));
    absolutise(&mut meta, &page);
    let mut out = build(url, site, &meta);
    // The mirrors hand out their own link for the video, which redirects to the real file (and only for
    // preview bots). Follow it here so the player gets the file itself.
    if let Some(p) = out.as_mut() {
        if let Some(v) = p.video.clone() {
            let mirror = reqwest::Url::parse(&v).ok().and_then(|u| u.host_str().and_then(known_host)).is_some();
            if mirror {
                if let Ok(target) = crate::fetch::validate_url(&v) {
                    match client.get(target).header("Range", "bytes=0-0").send().await {
                        Ok(r) if r.status().is_success() => {
                            let real = r.url().to_string();
                            if real.starts_with("https://") { p.video = Some(real); }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_fixer_sites() {
        assert_eq!(source_for("https://x.com/a/status/1").unwrap().0, "https://fxtwitter.com/a/status/1");
        assert_eq!(source_for("https://www.instagram.com/reel/De2dwg9knL7/").unwrap().0, "https://kkinstagram.com/reel/De2dwg9knL7/");
        assert_eq!(source_for("https://www.kkinstagram.com/reel/De2dwg9knL7/").unwrap().0, "https://kkinstagram.com/reel/De2dwg9knL7/");
        assert_eq!(sources_for("https://kkinstagram.com/reel/De0cudiRIbE/").unwrap().0.last().unwrap(), "https://www.instagram.com/reel/De0cudiRIbE/");
        assert_eq!(source_for("https://www.furaffinity.net/view/66547325/").unwrap().0, "https://www.furaffinity.net/view/66547325/");
        assert_eq!(source_for("https://www.xfuraffinity.net/view/66547325/").unwrap().0, "https://www.furaffinity.net/view/66547325/");
        assert_eq!(sources_for("https://www.xfuraffinity.net/view/66547325/").unwrap().0[1], "https://xfuraffinity.net/view/66547325/");
        assert_eq!(source_for("https://vxtwitter.com/a/status/1").unwrap().0, "https://fxtwitter.com/a/status/1");
        assert_eq!(source_for("https://staff.tumblr.com/post/1").unwrap().0, "https://tpmblr.com/staff/post/1");
        assert!(source_for("https://example.com/").is_none());
        assert!(source_for("http://x.com/a").is_none());
    }

    #[test]
    fn reads_open_graph() {
        let html = r#"<head><meta property="og:title" content="Candy &amp; Bara"><meta content="https://cdn.example/v.mp4" property="og:video"><meta name="og:image" content='https://cdn.example/i.jpg'><meta property="og:image:width" content="720"></head>"#;
        let p = build("https://x.com/a", "X", &parse_meta(html)).unwrap();
        assert_eq!(p.title.as_deref(), Some("Candy & Bara"));
        assert_eq!(p.video.as_deref(), Some("https://cdn.example/v.mp4"));
        assert_eq!(p.image.as_deref(), Some("https://cdn.example/i.jpg"));
        assert_eq!(p.width, Some(720));
        // Only https media
        let p = build("https://x.com/a", "X", &parse_meta(r#"<meta property="og:title" content="t"><meta property="og:image" content="http://insecure/i.jpg">"#)).unwrap();
        assert!(p.image.is_none());
        // Media given as a path on the page's own site
        let mut m = parse_meta(r#"<meta property="og:title" content="t"><meta property="og:video" content="/videos/De0cudiRIbE/1">"#);
        absolutise(&mut m, "https://kkinstagram.com/reel/De0cudiRIbE/");
        assert_eq!(build("https://instagram.com/reel/De0cudiRIbE/", "Instagram", &m).unwrap().video.as_deref(), Some("https://kkinstagram.com/videos/De0cudiRIbE/1"));
    }
}
