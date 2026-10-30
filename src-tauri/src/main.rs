#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer crashes or freezes with some GPU drivers (animated profiles took
    // the whole app down for a tester). Turn it off unless the person asks for it with MUSTELA_DMABUF=1.
    #[cfg(target_os = "linux")]
    if std::env::var_os("MUSTELA_DMABUF").is_none() && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    mustela_lib::run()
}
