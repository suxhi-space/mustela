//! macOS: the sound of one app (or of every app but Mustela) for a screen share, through ScreenCaptureKit
//! (macOS 13 and later). It needs the same Screen Recording permission as the picture.
//!
//! ScreenCaptureKit picks sound by app: an app's helper processes (a browser's audio process, WebKit's) count
//! as that app. Mustela's own sound (the call, its web view) is always left out. The sound comes out as 48 kHz
//! stereo float samples in 20 ms chunks, the same as on Windows and Linux.

use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_core_audio_types::{AudioBuffer, AudioBufferList};
use objc2_core_foundation::CFRetained;
use objc2_core_media::{kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, CMBlockBuffer, CMSampleBuffer, CMTime, CMTimeFlags};
use objc2_foundation::{NSArray, NSError};
use objc2_screen_capture_kit::{SCContentFilter, SCRunningApplication, SCShareableContent, SCStream, SCStreamConfiguration, SCStreamOutput, SCStreamOutputType};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

const RATE: isize = 48_000;
const CHUNK: usize = 960 * 8; // 20 ms of 48 kHz stereo f32

type Sink = Box<dyn FnMut(Vec<u8>) -> bool + Send>;

pub struct Ivars {
    out: Mutex<(Vec<u8>, Sink)>,
    gone: Arc<AtomicBool>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = AllocAnyThread]
    #[name = "MustelaShareAudioOutput"]
    #[ivars = Ivars]
    struct Output;

    unsafe impl NSObjectProtocol for Output {}

    unsafe impl SCStreamOutput for Output {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        fn did_output(&self, _stream: &SCStream, sample: &CMSampleBuffer, kind: SCStreamOutputType) {
            if kind != SCStreamOutputType::Audio { return; }
            let Some(pcm) = interleaved(sample) else { return };
            let mut out = self.ivars().out.lock().unwrap();
            let (buf, send) = &mut *out;
            buf.extend_from_slice(&pcm);
            while buf.len() >= CHUNK {
                let chunk: Vec<u8> = buf.drain(..CHUNK).collect();
                if !send(chunk) { self.ivars().gone.store(true, Ordering::Relaxed); break; }
            }
        }
    }
);

impl Output {
    fn new(send: Sink, gone: Arc<AtomicBool>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { out: Mutex::new((Vec::with_capacity(CHUNK * 4), send)), gone });
        unsafe { msg_send![super(this), init] }
    }
}

/// The samples of one buffer as interleaved stereo f32 bytes (ScreenCaptureKit hands over one plane per channel).
fn interleaved(sample: &CMSampleBuffer) -> Option<Vec<u8>> {
    // Room for a list of up to 8 buffers.
    #[repr(C)]
    struct List { n: u32, bufs: [AudioBuffer; 8] }
    let mut list: List = unsafe { std::mem::zeroed() };
    let mut block: *mut CMBlockBuffer = std::ptr::null_mut();
    let status = unsafe {
        sample.audio_buffer_list_with_retained_block_buffer(
            std::ptr::null_mut(),
            (&mut list as *mut List).cast::<AudioBufferList>(),
            std::mem::size_of::<List>(),
            None, None,
            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            &mut block,
        )
    };
    // Released when this returns; the sample memory belongs to it.
    let _block: Option<CFRetained<CMBlockBuffer>> = NonNull::new(block).map(|b| unsafe { CFRetained::from_raw(b) });
    if status != 0 || list.n == 0 { return None; }
    let plane = |b: &AudioBuffer| -> &[f32] {
        if b.mData.is_null() { return &[]; }
        unsafe { std::slice::from_raw_parts(b.mData as *const f32, b.mDataByteSize as usize / 4) }
    };
    let n = (list.n as usize).min(8);
    let mut out = Vec::new();
    if n >= 2 {
        // Planar: left and right in their own buffers.
        let (l, r) = (plane(&list.bufs[0]), plane(&list.bufs[1]));
        out.reserve(l.len().min(r.len()) * 8);
        for (a, b) in l.iter().zip(r) { out.extend_from_slice(&a.to_le_bytes()); out.extend_from_slice(&b.to_le_bytes()); }
    } else {
        let b = &list.bufs[0];
        let s = plane(b);
        match b.mNumberChannels {
            2 => for x in s { out.extend_from_slice(&x.to_le_bytes()); },
            1 => for x in s { out.extend_from_slice(&x.to_le_bytes()); out.extend_from_slice(&x.to_le_bytes()); },
            c if c > 2 => for f in s.chunks_exact(c as usize) { out.extend_from_slice(&f[0].to_le_bytes()); out.extend_from_slice(&f[1].to_le_bytes()); },
            _ => return None,
        }
    }
    Some(out)
}

/// The app that "owns" a process (a browser for its helpers, Mustela for its web view), when macOS says.
fn responsible(pid: i32) -> i32 {
    type F = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;
    let f = unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"responsibility_get_pid_responsible_for_pid".as_ptr()) };
    if f.is_null() { return pid; }
    let r = unsafe { std::mem::transmute::<*mut libc::c_void, F>(f)(pid) };
    if r > 0 { r } else { pid }
}

fn shareable_content() -> Result<Retained<SCShareableContent>, String> {
    let (tx, rx) = mpsc::channel::<Result<Retained<SCShareableContent>, String>>();
    let tx = Mutex::new(tx);
    let done = RcBlock::new(move |content: *mut SCShareableContent, err: *mut NSError| {
        let r = match unsafe { Retained::retain(content) } {
            Some(c) => Ok(c),
            None => Err(unsafe { err.as_ref() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "Screen Recording permission is needed.".into())),
        };
        let _ = tx.lock().unwrap().send(r);
    });
    unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&done) };
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "macOS didn't answer.".to_string())?
}

fn wait(f: impl FnOnce(&block2::DynBlock<dyn Fn(*mut NSError)>)) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let tx = Mutex::new(tx);
    let done = RcBlock::new(move |err: *mut NSError| {
        let _ = tx.lock().unwrap().send(match unsafe { err.as_ref() } { Some(e) => Err(e.localizedDescription().to_string()), None => Ok(()) });
    });
    f(&done);
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "macOS didn't answer.".to_string())?
}

/// Starts the capture; returns once it's running (or failed to start). Stops when `running` goes false or
/// `send` returns false.
pub fn start_with(pid: u32, running: Arc<AtomicBool>, send: impl FnMut(Vec<u8>) -> bool + Send + 'static) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let send: Sink = Box::new(send);
    std::thread::Builder::new().name("mustela-screen-audio".into()).spawn(move || {
        if let Err(e) = run(pid as i32, running, send, &tx) { let _ = tx.send(Err(e)); }
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(8)).unwrap_or(Err("The app's sound didn't start.".into()))
}

fn run(pid: i32, running: Arc<AtomicBool>, send: Sink, ready: &mpsc::Sender<Result<(), String>>) -> Result<(), String> {
    // ScreenCaptureKit only hands over sound from macOS 13 (it's weakly linked, so older Macs still open Mustela).
    if !objc2::available!(macos = 13.0) { return Err("Sharing sound needs macOS 13 or later.".into()); }
    let me = std::process::id() as i32;
    let content = shareable_content()?;
    let display = unsafe { content.displays() }.firstObject().ok_or("No screen found.")?;
    let apps = unsafe { content.applications() };
    let pid_of = |a: &SCRunningApplication| unsafe { a.processID() };
    let ours = |a: &SCRunningApplication| pid_of(a) == me || responsible(pid_of(a)) == me;

    let filter = if pid == 0 {
        // Everything but Mustela (and its web view, which plays the call).
        let skip: Vec<Retained<SCRunningApplication>> = apps.iter().filter(|a| ours(a)).collect();
        let skip = NSArray::from_retained_slice(&skip);
        unsafe { SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(SCContentFilter::alloc(), &display, &skip, &NSArray::new()) }
    } else {
        // The app, its helpers, and anything it's responsible for.
        let bundle = apps.iter().find(|a| pid_of(a) == pid).map(|a| unsafe { a.bundleIdentifier() }.to_string()).filter(|b| !b.is_empty());
        let take: Vec<Retained<SCRunningApplication>> = apps.iter().filter(|a| {
            let p = pid_of(a);
            if ours(a) { return false; }
            p == pid || responsible(p) == pid
                || bundle.as_deref().is_some_and(|b| unsafe { a.bundleIdentifier() }.to_string().starts_with(&format!("{b}.")))
        }).collect();
        if take.is_empty() { return Err("That app isn't one macOS can take sound from.".into()); }
        let take = NSArray::from_retained_slice(&take);
        unsafe { SCContentFilter::initWithDisplay_includingApplications_exceptingWindows(SCContentFilter::alloc(), &display, &take, &NSArray::new()) }
    };

    let config = unsafe { SCStreamConfiguration::new() };
    unsafe {
        config.setCapturesAudio(true);
        config.setSampleRate(RATE);
        config.setChannelCount(2);
        config.setExcludesCurrentProcessAudio(true);
        // Only the sound is used: keep the picture tiny and rare.
        config.setWidth(2);
        config.setHeight(2);
        config.setMinimumFrameInterval(CMTime { value: 1, timescale: 1, flags: CMTimeFlags::Valid, epoch: 0 });
    }
    let stream = unsafe { SCStream::initWithFilter_configuration_delegate(SCStream::alloc(), &filter, &config, None) };
    let gone = Arc::new(AtomicBool::new(false));
    let output = Output::new(send, gone.clone());
    let queue = DispatchQueue::new("app.mustela.share-audio", None);
    unsafe { stream.addStreamOutput_type_sampleHandlerQueue_error(ProtocolObject::from_ref(&*output), SCStreamOutputType::Audio, Some(&queue)) }
        .map_err(|e| e.localizedDescription().to_string())?;
    wait(|done| unsafe { stream.startCaptureWithCompletionHandler(Some(done)) })?;
    let _ = ready.send(Ok(()));

    while running.load(Ordering::Relaxed) && !gone.load(Ordering::Relaxed) { std::thread::sleep(Duration::from_millis(200)); }
    let _ = wait(|done| unsafe { stream.stopCaptureWithCompletionHandler(Some(done)) });
    Ok(())
}
