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
    /// Every picture the post has (posts with several), in order; `image` is the first.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
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
    (&["tumblr.com", "tpmblr.com", "txtumblr.com", "fxtumblr.com"], &["tpmblr.com", "txtumblr.com", "www.tumblr.com"], "Tumblr"),
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

/// The first place to ask (used by the tests).
#[cfg(test)]
pub fn source_for(url: &str) -> Option<(String, &'static str)> {
    sources_for(url).map(|(v, n)| (v[0].clone(), n))
}

/// HTML character references in a tag's text: the named few pages use, and every numbered one (&#x2019; &#8217;).
pub fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let end = rest[..rest.len().min(12)].find(';');
        let ch = end.and_then(|e| {
            let name = &rest[1..e];
            let num = |n: &str, radix| u32::from_str_radix(n, radix).ok().and_then(char::from_u32);
            match name {
                "amp" => Some('&'), "quot" => Some('"'), "apos" => Some('\''), "lt" => Some('<'), "gt" => Some('>'), "nbsp" => Some(' '),
                _ if name.starts_with("#x") || name.starts_with("#X") => num(&name[2..], 16),
                _ if name.starts_with('#') => num(&name[1..], 10),
                _ => None,
            }.map(|c| (c, e))
        });
        match ch {
            Some((c, e)) => { out.push(c); rest = &rest[e + 1..]; }
            None => { out.push('&'); rest = &rest[1..]; }
        }
    }
    out.push_str(rest);
    out
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
            if k.starts_with("og:") || k.starts_with("twitter:") || k == "theme-color" || k == "description" {
                // A post with several pictures lists one og:image per picture: keep them all (one per line) too.
                let list = match k.as_str() { "og:image" | "og:image:url" | "og:image:secure_url" => Some("og:image:all"), "twitter:image" | "twitter:image:src" => Some("twitter:image:all"), _ => None };
                if let Some(list) = list {
                    let all = out.entry(list.to_string()).or_insert_with(String::new);
                    if !all.is_empty() { all.push('\n'); }
                    all.push_str(&decode(&v));
                }
                out.entry(k).or_insert_with(|| decode(&v));
            }
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

/// All of a post's pictures (https only, no repeats, up to 10), when it has more than one.
/// (Open Graph's list first; a page that only lists its pictures as Twitter card tags works too.)
fn images(m: &HashMap<String, String>) -> Vec<String> {
    for key in ["og:image:all", "twitter:image:all"] {
        let mut out: Vec<String> = Vec::new();
        for u in m.get(key).map(|s| s.lines().collect::<Vec<_>>()).unwrap_or_default() {
            let u = u.trim();
            // TxTumblr puts a collage of all the photos first: not one of the pictures.
            if u.ends_with("?collage") { continue; }
            if u.starts_with("https://") && u.len() < 2000 && !out.iter().any(|x| x == u) { out.push(u.to_string()); }
            if out.len() == 10 { break; }
        }
        if out.len() > 1 { return out; }
    }
    Vec::new()
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
        images: images(m),
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
    // Redirects stay on https (the fixer sites redirect to their CDN); private addresses are refused.
    crate::fetch::outside_client(Duration::from_secs(8))
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
        // A video beats pictures, pictures beat none, and more pictures beat one (a mirror's single picture of a
        // whole Tumblr post used to win over Tumblr's own page listing each photo).
        let rank = |p: &LinkPreview| (if p.video.is_some() { 2 } else if p.image.is_some() { 1 } else { 0 }, p.images.len());
        for p in found.into_iter().flatten() {
            if best.as_ref().is_none_or(|b| rank(&p) > rank(b)) { best = Some(p); }
        }
        if best.as_ref().is_some_and(|b| b.video.is_some()) { break; }
    }
    // X: the mirror's page shows a post's photos as one combined picture. Its JSON lists them one by one.
    if site == "X" {
        if let Some(b) = best.as_mut().filter(|b| b.video.is_none()) {
            let photos = x_photos(&url).await;
            if photos.len() > 1 { b.image = photos.first().cloned(); b.images = photos; }
        }
    }
    // Tumblr: fxtumblr hands out one rendered picture of the whole post. The post's own feed lists its photos, and
    // so does the post's page on www.tumblr.com (one preview tag per photo: what Discord shows).
    if site == "Tumblr" {
        // None of the pages answered: still worth asking for the photos (the chat keeps Stoat's text card if this finds none).
        if best.is_none() {
            best = Some(LinkPreview { url: url.clone(), site: Some("Tumblr".into()), title: None, description: None, image: None, images: vec![], video: None, width: None, height: None, colour: None });
        }
        if let Some(b) = best.as_mut().filter(|b| b.video.is_none() && b.images.len() < 2) {
            // TxTumblr's copy of the post first (every photo, reblogs included), then Tumblr's old public feed,
            // then the post's page on www.tumblr.com.
            let mut photos = match tumblr_post(&url) { Some((blog, id)) => txtumblr_photos(&blog, &id).await, None => vec![] };
            if photos.len() < 2 { photos = tumblr_photos(&url).await; }
            if photos.len() < 2 {
                if let (Some((blog, id)), Some(c)) = (tumblr_post(&url), client(BOTS[0])) {
                    if let Some(p) = fetch_one(&c, &url, &format!("https://www.tumblr.com/{blog}/{id}"), site).await { photos = p.images; }
                }
            }
            if photos.len() > 1 { b.image = photos.first().cloned(); b.images = photos; }
        }
        if best.as_ref().is_some_and(|b| b.title.is_none() && b.image.is_none() && b.video.is_none()) { best = None; }
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

/// The post number in an X link (…/status/123…).
fn x_status_id(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let parts: Vec<&str> = u.path_segments()?.collect();
    let i = parts.iter().position(|p| *p == "status" || *p == "statuses")?;
    parts.get(i + 1).map(|id| id.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()).filter(|id| !id.is_empty())
}

/// Every photo in FxTwitter's answer for a post (`tweet.media.photos[].url`), https only, in order.
fn x_photos_from(json: &serde_json::Value) -> Vec<String> {
    json.pointer("/tweet/media/photos").and_then(|v| v.as_array()).map(|a| a.iter()
        .filter_map(|p| p.get("url").and_then(|u| u.as_str()))
        .filter(|u| u.starts_with("https://"))
        .map(String::from).take(10).collect()).unwrap_or_default()
}

async fn x_photos(url: &str) -> Vec<String> {
    let Some(id) = x_status_id(url) else { return vec![] };
    let Some(c) = client("Mustela (link previews)") else { return vec![] };
    let Ok(target) = crate::fetch::validate_url(&format!("https://api.fxtwitter.com/status/{id}")) else { return vec![] };
    let Ok(r) = c.get(target).send().await else { return vec![] };
    if !r.status().is_success() { return vec![]; }
    let Ok(bytes) = r.bytes().await else { return vec![] };
    if bytes.len() > 2_000_000 { return vec![]; }
    serde_json::from_slice::<serde_json::Value>(&bytes).map(|j| x_photos_from(&j)).unwrap_or_default()
}

/// The blog and post number in a Tumblr link: blog.tumblr.com/post/123…, (www.)tumblr.com/blog/123…, tpmblr.com/blog/123…
fn tumblr_post(url: &str) -> Option<(String, String)> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    let parts: Vec<&str> = u.path_segments()?.filter(|p| !p.is_empty()).collect();
    let digits = |p: &str| p.len() >= 6 && p.chars().all(|c| c.is_ascii_digit());
    let id = parts.iter().find(|p| digits(p))?.to_string();
    let sub = host.strip_suffix(".tumblr.com").filter(|b| *b != "www" && !b.contains('.'));
    let blog = match sub { Some(b) => b.to_string(), None => parts.first().filter(|p| !digits(p) && **p != "post")?.to_string() };
    if !blog.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return None; }
    Some((blog, id))
}

/// Every photo in Tumblr's public post feed (`var tumblr_api_read = {...};`): a photo post's own list, or the pictures
/// in a text post's body (newer posts and reblogs), largest size, https only, in order.
fn tumblr_photos_from(body: &str) -> Vec<String> {
    let start = body.find('{'); let end = body.rfind('}');
    let (Some(a), Some(b)) = (start, end) else { return vec![] };
    let Ok(j) = serde_json::from_str::<serde_json::Value>(&body[a..=b]) else { return vec![] };
    let Some(post) = j.pointer("/posts/0") else { return vec![] };
    let mut out: Vec<String> = Vec::new();
    fn add(out: &mut Vec<String>, u: &str) { let u = u.replace("\\/", "/"); if u.starts_with("https://") && !out.contains(&u) { out.push(u); } }
    if let Some(list) = post.get("photos").and_then(|v| v.as_array()) {
        for p in list { if let Some(u) = p.get("photo-url-1280").and_then(|v| v.as_str()) { add(&mut out, u); } }
    }
    if out.is_empty() { if let Some(u) = post.get("photo-url-1280").and_then(|v| v.as_str()) { add(&mut out, u); } }
    for key in ["regular-body", "photo-caption", "answer"] {
        if let Some(html) = post.get(key).and_then(|v| v.as_str()) {
            let mut rest = html;
            while let Some(i) = rest.find("<img") {
                rest = &rest[i + 4..];
                let tag = &rest[..rest.find('>').unwrap_or(rest.len())];
                if let Some(s) = tag.find("src=\"") { let v = &tag[s + 5..]; if let Some(e) = v.find('"') { if v[..e].contains(".media.tumblr.com/") { add(&mut out, &v[..e]); } } }
            }
        }
    }
    out.truncate(10);
    out
}

/// Every photo in a Tumblr post in Tumblr's own block format (what TxTumblr's `?json` answers with): the post's
/// image blocks, then those of the posts it reblogs, each at its original size (or the largest listed), in order.
fn tumblr_npf_photos(body: &str) -> Vec<String> {
    let Ok(j) = serde_json::from_str::<serde_json::Value>(body) else { return vec![] };
    let mut blocks: Vec<&serde_json::Value> = j.get("content").and_then(|c| c.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
    for t in j.get("trail").and_then(|t| t.as_array()).into_iter().flatten() {
        blocks.extend(t.get("content").and_then(|c| c.as_array()).into_iter().flatten());
    }
    let mut out: Vec<String> = Vec::new();
    for b in blocks.into_iter().filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("image")) {
        let Some(media) = b.get("media").and_then(|m| m.as_array()) else { continue };
        let pick = media.iter().find(|m| m.get("has_original_dimensions").and_then(|v| v.as_bool()) == Some(true)).or(media.first());
        if let Some(u) = pick.and_then(|m| m.get("url")).and_then(|u| u.as_str()) {
            if u.starts_with("https://") && u.len() < 2000 && !out.iter().any(|x| x == u) { out.push(u.to_string()); }
        }
        if out.len() == 10 { break; }
    }
    out
}

/// A post's photos from TxTumblr's `?json` (the post as Tumblr gives it), or nothing.
async fn txtumblr_photos(blog: &str, id: &str) -> Vec<String> {
    let Some(c) = client("Mustela (link previews)") else { return vec![] };
    let Ok(target) = crate::fetch::validate_url(&format!("https://txtumblr.com/{blog}/{id}?json")) else { return vec![] };
    let Ok(r) = c.get(target).send().await else { return vec![] };
    if !r.status().is_success() { return vec![]; }
    let Ok(bytes) = r.bytes().await else { return vec![] };
    if bytes.len() > 3_000_000 { return vec![]; }
    tumblr_npf_photos(&String::from_utf8_lossy(&bytes))
}

async fn tumblr_photos(url: &str) -> Vec<String> {
    let Some((blog, id)) = tumblr_post(url) else { return vec![] };
    let Some(c) = client("Mustela (link previews)") else { return vec![] };
    let Ok(target) = crate::fetch::validate_url(&format!("https://{blog}.tumblr.com/api/read/json?id={id}")) else { return vec![] };
    let Ok(r) = c.get(target).send().await else { return vec![] };
    if !r.status().is_success() { return vec![]; }
    let Ok(bytes) = r.bytes().await else { return vec![] };
    if bytes.len() > 3_000_000 { return vec![]; }
    tumblr_photos_from(&String::from_utf8_lossy(&bytes))
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
    fn reads_tumblr_photos() {
        assert_eq!(tumblr_post("https://www.tumblr.com/babelnimrod/832541645844119552").unwrap(), ("babelnimrod".into(), "832541645844119552".into()));
        assert_eq!(tumblr_post("https://babelnimrod.tumblr.com/post/832541645844119552/some-slug").unwrap(), ("babelnimrod".into(), "832541645844119552".into()));
        assert_eq!(tumblr_post("https://tpmblr.com/someone/832541645844119552").unwrap(), ("someone".into(), "832541645844119552".into()));
        assert!(tumblr_post("https://www.tumblr.com/someone").is_none());
        assert_eq!(tumblr_post("https://www.fxtumblr.com/babelnimrod/832541645844119552").unwrap(), ("babelnimrod".into(), "832541645844119552".into()));
        let photo = r#"var tumblr_api_read = {"posts":[{"type":"photo","photos":[{"photo-url-1280":"https://64.media.tumblr.com/a/s1280x1920/a.jpg"},{"photo-url-1280":"https://64.media.tumblr.com/b/s1280x1920/b.jpg"}]}]};"#;
        assert_eq!(tumblr_photos_from(photo), vec!["https://64.media.tumblr.com/a/s1280x1920/a.jpg".to_string(), "https://64.media.tumblr.com/b/s1280x1920/b.jpg".to_string()]);
        let text = r#"var tumblr_api_read = {"posts":[{"type":"regular","regular-body":"<p>hi</p><figure><img src=\"https://64.media.tumblr.com/x/s640x960/one.jpg\" alt=\"\"></figure><img src=\"https://64.media.tumblr.com/y/s640x960/two.png\"><img src=\"https://example.com/tracker.gif\">"}]};"#;
        assert_eq!(tumblr_photos_from(text), vec!["https://64.media.tumblr.com/x/s640x960/one.jpg".to_string(), "https://64.media.tumblr.com/y/s640x960/two.png".to_string()]);
        assert!(tumblr_photos_from("not json").is_empty());
        // TxTumblr's ?json: the post's image blocks and the reblogged post's, original size preferred.
        let npf = r#"{"content":[{"type":"text","text":"hi"},{"type":"image","media":[{"url":"https://64.media.tumblr.com/a/s2048x3072/a.jpg","has_original_dimensions":true},{"url":"https://64.media.tumblr.com/a/s640x960/a.jpg"}]}],
            "trail":[{"content":[{"type":"image","media":[{"url":"https://64.media.tumblr.com/b/s1280x1920/b.jpg"},{"url":"https://64.media.tumblr.com/b/s2048x3072/b.jpg","has_original_dimensions":true}]}]}]}"#;
        assert_eq!(tumblr_npf_photos(npf), vec!["https://64.media.tumblr.com/a/s2048x3072/a.jpg".to_string(), "https://64.media.tumblr.com/b/s2048x3072/b.jpg".to_string()]);
        assert!(tumblr_npf_photos("<html>").is_empty());
        // TxTumblr's page: the collage first, then each photo. The collage isn't counted.
        let tx = build("https://txtumblr.com/a/1", "Tumblr", &parse_meta(r#"<meta property="og:title" content="t"><meta property="og:image" content="https://txtumblr.com/a/1?collage"><meta property="og:image" content="https://64.media.tumblr.com/x/1.jpg"><meta property="og:image" content="https://64.media.tumblr.com/y/2.jpg">"#)).unwrap();
        assert_eq!(tx.images, vec!["https://64.media.tumblr.com/x/1.jpg".to_string(), "https://64.media.tumblr.com/y/2.jpg".to_string()]);
    }

    #[test]
    fn reads_x_photos() {
        assert_eq!(x_status_id("https://x.com/someone/status/1856321234567890123?s=20").as_deref(), Some("1856321234567890123"));
        assert_eq!(x_status_id("https://fxtwitter.com/a/status/42/photo/1").as_deref(), Some("42"));
        assert_eq!(x_status_id("https://x.com/someone"), None);
        let j: serde_json::Value = serde_json::from_str(r#"{"code":200,"tweet":{"media":{"photos":[{"type":"photo","url":"https://pbs.twimg.com/media/a.jpg"},{"type":"photo","url":"https://pbs.twimg.com/media/b.jpg"},{"url":"http://insecure/c.jpg"}],"mosaic":{"type":"mosaic_photo"}}}}"#).unwrap();
        assert_eq!(x_photos_from(&j), vec!["https://pbs.twimg.com/media/a.jpg".to_string(), "https://pbs.twimg.com/media/b.jpg".to_string()]);
        assert!(x_photos_from(&serde_json::json!({"code": 404})).is_empty());
    }

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
        assert_eq!(sources_for("https://www.fxtumblr.com/babelnimrod/832541645844119552").unwrap().0, vec!["https://tpmblr.com/babelnimrod/832541645844119552".to_string(), "https://txtumblr.com/babelnimrod/832541645844119552".to_string(), "https://www.tumblr.com/babelnimrod/832541645844119552".to_string()]);
        assert!(source_for("https://example.com/").is_none());
        assert!(source_for("http://x.com/a").is_none());
        assert_eq!(decode("hab&#x2019;s &amp; spa&#xdf; &#8217; &bogus; a&b"), "hab\u{2019}s & spa\u{df} \u{2019} &bogus; a&b");
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
        assert!(p.images.is_empty());
        let tumblr = build("https://www.tumblr.com/babelnimrod/832541645844119552", "Tumblr", &parse_meta(r#"<meta property="og:title" content="t"><meta property="og:image" content="https://64.media.tumblr.com/7154a388c08ce11848eac51291379760/3594401df49cbc37-ca/s2048x3072/2dc55359a8940ce4dbb0e596be28945a468121eb.jpg"><meta property="og:image" content="https://64.media.tumblr.com/ee781dcd3961dca08f60ea0cc77c4289/3594401df49cbc37-a2/s2048x3072/c88401d87d5568c87237044f145f76689d530176.jpg">"#)).unwrap();
        assert_eq!(tumblr.images.len(), 2);
        let tw = build("https://e.com/p", "X", &parse_meta(r#"<meta name="twitter:image" content="https://c/a.jpg"><meta name="twitter:image" content="https://c/b.jpg"><meta property="og:image" content="https://c/a.jpg">"#)).unwrap();
        assert_eq!(tw.images, vec!["https://c/a.jpg".to_string(), "https://c/b.jpg".to_string()]);
        let many = build("https://bsky.app/p", "Bluesky", &parse_meta(r#"<meta property="og:image" content="https://cdn/a.jpg"><meta property="og:image" content="https://cdn/b.jpg"><meta property="og:image" content="https://cdn/a.jpg">"#)).unwrap();
        assert_eq!(many.image.as_deref(), Some("https://cdn/a.jpg"));
        assert_eq!(many.images, vec!["https://cdn/a.jpg".to_string(), "https://cdn/b.jpg".to_string()]);
        assert!(p.image.is_none());
        // Media given as a path on the page's own site
        let mut m = parse_meta(r#"<meta property="og:title" content="t"><meta property="og:video" content="/videos/De0cudiRIbE/1">"#);
        absolutise(&mut m, "https://kkinstagram.com/reel/De0cudiRIbE/");
        assert_eq!(build("https://instagram.com/reel/De0cudiRIbE/", "Instagram", &m).unwrap().video.as_deref(), Some("https://kkinstagram.com/videos/De0cudiRIbE/1"));
    }
}
