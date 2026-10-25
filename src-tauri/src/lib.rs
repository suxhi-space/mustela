mod fetch;
#[cfg(desktop)]
mod activity;
#[cfg(desktop)]
mod desktop;

/// Phones have no game detection or Rich Presence socket.
#[cfg(not(desktop))]
#[derive(serde::Serialize)]
struct NoActivity { rpc: &'static str, detect: &'static str }
#[cfg(not(desktop))]
#[tauri::command]
fn activity_config(detect: bool, rpc: bool) -> NoActivity { let _ = (detect, rpc); NoActivity { rpc: "unsupported", detect: "unsupported" } }
#[cfg(desktop)]
use activity::activity_config;

use tauri::ipc::Response;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// What the window can do on this platform, so the UI only offers real choices.
#[tauri::command]
fn material_support() -> Vec<&'static str> {
    #[cfg(target_os = "windows")]
    { vec!["mica", "acrylic", "blur"] }
    #[cfg(target_os = "macos")]
    { vec!["vibrancy"] }
    #[cfg(target_os = "linux")]
    { vec![] }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    { vec![] }
}

/// Applies (or removes) a native window material. Returns true if the OS accepted it.
/// "see-through" needs no native call: the window is already transparent, and
/// the page simply paints its surfaces with some opacity. Whether the desktop
/// then blurs what's behind it is up to the compositor (KDE can; many cannot).
#[tauri::command]
fn set_material(window: tauri::WebviewWindow, kind: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::*;
        let _ = (clear_mica(&window), clear_acrylic(&window), clear_blur(&window));
        let r = match kind.as_str() {
            "mica" => apply_mica(&window, None),
            "acrylic" => apply_acrylic(&window, Some((18, 18, 18, 125))),
            "blur" => apply_blur(&window, Some((18, 18, 18, 125))),
            _ => return Ok(kind == "none" || kind == "see-through"),
        };
        return Ok(r.is_ok());
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::*;
        let _ = clear_vibrancy(&window);
        return match kind.as_str() {
            "vibrancy" => Ok(apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None).is_ok()),
            _ => Ok(kind == "none" || kind == "see-through"),
        };
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = &window;
        Ok(kind == "none" || kind == "see-through")
    }
}

/// Fetches an image (profile banners) for the webview. Doing this in Rust means
/// no CORS dependence, a hard size cap, a timeout, and https-only (see fetch.rs).
#[tauri::command]
async fn fetch_image(url: String) -> Result<Response, String> {
    Ok(Response::new(fetch::fetch_capped(&url).await?))
}

/// Downloads a soundboard clip from a direct link or a soundboard page (MyInstants and similar).
#[tauri::command]
async fn fetch_audio(url: String) -> Result<Response, String> {
    Ok(Response::new(fetch::fetch_audio(&url).await?))
}

/// Opens (or raises) the pop-out call window. Desktop only. The call moves into
/// it (see src/ui/call/state.ts) and moves back when it closes.
#[tauri::command]
fn open_popout(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(w) = app.get_webview_window("call") {
            let _ = w.show();
            return w.set_focus().map_err(|e| e.to_string());
        }
        // Like Discord's: a normal resizable window with a thin title bar of our own.
        let b = WebviewWindowBuilder::new(&app, "call", WebviewUrl::App("index.html?popout=1".into()))
            .title("Mustela call")
            .inner_size(800.0, 500.0)
            .min_inner_size(360.0, 240.0)
            .disable_drag_drop_handler();
        #[cfg(target_os = "macos")]
        let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
        #[cfg(not(target_os = "macos"))]
        let b = b.decorations(false);
        let w = b.build()            .map_err(|e| e.to_string())?;
        // The call runs in this window now, so it needs camera, mic and screen capture (Linux: off by default).
        #[cfg(target_os = "linux")]
        let _ = w.with_webview(|wv| {
            use webkit2gtk::{SettingsExt, WebViewExt};
            if let Some(s) = WebViewExt::settings(&wv.inner()) { s.set_enable_media_stream(true); s.set_enable_webrtc(true); s.set_enable_mediasource(true); }
        });
        let _ = &w;
        Ok(())
    }
    #[cfg(not(desktop))]
    { let _ = app; Err("Pop-out calls are desktop only".into()) }
}

/// Closes the call window and brings the main window back to the front.
#[tauri::command]
fn close_popout(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("call") { let _ = w.close(); }
    if let Some(m) = app.get_webview_window("main") {
        let _ = m.show();
        // Minimizing only exists on desktop; Android and iOS have no such state.
        #[cfg(desktop)]
        let _ = m.unminimize();
        let _ = m.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // A second launch focuses the running Mustela instead of starting another copy.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])));
    builder
        // Voice, camera and screen share run in the webview. The app only loads its own
        // bundled pages (see the CSP), so granting these to it is the same as a browser
        // remembering "allow" for one site.
        .on_permission_request(|_webview, kind| {
            use tauri::webview::{PermissionKind as K, PermissionResponse as R};
            match kind {
                K::Microphone | K::Camera | K::DisplayCapture | K::Notifications | K::Autoplay => R::Allow,
                _ => R::Default,
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.manage(activity::ActivityState::default());
                desktop::setup(app)?;
                // Started with the computer: stay in the tray until opened.
                if std::env::args().any(|a| a == "--minimized") {
                    if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
                }
            }
            #[cfg(target_os = "linux")]
            for label in ["main", "call"] {
                if let Some(w) = app.get_webview_window(label) {
                    let _ = w.with_webview(|wv| {
                        use webkit2gtk::{SettingsExt, WebViewExt};
                        if let Some(s) = WebViewExt::settings(&wv.inner()) {
                            s.set_enable_media_stream(true);
                            s.set_enable_webrtc(true);
                            s.set_enable_mediasource(true);
                        }
                    });
                }
            }
            let _ = app;
            Ok(())
        })
        .plugin(tauri_plugin_mustela_native::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            // Closing the main window hides it to the tray, so reopening is instant and calls keep going.
            #[cfg(desktop)]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if desktop::closes_to_tray(window.app_handle()) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
            // Tell the main window when the pop-out is closed by its own X button.
            if window.label() == "call" {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = window.app_handle().emit("mustela:popout-closed", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![material_support, set_material, fetch_image, open_popout, close_popout, activity_config, fetch_audio,
            #[cfg(desktop)] desktop::tray_state, #[cfg(desktop)] desktop::set_close_to_tray,
            #[cfg(desktop)] desktop::appimage_status, #[cfg(desktop)] desktop::appimage_install, #[cfg(desktop)] desktop::relaunch_installed])
        .run(tauri::generate_context!())
        .expect("error while running Mustela");
}
