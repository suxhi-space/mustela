fn main() {
    // macOS: ScreenCaptureKit (screen share sound, src/sck_audio.rs) is only there from macOS 12.3. Link it weakly
    // so Mustela still opens on older Macs (it only uses it on macOS 13 and later).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
    }
    tauri_build::build()
}
