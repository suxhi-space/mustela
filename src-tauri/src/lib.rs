mod fetch;
mod preview;
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

/// The running Mustela.app (…/Mustela.app/Contents/MacOS/mustela → …/Mustela.app).
#[cfg(target_os = "macos")]
fn mac_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let app = exe.parent()?.parent()?.parent()?.to_path_buf();
    app.extension().is_some_and(|x| x == "app").then_some(app)
}
#[cfg(target_os = "macos")]
fn writable(dir: &std::path::Path) -> bool {
    let probe = dir.join(format!(".mustela-write-test-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
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
        // macOS: replace the app in place (no "drag to Applications" window): mount the update, and once
        // Mustela has quit, swap the app bundle, unmount and open the new one. If the app's folder can't be
        // written to, fall back to opening the disk image like before.
        #[cfg(target_os = "macos")]
        updater::Kind::MacosDmg if mac_bundle().is_some_and(|b| writable(b.parent().unwrap_or(&b))) => {
            let bundle = mac_bundle().ok_or("Couldn't find Mustela.app.")?;
            let dmg = std::env::temp_dir().join(format!("Mustela-{}.dmg", info.version));
            updater::download(&asset, &dmg, progress).await?;
            let mnt = std::env::temp_dir().join(format!("mustela-update-{}", std::process::id()));
            let _ = std::fs::create_dir_all(&mnt);
            let ok = std::process::Command::new("hdiutil").args(["attach", "-nobrowse", "-noautoopen", "-quiet", "-mountpoint"]).arg(&mnt).arg(&dmg)
                .status().map(|s| s.success()).unwrap_or(false);
            if !ok { return Err("Couldn't open the update.".into()); }
            let new_app = std::fs::read_dir(&mnt).map_err(|e| e.to_string())?.flatten().map(|e| e.path())
                .find(|p| p.extension().is_some_and(|x| x == "app")).ok_or("The update has no app in it.")?;
            let q = |p: &std::path::Path| format!("'{}'", p.to_string_lossy().replace('\'', "'\\''"));
            let script = format!(
                "while kill -0 {pid} 2>/dev/null; do sleep 0.3; done; rm -rf {dest}.old; mv {dest} {dest}.old && ditto {src} {dest} && rm -rf {dest}.old || mv {dest}.old {dest}; hdiutil detach {mnt} -quiet; xattr -dr com.apple.quarantine {dest} 2>/dev/null; rm -f {dmg}; open {dest}",
                pid = std::process::id(), dest = q(&bundle), src = q(&new_app), mnt = q(&mnt), dmg = q(&dmg),
            );
            std::process::Command::new("/bin/sh").args(["-c", &script]).spawn().map_err(|e| format!("Couldn't start the update: {e}"))?;
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

/// A Stoat invite or bot link inside Discover: handled by Mustela's own dialogs instead of opening there.
#[cfg(desktop)]
fn discover_link(url: &tauri::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    let path = url.path().trim_end_matches('/');
    let known = matches!(host, "stt.gg" | "rvlt.gg" | "stoat.chat" | "app.stoat.chat" | "revolt.chat" | "app.revolt.chat");
    if !known { return false; }
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    match parts.as_slice() {
        ["invite", code] | ["bot", code] => !code.is_empty(),
        [code] => matches!(host, "stt.gg" | "rvlt.gg") && *code != "discover" && code.len() >= 4 && code.len() <= 32 && code.chars().all(|c| c.is_ascii_alphanumeric()),
        _ => false,
    }
}

/// Discover (stt.gg) in its own window. Stoat's site only lets stoat.chat show it in a frame, so it can't
/// sit inside Mustela's window; a window of its own works. Invite and bot links come back to Mustela.
#[cfg(desktop)]
#[tauri::command]
async fn open_discover(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("discover") { let _ = w.unminimize(); let _ = w.set_focus(); return Ok(()); }
    let url: tauri::Url = "https://stt.gg/discover/servers".parse().map_err(|e: url::ParseError| e.to_string())?;
    let nav = app.clone();
    let popup = app.clone();
    let send = |app: &tauri::AppHandle, u: &tauri::Url| {
        let _ = app.emit("mustela:discover-link", u.to_string());
        if let Some(m) = app.get_webview_window("main") { let _ = m.unminimize(); let _ = m.show(); let _ = m.set_focus(); }
    };
    tauri::WebviewWindowBuilder::new(&app, "discover", tauri::WebviewUrl::External(url))
        .title("Discover · Mustela")
        .inner_size(1100.0, 780.0)
        .min_inner_size(420.0, 500.0)
        .on_navigation(move |u| { if discover_link(u) { send(&nav, u); false } else { true } })
        .on_new_window(move |u, _| { if discover_link(&u) { send(&popup, &u); } else { use tauri_plugin_opener::OpenerExt; let _ = popup.opener().open_url(u.as_str(), None::<&str>); } tauri::webview::NewWindowResponse::Deny })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Starting with the computer: open the window (true) or stay in the tray (false). Kept as a file so it's
/// known before the interface loads.
#[cfg(desktop)]
#[tauri::command]
fn set_start_open(app: tauri::AppHandle, open: bool) -> Result<bool, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = dir.join("start-open");
    if open { std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?; std::fs::write(&file, b"1").map_err(|e| e.to_string())?; }
    else if file.exists() { std::fs::remove_file(&file).map_err(|e| e.to_string())?; }
    Ok(file.exists())
}
#[cfg(desktop)]
#[tauri::command]
fn start_open(app: tauri::AppHandle) -> bool {
    app.path().app_config_dir().map(|d| d.join("start-open")).is_ok_and(|p| p.exists())
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
                // Started with the computer: stay in the tray until opened, unless you chose to have the window open.
                let open_window = app.path().app_config_dir().map(|d| d.join("start-open")).is_ok_and(|p| p.exists());
                if std::env::args().any(|a| a == "--minimized") && !open_window {
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
                // Light or dark mode changed: the tray icon follows.
                if let tauri::WindowEvent::ThemeChanged(_) = event { desktop::refresh_tray(window.app_handle()); }
            }
            // Tell the main window when the pop-out is closed by its own X button.
            if window.label() == "call" {
                if let tauri::WindowEvent::Destroyed = event {
                    let _ = window.app_handle().emit("mustela:popout-closed", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![material_support, set_material, fetch_image, preview::link_preview, close_popout, activity_config, fetch_audio, update_config, check_update, install_update,
            #[cfg(desktop)] screen_sources, #[cfg(desktop)] screen_permission, #[cfg(desktop)] screen_permission_request, #[cfg(desktop)] relaunch, #[cfg(desktop)] screen_start, #[cfg(desktop)] screen_ack, #[cfg(desktop)] screen_stop, #[cfg(desktop)] screen_audio,
            #[cfg(target_os = "linux")] call_linux::voice_start_call, #[cfg(target_os = "linux")] call_linux::voice_set_mic,
            #[cfg(target_os = "linux")] call_linux::voice_set_deaf, #[cfg(target_os = "linux")] call_linux::voice_end_call,
            #[cfg(target_os = "linux")] call_linux::voice_call_state,
            #[cfg(desktop)] notify::notify_rich, #[cfg(desktop)] set_start_open, #[cfg(desktop)] open_discover, #[cfg(desktop)] start_open,
            #[cfg(desktop)] desktop::tray_state, #[cfg(desktop)] desktop::set_close_to_tray,
            #[cfg(desktop)] desktop::appimage_status, #[cfg(desktop)] desktop::appimage_install, #[cfg(desktop)] desktop::relaunch_installed])
        .run(tauri::generate_context!())
        .expect("error while running Mustela");
}
