//! Screen share capture, done in Rust so Mustela can show its own picker (no system "is sharing"
//! bar or separate picker app) and, on Windows, share one app's sound.
//!
//! Frames are captured, scaled to the chosen size and sent to the page as small JPEGs over a
//! Tauri channel; the page turns them into the video track the call sends. At most two frames
//! are in flight: if the page or the computer falls behind, frames are skipped, never queued.

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// "screen:<id>" or "window:<id>"
    pub id: String,
    pub name: String,
    /// The app a window belongs to (empty for screens)
    pub app: String,
    /// Process id, for "share this app's sound" (0 for screens)
    pub pid: u32,
    pub width: u32,
    pub height: u32,
    /// A small JPEG preview, base64
    pub thumb: Option<String>,
    pub primary: bool,
}

#[derive(Default)]
pub struct ScreenState {
    video: Mutex<Option<Arc<AtomicBool>>>,
    inflight: Arc<AtomicU32>,
    #[cfg(target_os = "windows")]
    audio: Mutex<Option<Arc<AtomicBool>>>,
}

/// Scales RGBA to fit inside max_w × max_h (never up) and compresses it to JPEG.
fn encode(rgba: &[u8], w: u32, h: u32, max_w: u32, max_h: u32, quality: u8) -> Option<Vec<u8>> {
    encode_as(rgba, w, h, max_w, max_h, quality, jpeg_encoder::ColorType::Rgba)
}

/// Like `encode`, for pictures in another channel order (Windows captures come as BGRA).
fn encode_as(rgba: &[u8], w: u32, h: u32, max_w: u32, max_h: u32, quality: u8, order: jpeg_encoder::ColorType) -> Option<Vec<u8>> {
    use fast_image_resize as fr;
    let s = (max_w as f32 / w as f32).min(max_h as f32 / h as f32).min(1.0);
    let (tw, th) = (((w as f32 * s) as u32).max(2) & !1, ((h as f32 * s) as u32).max(2) & !1);
    let scaled;
    let (buf, bw, bh): (&[u8], u32, u32) = if tw == w && th == h {
        (rgba, w, h)
    } else {
        let src = fr::images::ImageRef::new(w, h, rgba, fr::PixelType::U8x4).ok()?;
        let mut dst = fr::images::Image::new(tw, th, fr::PixelType::U8x4);
        let mut rz = fr::Resizer::new();
        rz.resize(&src, &mut dst, &fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Bilinear))).ok()?;
        scaled = dst.into_vec();
        (&scaled, tw, th)
    };
    let mut out = Vec::with_capacity((bw * bh / 4) as usize);
    let enc = jpeg_encoder::Encoder::new(&mut out, quality);
    enc.encode(buf, bw as u16, bh as u16, order).ok()?;
    Some(out)
}

fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() { s.push(T[(n >> (18 - 6 * i) & 63) as usize] as char) } else { s.push('=') }
        }
    }
    s
}

/// Everything that can be shared: screens first, then app windows (not Mustela's own).
pub fn sources(thumbs: bool) -> Vec<Source> {
    let mut out = vec![];
    if let Ok(monitors) = xcap::Monitor::all() {
        for (i, m) in monitors.iter().enumerate() {
            let (w, h) = (m.width().unwrap_or(0), m.height().unwrap_or(0));
            let thumb = if thumbs { m.capture_image().ok().and_then(|img| encode(img.as_raw(), img.width(), img.height(), 320, 180, 70)).map(|j| b64(&j)) } else { None };
            out.push(Source {
                id: format!("screen:{}", m.id().unwrap_or(i as u32)),
                name: m.friendly_name().ok().filter(|n| !n.is_empty()).or_else(|| m.name().ok()).unwrap_or_else(|| format!("Screen {}", i + 1)),
                app: String::new(), pid: 0, width: w, height: h, thumb, primary: m.is_primary().unwrap_or(false),
            });
        }
    }
    let me = std::process::id();
    if let Ok(windows) = xcap::Window::all() {
        for win in windows {
            let (w, h) = (win.width().unwrap_or(0), win.height().unwrap_or(0));
            let title = win.title().unwrap_or_default();
            let pid = win.pid().unwrap_or(0);
            if w < 120 || h < 80 || title.trim().is_empty() || pid == me || win.is_minimized().unwrap_or(false) { continue; }
            let thumb = if thumbs { win.capture_image().ok().and_then(|img| encode(img.as_raw(), img.width(), img.height(), 320, 180, 70)).map(|j| b64(&j)) } else { None };
            out.push(Source {
                id: format!("window:{}", win.id().unwrap_or(0)),
                name: title, app: win.app_name().unwrap_or_default(), pid, width: w, height: h, thumb, primary: false,
            });
        }
    }
    out
}

enum Target { Screen(xcap::Monitor), Window(xcap::Window) }

fn find(id: &str) -> Result<Target, String> {
    let (kind, n) = id.split_once(':').ok_or("bad source")?;
    let n: u32 = n.parse().map_err(|_| "bad source")?;
    match kind {
        "screen" => xcap::Monitor::all().map_err(|e| e.to_string())?.into_iter().find(|m| m.id().ok() == Some(n)).map(Target::Screen),
        "window" => xcap::Window::all().map_err(|e| e.to_string())?.into_iter().find(|w| w.id().ok() == Some(n)).map(Target::Window),
        _ => None,
    }.ok_or_else(|| "That screen or window isn't there any more.".to_string())
}

/// Starts sending frames of `id` to `channel`, at most `fps` a second, scaled to fit `max_w` × `max_h`.
pub fn start(state: &ScreenState, id: &str, max_w: u32, max_h: u32, fps: u32, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
    stop(state);
    let id = id.to_string();
    let running = Arc::new(AtomicBool::new(true));
    *state.video.lock().unwrap() = Some(running.clone());
    let inflight = state.inflight.clone();
    inflight.store(0, Ordering::SeqCst);
    let frame = Duration::from_millis(1000 / fps.clamp(1, 60) as u64);
    // Fewer bytes at higher sizes keeps it light; text stays readable at 75.
    let quality = if max_w > 1280 { 72 } else { 78 };
    // Screen and window handles can't move between threads on Windows, so the thread looks it up itself.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new().name("mustela-screen".into()).spawn(move || {
        // Windows: one continuous capture session (no pointer flicker, the pointer included, any window).
        #[cfg(target_os = "windows")]
        {
            let wgc_target = id.split_once(':').and_then(|(k, n)| n.parse::<u32>().ok().map(|n| (k, n))).and_then(|(k, n)| match k {
                "screen" => Some(crate::wgc_capture::Target::Monitor(n)),
                "window" => Some(crate::wgc_capture::Target::Window(n)),
                _ => None,
            });
            if let Some(Ok((capture, frames))) = wgc_target.map(crate::wgc_capture::start) {
                let _ = ready_tx.send(Ok(()));
                let mut last = Instant::now() - frame;
                let mut quiet = Duration::ZERO;
                while running.load(Ordering::Relaxed) {
                    match frames.recv_timeout(Duration::from_millis(250)) {
                        Ok(f) => {
                            quiet = Duration::ZERO;
                            // At most the chosen frame rate, and never more than two frames waiting for the page.
                            if last.elapsed() < frame || inflight.load(Ordering::SeqCst) >= 2 { continue; }
                            last = Instant::now();
                            if let Some(jpeg) = encode_as(&f.bgra, f.width, f.height, max_w, max_h, quality, jpeg_encoder::ColorType::Bgra) {
                                inflight.fetch_add(1, Ordering::SeqCst);
                                if channel.send(InvokeResponseBody::Raw(jpeg)).is_err() { break; }
                            }
                        }
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            // Windows only sends frames when something changes; a closed window sends none, ever.
                            quiet += Duration::from_millis(250);
                            if quiet > Duration::from_secs(3) && id.starts_with("window:") {
                                if find(&id).is_err() { let _ = channel.send(InvokeResponseBody::Raw(vec![])); break; }
                                quiet = Duration::ZERO; // still there: look again in a few seconds
                            }
                        }
                        Err(_) => { let _ = channel.send(InvokeResponseBody::Raw(vec![])); break; }
                    }
                }
                drop(capture);
                return;
            }
        }
        let target = match find(&id) { Ok(t) => { let _ = ready_tx.send(Ok(())); t } Err(e) => { let _ = ready_tx.send(Err(e)); return; } };
        let mut next = Instant::now();
        let mut failures = 0u32;
        let mut crop = false;
        while running.load(Ordering::Relaxed) {
            let now = Instant::now();
            if now < next { std::thread::sleep(next - now); }
            next += frame;
            if Instant::now() > next + frame * 4 { next = Instant::now() + frame; } // fell behind: don't try to catch up
            if inflight.load(Ordering::SeqCst) >= 2 { continue; } // the page hasn't caught up: skip this frame
            let img = match &target {
                Target::Screen(m) => m.capture_image(),
                Target::Window(w) => {
                    // Once grabbing the window itself has failed, take its rectangle from its display
                    // instead (works for anything on screen, as long as it isn't covered).
                    let direct = if crop { None } else { w.capture_image().ok() };
                    match direct {
                        Some(i) => Ok(i),
                        None => { crop = true; crop_from_display(w) }
                    }
                }
            };
            let Ok(img) = img else {
                // A single failed grab happens (a window being resized, a busy display server). Only stop
                // when it keeps failing: the window closed or the screen went away. The empty message tells the page.
                failures += 1;
                if failures > fps.clamp(1, 60) * 3 { let _ = channel.send(InvokeResponseBody::Raw(vec![])); break; }
                continue;
            };
            failures = 0;
            if let Some(jpeg) = encode(img.as_raw(), img.width(), img.height(), max_w, max_h, quality) {
                inflight.fetch_add(1, Ordering::SeqCst);
                if channel.send(InvokeResponseBody::Raw(jpeg)).is_err() { break; }
            }
        }
    }).map_err(|e| e.to_string())?;
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap_or(Err("The capture didn't start.".into()))
}

/// A window's rectangle cut out of a picture of its display.
fn crop_from_display(w: &xcap::Window) -> xcap::XCapResult<xcap::image::RgbaImage> {
    let m = w.current_monitor()?;
    let (mx, my, mw, mh) = (m.x()?, m.y()?, m.width()?, m.height()?);
    let x = (w.x()? - mx).clamp(0, mw as i32) as u32;
    let y = (w.y()? - my).clamp(0, mh as i32) as u32;
    let width = w.width()?.min(mw - x).max(1);
    let height = w.height()?.min(mh - y).max(1);
    m.capture_region(x, y, width, height)
}

/// The page drew a frame.
pub fn ack(state: &ScreenState) {
    let _ = state.inflight.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| Some(n.saturating_sub(1)));
}

pub fn stop(state: &ScreenState) {
    if let Some(r) = state.video.lock().unwrap().take() { r.store(false, Ordering::Relaxed); }
    #[cfg(target_os = "windows")]
    if let Some(r) = state.audio.lock().unwrap().take() { r.store(false, Ordering::Relaxed); }
}

/// Windows: the sound of one app (`pid`, with its child processes), or of everything except
/// Mustela (`pid` 0), as 48 kHz stereo float samples in ~20 ms chunks.
#[cfg(target_os = "windows")]
pub fn start_audio(state: &ScreenState, pid: u32, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
    use std::collections::VecDeque;
    use wasapi::*;
    if let Some(r) = state.audio.lock().unwrap().take() { r.store(false, Ordering::Relaxed); }
    let running = Arc::new(AtomicBool::new(true));
    *state.audio.lock().unwrap() = Some(running.clone());
    let (target, include) = if pid == 0 { (std::process::id(), false) } else { (pid, true) };
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new().name("mustela-screen-audio".into()).spawn(move || {
        let run = || -> Result<(), String> {
            initialize_mta().ok().map_err(|e| e.to_string())?;
            let fmt = WaveFormat::new(32, 32, &SampleType::Float, 48000, 2, None);
            let mut client = AudioClient::new_application_loopback_client(target, include).map_err(|e| e.to_string())?;
            client.initialize_client(&fmt, &Direction::Capture, &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 }).map_err(|e| e.to_string())?;
            let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
            let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
            client.start_stream().map_err(|e| e.to_string())?;
            let _ = tx.send(Ok(()));
            let chunk = 960 * 8; // 20 ms of 48 kHz stereo f32
            let mut q: VecDeque<u8> = VecDeque::new();
            while running.load(Ordering::Relaxed) {
                if capture.get_next_packet_size().ok().flatten().unwrap_or(0) > 0 { let _ = capture.read_from_device_to_deque(&mut q); }
                while q.len() >= chunk {
                    let bytes: Vec<u8> = q.drain(..chunk).collect();
                    if channel.send(InvokeResponseBody::Raw(bytes)).is_err() { return Ok(()); }
                }
                if event.wait_for_event(500).is_err() && !running.load(Ordering::Relaxed) { break; }
            }
            let _ = client.stop_stream();
            Ok(())
        };
        if let Err(e) = run() { let _ = tx.send(Err(e)); }
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).unwrap_or(Err("The app's sound didn't start.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64() {
        assert_eq!(b64(b"Man"), "TWFu");
        assert_eq!(b64(b"Ma"), "TWE=");
        assert_eq!(b64(b"M"), "TQ==");
    }
    #[test]
    fn frames_are_scaled_and_compressed() {
        let (w, h) = (1920u32, 1080u32);
        let rgba: Vec<u8> = (0..w * h * 4).map(|i| (i % 251) as u8).collect();
        let jpeg = encode(&rgba, w, h, 1280, 720, 75).unwrap();
        assert_eq!(&jpeg[..2], &[0xff, 0xd8]); // a JPEG
        // Never scaled up
        let small = encode(&rgba[..(64 * 32 * 4) as usize], 64, 32, 1280, 720, 75).unwrap();
        assert_eq!(&small[..2], &[0xff, 0xd8]);
    }
}

#[cfg(all(test, target_os = "linux"))]
mod live {
    /// Needs a display (run under xvfb-run); skipped without one.
    #[test]
    fn lists_and_captures_a_screen() {
        if std::env::var_os("DISPLAY").is_none() { return; }
        let list = super::sources(false);
        let screen = list.iter().find(|s| s.id.starts_with("screen:")).expect("a screen");
        assert!(screen.width > 0 && screen.height > 0);
        // A virtual display (Xvfb) refuses some grabs; at least one in a few tries must work.
        let m = xcap::Monitor::all().unwrap();
        assert!((0..5).any(|_| m[0].capture_image().is_ok()));
    }
}
