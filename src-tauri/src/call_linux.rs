//! Voice calls in Rust, for Linux systems whose WebKitGTK was built without WebRTC (the web call engine
//! needs it). LiveKit's Rust SDK does the call, and WebRTC's own audio device layer does the microphone,
//! the speakers and echo cancellation, through PulseAudio/PipeWire. Voice only: cameras and screen shares
//! need WebRTC in the page.
//!
//! The page drives it the way it drives the Android call service (src/lib/voice/native.ts): start, mute,
//! deafen, leave, and a state it reads every second.

use livekit::options::TrackPublishOptions;
use livekit::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

struct Call {
    room: Arc<Room>,
    _audio: PlatformAudio,
    mic: LocalAudioTrack,
    channel_id: String,
    channel_name: String,
    mic_on: bool,
    deaf: bool,
}

#[derive(Default)]
struct Shared {
    call: Option<Call>,
    speaking: Vec<String>,
    error: Option<String>,
}

/// The one call, kept by the app (managed state).
#[derive(Default, Clone)]
pub struct VoiceState(Arc<Mutex<Shared>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallState {
    active: bool,
    connected: bool,
    mic: bool,
    deaf: bool,
    channel_id: Option<String>,
    channel_name: Option<String>,
    participants: Vec<String>,
    speaking: Vec<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    url: String,
    token: String,
    channel_id: String,
    channel_name: String,
}

#[derive(Deserialize)]
pub struct OnArgs {
    on: bool,
}

async fn state_of(s: &Shared) -> CallState {
    match &s.call {
        None => CallState { active: false, connected: false, mic: false, deaf: false, channel_id: None, channel_name: None, participants: vec![], speaking: vec![], error: s.error.clone() },
        Some(c) => {
            let mut participants = vec![c.room.local_participant().identity().to_string()];
            participants.extend(c.room.remote_participants().keys().map(|id| id.to_string()));
            CallState {
                active: true,
                connected: c.room.connection_state() == ConnectionState::Connected,
                mic: c.mic_on,
                deaf: c.deaf,
                channel_id: Some(c.channel_id.clone()),
                channel_name: Some(c.channel_name.clone()),
                participants,
                speaking: s.speaking.clone(),
                error: s.error.clone(),
            }
        }
    }
}

/// Everyone else's voices on or off (deafen): their tracks stop playing, nothing is unsubscribed.
fn set_playback(room: &Room, on: bool) {
    for p in room.remote_participants().values() {
        for publication in p.track_publications().values() {
            if let Some(RemoteTrack::Audio(t)) = publication.track() {
                t.rtc_track().set_enabled(on);
            }
        }
    }
}

#[tauri::command]
pub async fn voice_start_call(state: tauri::State<'_, VoiceState>, payload: StartArgs) -> Result<CallState, String> {
    voice_end(&state).await;
    let audio = PlatformAudio::new().map_err(|_| "No microphone or speakers were found.".to_string())?;
    let (room, mut events) = Room::connect(&payload.url, &payload.token, RoomOptions::default())
        .await
        .map_err(|e| format!("Couldn't connect to the voice server: {e}"))?;
    let room = Arc::new(room);
    // Joined muted, like the web engine: the page turns the microphone on if you want it.
    let mic = LocalAudioTrack::create_audio_track("microphone", audio.rtc_source());
    mic.mute();
    let options = TrackPublishOptions { source: TrackSource::Microphone, dtx: true, red: true, ..Default::default() };
    if let Err(e) = room.local_participant().publish_track(LocalTrack::Audio(mic.clone()), options).await {
        let _ = room.close().await;
        return Err(format!("Couldn't send your microphone: {e}"));
    }
    {
        let mut s = state.0.lock().await;
        s.error = None;
        s.speaking.clear();
        s.call = Some(Call { room: room.clone(), _audio: audio, mic, channel_id: payload.channel_id, channel_name: payload.channel_name, mic_on: false, deaf: false });
    }
    // Room events: who's talking, someone's voice arriving while deafened, and the call ending.
    let shared = state.0.clone();
    let watched = room.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            let mut s = shared.lock().await;
            let ours = s.call.as_ref().is_some_and(|c| Arc::ptr_eq(&c.room, &watched));
            if !ours { break; }
            match event {
                RoomEvent::ActiveSpeakersChanged { speakers } => {
                    s.speaking = speakers.iter().map(|p| p.identity().to_string()).collect();
                }
                RoomEvent::TrackSubscribed { track: RemoteTrack::Audio(t), .. } => {
                    if s.call.as_ref().is_some_and(|c| c.deaf) { t.rtc_track().set_enabled(false); }
                }
                RoomEvent::Disconnected { reason } => {
                    s.call = None;
                    s.speaking.clear();
                    s.error = Some(format!("The call ended ({reason:?})."));
                    break;
                }
                _ => {}
            }
        }
    });
    let s = state.0.lock().await;
    Ok(state_of(&s).await)
}

#[tauri::command]
pub async fn voice_set_mic(state: tauri::State<'_, VoiceState>, payload: OnArgs) -> Result<CallState, String> {
    let mut s = state.0.lock().await;
    if let Some(c) = s.call.as_mut() {
        if payload.on { c.mic.unmute() } else { c.mic.mute() }
        c.mic_on = payload.on;
    }
    Ok(state_of(&s).await)
}

#[tauri::command]
pub async fn voice_set_deaf(state: tauri::State<'_, VoiceState>, payload: OnArgs) -> Result<CallState, String> {
    let mut s = state.0.lock().await;
    if let Some(c) = s.call.as_mut() {
        c.deaf = payload.on;
        set_playback(&c.room, !payload.on);
        // Deafening mutes you too, like Discord and Stoat.
        if payload.on && c.mic_on { c.mic.mute(); c.mic_on = false; }
    }
    Ok(state_of(&s).await)
}

async fn voice_end(state: &VoiceState) {
    let call = state.0.lock().await.call.take();
    if let Some(c) = call {
        let _ = c.room.close().await;
    }
}

#[tauri::command]
pub async fn voice_end_call(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    voice_end(&state).await;
    state.0.lock().await.error = None;
    Ok(())
}

#[tauri::command]
pub async fn voice_call_state(state: tauri::State<'_, VoiceState>) -> Result<CallState, String> {
    let s = state.0.lock().await;
    Ok(state_of(&s).await)
}
