//! Desktop-only shell features: the tray icon, closing to the tray, single
//! instance focus, and installing the Linux AppImage like a normal app.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{image::Image, AppHandle, Emitter, Manager, Runtime};

pub struct Shell<R: Runtime> {
    pub close_to_tray: AtomicBool,
    tray: Mutex<Option<TrayIcon<R>>>,
    mute: Mutex<Option<CheckMenuItem<R>>>,
    deafen: Mutex<Option<CheckMenuItem<R>>>,
    leave: Mutex<Option<MenuItem<R>>>,
}

const ICON: &[u8] = include_bytes!("../icons/tray.png");
const ICON_CALL: &[u8] = include_bytes!("../icons/tray-call.png");

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn setup<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let h = app.handle();
    let open = MenuItem::with_id(h, "open", "Open Mustela", true, None::<&str>)?;
    let mute = CheckMenuItem::with_id(h, "mute", "Mute", false, false, None::<&str>)?;
    let deafen = CheckMenuItem::with_id(h, "deafen", "Deafen", false, false, None::<&str>)?;
    let leave = MenuItem::with_id(h, "leave", "Leave call", false, None::<&str>)?;
    let settings = MenuItem::with_id(h, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(h, "quit", "Quit Mustela", true, None::<&str>)?;
    let menu = Menu::with_items(h, &[
        &open, &PredefinedMenuItem::separator(h)?, &mute, &deafen, &leave,
        &PredefinedMenuItem::separator(h)?, &settings, &quit,
    ])?;
    let tray = TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(ICON)?)
        .tooltip("Mustela")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            "settings" => { show_main(app); let _ = app.emit("tray://action", "settings"); }
            other => { let _ = app.emit("tray://action", other); }
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        })
        .build(h)?;
    app.manage(Shell {
        close_to_tray: AtomicBool::new(true),
        tray: Mutex::new(Some(tray)),
        mute: Mutex::new(Some(mute)),
        deafen: Mutex::new(Some(deafen)),
        leave: Mutex::new(Some(leave)),
    });
    Ok(())
}

/// The webview reports the call state so the tray can show it.
#[tauri::command]
pub fn tray_state<R: Runtime>(app: AppHandle<R>, in_call: bool, channel: Option<String>, mic: bool, deaf: bool) {
    let Some(s) = app.try_state::<Shell<R>>() else { return };
    {
        let tray = s.tray.lock().unwrap();
        if let Some(t) = tray.as_ref() {
            let _ = t.set_icon(Image::from_bytes(if in_call { ICON_CALL } else { ICON }).ok());
            let tip = match (&channel, in_call) { (Some(c), true) => format!("Mustela: in {c}"), _ => "Mustela".to_string() };
            let _ = t.set_tooltip(Some(tip));
        }
    }
    { let g = s.mute.lock().unwrap(); if let Some(m) = g.as_ref() { let _ = m.set_enabled(in_call); let _ = m.set_checked(in_call && !mic); } }
    { let g = s.deafen.lock().unwrap(); if let Some(d) = g.as_ref() { let _ = d.set_enabled(in_call); let _ = d.set_checked(in_call && deaf); } }
    { let g = s.leave.lock().unwrap(); if let Some(l) = g.as_ref() { let _ = l.set_enabled(in_call); } }
}

#[tauri::command]
pub fn set_close_to_tray<R: Runtime>(app: AppHandle<R>, on: bool) {
    if let Some(s) = app.try_state::<Shell<R>>() { s.close_to_tray.store(on, Ordering::Relaxed); }
}

pub fn closes_to_tray<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Shell<R>>().map(|s| s.close_to_tray.load(Ordering::Relaxed)).unwrap_or(false)
}

/* ------------------------------------------------------------------ AppImage */

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppImageStatus { is_app_image: bool, installed: bool, path: Option<String> }

#[cfg(target_os = "linux")]
fn home() -> Option<std::path::PathBuf> { std::env::var_os("HOME").map(std::path::PathBuf::from) }

/// Where this AppImage lives now. Installing moves it while it runs, so the moved path is kept here
/// (the APPIMAGE variable still names the old place) and the updater replaces the right file.
#[cfg(target_os = "linux")]
static APPIMAGE_NOW: std::sync::Mutex<Option<std::path::PathBuf>> = std::sync::Mutex::new(None);
#[cfg(target_os = "linux")]
pub fn appimage_path() -> Option<std::path::PathBuf> {
    APPIMAGE_NOW.lock().ok().and_then(|p| p.clone()).or_else(|| std::env::var_os("APPIMAGE").map(std::path::PathBuf::from))
}

#[cfg(target_os = "linux")]
const ENTRY: &str = "mustela.desktop";
#[cfg(target_os = "linux")]
fn desktop_entry(exec: &std::path::Path) -> String {
    format!(
        "[Desktop Entry]\nType=Application\nName=Mustela\nComment=Chat on Stoat\nExec=\"{}\" %U\nIcon=mustela\nTerminal=false\nCategories=Network;InstantMessaging;Chat;\nStartupWMClass=mustela\nKeywords=stoat;revolt;chat;voice;\n",
        exec.display()
    )
}
#[cfg(target_os = "linux")]
fn install_icons(h: &std::path::Path) {
    for (size, bytes) in [("128x128", &include_bytes!("../icons/128x128.png")[..]), ("256x256", &include_bytes!("../icons/128x128@2x.png")[..])] {
        let dir = h.join(format!(".local/share/icons/hicolor/{size}/apps"));
        if std::fs::create_dir_all(&dir).is_ok() { let _ = std::fs::write(dir.join("mustela.png"), bytes); }
    }
}

/// On every start, like VRCX: an AppImage already in ~/Applications gets its fixed name back, and an
/// existing menu entry (and desktop shortcut) is pointed at wherever the AppImage is now, so shortcuts
/// never break after a move, a rename or an update.
#[cfg(target_os = "linux")]
pub fn appimage_on_start() {
    use std::fs;
    let (Some(mut cur), Some(h)) = (appimage_path(), home()) else { return };
    let fixed = h.join("Applications/Mustela.AppImage");
    if cur.parent() == fixed.parent() && cur != fixed && fs::rename(&cur, &fixed).is_ok() {
        cur = fixed;
        if let Ok(mut p) = APPIMAGE_NOW.lock() { *p = Some(cur.clone()); }
    }
    let app_entry = h.join(".local/share/applications").join(ENTRY);
    if !app_entry.exists() { return; } // not installed: the app offers to install instead
    let want = desktop_entry(&cur);
    if fs::read_to_string(&app_entry).ok().as_deref() != Some(want.as_str()) {
        let _ = fs::write(&app_entry, &want);
        install_icons(&h);
        let _ = std::process::Command::new("update-desktop-database").arg(app_entry.parent().unwrap()).status();
    }
    if let Some(desk) = desktop_dir(&h) {
        let f = desk.join(ENTRY);
        if f.exists() && fs::read_to_string(&f).ok().as_deref() != Some(want.as_str()) { let _ = fs::write(&f, &want); }
    }
}

#[cfg(target_os = "linux")]
fn desktop_dir(h: &std::path::Path) -> Option<std::path::PathBuf> {
    std::process::Command::new("xdg-user-dir").arg("DESKTOP").output().ok()
        .and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| std::path::PathBuf::from(s.trim()))
        .filter(|p| p.is_dir() && p != h).or_else(|| Some(h.join("Desktop")).filter(|p| p.is_dir()))
}

/// Running from an AppImage? And is it already in ~/Applications with a menu entry?
#[tauri::command]
pub fn appimage_status() -> AppImageStatus {
    #[cfg(target_os = "linux")]
    {
        let path = appimage_path();
        let installed = match (&path, home()) {
            (Some(p), Some(h)) => p.starts_with(h.join("Applications")) && h.join(".local/share/applications").join(ENTRY).exists(),
            _ => false,
        };
        return AppImageStatus { is_app_image: path.is_some(), installed, path: path.map(|p| p.to_string_lossy().into_owned()) };
    }
    #[cfg(not(target_os = "linux"))]
    AppImageStatus { is_app_image: false, installed: false, path: None }
}

/// Moves the AppImage to ~/Applications/Mustela.AppImage, adds an app-menu entry and icon,
/// and optionally a desktop shortcut. Returns the new path. Relaunch to run from there.
#[tauri::command]
pub fn appimage_install(desktop_shortcut: bool) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        use std::fs;
        use std::os::unix::fs::PermissionsExt;
        let src = appimage_path().ok_or_else(|| "Mustela isn't running from an AppImage.".to_string())?;
        let h = home().ok_or("No home folder.")?;
        let apps = h.join("Applications");
        fs::create_dir_all(&apps).map_err(|e| e.to_string())?;
        let dest = apps.join("Mustela.AppImage");
        if src != dest {
            // Moved, not copied (no second copy left behind). Across disks: copy, then remove the original.
            // The running Mustela keeps working either way.
            if fs::rename(&src, &dest).is_err() {
                fs::copy(&src, &dest).map_err(|e| format!("Couldn't copy the AppImage: {e}"))?;
                let _ = fs::remove_file(&src);
            }
        }
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
        if let Ok(mut p) = APPIMAGE_NOW.lock() { *p = Some(dest.clone()); }
        install_icons(&h);
        let entry = desktop_entry(&dest);
        let app_dir = h.join(".local/share/applications");
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
        fs::write(app_dir.join(ENTRY), &entry).map_err(|e| e.to_string())?;
        if desktop_shortcut {
            if let Some(desk) = desktop_dir(&h) {
                let f = desk.join(ENTRY);
                fs::write(&f, &entry).map_err(|e| e.to_string())?;
                let _ = fs::set_permissions(&f, fs::Permissions::from_mode(0o755));
                // GNOME needs the launcher marked trusted before it will run it
                let _ = std::process::Command::new("gio").args(["set", &f.to_string_lossy(), "metadata::trusted", "true"]).status();
            }
        }
        let _ = std::process::Command::new("update-desktop-database").arg(&app_dir).status();
        return Ok(dest.to_string_lossy().into_owned());
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = desktop_shortcut; Err("Only for the Linux AppImage.".into()) }
}

/// Starts the installed copy (always ~/Applications/Mustela.AppImage) and quits this one.
#[tauri::command]
pub fn relaunch_installed<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let p = home().ok_or("No home folder.")?.join("Applications/Mustela.AppImage");
        std::process::Command::new(&p).spawn().map_err(|e| e.to_string())?;
        app.exit(0);
        return Ok(());
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = app; Err("Only for the Linux AppImage.".into()) }
}
