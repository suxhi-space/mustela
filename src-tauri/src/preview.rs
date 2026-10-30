//! Previews for social posts Stoat doesn't preview well (X, Instagram, Bluesky, TikTok, Reddit): the post's
//! picture or video, title and text, read from the page's Open Graph tags the way Discord does. X and
//! Instagram go through their "fixer" sites (fxtwitter.com, kkinstagram.com), which exist to hand out playable
//! previews. Only these sites are ever asked, only https media is kept, and pages are size-capped.

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

/// Where to ask for a link's preview, or None for sites this doesn't handle.
pub fn source_for(url: &str) -> Option<(String, &'static str)> {
    let u = reqwest::Url::parse(url).ok()?;
    if u.scheme() != "https" { return None; }
    let host = u.host_str()?.trim_start_matches("www.").trim_start_matches("m.").trim_start_matches("mobile.").to_ascii_lowercase();
    let path = u.path();
    let with = |h: &str| format!("https://{h}{path}{}", u.query().map(|q| format!("?{q}")).unwrap_or_default());
    match host.as_str() {
        "x.com" | "twitter.com" => Some((with("fxtwitter.com"), "X")),
        "fxtwitter.com" | "fixupx.com" | "vxtwitter.com" | "fixvx.com" => Some((with("fxtwitter.com"), "X")),
        "instagram.com" | "kkinstagram.com" | "ddinstagram.com" | "instagramez.com" => Some((with("kkinstagram.com"), "Instagram")),
        "bsky.app" => Some((with("bsky.app"), "Bluesky")),
        "tiktok.com" | "vm.tiktok.com" => Some((with("tiktok.com"), "TikTok")),
        "reddit.com" | "old.reddit.com" => Some((with("reddit.com"), "Reddit")),
        _ => None,
    }
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

/// A social post's preview, or None when there's nothing to show.
#[tauri::command]
pub async fn link_preview(url: String) -> Option<LinkPreview> {
    if let Some(hit) = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&url).cloned()) { return hit; }
    let (fetch, site) = source_for(&url)?;
    let target = crate::fetch::validate_url(&fetch).ok()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        // Redirects stay on https (the fixer sites redirect to their CDN); private addresses are refused.
        .redirect(reqwest::redirect::Policy::custom(|a| if a.previous().len() < 4 && crate::fetch::validate_url(a.url().as_str()).is_ok() { a.follow() } else { a.stop() }))
        // The fixer sites only hand out previews to link-preview bots; Discord's is the one they all know.
        .user_agent("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)")
        .build().ok()?;
    let mut resp = client.get(target).send().await.ok()?;
    let mut html = Vec::new();
    while let Some(chunk) = resp.chunk().await.ok()? {
        html.extend_from_slice(&chunk);
        if html.len() > 1_500_000 { break; } // the tags are in <head>; no need for the rest
    }
    let out = build(&url, site, &parse_meta(&String::from_utf8_lossy(&html)));
    let mut c = CACHE.lock().unwrap();
    let map = c.get_or_insert_with(HashMap::new);
    if map.len() > 500 { map.clear(); }
    map.insert(url, out.clone());
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
    }
}
