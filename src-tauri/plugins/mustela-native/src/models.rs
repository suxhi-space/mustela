use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Accent {
  /// "#rrggbb", or None when the OS has no dynamic color (Android < 12).
  pub hex: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCall {
  /// LiveKit server URL and token from Stoat's join_call.
  pub url: String,
  pub token: String,
  pub channel_id: String,
  /// Shown in the notification.
  pub channel_name: String,
}

/// Picture-in-picture: `auto` lets Android shrink the app into a floating window when you
/// leave it during a call; `enter` does it now. Width/height are the window's shape.
#[derive(Debug, Deserialize, Serialize)]
pub struct Pip {
  pub enter: bool,
  pub auto: bool,
  pub width: u32,
  pub height: u32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PipResult {
  pub supported: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SetMic {
  pub on: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallState {
  /// A call exists (connecting, connected, or just dropped).
  pub active: bool,
  pub connected: bool,
  pub mic: bool,
  pub channel_id: Option<String>,
  pub channel_name: Option<String>,
  /// User ids in the call, you included.
  pub participants: Vec<String>,
  pub speaking: Vec<String>,
  pub error: Option<String>,
}

/// The voice bubble over other apps while you're in a call: wanted (`on`) and showing you muted.
#[derive(Debug, Deserialize, Serialize)]
pub struct Overlay {
  pub on: bool,
  pub muted: bool,
}

/// Whether Mustela may draw over other apps (the bubble needs it).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Allowed {
  pub allowed: bool,
}

/// Android screen share: the largest size and frame rate to send.
#[derive(Debug, Deserialize, Serialize)]
pub struct ScreenSize {
  pub width: u32,
  pub height: u32,
  pub fps: u32,
}

/// What the Kotlin side gets: the size, and where frames go (each message is
/// `{ f: "<base64 JPEG>" }`, or `{ end: true }` when the share stops).
#[derive(Serialize)]
pub struct ScreenStart {
  pub width: u32,
  pub height: u32,
  pub fps: u32,
  pub channel: tauri::ipc::Channel<serde_json::Value>,
}
