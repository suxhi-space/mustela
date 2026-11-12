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

#[command]
pub(crate) async fn background<R: Runtime>(app: AppHandle<R>) -> Result<()> { app.mustela_native().background() }

/// Watching a stream on a phone: let the screen turn sideways (on), or back to how the app normally turns (off).
#[command]
pub(crate) async fn landscape<R: Runtime>(app: AppHandle<R>, payload: SetMic) -> Result<()> { app.mustela_native().landscape(payload) }

/// Full-screen stream: hide the phone's status bar and nav buttons (off), or show them again (on).
#[command]
pub(crate) async fn system_bars<R: Runtime>(app: AppHandle<R>, payload: SetMic) -> Result<()> { app.mustela_native().system_bars(payload) }

/// Phones: where call audio can play (earpiece, speaker, Bluetooth…) and which one it's using.
#[command]
pub(crate) async fn audio_outputs<R: Runtime>(app: AppHandle<R>) -> Result<AudioOutputs> { app.mustela_native().audio_outputs() }

#[command]
pub(crate) async fn set_audio_output<R: Runtime>(app: AppHandle<R>, payload: SetOutput) -> Result<()> { app.mustela_native().set_audio_output(payload) }

#[command]
pub(crate) async fn call_audio<R: Runtime>(app: AppHandle<R>, payload: SetMic) -> Result<()> { app.mustela_native().call_audio(payload) }

#[command]
pub(crate) async fn set_call_overlay<R: Runtime>(app: AppHandle<R>, payload: Overlay) -> Result<()> { app.mustela_native().set_call_overlay(payload) }

#[command]
pub(crate) async fn overlay_allowed<R: Runtime>(app: AppHandle<R>) -> Result<Allowed> { app.mustela_native().overlay_allowed() }

#[command]
pub(crate) async fn request_overlay<R: Runtime>(app: AppHandle<R>) -> Result<Allowed> { app.mustela_native().request_overlay() }

#[command]
pub(crate) async fn screen_start<R: Runtime>(app: AppHandle<R>, payload: ScreenSize, channel: tauri::ipc::Channel<serde_json::Value>) -> Result<()> {
  app.mustela_native().screen_start(ScreenStart { width: payload.width, height: payload.height, fps: payload.fps, channel })
}

#[command]
pub(crate) async fn screen_ack<R: Runtime>(app: AppHandle<R>) -> Result<()> { app.mustela_native().screen_ack() }

#[command]
pub(crate) async fn screen_stop<R: Runtime>(app: AppHandle<R>) -> Result<()> { app.mustela_native().screen_stop() }

/// Phones: save a picture or video to Downloads (share false), or hand its link to the share sheet (share true).
#[command]
pub(crate) async fn media_file<R: Runtime>(app: AppHandle<R>, payload: MediaFile) -> Result<serde_json::Value> { app.mustela_native().media_file(payload) }

/// Android: check for messages while Mustela is closed (see MessageWatch.kt).
#[command]
pub(crate) async fn watch<R: Runtime>(app: AppHandle<R>, payload: Watch) -> Result<()> { app.mustela_native().watch(payload) }

/// Android: the page is connected and notifying itself (true), or let go in the background (false).
#[command]
pub(crate) async fn watch_alive<R: Runtime>(app: AppHandle<R>, payload: WatchAlive) -> Result<()> { app.mustela_native().watch_alive(payload) }

/// Android: a conversation was opened, so its notification goes.
#[command]
pub(crate) async fn watch_clear<R: Runtime>(app: AppHandle<R>, payload: WatchClear) -> Result<()> { app.mustela_native().watch_clear(payload) }

/// Android: your newest photos and videos for the + card (small thumbnails), or allowed=false.
#[command]
pub(crate) async fn recent_photos<R: Runtime>(app: AppHandle<R>, payload: RecentPhotos) -> Result<serde_json::Value> { app.mustela_native().recent_photos(payload) }

#[command]
pub(crate) async fn request_photos<R: Runtime>(app: AppHandle<R>) -> Result<()> { app.mustela_native().request_photos() }

/// Android: a picked photo or video itself (base64), to attach.
#[command]
pub(crate) async fn photo_file<R: Runtime>(app: AppHandle<R>, payload: PhotoFile) -> Result<serde_json::Value> { app.mustela_native().photo_file(payload) }

/// Android: a photo or video from the phone's camera app, kept only in Mustela's cache until attached.
#[command]
pub(crate) async fn take_media<R: Runtime>(app: AppHandle<R>, payload: TakeMedia) -> Result<serde_json::Value> { app.mustela_native().take_media(payload) }

/// Android: what the camera took while Mustela was closed (Android needed the memory), if anything.
#[command]
pub(crate) async fn pending_media<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value> { app.mustela_native().pending_media() }

#[command]
pub(crate) async fn notify_message<R: Runtime>(app: AppHandle<R>, payload: NotifyMessage) -> Result<()> { app.mustela_native().notify_message(payload) }
