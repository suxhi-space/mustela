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

/// Where call audio plays on a phone: the earpiece, the speaker, Bluetooth, a headset…
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct AudioOutput {
  pub id: i32,
  /// "earpiece", "speaker", "bluetooth", "wired", "usb" or "other"
  pub kind: String,
  pub name: String,
  pub selected: bool,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct AudioOutputs {
  pub outputs: Vec<AudioOutput>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct SetOutput {
  pub id: i32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct MediaFile {
  pub url: String,
  pub name: String,
  pub share: bool,
  /// "save", "share" or "open" (empty: from `share`)
  #[serde(default)]
  pub mode: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct InstallApk {
  pub path: String,
}

/// Notifications while Mustela is closed (Android): on with the page's profile as JSON, or off.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Watch {
  pub on: bool,
  pub profile: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchAlive {
  pub alive: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchClear {
  pub channel: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPhotos {
  pub limit: u32,
  /// Where to start (the `next` of the previous page), for the + card filling in as you scroll
  #[serde(default)]
  pub offset: u32,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoFile {
  pub uri: String,
}

/** Android: take a photo (or a video) with the phone's own camera app, into Mustela's cache (Camera.kt). */
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeMedia {
  pub video: bool,
}

/** A chat notification (phones and tablets): Notifier.kt shows it like the ones while Mustela is closed. */
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyMessage {
  pub channel: String,
  pub kind: String,
  pub title: String,
  pub id: String,
  pub author: String,
  pub author_id: String,
  pub avatar: String,
  pub text: String,
  pub at: i64,
  pub api: String,
  pub token: String,
  pub accent: i32,
}

/// Sign-in tokens kept in the Android Keystore-backed vault (Vault.kt).
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultKey {
  pub account: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultPut {
  pub account: String,
  pub secret: String,
}

