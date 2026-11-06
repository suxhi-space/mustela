//! Emoji pictures kept on this device. The app asks for `emoji://localhost/<style>/<codepoints>.svg` (on Windows and
//! Android `http://emoji.localhost/...`); the first time, the picture comes from Stoat's emoji server and is saved in
//! the app's cache folder, and every time after that it's read from disk: instant, and it works offline. Only Stoat's
//! emoji server is ever asked, only for style and file names made of plain letters, digits and dashes, and pictures
//! are size-capped.

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

const UPSTREAM: &str = "https://static.stoat.chat/emoji";
const MAX_BYTES: usize = 512 * 1024;

fn client() -> Option<&'static reqwest::Client> {
    static C: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().ok()).as_ref()
}

/// `<style>/<codepoints>.svg` from the request's path, or None for anything else.
pub fn parse(path: &str) -> Option<(String, String)> {
    let mut parts = path.trim_start_matches('/').split('/');
    let (pack, file) = (parts.next()?, parts.next()?);
    if parts.next().is_some() { return None; }
    let plain = |s: &str, max: usize| !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    let stem = file.strip_suffix(".svg")?;
    (plain(pack, 24) && plain(stem, 80)).then(|| (pack.to_string(), file.to_string()))
}

fn reply(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", if status == StatusCode::OK { "image/svg+xml" } else { "text/plain" })
        // The picture for a name never changes, so the web view can keep it too.
        .header("Cache-Control", if status == StatusCode::OK { "public, max-age=31536000, immutable" } else { "no-store" })
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_cache_dir().ok().map(|d| d.join("emoji"))
}

pub async fn serve<R: Runtime>(app: AppHandle<R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some((pack, file)) = parse(req.uri().path()) else { return reply(StatusCode::NOT_FOUND, Vec::new()) };
    let on_disk = folder(&app).map(|d| d.join(&pack).join(&file));
    if let Some(p) = &on_disk {
        if let Ok(bytes) = tokio_read(p).await { if !bytes.is_empty() { return reply(StatusCode::OK, bytes); } }
    }
    let Some(c) = client() else { return reply(StatusCode::SERVICE_UNAVAILABLE, Vec::new()) };
    let Ok(resp) = c.get(format!("{UPSTREAM}/{pack}/{file}?v=1")).send().await else { return reply(StatusCode::BAD_GATEWAY, Vec::new()) };
    if !resp.status().is_success() { return reply(StatusCode::NOT_FOUND, Vec::new()); }
    if resp.content_length().is_some_and(|n| n as usize > MAX_BYTES) { return reply(StatusCode::NOT_FOUND, Vec::new()); }
    let Ok(bytes) = resp.bytes().await else { return reply(StatusCode::BAD_GATEWAY, Vec::new()) };
    if bytes.len() > MAX_BYTES || !bytes.windows(4).take(4096).any(|w| w == b"<svg") { return reply(StatusCode::NOT_FOUND, Vec::new()); }
    if let Some(p) = on_disk {
        // Written to a side file and renamed, so a half-written picture is never served.
        let tmp = p.with_extension("svg.part");
        let data = bytes.to_vec();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            if let Some(dir) = p.parent() { let _ = std::fs::create_dir_all(dir); }
            if std::fs::write(&tmp, &data).is_ok() { let _ = std::fs::rename(&tmp, &p); }
        }).await;
    }
    reply(StatusCode::OK, bytes.to_vec())
}

async fn tokio_read(p: &std::path::Path) -> std::io::Result<Vec<u8>> {
    let p = p.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || std::fs::read(p)).await.unwrap_or_else(|e| Err(std::io::Error::other(e.to_string())))
}

/// How much the saved emoji take up (Settings > Advanced).
#[tauri::command]
pub fn emoji_store_size(app: AppHandle) -> u64 {
    fn walk(d: &std::path::Path) -> u64 {
        std::fs::read_dir(d).map(|r| r.flatten().map(|e| {
            let p = e.path();
            if p.is_dir() { walk(&p) } else { e.metadata().map(|m| m.len()).unwrap_or(0) }
        }).sum()).unwrap_or(0)
    }
    folder(&app).map(|d| walk(&d)).unwrap_or(0)
}

#[tauri::command]
pub fn clear_emoji_store(app: AppHandle) {
    if let Some(d) = folder(&app) { let _ = std::fs::remove_dir_all(d); }
}

#[cfg(test)]
mod tests {
    use super::parse;
    #[test]
    fn only_plain_names() {
        assert_eq!(parse("/fluent-3d/1f600.svg"), Some(("fluent-3d".into(), "1f600.svg".into())));
        assert_eq!(parse("/twemoji/1f468-200d-1f469-200d-1f467.svg").unwrap().1, "1f468-200d-1f469-200d-1f467.svg");
        for bad in ["/../etc/passwd", "/fluent-3d/../../x.svg", "/fluent-3d/1F600.svg", "/fluent-3d/1f600.png", "/a/b/c.svg", "/fluent-3d/.svg", "//x.svg"] {
            assert!(parse(bad).is_none(), "{bad}");
        }
    }
}
