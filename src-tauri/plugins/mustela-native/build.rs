const COMMANDS: &[&str] = &["accent", "start_call", "end_call", "set_mic", "call_state", "pip"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
