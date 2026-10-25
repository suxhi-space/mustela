use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::MustelaNativeExt;
use crate::Result;

#[command]
pub(crate) async fn accent<R: Runtime>(app: AppHandle<R>) -> Result<Accent> { app.mustela_native().accent() }

#[command]
pub(crate) async fn start_call<R: Runtime>(app: AppHandle<R>, payload: StartCall) -> Result<CallState> { app.mustela_native().start_call(payload) }

#[command]
pub(crate) async fn end_call<R: Runtime>(app: AppHandle<R>) -> Result<()> { app.mustela_native().end_call() }

#[command]
pub(crate) async fn set_mic<R: Runtime>(app: AppHandle<R>, payload: SetMic) -> Result<CallState> { app.mustela_native().set_mic(payload) }

#[command]
pub(crate) async fn pip<R: Runtime>(app: AppHandle<R>, payload: Pip) -> Result<PipResult> { app.mustela_native().pip(payload) }

#[command]
pub(crate) async fn call_state<R: Runtime>(app: AppHandle<R>) -> Result<CallState> { app.mustela_native().call_state() }
