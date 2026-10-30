mod fetch;
mod updater;
#[cfg(desktop)]
mod activity;
#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
mod screen;
#[cfg(desktop)]
mod notify;
#[cfg(target_os = "windows")]
mod wgc_capture;
#[cfg(target_os = "linux")]
mod call_linux;

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
use tauri::WebviewWindowBuilder;
#[cfg(all(desktop, not(windows)))]
use tauri::WebviewUrl;

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

/// The pop-out call window, made when the main window calls `window.open` (see
/// src/ui/call/popout.tsx). The main window draws the call into it, so the call itself never
/// moves: popping out or back in doesn't reconnect. Anything else asking for a window is refused.
#[cfg(desktop)]
fn popout_window(app: &tauri::AppHandle, features: tauri::webview::NewWindowFeatures) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    use tauri::webview::NewWindowResponse;
    // Windows: WebView2 opens the pop-out itself, the way its own pop-ups work. Making a Tauri
    // window from inside this request froze both windows there. The main window hands the
    // pop-out its styles and fonts, so it needs nothing from the app's own pages.
    #[cfg(windows)]
    { let _ = (app, features); NewWindowResponse::Allow }
    #[cfg(not(windows))]
    {
        if app.get_webview_window("call").is_some() { return NewWindowResponse::Deny; }
        let b = WebviewWindowBuilder::new(app, "call", WebviewUrl::External("about:blank".parse().expect("valid url")))
            .window_features(features)
            .title("Mustela call")
            .inner_size(800.0, 500.0)
            .min_inner_size(360.0, 240.0)
            .background_color(tauri::window::Color(17, 18, 22, 255))
            .disable_drag_drop_handler();
        // Like Discord's: a normal resizable window with a thin title bar of our own.
        #[cfg(target_os = "macos")]
        let b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
        #[cfg(not(target_os = "macos"))]
        let b = b.decorations(false);
        match b.build() {
            Ok(w) => NewWindowResponse::Create { window: w },
            Err(_) => NewWindowResponse::Deny,
        }
    }
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

/// The version, update repository and install kind baked into this build.
#[tauri::command]
fn update_config() -> updater::Config { updater::config() }

/// Asks GitHub whether a newer release exists. None means up to date.
#[tauri::command]
async fn check_update() -> Result<Option<updater::UpdateInfo>, String> {
    Ok(updater::check().await?.map(|(info, _)| info))
}

/// Downloads the new version (checked against GitHub's SHA-256) and puts it in place:
/// Windows runs the installer and restarts, an AppImage swaps itself and restarts, a Mac
/// .dmg or Linux .deb is saved to Downloads and opened. Phones open the release page instead.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<String, String> {
    let (info, asset) = updater::check().await?.ok_or("Mustela is already up to date.")?;
    let asset = asset.ok_or("This release has no file for your system. Open the release page instead.")?;
    let kind = updater::Kind::current();
    let _ = &info;
    let progress = |done: u64, total: u64| { let _ = app.emit("mustela:update-progress", (done, total)); };
    match kind {
        #[cfg(target_os = "windows")]
        updater::Kind::WindowsNsis => {
            let path = std::env::temp_dir().join(format!("Mustela-{}-setup.exe", info.version));
            updater::download(&asset, &path, progress).await?;
            use std::os::windows::process::CommandExt;
            // `start` goes through ShellExecute, so Windows can ask for admin rights (Mustela installs to Program Files).
            // /P: passive (progress bar only). /UPDATE: update in place, keeping settings. /R: start Mustela again when done.
            std::process::Command::new("cmd").args(["/C", "start", ""]).arg(&path).args(["/P", "/UPDATE", "/R"])
                .creation_flags(0x0800_0000).spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
            app.exit(0);
            Ok("Installing…".into())
        }
        #[cfg(target_os = "linux")]
        updater::Kind::LinuxAppimage => {
            let current = desktop::appimage_path().ok_or_else(|| "Mustela isn't running from an AppImage.".to_string())?.to_string_lossy().into_owned();
            let next = format!("{current}.new");
            updater::download(&asset, std::path::Path::new(&next), progress).await?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&next, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
            // Same folder, so the rename is atomic: the old file is never half-replaced.
            std::fs::rename(&next, &current).map_err(|e| { let _ = std::fs::remove_file(&next); format!("Couldn't replace the AppImage: {e}") })?;
            std::process::Command::new(&current).spawn().map_err(|e| format!("Updated, but couldn't restart: {e}"))?;
            app.exit(0);
            Ok("Restarting…".into())
        }
        #[cfg(desktop)]
        _ => {
            let dir = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(|h| std::path::PathBuf::from(h).join("Downloads"))
                .filter(|d| d.is_dir()).unwrap_or_else(std::env::temp_dir);
            let path = dir.join(&asset.name);
            updater::download(&asset, &path, progress).await?;
            use tauri_plugin_opener::OpenerExt;
            app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| format!("Saved to {}, but couldn't open it: {e}", path.display()))?;
            Ok(format!("Saved to {}. Finish the install there.", path.display()))
        }
        #[cfg(not(desktop))]
        _ => { let _ = (info, progress); Err("Open the release page to update.".into()) }
    }
}

/// Screens and windows that can be shared, with small previews (desktop).
#[cfg(desktop)]
#[tauri::command]
async fn screen_sources(thumbs: bool) -> Vec<screen::Source> {
    tauri::async_runtime::spawn_blocking(move || screen::sources(thumbs)).await.unwrap_or_default()
}

/// macOS: may Mustela record the screen? (Always yes elsewhere.)
#[cfg(desktop)]
#[tauri::command]
fn screen_permission() -> bool { screen::permitted() }

/// macOS: ask for screen recording (macOS's prompt), then open the matching page in System Settings.
#[cfg(desktop)]
#[tauri::command]
fn screen_permission_request(app: tauri::AppHandle) -> bool {
    let ok = screen::request_permission();
    #[cfg(target_os = "macos")]
    if !ok {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", None::<&str>);
    }
    let _ = &app;
    ok
}

/// Restarts Mustela (macOS only applies a new screen recording permission to a fresh start).
#[cfg(desktop)]
#[tauri::command]
fn relaunch(app: tauri::AppHandle) { app.restart() }

/// Starts sending frames of a screen or window to the page (see screen.rs).
#[cfg(desktop)]
#[tauri::command]
// Async: starting a capture can take a moment (finding the window, the first grab), and a plain
// command would hold the app's main thread, freezing every window, the pop-out included, meanwhile.
async fn screen_start(app: tauri::AppHandle, id: String, width: u32, height: u32, fps: u32, channel: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || screen::start(&app.state::<screen::ScreenState>(), &id, width, height, fps, channel)).await.map_err(|e| e.to_string())?
}
#[cfg(desktop)]
#[tauri::command]
fn screen_ack(state: tauri::State<screen::ScreenState>) { screen::ack(&state) }
#[cfg(desktop)]
#[tauri::command]
fn screen_stop(state: tauri::State<screen::ScreenState>) { screen::stop(&state) }

/// Windows: one app's sound (pid), or everything but Mustela (pid 0), for a screen share.
#[cfg(desktop)]
#[tauri::command]
async fn screen_audio(app: tauri::AppHandle, pid: u32, channel: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    { tauri::async_runtime::spawn_blocking(move || screen::start_audio(&app.state::<screen::ScreenState>(), pid, channel)).await.map_err(|e| e.to_string())? }
    #[cfg(not(target_os = "windows"))]
    { let _ = (app, pid, channel); Err("Sharing an app's sound works on Windows for now.".into()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // A second launch focuses the running Mustela instead of starting another copy.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| desktop::show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        // Remembers each window's size and place (the main window and the call pop-out). Visibility is
        // left alone so "start minimised to the tray" still works.
        .plugin(tauri_plugin_window_state::Builder::default()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE & !tauri_plugin_window_state::StateFlags::DECORATIONS)
            .build());
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
            // Desktop: the main window is made here rather than from the config alone, so it can
            // open the call pop-out (window.open) as a window of its own.
            #[cfg(desktop)]
            if app.get_webview_window("main").is_none() {
                if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main").cloned() {
                    let handle = app.handle().clone();
                    WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                        .on_new_window(move |_url, features| popout_window(&handle, features))
                        .build()?;
                }
            }
            #[cfg(desktop)]
            {
                app.manage(activity::ActivityState::default());
                app.manage(screen::ScreenState::default());
                #[cfg(target_os = "linux")]
                app.manage(call_linux::VoiceState::default());
                #[cfg(target_os = "linux")]
                std::thread::spawn(desktop::appimage_on_start);
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
        .invoke_handler(tauri::generate_handler![material_support, set_material, fetch_image, close_popout, activity_config, fetch_audio, update_config, check_update, install_update,
            #[cfg(desktop)] screen_sources, #[cfg(desktop)] screen_permission, #[cfg(desktop)] screen_permission_request, #[cfg(desktop)] relaunch, #[cfg(desktop)] screen_start, #[cfg(desktop)] screen_ack, #[cfg(desktop)] screen_stop, #[cfg(desktop)] screen_audio,
            #[cfg(target_os = "linux")] call_linux::voice_start_call, #[cfg(target_os = "linux")] call_linux::voice_set_mic,
            #[cfg(target_os = "linux")] call_linux::voice_set_deaf, #[cfg(target_os = "linux")] call_linux::voice_end_call,
            #[cfg(target_os = "linux")] call_linux::voice_call_state,
            #[cfg(desktop)] notify::notify_rich,
            #[cfg(desktop)] desktop::tray_state, #[cfg(desktop)] desktop::set_close_to_tray,
            #[cfg(desktop)] desktop::appimage_status, #[cfg(desktop)] desktop::appimage_install, #[cfg(desktop)] desktop::relaunch_installed])
        .run(tauri::generate_context!())
        .expect("error while running Mustela");
}
