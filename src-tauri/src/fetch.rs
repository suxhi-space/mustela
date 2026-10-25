//! Image fetching for the webview, kept free of Tauri types so it can be
//! compiled and unit-tested anywhere.

use std::net::IpAddr;
use std::time::Duration;

pub const MAX_BYTES: usize = 4 * 1024 * 1024;

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00 /* unique local */ || (v6.segments()[0] & 0xffc0) == 0xfe80 /* link local */,
    }
}

/// https only, and no localhost / private IP literals.
///
/// Limit: a hostname that *resolves* to a private address is not caught here.
/// The URLs we fetch come from the user's own Stoat instance, but a hardened
/// build should resolve first and check the address.
pub fn validate_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "bad url".to_string())?;
    if parsed.scheme() != "https" {
        return Err("https only".into());
    }
    match parsed.host() {
        Some(url::Host::Domain(d)) if d.eq_ignore_ascii_case("localhost") || d.ends_with(".localhost") => Err("blocked host".into()),
        Some(url::Host::Ipv4(ip)) if is_blocked_ip(IpAddr::V4(ip)) => Err("blocked host".into()),
        Some(url::Host::Ipv6(ip)) if is_blocked_ip(IpAddr::V6(ip)) => Err("blocked host".into()),
        None => Err("bad url".into()),
        _ => Ok(parsed),
    }
}

pub async fn fetch_capped(url: &str) -> Result<Vec<u8>, String> {
    Ok(fetch_typed(url, MAX_BYTES).await?.0)
}

const AUDIO_EXT: [&str; 7] = [".mp3", ".ogg", ".wav", ".m4a", ".opus", ".webm", ".aac"];

/// The first audio file a soundboard page links to: og:audio, <audio>/<source> src,
/// or any quoted path ending in an audio extension (MyInstants puts it in play('…')).
pub fn find_audio_link(html: &str, base: &reqwest::Url) -> Option<reqwest::Url> {
    let lower = html.to_ascii_lowercase();
    let mut candidates: Vec<String> = vec![];
    if let Some(i) = lower.find("og:audio") {
        if let Some(c) = lower[i..].find("content=") {
            let start = i + c + 8;
            let q = html.as_bytes().get(start).copied();
            if q == Some(b'"') || q == Some(b'\'') {
                let rest = &html[start + 1..];
                if let Some(end) = rest.find(q.unwrap() as char) { candidates.push(rest[..end].to_string()); }
            }
        }
    }
    // Quoted strings ending in an audio extension, in page order.
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let q = bytes[i];
        if q == b'"' || q == b'\'' {
            if let Some(len) = html[i + 1..].find(q as char) {
                let s = &html[i + 1..i + 1 + len];
                let sl = s.to_ascii_lowercase();
                let path = sl.split(['?', '#']).next().unwrap_or("");
                if len < 600 && !s.contains(['<', '>', ' ', '(', ',']) && AUDIO_EXT.iter().any(|e| path.ends_with(e)) {
                    candidates.push(s.to_string());
                    i += len + 2;
                    continue;
                }
            }
        }
        i += 1;
    }
    candidates.into_iter().filter_map(|c| base.join(&c.replace("&amp;", "&")).ok()).find(|u| u.scheme() == "https")
}

/// A soundboard clip from a direct audio link or a page that has one (MyInstants and similar).
pub async fn fetch_audio(url: &str) -> Result<Vec<u8>, String> {
    let (bytes, ctype) = fetch_typed(url, 8 * 1024 * 1024).await?;
    let path = url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if ctype.starts_with("audio/") || ctype.starts_with("video/") || AUDIO_EXT.iter().any(|e| path.ends_with(e)) { return Ok(bytes); }
    if !ctype.contains("html") { return Err("not audio".into()); }
    let html = String::from_utf8_lossy(&bytes);
    let link = find_audio_link(&html, &validate_url(url)?).ok_or_else(|| "no sound on that page".to_string())?;
    let (audio, _) = fetch_typed(link.as_str(), 8 * 1024 * 1024).await?;
    Ok(audio)
}

async fn fetch_typed(url: &str, max: usize) -> Result<(Vec<u8>, String), String> {
    let parsed = validate_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Mozilla/5.0 (compatible; Mustela)")
        .build()
        .map_err(|_| "client".to_string())?;
    let mut resp = client.get(parsed).send().await.map_err(|_| "network".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status().as_u16()));
    }
    if resp.content_length().map_or(false, |n| n as usize > max) {
        return Err("too large".into());
    }
    let ctype = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    let mut out = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| "network".to_string())? {
        if out.len() + chunk.len() > max {
            return Err("too large".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok((out, ctype))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_https() {
        assert!(validate_url("https://autumn.revolt.chat/backgrounds/abc").is_ok());
        assert!(validate_url("https://example.com:8443/x.png").is_ok());
    }

    #[test]
    fn rejects_other_schemes() {
        for u in ["http://example.com/a.png", "file:///etc/passwd", "ftp://x/y", "data:text/plain,hi", "javascript:alert(1)"] {
            assert!(validate_url(u).is_err(), "{u}");
        }
    }

    #[test]
    fn rejects_local_and_private_targets() {
        for u in [
            "https://localhost/a", "https://LOCALHOST/a", "https://app.localhost/a",
            "https://127.0.0.1/a", "https://10.0.0.5/a", "https://192.168.1.1/a", "https://172.16.0.1/a",
            "https://169.254.169.254/latest/meta-data", "https://0.0.0.0/a",
            "https://[::1]/a", "https://[fd00::1]/a", "https://[fe80::1]/a",
        ] {
            assert!(validate_url(u).is_err(), "{u}");
        }
    }

    #[test]
    fn rejects_garbage() {
        for u in ["", "not a url", "https://", "//example.com"] {
            assert!(validate_url(u).is_err(), "{u:?}");
        }
    }

    #[test]
    fn finds_audio_on_pages() {
        let base = reqwest::Url::parse("https://www.myinstants.com/en/instant/vine-boom-sound-70972/").unwrap();
        let html = r#"<button class="small-button" onclick="play('/media/sounds/vine-boom.mp3', 'loader-1', '70972')"></button>"#;
        assert_eq!(find_audio_link(html, &base).unwrap().as_str(), "https://www.myinstants.com/media/sounds/vine-boom.mp3");
        let og = r#"<meta property="og:audio" content="https://cdn.example.com/a/b.ogg">"#;
        assert_eq!(find_audio_link(og, &base).unwrap().as_str(), "https://cdn.example.com/a/b.ogg");
        let src = r#"<audio controls><source src="sounds/x.wav?v=2" type="audio/wav"></audio>"#;
        assert_eq!(find_audio_link(src, &base).unwrap().as_str(), "https://www.myinstants.com/en/instant/vine-boom-sound-70972/sounds/x.wav?v=2");
        assert!(find_audio_link("<p>nothing here</p>", &base).is_none());
        assert!(find_audio_link(r#"<a href="http://insecure.example/a.mp3">"#, &base).is_none());
    }

    #[test]
    fn public_ip_literals_are_allowed() {
        assert!(validate_url("https://1.1.1.1/a").is_ok());
    }
}
