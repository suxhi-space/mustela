const COMMANDS: &[&str] = &["accent", "start_call", "end_call", "set_mic", "call_state", "pip", "background",
  "call_audio", "set_call_overlay", "overlay_allowed", "request_overlay", "screen_start", "screen_ack", "screen_stop", "landscape", "system_bars", "audio_outputs", "set_audio_output", "media_file", "watch", "watch_alive", "watch_clear", "notify_message", "recent_photos", "request_photos", "photo_file", "take_media", "pending_media"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
