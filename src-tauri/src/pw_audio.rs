//! Linux: the sound of one app (or of every app but Mustela) for a screen share, through PipeWire.
//!
//! Mustela opens its own capture stream that nothing connects to by itself, then watches PipeWire's list of
//! playing streams and links the ones that belong to the shared app into it (PipeWire mixes them). Apps that
//! start playing later, or open a new stream, are linked as they show up. The sound comes out as 48 kHz
//! stereo float samples in 20 ms chunks, the same as on Windows, so the page handles both the same way.
//!
//! Which streams belong to the app: the window's process, any process started by it (browsers play sound from
//! a helper process), or the same program. Mustela's own sound (the call, its web view) is never included.

use pipewire as pw;
use pw::{properties::properties, spa};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

const RATE: u32 = 48_000;
const CHUNK: usize = 960 * 8; // 20 ms of 48 kHz stereo f32

/// Which playing streams to take.
#[derive(Clone, Debug)]
pub struct Want {
    /// The shared app's process (0: every app but Mustela).
    pid: u32,
    /// That process's program, to also catch its streams when the process IDs don't line up (sandboxed apps).
    exe: Option<String>,
    me: u32,
}

impl Want {
    pub fn new(pid: u32) -> Self {
        let exe = if pid == 0 { None } else { exe_name(pid) };
        Want { pid, exe, me: std::process::id() }
    }

    /// Whether a stream from process `pid` (as PipeWire saw it, `sec`, and as the app says, `app`), running
    /// `binary`, is one to take.
    fn takes(&self, app: Option<u32>, sec: Option<u32>, binary: Option<&str>) -> bool {
        let pids: Vec<u32> = [app, sec].into_iter().flatten().filter(|p| *p > 0).collect();
        if pids.iter().any(|p| descends(*p, self.me)) { return false; }
        if self.pid == 0 { return true; }
        if pids.iter().any(|p| descends(*p, self.pid)) { return true; }
        match (&self.exe, binary) {
            (Some(exe), Some(b)) => same_program(exe, b),
            _ => false,
        }
    }
}

/// `pid` is `root` or was started (at any depth) by it.
fn descends(pid: u32, root: u32) -> bool {
    let mut p = pid;
    for _ in 0..64 {
        if p == root { return true; }
        if p <= 1 { return false; }
        match parent(p) { Some(q) if q != p => p = q, _ => return false }
    }
    false
}

fn parent(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // "pid (name) state ppid ..."; the name can hold spaces and brackets, so read after the last ')'.
    stat.rsplit_once(')')?.1.split_whitespace().nth(1)?.parse().ok()
}

fn exe_name(pid: u32) -> Option<String> {
    let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
    Some(exe.file_name()?.to_string_lossy().into_owned())
}

/// "firefox" vs "firefox-bin", "chrome" vs "google-chrome": the same program under a slightly different name.
fn same_program(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.rsplit('/').next().unwrap_or(s).trim_end_matches(" (deleted)").trim_end_matches("-bin").to_ascii_lowercase();
    let (a, b) = (norm(a), norm(b));
    !a.is_empty() && !b.is_empty() && (a == b || a.ends_with(&format!("-{b}")) || b.ends_with(&format!("-{a}")))
}

/// What PipeWire told us about, kept up to date from its registry.
#[derive(Default)]
struct Graph {
    /// Client → the process PipeWire saw connect.
    clients: HashMap<u32, u32>,
    /// Playing streams to take.
    taken: HashSet<u32>,
    /// Output ports of those streams: port → (node, channel).
    outs: HashMap<u32, (u32, String)>,
    /// Our stream's node and its input ports by channel.
    ours: Option<u32>,
    ins: HashMap<String, u32>,
    /// Links made (output port, input port), and their proxies (kept so the links stay).
    linked: HashSet<(u32, u32)>,
    links: HashMap<(u32, u32), pw::link::Link>,
}

fn prop<'a>(o: &'a pw::registry::GlobalObject<&spa::utils::dict::DictRef>, k: &str) -> Option<&'a str> {
    o.props.and_then(|p| p.get(k))
}

/// Starts the capture; returns once it's running (or failed to start). Stops when `running` goes false or the
/// page stops listening.
pub fn start(pid: u32, running: Arc<AtomicBool>, channel: Channel<InvokeResponseBody>) -> Result<(), String> {
    start_with(pid, running, move |chunk| channel.send(InvokeResponseBody::Raw(chunk)).is_ok())
}

/// The same, handing each 20 ms chunk to `send` (false: stop).
pub fn start_with(pid: u32, running: Arc<AtomicBool>, send: impl FnMut(Vec<u8>) -> bool + Send + 'static) -> Result<(), String> {
    let want = Want::new(pid);
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new().name("mustela-screen-audio".into()).spawn(move || {
        if let Err(e) = run(want, running, Box::new(send), &tx) { let _ = tx.send(Err(e)); }
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).unwrap_or(Err("The app's sound didn't start.".into()))
}

/// The call library (LiveKit's WebRTC) carries stand-ins for a few PipeWire functions that only work once it has
/// loaded PipeWire itself, and the build uses those stand-ins for everyone, us included. So load PipeWire the
/// same way it would (its own setup function, with the system's library) before using it. Once is enough, and
/// it's harmless if WebRTC did it already.
fn load_pipewire() -> Result<(), String> {
    use std::sync::OnceLock;
    extern "C" {
        #[link_name = "_ZN14modules_portal18InitializePipewireEPv"]
        fn webrtc_initialize_pipewire(module: *mut std::ffi::c_void);
        #[link_name = "_ZN14modules_portal21IsPipewireInitializedEv"]
        fn webrtc_pipewire_initialized() -> bool;
    }
    static LOADED: OnceLock<Result<(), String>> = OnceLock::new();
    LOADED.get_or_init(|| unsafe {
        if webrtc_pipewire_initialized() { return Ok(()); }
        let lib = libc::dlopen(c"libpipewire-0.3.so.0".as_ptr(), libc::RTLD_NOW | libc::RTLD_GLOBAL);
        if lib.is_null() { return Err("PipeWire isn't installed, which Mustela needs to share an app's sound.".into()); }
        webrtc_initialize_pipewire(lib);
        if webrtc_pipewire_initialized() { Ok(()) } else { Err("This PipeWire is too old to share an app's sound.".into()) }
    }).clone()
}

fn run(want: Want, running: Arc<AtomicBool>, send: Box<dyn FnMut(Vec<u8>) -> bool>, ready: &std::sync::mpsc::Sender<Result<(), String>>) -> Result<(), String> {
    let no_pw = |_| "Couldn't reach PipeWire, which Mustela needs to share an app's sound.".to_string();
    load_pipewire()?;
    pw::init();
    let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(no_pw)?;
    let context = pw::context::ContextRc::new(&mainloop, None).map_err(no_pw)?;
    let core = context.connect_rc(None).map_err(no_pw)?;
    let registry = core.get_registry_rc().map_err(no_pw)?;

    let name = format!("mustela-share-audio-{}", std::process::id());
    let graph = Rc::new(RefCell::new(Graph::default()));

    // Links every taken output port to our matching input (mono to both sides).
    let link_all = {
        let graph = graph.clone();
        let core = core.clone();
        move || {
            let mut g = graph.borrow_mut();
            let Some(ours) = g.ours else { return };
            let mut todo = Vec::new();
            for (&port, (node, ch)) in &g.outs {
                if !g.taken.contains(node) { continue; }
                let targets: Vec<&str> = match ch.as_str() {
                    "FL" | "FR" => vec![ch.as_str()],
                    "MONO" | "" | "UNK" => vec!["FL", "FR"],
                    // Surround: fronts and centre go to both sides, the rest is left out.
                    "FC" | "LFE" => vec!["FL", "FR"],
                    "SL" | "RL" => vec!["FL"],
                    "SR" | "RR" => vec!["FR"],
                    _ => vec![],
                };
                for t in targets {
                    if let Some(&inp) = g.ins.get(t) {
                        if !g.linked.contains(&(port, inp)) { todo.push((*node, port, inp)); }
                    }
                }
            }
            for (node, out, inp) in todo {
                g.linked.insert((out, inp));
                let link = core.create_object::<pw::link::Link>("link-factory", &properties! {
                    "link.output.node" => node.to_string(),
                    "link.output.port" => out.to_string(),
                    "link.input.node" => ours.to_string(),
                    "link.input.port" => inp.to_string(),
                    "object.linger" => "false",
                });
                if let Ok(l) = link { g.links.insert((out, inp), l); }
            }
        }
    };
    let link_all = Rc::new(link_all);

    let _reg = registry
        .add_listener_local()
        .global({
            let graph = graph.clone();
            let link_all = link_all.clone();
            let name = name.clone();
            move |o| {
                use pw::types::ObjectType;
                match o.type_ {
                    ObjectType::Client => {
                        if let Some(p) = prop(o, "pipewire.sec.pid").and_then(|p| p.parse().ok()) {
                            graph.borrow_mut().clients.insert(o.id, p);
                        }
                    }
                    ObjectType::Node => {
                        if prop(o, "node.name") == Some(name.as_str()) {
                            graph.borrow_mut().ours = Some(o.id);
                        } else if prop(o, "media.class") == Some("Stream/Output/Audio") {
                            let app = prop(o, "application.process.id").and_then(|p| p.parse().ok());
                            let sec = prop(o, "client.id").and_then(|c| c.parse::<u32>().ok()).and_then(|c| graph.borrow().clients.get(&c).copied());
                            if want.takes(app, sec, prop(o, "application.process.binary")) {
                                graph.borrow_mut().taken.insert(o.id);
                            }
                        } else { return }
                    }
                    ObjectType::Port => {
                        let (Some(node), Some(dir)) = (prop(o, "node.id").and_then(|n| n.parse::<u32>().ok()), prop(o, "port.direction")) else { return };
                        if prop(o, "port.monitor") == Some("true") { return }
                        let ch = prop(o, "audio.channel").unwrap_or("").to_string();
                        let mut g = graph.borrow_mut();
                        if dir == "out" { g.outs.insert(o.id, (node, ch)); }
                        else if dir == "in" && Some(node) == g.ours { g.ins.insert(ch, o.id); }
                        else { return }
                    }
                    _ => return,
                }
                link_all();
            }
        })
        .global_remove({
            let graph = graph.clone();
            move |id| {
                let mut g = graph.borrow_mut();
                g.clients.remove(&id);
                g.taken.remove(&id);
                g.outs.remove(&id);
                g.linked.retain(|(o, i)| *o != id && *i != id);
                g.links.retain(|(o, i), _| *o != id && *i != id);
            }
        })
        .register();

    let props = properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Screen",
        *pw::keys::NODE_NAME => name.as_str(),
        *pw::keys::NODE_DESCRIPTION => "Mustela screen share sound",
        *pw::keys::APP_NAME => "Mustela",
        "node.autoconnect" => "false",
        "node.dont-reconnect" => "true",
        // Keep running (sending silence) while the app is quiet, like on Windows.
        "node.want-driver" => "true",
        "node.always-process" => "true",
    };
    let stream = pw::stream::StreamBox::new(&core, &name, props).map_err(|e| e.to_string())?;

    struct Out { buf: Vec<u8>, send: Box<dyn FnMut(Vec<u8>) -> bool>, gone: Rc<AtomicBool> }
    let gone = Rc::new(AtomicBool::new(false));
    let _listener = stream
        .add_local_listener_with_user_data(Out { buf: Vec::with_capacity(CHUNK * 4), send, gone: gone.clone() })
        .process(|stream, out| {
            let Some(mut buffer) = stream.dequeue_buffer() else { return };
            let datas = buffer.datas_mut();
            let Some(d) = datas.first_mut() else { return };
            let (off, size) = (d.chunk().offset() as usize, d.chunk().size() as usize);
            if let Some(bytes) = d.data() {
                let end = (off + size).min(bytes.len());
                if off < end { out.buf.extend_from_slice(&bytes[off..end]); }
            }
            while out.buf.len() >= CHUNK {
                let chunk: Vec<u8> = out.buf.drain(..CHUNK).collect();
                if !(out.send)(chunk) { out.gone.store(true, Ordering::Relaxed); break; }
            }
        })
        .register()
        .map_err(|e| e.to_string())?;

    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::F32LE);
    info.set_rate(RATE);
    info.set_channels(2);
    let mut pos = [0u32; spa::sys::SPA_AUDIO_MAX_CHANNELS as usize];
    pos[0] = spa::sys::SPA_AUDIO_CHANNEL_FL;
    pos[1] = spa::sys::SPA_AUDIO_CHANNEL_FR;
    info.set_position(pos);
    let values: Vec<u8> = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &spa::pod::Value::Object(spa::pod::Object {
            type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
            id: spa::param::ParamType::EnumFormat.as_raw(),
            properties: info.into(),
        }),
    ).map_err(|e| format!("{e:?}"))?.0.into_inner();
    let mut params = [spa::pod::Pod::from_bytes(&values).ok_or("Bad audio format")?];
    stream.connect(
        spa::utils::Direction::Input,
        None,
        pw::stream::StreamFlags::MAP_BUFFERS,
        &mut params,
    ).map_err(|e| e.to_string())?;

    // Stop when asked to, or when the page stopped listening.
    let timer = mainloop.loop_().add_timer({
        let mainloop = mainloop.clone();
        move |_| if !running.load(Ordering::Relaxed) || gone.load(Ordering::Relaxed) { mainloop.quit(); }
    });
    timer.update_timer(Some(Duration::from_millis(50)), Some(Duration::from_millis(200))).into_result().map_err(|e| e.to_string())?;

    let _ = ready.send(Ok(()));
    mainloop.run();
    let _ = stream.disconnect();
    graph.borrow_mut().links.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn program_names() {
        assert!(same_program("firefox", "firefox-bin"));
        assert!(same_program("/usr/lib/firefox/firefox", "firefox"));
        assert!(same_program("chrome", "google-chrome"));
        assert!(!same_program("chrome", "chromium"));
        assert!(!same_program("", "x"));
    }
    #[test]
    fn process_tree() {
        let me = std::process::id();
        assert!(descends(me, me));
        assert!(descends(me, 1) || parent(me).is_some());
        let child = std::process::Command::new("sleep").arg("2").spawn().unwrap();
        assert!(descends(child.id(), me));
        assert!(!descends(me, child.id()));
        // Mustela's own sound is never taken, even when sharing "everything".
        let all = Want::new(0);
        assert!(!all.takes(Some(child.id()), None, Some("sleep")));
        assert!(all.takes(Some(1), None, None));
        let one = Want { pid: child.id(), exe: Some("sleep".into()), me: 999_999_999 };
        assert!(one.takes(None, Some(child.id()), None));
        assert!(one.takes(Some(1), None, Some("sleep")));
        assert!(!one.takes(Some(1), None, Some("mpv")));
    }

    /// Needs PipeWire with something playing; run with MUSTELA_PW_TEST=<pid of the player> (0: everything).
    #[test]
    fn live_capture() {
        let Some(pid) = std::env::var("MUSTELA_PW_TEST").ok().and_then(|p| p.parse().ok()) else { return };
        let got = Arc::new(std::sync::Mutex::new((0usize, 0f32)));
        let running = Arc::new(AtomicBool::new(true));
        let g = got.clone();
        start_with(pid, running.clone(), move |c| {
            let peak = c.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]).abs()).fold(0f32, f32::max);
            let mut g = g.lock().unwrap();
            g.0 += 1; g.1 = g.1.max(peak);
            true
        }).unwrap();
        std::thread::sleep(Duration::from_secs(2));
        running.store(false, Ordering::Relaxed);
        let (chunks, peak) = *got.lock().unwrap();
        println!("chunks {chunks}, peak {peak}");
        assert!(chunks > 50, "chunks {chunks}");
        let expect_sound = std::env::var("MUSTELA_PW_SILENT").is_err();
        assert_eq!(peak > 0.01, expect_sound, "peak {peak}");
    }
}
