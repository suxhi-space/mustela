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
  pub fn audio_outputs(&self) -> Result<AudioOutputs> { Ok(AudioOutputs::default()) }
  pub fn set_audio_output(&self, _: SetOutput) -> Result<()> { Ok(()) }
  pub fn set_call_overlay(&self, _: Overlay) -> Result<()> { Ok(()) }
  pub fn overlay_allowed(&self) -> Result<Allowed> { Ok(Allowed::default()) }
  pub fn request_overlay(&self) -> Result<Allowed> { Ok(Allowed::default()) }
  pub fn screen_start(&self, _: ScreenStart) -> Result<()> { Err(Error::Unsupported) }
  pub fn screen_ack(&self) -> Result<()> { Ok(()) }
  pub fn screen_stop(&self) -> Result<()> { Ok(()) }
}
