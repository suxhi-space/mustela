use serde::de::DeserializeOwned;
use tauri::{
  plugin::{PluginApi, PluginHandle},
  AppHandle, Runtime,
};

use crate::models::*;
#[allow(unused_imports)] // Error is only used off Android
use crate::{Error, Result};

/// Registers the Kotlin class `app.mustela.nativecall.NativePlugin`.
pub fn init<R: Runtime, C: DeserializeOwned>(_app: &AppHandle<R>, api: PluginApi<R, C>) -> Result<MustelaNative<R>> {
  #[cfg(target_os = "android")]
  let handle = api.register_android_plugin("app.mustela.nativecall", "NativePlugin")?;
  #[cfg(not(target_os = "android"))]
  let handle: PluginHandle<R> = { let _ = api; return Err(Error::Unsupported) };
  #[cfg(target_os = "android")]
  { Ok(MustelaNative(handle)) }
  #[cfg(not(target_os = "android"))]
  { unreachable!() }
}

pub struct MustelaNative<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> MustelaNative<R> {
  pub fn accent(&self) -> Result<Accent> { self.0.run_mobile_plugin("accent", ()).map_err(Into::into) }
  pub fn start_call(&self, p: StartCall) -> Result<CallState> { self.0.run_mobile_plugin("startCall", p).map_err(Into::into) }
  pub fn end_call(&self) -> Result<()> { self.0.run_mobile_plugin("endCall", ()).map_err(Into::into) }
  pub fn set_mic(&self, p: SetMic) -> Result<CallState> { self.0.run_mobile_plugin("setMic", p).map_err(Into::into) }
  pub fn pip(&self, p: Pip) -> Result<PipResult> { self.0.run_mobile_plugin("pip", p).map_err(Into::into) }
  pub fn call_state(&self) -> Result<CallState> { self.0.run_mobile_plugin("callState", ()).map_err(Into::into) }
  pub fn background(&self) -> Result<()> { self.0.run_mobile_plugin("background", ()).map_err(Into::into) }
  pub fn call_audio(&self, p: SetMic) -> Result<()> { self.0.run_mobile_plugin("callAudio", p).map_err(Into::into) }
  pub fn landscape(&self, p: SetMic) -> Result<()> { self.0.run_mobile_plugin("landscape", p).map_err(Into::into) }
  pub fn system_bars(&self, p: SetMic) -> Result<()> { self.0.run_mobile_plugin("systemBars", p).map_err(Into::into) }
  pub fn media_file(&self, p: MediaFile) -> Result<serde_json::Value> { self.0.run_mobile_plugin("mediaFile", p).map_err(Into::into) }
  pub fn install_apk(&self, p: InstallApk) -> Result<()> { self.0.run_mobile_plugin("installApk", p).map_err(Into::into) }
  pub fn audio_outputs(&self) -> Result<AudioOutputs> { self.0.run_mobile_plugin("audioOutputs", ()).map_err(Into::into) }
  pub fn set_audio_output(&self, p: SetOutput) -> Result<()> { self.0.run_mobile_plugin("setAudioOutput", p).map_err(Into::into) }
  pub fn set_call_overlay(&self, p: Overlay) -> Result<()> { self.0.run_mobile_plugin("setCallOverlay", p).map_err(Into::into) }
  pub fn overlay_allowed(&self) -> Result<Allowed> { self.0.run_mobile_plugin("overlayAllowed", ()).map_err(Into::into) }
  pub fn request_overlay(&self) -> Result<Allowed> { self.0.run_mobile_plugin("requestOverlay", ()).map_err(Into::into) }
  pub fn screen_start(&self, p: ScreenStart) -> Result<()> { self.0.run_mobile_plugin("screenStart", p).map_err(Into::into) }
  pub fn screen_ack(&self) -> Result<()> { self.0.run_mobile_plugin("screenAck", ()).map_err(Into::into) }
  pub fn screen_stop(&self) -> Result<()> { self.0.run_mobile_plugin("screenStop", ()).map_err(Into::into) }
  pub fn watch(&self, p: Watch) -> Result<()> { self.0.run_mobile_plugin("watch", p).map_err(Into::into) }
  pub fn watch_alive(&self, p: WatchAlive) -> Result<()> { self.0.run_mobile_plugin("watchAlive", p).map_err(Into::into) }
  pub fn watch_clear(&self, p: WatchClear) -> Result<()> { self.0.run_mobile_plugin("watchClear", p).map_err(Into::into) }
  pub fn notify_message(&self, p: NotifyMessage) -> Result<()> { self.0.run_mobile_plugin("notifyMessage", p).map_err(Into::into) }
  pub fn recent_photos(&self, p: RecentPhotos) -> Result<serde_json::Value> { self.0.run_mobile_plugin("recentPhotos", p).map_err(Into::into) }
  pub fn request_photos(&self) -> Result<()> { self.0.run_mobile_plugin("requestPhotos", ()).map_err(Into::into) }
  pub fn photo_file(&self, p: PhotoFile) -> Result<serde_json::Value> { self.0.run_mobile_plugin("photoFile", p).map_err(Into::into) }
  pub fn take_media(&self, p: TakeMedia) -> Result<serde_json::Value> { self.0.run_mobile_plugin("takeMedia", p).map_err(Into::into) }
  pub fn pending_media(&self) -> Result<serde_json::Value> { self.0.run_mobile_plugin("pendingMedia", ()).map_err(Into::into) }
}
