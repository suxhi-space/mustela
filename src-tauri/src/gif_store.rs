//! Your favorite GIFs kept on this device, so the GIF picker's Favorites show at once instead of downloading again
//! every time. The app tells Mustela which GIFs are favorites (`warm_gifs`); only those are ever fetched (https only,
//! no private addresses, size-capped) and stored in the app's cache folder, and ones you un-favorite are deleted.
//! The picker shows them through `gifs://localhost/?u=<link>` (on Windows and Android `http://gifs.localhost/?u=…`).

use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

const MAX_BYTES: usize = 20 * 1024 * 1024;
static FAVS: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn key(url: &str) -> String { Sha256::digest(url.as_bytes()).iter().map(|b| format!("{b:02x}")).collect() }
fn folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> { app.path().app_cache_dir().ok().map(|d| d.join("gifs")) }
fn allowed(url: &str) -> bool { FAVS.lock().ok().and_then(|g| g.as_ref().map(|s| s.contains(url))).unwrap_or(false) }

/// What the bytes are, from their first few (the links often have no file extension).
pub fn sniff(b: &[u8]) -> &'static str {
    if b.starts_with(b"GIF8") { "image/gif" }
    else if b.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) { "video/webm" }
    else if b.len() > 12 && &b[4..8] == b"ftyp" { "video/mp4" }
    else if b.len() > 12 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" { "image/webp" }
    else if b.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" }
    else if b.starts_with(&[0xFF, 0xD8, 0xFF]) { "image/jpeg" }
    else { "application/octet-stream" }
}

/// `Range: bytes=a-b` (video players ask for parts), clamped to the file.
pub fn range(header: Option<&str>, len: usize) -> Option<(usize, usize)> {
    let spec = header?.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if len == 0 { return None; }
    let (start, end) = if a.is_empty() {
        let n: usize = b.parse().ok()?; (len.saturating_sub(n), len - 1)
    } else {
        let s: usize = a.parse().ok()?; (s, b.parse::<usize>().ok().map_or(len - 1, |e| e.min(len - 1)))
    };
    (start <= end && start < len).then_some((start, end))
}

fn reply(status: StatusCode, kind: &str, body: Vec<u8>, extra: Option<String>) -> Response<Vec<u8>> {
    let mut r = Response::builder().status(status).header("Content-Type", kind).header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-cache").header("Access-Control-Allow-Origin", "*");
    if let Some(cr) = extra { r = r.header("Content-Range", cr); }
    r.body(body).unwrap_or_else(|_| Response::new(Vec::new()))
}

async fn fetch(url: &str) -> Option<Vec<u8>> {
    let target = crate::fetch::validate_url(url).ok()?;
    let c = crate::fetch::outside_client(Duration::from_secs(40)).build().ok()?;
    let mut r = c.get(target).send().await.ok()?;
    if !r.status().is_success() || r.content_length().is_some_and(|n| n as usize > MAX_BYTES) { return None; }
    let mut buf = Vec::new();
    while let Some(chunk) = r.chunk().await.ok()? {
        if buf.len() + chunk.len() > MAX_BYTES { return None; }
        buf.extend_from_slice(&chunk);
    }
    (!buf.is_empty()).then_some(buf)
}

async fn stored<R: Runtime>(app: &AppHandle<R>, url: &str) -> Option<Vec<u8>> {
    let path = folder(app)?.join(key(url));
    if let Ok(b) = std::fs::read(&path) { if !b.is_empty() { return Some(b); } }
    if !allowed(url) { return None; }
    let b = fetch(url).await?;
    if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
    let tmp = path.with_extension("part");
    if std::fs::write(&tmp, &b).is_ok() { let _ = std::fs::rename(&tmp, &path); }
    Some(b)
}

pub async fn serve<R: Runtime>(app: AppHandle<R>, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let url = req.uri().query().and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("u=")))
        .and_then(urlencoding_decode);
    let Some(url) = url.filter(|u| u.starts_with("https://")) else { return reply(StatusCode::NOT_FOUND, "text/plain", Vec::new(), None) };
    let Some(bytes) = stored(&app, &url).await else { return reply(StatusCode::NOT_FOUND, "text/plain", Vec::new(), None) };
    let kind = sniff(&bytes);
    match range(req.headers().get("range").and_then(|v| v.to_str().ok()), bytes.len()) {
        Some((a, b)) => { let total = bytes.len(); reply(StatusCode::PARTIAL_CONTENT, kind, bytes[a..=b].to_vec(), Some(format!("bytes {a}-{b}/{total}"))) }
        None => reply(StatusCode::OK, kind, bytes, None),
    }
}

fn urlencoding_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => { out.push(u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).ok()?, 16).ok()?); i += 3; }
            b'+' => { out.push(b' '); i += 1; }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8(out).ok()
}

/// The current favorites: download any not kept yet (in the background), and forget the ones no longer favorited.
#[tauri::command]
pub fn warm_gifs(app: AppHandle, urls: Vec<String>) {
    let urls: Vec<String> = urls.into_iter().filter(|u| u.starts_with("https://") && u.len() < 2048).take(300).collect();
    if let Ok(mut g) = FAVS.lock() { *g = Some(urls.iter().cloned().collect()); }
    let Some(dir) = folder(&app) else { return };
    let keep: HashSet<String> = urls.iter().map(|u| key(u.as_str())).collect();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() { if !keep.contains(&e.file_name().to_string_lossy().to_string()) { let _ = std::fs::remove_file(e.path()); } }
    }
    tauri::async_runtime::spawn(async move {
        for u in urls { if !dir.join(key(&u)).exists() { let _ = stored(&app, &u).await; } }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_and_types() {
        assert_eq!(range(Some("bytes=0-"), 100), Some((0, 99)));
        assert_eq!(range(Some("bytes=10-19"), 100), Some((10, 19)));
        assert_eq!(range(Some("bytes=-10"), 100), Some((90, 99)));
        assert_eq!(range(Some("bytes=50-500"), 100), Some((50, 99)));
        assert_eq!(range(Some("bytes=200-"), 100), None);
        assert_eq!(range(None, 100), None);
        assert_eq!(sniff(b"GIF89a...."), "image/gif");
        assert_eq!(sniff(&[0x1A, 0x45, 0xDF, 0xA3, 0, 0]), "video/webm");
        assert_eq!(urlencoding_decode("https%3A%2F%2Fa.b%2Fc%3Fd%3D1").as_deref(), Some("https://a.b/c?d=1"));
    }
}
