//! Activity ("Playing …"), desktop only.
//!
//! Two sources, both feeding the webview through events:
//!  * game detection: running programs matched against Discord's public list of
//!    detectable games (downloaded once a week, cached in the app data folder);
//!  * Rich Presence: a small server on Discord's local IPC socket
//!    (`discord-ipc-N`), so games and apps that report Rich Presence to Discord
//!    report it to Mustela too. Whoever binds `discord-ipc-0` first gets every
//!    game; Discord takes the next free slot. So when Mustela holds slot 0 and
//!    Discord is running, each connection is passed through to Discord untouched
//!    and Mustela only reads the activity on the way past: your friends on
//!    Discord still see what you're playing. If Discord got there first,
//!    Mustela keeps trying and takes slot 0 the next time it's free.
//!
//! Nothing here touches the network except fetching that public list and
//! resolving Rich Presence image names to public Discord CDN links.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::watch;

const LIST_URL: &str = "https://discord.com/api/v9/applications/detectable";
const LIST_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);
const SCAN_EVERY: Duration = Duration::from_secs(15);

#[derive(Clone, Debug)]
struct Game { id: String, name: String, icon: Option<String>, exes: Vec<String> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Detected { id: String, name: String, icon: Option<String>, started_at: u64, exe: String }

#[derive(Serialize, Clone)]
pub struct Status { rpc: &'static str, detect: &'static str }

#[derive(Default)]
pub struct ActivityState {
    games: Mutex<Option<Arc<Vec<Game>>>>,
    detect: Mutex<Option<watch::Sender<bool>>>,
    rpc: Mutex<Option<(watch::Sender<bool>, &'static str)>>,
    assets: Mutex<HashMap<String, HashMap<String, String>>>,
}

fn os_key() -> &'static str {
    if cfg!(target_os = "windows") { "win32" } else if cfg!(target_os = "macos") { "darwin" } else { "linux" }
}

/// Program names shared by many apps; they never identify a game on their own.
const GENERIC: &[&str] = &[
    "java", "javaw", "java.exe", "javaw.exe", "python", "python3", "python.exe", "pythonw.exe", "node", "node.exe",
    "electron", "electron.exe", "wine", "wine64", "wine-preloader", "wine64-preloader", "mono", "dotnet", "dotnet.exe",
    "ruby", "lua", "love", "love.exe", "bash", "sh", "cmd.exe", "conhost.exe", "launcher", "launcher.exe", "game", "game.exe",
    "main", "main.exe", "start", "start.exe", "app", "app.exe", "run", "run.exe", "steam", "steam.exe", "chrome", "chrome.exe",
];

fn parse_list(v: &Value) -> Vec<Game> {
    let os = os_key();
    v.as_array().map(|a| a.iter().filter_map(|g| {
        let id = g.get("id")?.as_str()?.to_string();
        let name = g.get("name")?.as_str()?.to_string();
        let exes: Vec<String> = g.get("executables")?.as_array()?.iter().filter_map(|e| {
            if e.get("os").and_then(|o| o.as_str()) != Some(os) { return None; }
            if e.get("is_launcher").and_then(|b| b.as_bool()) == Some(true) { return None; }
            let n = e.get("name")?.as_str()?.trim_start_matches('>').to_lowercase().replace('\\', "/");
            if n.len() < 3 { return None; }
            // A bare runtime ("java", "python", "node"…) is running for all sorts of reasons (build tools,
            // background helpers), so it only counts with the game's own folder in front of it.
            let file = n.rsplit('/').next().unwrap_or(&n);
            if GENERIC.contains(&file) {
                const PLAIN: &[&str] = &["", ".", "bin", "lib", "jre", "jdk", "home", "contents", "macos", "jre.bundle", "runtime", "x64", "x86", "win64", "win32"];
                if n.split('/').rev().skip(1).all(|seg| PLAIN.contains(&seg)) { return None; }
            }
            Some(n)
        }).collect();
        if exes.is_empty() { return None; }
        let icon = g.get("icon").and_then(|i| i.as_str()).map(|h| format!("https://cdn.discordapp.com/app-icons/{id}/{h}.png?size=128"));
        Some(Game { id, name, icon, exes })
    }).collect()).unwrap_or_default()
}

/// The detectable-games list: cached file if fresh, else downloaded (falling back to a stale cache).
async fn load_games<R: Runtime>(app: &AppHandle<R>) -> Arc<Vec<Game>> {
    let state = app.state::<ActivityState>();
    if let Some(g) = state.games.lock().unwrap().clone() { return g; }
    let path = app.path().app_cache_dir().ok().map(|d| d.join("detectable.json"));
    let fresh = path.as_ref().and_then(|p| std::fs::metadata(p).ok()).and_then(|m| m.modified().ok())
        .map(|t| t.elapsed().unwrap_or_default() < LIST_MAX_AGE).unwrap_or(false);
    let mut raw: Option<Vec<u8>> = if fresh { path.as_ref().and_then(|p| std::fs::read(p).ok()) } else { None };
    if raw.is_none() {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).user_agent("Mustela").build();
        if let Ok(c) = client {
            if let Ok(r) = c.get(LIST_URL).send().await {
                if r.status().is_success() {
                    if let Ok(b) = r.bytes().await {
                        if let Some(p) = &path { let _ = std::fs::create_dir_all(p.parent().unwrap()); let _ = std::fs::write(p, &b); }
                        raw = Some(b.to_vec());
                    }
                }
            }
        }
    }
    if raw.is_none() { raw = path.as_ref().and_then(|p| std::fs::read(p).ok()); }
    let games = Arc::new(raw.and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| parse_list(&v)).unwrap_or_default());
    *state.games.lock().unwrap() = Some(games.clone());
    games
}

/* ------------------------------------------------------------------ game detection */

async fn detect_loop<R: Runtime>(app: AppHandle<R>, mut stop: watch::Receiver<bool>) {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System, UpdateKind};
    let games = load_games(&app).await;
    // Index by file name so each process costs one hash lookup.
    let mut by_file: HashMap<String, Vec<(usize, String)>> = HashMap::new();
    for (i, g) in games.iter().enumerate() {
        for e in &g.exes {
            let file = e.rsplit('/').next().unwrap_or(e).to_string();
            by_file.entry(file).or_default().push((i, e.clone()));
        }
    }
    let kind = ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet);
    let mut sys = System::new_with_specifics(RefreshKind::nothing().with_processes(kind));
    let mut last: Vec<String> = vec![];
    loop {
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        let mut found: HashMap<String, Detected> = HashMap::new();
        for p in sys.processes().values() {
            let Some(exe) = p.exe() else { continue };
            let full = exe.to_string_lossy().to_lowercase().replace('\\', "/");
            let file = full.rsplit('/').next().unwrap_or(&full).to_string();
            let Some(cands) = by_file.get(&file) else { continue };
            for (i, suffix) in cands {
                // "game.exe" matches any folder; "steamapps/common/x/game.exe" must match the tail on a folder boundary.
                let ok = full == *suffix || (full.ends_with(suffix.as_str()) && full.as_bytes().get(full.len() - suffix.len() - 1) == Some(&b'/'));
                if ok {
                    let g = &games[*i];
                    let started = p.start_time() * 1000;
                    found.entry(g.id.clone()).and_modify(|d| d.started_at = d.started_at.min(started)).or_insert(Detected {
                        id: g.id.clone(), name: g.name.clone(), icon: g.icon.clone(), started_at: started, exe: file.clone(),
                    });
                }
            }
        }
        let mut list: Vec<Detected> = found.into_values().collect();
        list.sort_by_key(|d| std::cmp::Reverse(d.started_at)); // newest first
        let ids: Vec<String> = list.iter().map(|d| d.id.clone()).collect();
        if ids != last { let _ = app.emit("activity://games", &list); last = ids; }
        tokio::select! {
            _ = tokio::time::sleep(SCAN_EVERY) => {},
            _ = stop.changed() => break,
        }
    }
    let _ = app.emit("activity://games", Vec::<Detected>::new());
}

/* ------------------------------------------------------------------ Rich Presence (Discord IPC) */

const OP_HANDSHAKE: u32 = 0;
const OP_FRAME: u32 = 1;
const OP_CLOSE: u32 = 2;
const OP_PING: u32 = 3;
const OP_PONG: u32 = 4;

async fn write_frame<W: AsyncWriteExt + Unpin>(w: &mut W, op: u32, v: &Value) -> std::io::Result<()> {
    let body = serde_json::to_vec(v).unwrap_or_default();
    let mut buf = Vec::with_capacity(8 + body.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(body.len() as u32).to_le_bytes());
    buf.extend_from_slice(&body);
    w.write_all(&buf).await
}

async fn read_frame<Rd: AsyncReadExt + Unpin>(r: &mut Rd) -> std::io::Result<(u32, Value)> {
    let mut head = [0u8; 8];
    r.read_exact(&mut head).await?;
    let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
    if len > 64 * 1024 { return Err(std::io::Error::other("frame too large")); }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body).await?;
    Ok((op, serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

/// Discord asset name -> https URL, looking names up once per application.
async fn asset_url<R: Runtime>(app: &AppHandle<R>, client_id: &str, key: &str) -> Option<String> {
    if let Some(rest) = key.strip_prefix("mp:") { return Some(format!("https://media.discordapp.net/{rest}")); }
    if key.starts_with("https://") { return Some(key.to_string()); }
    if key.chars().all(|c| c.is_ascii_digit()) { return Some(format!("https://cdn.discordapp.com/app-assets/{client_id}/{key}.png")); }
    let state = app.state::<ActivityState>();
    let cached = state.assets.lock().unwrap().get(client_id).cloned();
    let map = match cached {
        Some(m) => m,
        None => {
            let url = format!("https://discord.com/api/v9/oauth2/applications/{client_id}/assets");
            let m: HashMap<String, String> = async {
                let r = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().ok()?.get(url).send().await.ok()?;
                let v: Value = serde_json::from_slice(&r.bytes().await.ok()?).ok()?;
                Some(v.as_array()?.iter().filter_map(|a| Some((a.get("name")?.as_str()?.to_string(), a.get("id")?.as_str()?.to_string()))).collect())
            }.await.unwrap_or_default();
            state.assets.lock().unwrap().insert(client_id.to_string(), m.clone());
            m
        }
    };
    map.get(key).map(|id| format!("https://cdn.discordapp.com/app-assets/{client_id}/{id}.png"))
}

async fn to_activity<R: Runtime>(app: &AppHandle<R>, client_id: &str, a: &Value) -> Option<Value> {
    if a.is_null() { return None; }
    let games = load_games(app).await;
    let game = games.iter().find(|g| g.id == client_id);
    let kind = match a.get("type").and_then(|t| t.as_u64()).unwrap_or(0) { 1 => "streaming", 2 => "listening", 3 => "watching", 5 => "competing", _ => "playing" };
    let name = game.map(|g| g.name.clone()).or_else(|| a.get("name").and_then(|n| n.as_str()).map(String::from)).unwrap_or_else(|| "Something".into());
    let start = a.pointer("/timestamps/start").and_then(|t| t.as_u64()).map(|t| if t < 1_000_000_000_000 { t * 1000 } else { t });
    let mut image = None;
    if let Some(k) = a.pointer("/assets/large_image").and_then(|k| k.as_str()) { image = asset_url(app, client_id, k).await; }
    if image.is_none() { image = game.and_then(|g| g.icon.clone()); }
    let end = a.pointer("/timestamps/end").and_then(|t| t.as_u64()).map(|t| if t < 1_000_000_000_000 { t * 1000 } else { t });
    let small = match a.pointer("/assets/small_image").and_then(|k| k.as_str()) { Some(k) => asset_url(app, client_id, k).await, None => None };
    let text = |p: &str| a.pointer(p).and_then(|v| v.as_str()).map(|s| s.chars().take(128).collect::<String>());
    // Buttons: games send [{label, url}]; through Discord they come back as labels plus metadata.button_urls.
    let urls: Vec<&str> = a.pointer("/metadata/button_urls").and_then(|v| v.as_array()).map(|v| v.iter().filter_map(|u| u.as_str()).collect()).unwrap_or_default();
    let buttons: Vec<Value> = a.get("buttons").and_then(|b| b.as_array()).map(|b| b.iter().enumerate().filter_map(|(i, x)| {
        let (label, url) = match x {
            Value::String(l) => (l.as_str(), *urls.get(i)?),
            _ => (x.get("label")?.as_str()?, x.get("url")?.as_str()?),
        };
        if !url.starts_with("https://") || label.trim().is_empty() { return None; }
        Some(json!({ "label": label.chars().take(32).collect::<String>(), "url": url.chars().take(512).collect::<String>() }))
    }).take(2).collect()).unwrap_or_default();
    Some(json!({
        "kind": kind, "name": name,
        "details": text("/details"),
        "state": text("/state"),
        "startedAt": start, "endsAt": end, "image": image, "appId": client_id,
        "largeText": text("/assets/large_text"), "smallImage": small, "smallText": text("/assets/small_text"),
        "buttons": if buttons.is_empty() { Value::Null } else { Value::Array(buttons) },
    }))
}

async fn serve_client<R: Runtime, S: AsyncReadExt + AsyncWriteExt + Unpin + Send + 'static>(app: AppHandle<R>, mut s: S, own: u32) {
    let mut client_id = String::new();
    let mut had_activity = false;
    let (op, hello) = match read_frame(&mut s).await { Ok(f) => f, Err(_) => return };
    if op != OP_HANDSHAKE { return; }
    if let Some(id) = hello.get("client_id").and_then(|c| c.as_str()) { client_id = id.chars().filter(|c| c.is_ascii_digit()).take(24).collect(); }
    // Discord is running on another slot: hand the game to it and just listen in.
    if let Some(up) = connect_discord(own).await {
        proxy(app, s, up, hello, client_id).await;
        return;
    }
    let ready = json!({ "cmd": "DISPATCH", "evt": "READY", "data": {
        "v": 1, "config": { "cdn_host": "cdn.discordapp.com", "api_endpoint": "//discord.com/api", "environment": "production" },
        "user": { "id": "0", "username": "Mustela", "discriminator": "0", "global_name": "Mustela", "avatar": null, "bot": false, "flags": 0, "premium_type": 0 }
    }, "nonce": null });
    if write_frame(&mut s, OP_FRAME, &ready).await.is_err() { return; }
    let app_name = { let g = load_games(&app).await; g.iter().find(|x| x.id == client_id).map(|x| x.name.clone()) };
    loop {
        let (op, msg) = match read_frame(&mut s).await { Ok(f) => f, Err(_) => break };
        match op {
            OP_PING => { if write_frame(&mut s, OP_PONG, &msg).await.is_err() { break; } }
            OP_CLOSE => break,
            OP_FRAME => {
                let cmd = msg.get("cmd").and_then(|c| c.as_str()).unwrap_or("").to_string();
                let nonce = msg.get("nonce").cloned().unwrap_or(Value::Null);
                if cmd == "SET_ACTIVITY" {
                    let raw = msg.pointer("/args/activity").cloned().unwrap_or(Value::Null);
                    let act = to_activity(&app, &client_id, &raw).await;
                    had_activity = act.is_some();
                    let _ = app.emit("activity://rpc", json!({ "app": app_name, "activity": act }));
                    if write_frame(&mut s, OP_FRAME, &json!({ "cmd": cmd, "data": raw, "evt": null, "nonce": nonce })).await.is_err() { break; }
                } else if write_frame(&mut s, OP_FRAME, &json!({ "cmd": cmd, "data": {}, "evt": null, "nonce": nonce })).await.is_err() { break; }
            }
            _ => break,
        }
    }
    if had_activity { let _ = app.emit("activity://rpc", json!({ "app": null, "activity": null })); }
}

/// Passes a game's connection through to Discord, reading SET_ACTIVITY on the way.
/// Frames from Discord go back to the game byte for byte (its READY carries the real user).
async fn proxy<R: Runtime, S, U>(app: AppHandle<R>, game: S, mut up: U, hello: Value, client_id: String)
where S: AsyncReadExt + AsyncWriteExt + Unpin + Send + 'static, U: AsyncReadExt + AsyncWriteExt + Unpin + Send + 'static {
    if write_frame(&mut up, OP_HANDSHAKE, &hello).await.is_err() { return; }
    let (mut g_rd, mut g_wr) = tokio::io::split(game);
    let (mut u_rd, mut u_wr) = tokio::io::split(up);
    let app_name = { let g = load_games(&app).await; g.iter().find(|x| x.id == client_id).map(|x| x.name.clone()) };
    let tap = app.clone();
    let id = client_id.clone();
    let upward = async move {
        let mut had = false;
        loop {
            let (op, msg) = match read_frame(&mut g_rd).await { Ok(f) => f, Err(_) => break };
            if op == OP_FRAME && msg.get("cmd").and_then(|c| c.as_str()) == Some("SET_ACTIVITY") {
                let raw = msg.pointer("/args/activity").cloned().unwrap_or(Value::Null);
                let act = to_activity(&tap, &id, &raw).await;
                had = act.is_some();
                let _ = tap.emit("activity://rpc", json!({ "app": app_name, "activity": act }));
            }
            if write_frame(&mut u_wr, op, &msg).await.is_err() || op == OP_CLOSE { break; }
        }
        had
    };
    let downward = async move { let _ = tokio::io::copy(&mut u_rd, &mut g_wr).await; };
    let had = tokio::select! { h = upward => h, _ = downward => true };
    if had { let _ = app.emit("activity://rpc", json!({ "app": null, "activity": null })); }
}

/// The real Discord (or another Rich Presence host), on any slot but ours.
#[cfg(unix)]
async fn connect_discord(own: u32) -> Option<tokio::net::UnixStream> {
    let base = std::path::PathBuf::from(ipc_dir());
    // Plain installs share our folder; Flatpak and Snap builds of Discord (and Vesktop) keep their own.
    let dirs = [base.clone(), base.join("app/com.discordapp.Discord"), base.join("app/com.discordapp.DiscordCanary"), base.join("snap.discord"), base.join(".flatpak/dev.vencord.Vesktop/xdg-run")];
    for (n, dir) in dirs.iter().enumerate() {
        for i in 0..10u32 {
            if n == 0 && i == own { continue; }
            let p = dir.join(format!("discord-ipc-{i}"));
            if !p.exists() { continue; }
            if let Ok(Ok(s)) = tokio::time::timeout(Duration::from_millis(400), tokio::net::UnixStream::connect(&p)).await { return Some(s); }
        }
    }
    None
}
#[cfg(windows)]
async fn connect_discord(own: u32) -> Option<tokio::net::windows::named_pipe::NamedPipeClient> {
    use tokio::net::windows::named_pipe::ClientOptions;
    (0..10).filter(|i| *i != own).find_map(|i| ClientOptions::new().open(pipe_name(i)).ok())
}

#[cfg(unix)]
fn ipc_dir() -> String {
    ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"].iter().find_map(|k| std::env::var(k).ok()).unwrap_or_else(|| "/tmp".into())
}

/// Binds the first free discord-ipc socket. Err("busy") when Discord already holds slot 0.
#[cfg(unix)]
fn bind_rpc() -> Result<(tokio::net::UnixListener, std::path::PathBuf), &'static str> {
    // Only slot 0 is worth having: games try it first and stop at the first answer.
    let p = std::path::Path::new(&ipc_dir()).join("discord-ipc-0");
    if p.exists() {
        if std::os::unix::net::UnixStream::connect(&p).is_ok() { return Err("busy"); } // Discord got there first
        let _ = std::fs::remove_file(&p); // stale socket from a crash
    }
    tokio::net::UnixListener::bind(&p).map(|l| (l, p)).map_err(|_| "unsupported")
}

#[cfg(unix)]
async fn rpc_loop<R: Runtime>(app: AppHandle<R>, l: tokio::net::UnixListener, path: std::path::PathBuf, mut stop: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            r = l.accept() => if let Ok((s, _)) = r { tauri::async_runtime::spawn(serve_client(app.clone(), s, 0)); },
            _ = stop.changed() => break,
        }
    }
    let _ = std::fs::remove_file(path);
}

#[cfg(windows)]
fn pipe_name(i: u32) -> String { format!(r"\\.\pipe\discord-ipc-{i}") }

#[cfg(windows)]
fn bind_rpc() -> Result<(tokio::net::windows::named_pipe::NamedPipeServer, u32), &'static str> {
    use tokio::net::windows::named_pipe::ServerOptions;
    // Only slot 0 is worth having: games try it first and stop at the first answer.
    match ServerOptions::new().first_pipe_instance(true).create(pipe_name(0)) {
        Ok(s) => Ok((s, 0)),
        Err(_) => Err("busy"),
    }
}

#[cfg(windows)]
async fn rpc_loop<R: Runtime>(app: AppHandle<R>, mut server: tokio::net::windows::named_pipe::NamedPipeServer, i: u32, mut stop: watch::Receiver<bool>) {
    use tokio::net::windows::named_pipe::ServerOptions;
    loop {
        tokio::select! {
            r = server.connect() => {
                if r.is_err() { break; }
                let next = match ServerOptions::new().create(pipe_name(i)) { Ok(n) => n, Err(_) => break };
                let client = std::mem::replace(&mut server, next);
                tauri::async_runtime::spawn(serve_client(app.clone(), client, i));
            }
            _ = stop.changed() => break,
        }
    }
}

/* ------------------------------------------------------------------ command */

/// Turns detection and Rich Presence on or off; returns what is actually running.
#[tauri::command]
pub async fn activity_config<R: Runtime>(app: AppHandle<R>, detect: bool, rpc: bool) -> Status {
    let state = app.state::<ActivityState>();

    // Detection
    let detect_status = {
        let mut d = state.detect.lock().unwrap();
        if detect && d.is_none() {
            let (tx, rx) = watch::channel(false);
            tauri::async_runtime::spawn(detect_loop(app.clone(), rx));
            *d = Some(tx);
        } else if !detect { if let Some(tx) = d.take() { let _ = tx.send(true); } }
        if detect { "on" } else { "off" }
    };

    // Rich Presence
    let rpc_status: &'static str = {
        let mut r = state.rpc.lock().unwrap();
        if !rpc {
            if let Some((tx, _)) = r.take() { let _ = tx.send(true); }
            "off"
        } else if let Some((_, s)) = r.as_ref() {
            s
        } else {
            match bind_rpc() {
                #[cfg(unix)]
                Ok((l, path)) => { let (tx, rx) = watch::channel(false); tauri::async_runtime::spawn(rpc_loop(app.clone(), l, path, rx)); *r = Some((tx, "listening")); "listening" }
                #[cfg(windows)]
                Ok((srv, i)) => { let (tx, rx) = watch::channel(false); tauri::async_runtime::spawn(rpc_loop(app.clone(), srv, i, rx)); *r = Some((tx, "listening")); "listening" }
                Err(e) => e,
            }
        }
    };
    Status { rpc: rpc_status, detect: detect_status }
}
