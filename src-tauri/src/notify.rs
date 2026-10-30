//! Desktop notifications with the sender's picture, like other chat apps: "Mika (#general, Glass Garden)"
//! with their avatar. Windows shows it round in the corner and opens the chat when clicked; Linux and macOS
//! show it as the notification's picture. If anything about the picture fails, the notification still shows.

use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};

/// The avatar, fetched (https only, size-capped) and saved as a 128px PNG in the cache, reused next time.
async fn icon_file<R: Runtime>(app: &AppHandle<R>, url: &str) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("notify-icons");
    let mut h = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut h);
    let path = dir.join(format!("{:016x}.png", h.finish()));
    if path.exists() { return Some(path); }
    let bytes = crate::fetch::fetch_capped(url).await.ok()?;
    let img = image::load_from_memory(&bytes).ok()?.thumbnail(128, 128);
    std::fs::create_dir_all(&dir).ok()?;
    img.save_with_format(&path, image::ImageFormat::Png).ok()?;
    Some(path)
}

#[cfg(target_os = "windows")]
fn show<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str, icon: Option<PathBuf>, channel: Option<String>) -> Result<(), String> {
    use tauri::Emitter;
    use tauri_winrt_notification::{IconCrop, Toast};
    // Installed copies are registered under the app's id; a dev build borrows PowerShell's so toasts still show.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dev = exe.parent().is_some_and(|d| d.ends_with("target\\debug") || d.ends_with("target\\release"));
    let id = if dev { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() };
    let mut toast = Toast::new(&id).title(title).text1(body).sound(None); // Mustela plays its own sound
    if let Some(p) = &icon { toast = toast.icon(p, IconCrop::Circular, ""); }
    let handle = app.clone();
    toast = toast.on_activated(move |_| {
        if let Some(w) = handle.get_webview_window("main") { let _ = w.unminimize(); let _ = w.show(); let _ = w.set_focus(); }
        if let Some(c) = &channel { let _ = handle.emit("mustela:notify-open", c.clone()); }
        Ok(())
    });
    toast.show().map_err(|e| e.to_string())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn show<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str, icon: Option<PathBuf>, _channel: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { let _ = notify_rust::set_application(&app.config().identifier); }
    let mut n = notify_rust::Notification::new();
    n.summary(title).body(body).appname("Mustela");
    if let Some(p) = icon.as_ref().and_then(|p| p.to_str()) { n.image_path(p); }
    #[cfg(target_os = "linux")]
    { let _ = app; n.icon(&app.config().identifier); }
    n.show().map(|_| ()).map_err(|e| e.to_string())
}

/// Shows a notification. `icon` is the sender's avatar URL; `channel` is opened when it's clicked (Windows).
#[tauri::command]
pub async fn notify_rich<R: Runtime>(app: AppHandle<R>, title: String, body: String, icon: Option<String>, channel: Option<String>) -> Result<(), String> {
    let path = match icon.as_deref() { Some(u) if u.starts_with("https://") => icon_file(&app, u).await, _ => None };
    let (t, b) = (title.chars().take(200).collect::<String>(), body.chars().take(400).collect::<String>());
    // Toast and D-Bus calls can block for a moment; keep them off the async runtime.
    tauri::async_runtime::spawn_blocking(move || show(&app, &t, &b, path, channel)).await.map_err(|e| e.to_string())?
}
