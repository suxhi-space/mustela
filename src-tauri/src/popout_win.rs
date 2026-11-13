//! Windows: Mustela's own title bar on the call pop-out.
//!
//! On Windows the pop-out is WebView2's own pop-up window (see `popout_window` in lib.rs for why), which comes with
//! the system frame. When "Mustela's" title bar is chosen, the frame is taken off here and the pop-out's page does
//! the rest: its bar drags the window, its edges resize it, and its buttons minimize, maximize and close it, all
//! through `popout_frame`. If the window can't be found, nothing changes and the system frame stays.

use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowLongPtrW, GetWindowRect, GetWindowTextW, IsIconic, IsWindowVisible, SetWindowLongPtrW,
    SetWindowPos, ShowWindowAsync, GWL_STYLE, HWND_NOTOPMOST, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_NOZORDER, SW_MINIMIZE, SW_RESTORE, WS_CAPTION, WS_THICKFRAME,
};

/// The title the main window gives the pop-out's page (src/ui/call/popout.tsx).
const TITLE: &str = "Mustela call";

fn find() -> Option<HWND> {
    unsafe extern "system" fn each(hwnd: HWND, out: LPARAM) -> BOOL {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() { return true.into(); }
            let mut buf = [0u16; 64];
            let n = GetWindowTextW(hwnd, &mut buf) as usize;
            if String::from_utf16_lossy(&buf[..n]) != TITLE { return true.into(); }
            // Only WebView2's (Chromium's) windows: nothing else that happens to have the same title.
            let mut class = [0u16; 64];
            let c = GetClassNameW(hwnd, &mut class) as usize;
            if !String::from_utf16_lossy(&class[..c]).starts_with("Chrome_WidgetWin") { return true.into(); }
            *(out.0 as *mut Option<HWND>) = Some(hwnd);
            false.into()
        }
    }
    let mut found: Option<HWND> = None;
    unsafe { let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize)); }
    found
}

fn rect(hwnd: HWND) -> Option<[i32; 4]> {
    let mut r = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut r).ok()?; }
    Some([r.left, r.top, r.right - r.left, r.bottom - r.top])
}

/// `op`: "frameless" (take the frame off; gives the window's place), "rect", "move" (to x, y, w, h), "minimize",
/// "restore", "workarea" (the screen area the window is on, without the taskbar), "top" (x = 1: keep on top).
/// Places and sizes are in screen pixels.
#[tauri::command]
pub fn popout_frame(op: String, x: Option<i32>, y: Option<i32>, w: Option<i32>, h: Option<i32>) -> Result<Option<[i32; 4]>, String> {
    let hwnd = find().ok_or("The call window isn't open.")?;
    unsafe {
        match op.as_str() {
            "frameless" => {
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let bare = style & !((WS_CAPTION.0 | WS_THICKFRAME.0) as isize);
                if bare != style {
                    SetWindowLongPtrW(hwnd, GWL_STYLE, bare);
                    let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                }
                Ok(rect(hwnd))
            }
            "rect" => Ok(rect(hwnd)),
            "move" => {
                let (x, y, w, h) = (x.ok_or("x")?, y.ok_or("y")?, w.ok_or("w")?.max(200), h.ok_or("h")?.max(150));
                if IsIconic(hwnd).as_bool() { let _ = ShowWindowAsync(hwnd, SW_RESTORE); }
                SetWindowPos(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE).map_err(|e| e.to_string())?;
                Ok(rect(hwnd))
            }
            "minimize" => { let _ = ShowWindowAsync(hwnd, SW_MINIMIZE); Ok(None) }
            "restore" => { let _ = ShowWindowAsync(hwnd, SW_RESTORE); Ok(None) }
            "workarea" => {
                let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
                let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
                if !GetMonitorInfoW(mon, &mut info).as_bool() { return Err("No screen.".into()); }
                let r = info.rcWork;
                Ok(Some([r.left, r.top, r.right - r.left, r.bottom - r.top]))
            }
            "top" => {
                let after = if x == Some(1) { HWND_TOPMOST } else { HWND_NOTOPMOST };
                SetWindowPos(hwnd, Some(after), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE).map_err(|e| e.to_string())?;
                Ok(None)
            }
            _ => Err("Unknown window action.".into()),
        }
    }
}
