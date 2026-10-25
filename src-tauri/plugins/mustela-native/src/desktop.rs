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
}
