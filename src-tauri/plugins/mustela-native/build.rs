const COMMANDS: &[&str] = &["accent", "start_call", "end_call", "set_mic", "call_state", "pip", "background",
  "call_audio", "set_call_overlay", "overlay_allowed", "request_overlay", "screen_start", "screen_ack", "screen_stop", "landscape", "system_bars", "audio_outputs", "set_audio_output"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
