use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;
use crate::{Error, Result};

pub fn init<R: Runtime, C: DeserializeOwned>(app: &AppHandle<R>, _api: PluginApi<R, C>) -> Result<MustelaNative<R>> {
  Ok(MustelaNative(app.clone()))
}

/// Desktop has nothing native to offer: the app falls back to the CSS accent and the web call engine.
pub struct MustelaNative<R: Runtime>(AppHandle<R>);

impl<R: Runtime> MustelaNative<R> {
  pub fn accent(&self) -> Result<Accent> { Ok(Accent::default()) }
  pub fn start_call(&self, _: StartCall) -> Result<CallState> { Err(Error::Unsupported) }
  pub fn end_call(&self) -> Result<()> { Ok(()) }
  pub fn set_mic(&self, _: SetMic) -> Result<CallState> { Err(Error::Unsupported) }
  pub fn pip(&self, _: Pip) -> Result<PipResult> { Ok(PipResult { supported: false }) }
  pub fn call_state(&self) -> Result<CallState> { Ok(CallState::default()) }
  pub fn background(&self) -> Result<()> { Ok(()) }
  pub fn call_audio(&self, _: SetMic) -> Result<()> { Ok(()) }
  pub fn landscape(&self, _: SetMic) -> Result<()> { Ok(()) }
  pub fn system_bars(&self, _: SetMic) -> Result<()> { Ok(()) }
  pub fn media_file(&self, _: MediaFile) -> Result<serde_json::Value> { Ok(serde_json::Value::Null) }
  pub fn install_apk(&self, _: InstallApk) -> Result<()> { Ok(()) }
  pub fn audio_outputs(&self) -> Result<AudioOutputs> { Ok(AudioOutputs::default()) }
  pub fn set_audio_output(&self, _: SetOutput) -> Result<()> { Ok(()) }
  pub fn set_call_overlay(&self, _: Overlay) -> Result<()> { Ok(()) }
  pub fn overlay_allowed(&self) -> Result<Allowed> { Ok(Allowed::default()) }
  pub fn request_overlay(&self) -> Result<Allowed> { Ok(Allowed::default()) }
  pub fn screen_start(&self, _: ScreenStart) -> Result<()> { Err(Error::Unsupported) }
  pub fn screen_ack(&self) -> Result<()> { Ok(()) }
  pub fn screen_stop(&self) -> Result<()> { Ok(()) }
  pub fn watch(&self, _: Watch) -> Result<()> { Ok(()) }
  pub fn watch_alive(&self, _: WatchAlive) -> Result<()> { Ok(()) }
  pub fn watch_clear(&self, _: WatchClear) -> Result<()> { Ok(()) }
  pub fn notify_message(&self, _: NotifyMessage) -> Result<()> { Ok(()) }
  pub fn recent_photos(&self, _: RecentPhotos) -> Result<serde_json::Value> { Ok(serde_json::json!({ "allowed": false, "items": [] })) }
  pub fn request_photos(&self) -> Result<()> { Ok(()) }
  pub fn photo_file(&self, _: PhotoFile) -> Result<serde_json::Value> { Ok(serde_json::Value::Null) }
  pub fn take_media(&self, _: TakeMedia) -> Result<serde_json::Value> { Ok(serde_json::json!({ "cancelled": true })) }
  pub fn pending_media(&self) -> Result<serde_json::Value> { Ok(serde_json::json!({})) }
}
