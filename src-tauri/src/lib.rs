mod fetch;

use tauri::ipc::Response;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// What the window can do on this platform, so the UI only offers real choices.
#[tauri::command]
fn material_support() -> Vec<&'static str> {
    #[cfg(target_os = "windows")]
    { vec!["mica", "acrylic", "blur", "see-through"] }
    #[cfg(target_os = "macos")]
    { vec!["vibrancy", "see-through"] }
    #[cfg(target_os = "linux")]
    { vec!["see-through"] }
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

/// Opens (or raises) the small always-on-top call window. Desktop only.
/// The call itself stays in the main window; this window is a remote control
/// that talks to it over events (see src/ui/call/bridge.ts).
#[tauri::command]
fn open_popout(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(w) = app.get_webview_window("call") {
            let _ = w.show();
            return w.set_focus().map_err(|e| e.to_string());
        }
        WebviewWindowBuilder::new(&app, "call", WebviewUrl::App("index.html?popout=1".into()))
            .title("Mustela call")
            .inner_size(340.0, 420.0)
            .min_inner_size(260.0, 200.0)
            .always_on_top(true)
            .build()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(desktop))]
    { let _ = app; Err("Pop-out calls are desktop only".into()) }
}

/// Closes the call window and brings the main window back to the front.
#[tauri::command]
fn close_popout(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("call") { let _ = w.close(); }
    if let Some(m) = app.get_webview_window("main") { let _ = m.show(); let _ = m.unminimize(); let _ = m.set_focus(); }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_mustela_native::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            // Tell the main window when the pop-out is closed by its own X button.
            if window.label() == "call" {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = window.app_handle().emit("mustela:popout-closed", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![material_support, set_material, fetch_image, open_popout, close_popout])
        .run(tauri::generate_context!())
        .expect("error while running Mustela");
}
