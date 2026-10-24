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
    let parsed = validate_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|_| "client".to_string())?;
    let mut resp = client.get(parsed).send().await.map_err(|_| "network".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status().as_u16()));
    }
    if resp.content_length().map_or(false, |n| n as usize > MAX_BYTES) {
        return Err("too large".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| "network".to_string())? {
        if out.len() + chunk.len() > MAX_BYTES {
            return Err("too large".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
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
    fn public_ip_literals_are_allowed() {
        assert!(validate_url("https://1.1.1.1/a").is_ok());
    }
}
