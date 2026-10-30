//! Windows: one continuous Windows Graphics Capture session for the whole share (what OBS, Discord and
//! Chromium do), instead of grabbing single pictures. Starting and stopping a capture for every frame is
//! slow and makes Windows flicker the mouse pointer; a running session doesn't, includes the pointer, and
//! sees hardware-drawn windows (games, browsers, Electron apps) and windows behind other windows.

use std::sync::{mpsc::{sync_channel, Receiver, TrySendError}, Mutex};
use windows::{
    core::{factory, IInspectable, Interface, Ref},
    Foundation::TypedEventHandler,
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
    },
    Win32::{
        Foundation::{HMODULE, HWND},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::{
                D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC,
                D3D11_USAGE_STAGING,
            },
            Dxgi::IDXGIDevice,
            Gdi::HMONITOR,
        },
        System::WinRT::{
            Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
            Graphics::Capture::IGraphicsCaptureItemInterop,
        },
    },
};

/// The capture's Direct3D device, for resizing the frame pool from the capture's own thread. The device
/// comes from a free-threaded D3D11 device and is agile, so using it from that thread is fine; the crate
/// just doesn't mark the WinRT wrapper as `Send`.
struct AgileDevice(IDirect3DDevice);
unsafe impl Send for AgileDevice {}
unsafe impl Sync for AgileDevice {}
impl AgileDevice { fn get(&self) -> &IDirect3DDevice { &self.0 } }

/// One captured picture: BGRA, tightly packed.
pub struct Frame { pub width: u32, pub height: u32, pub bgra: Vec<u8> }

pub enum Target { Monitor(u32), Window(u32) }

/// A running capture; dropping it stops it.
pub struct Capture { session: GraphicsCaptureSession, pool: Direct3D11CaptureFramePool }

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

/// Copies a captured texture into memory (a GPU-to-CPU copy through a staging texture).
fn read_texture(d3d: &ID3D11Device, ctx: &ID3D11DeviceContext, tex: &ID3D11Texture2D) -> windows::core::Result<Frame> {
    unsafe {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        tex.GetDesc(&mut desc);
        let mut staging_desc = desc;
        staging_desc.BindFlags = 0;
        staging_desc.MiscFlags = 0;
        staging_desc.Usage = D3D11_USAGE_STAGING;
        staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        let mut staging: Option<ID3D11Texture2D> = None;
        d3d.CreateTexture2D(&staging_desc, None, Some(&mut staging))?;
        let staging = staging.ok_or_else(windows::core::Error::empty)?;
        let dst: ID3D11Resource = staging.cast()?;
        let src: ID3D11Resource = tex.cast()?;
        ctx.CopyResource(&dst, &src);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        ctx.Map(&dst, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        let (w, h) = (desc.Width, desc.Height);
        let row = (w * 4) as usize;
        let mut bgra = vec![0u8; row * h as usize];
        let base = mapped.pData as *const u8;
        for y in 0..h as usize {
            let from = std::slice::from_raw_parts(base.add(y * mapped.RowPitch as usize), row);
            bgra[y * row..(y + 1) * row].copy_from_slice(from);
        }
        ctx.Unmap(&dst, 0);
        Ok(Frame { width: w, height: h, bgra })
    }
}

/// Starts capturing a screen or a window. Frames arrive on the receiver as Windows draws them; if the
/// last one hasn't been taken yet, the new one is dropped (never a backlog).
pub fn start(target: Target) -> windows::core::Result<(Capture, Receiver<Frame>)> {
    let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
    // The picker's ids are the handles' low 32 bits, which is all a handle uses; sign-extend them back.
    let item: GraphicsCaptureItem = unsafe {
        match target {
            Target::Monitor(id) => interop.CreateForMonitor(HMONITOR(id as i32 as isize as _))?,
            Target::Window(id) => interop.CreateForWindow(HWND(id as i32 as isize as _))?,
        }
    };

    let mut device: Option<ID3D11Device> = None;
    unsafe {
        D3D11CreateDevice(None, D3D_DRIVER_TYPE_HARDWARE, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT, None, D3D11_SDK_VERSION, Some(&mut device), None, None)?;
    }
    let d3d = device.ok_or_else(windows::core::Error::empty)?;
    let ctx = unsafe { d3d.GetImmediateContext()? };
    let dxgi: IDXGIDevice = d3d.cast()?;
    let rt_device: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;

    let size = item.Size()?;
    let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&rt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)?;
    let (tx, rx) = sync_channel::<Frame>(1);
    let last_size = Mutex::new(size);
    let pool_device = AgileDevice(rt_device.clone());
    pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, IInspectable>::new(
        move |sender: Ref<'_, Direct3D11CaptureFramePool>, _| {
            let Some(pool) = sender.as_ref() else { return Ok(()) };
            let frame = pool.TryGetNextFrame()?;
            // A window that changed size: the pool follows it (the next frames come at the new size).
            let content = frame.ContentSize()?;
            {
                let mut last = last_size.lock().unwrap_or_else(|e| e.into_inner());
                if content.Width != last.Width || content.Height != last.Height {
                    *last = content;
                    let _ = frame.Close();
                    pool.Recreate(pool_device.get(), DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, content)?;
                    return Ok(());
                }
            }
            let picture = (|| {
                let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                let tex: ID3D11Texture2D = unsafe { access.GetInterface()? };
                read_texture(&d3d, &ctx, &tex)
            })();
            let _ = frame.Close();
            if let Ok(p) = picture {
                match tx.try_send(p) { Ok(()) | Err(TrySendError::Full(_)) => {}, Err(TrySendError::Disconnected(_)) => {} }
            }
            Ok(())
        },
    ))?;

    let session = pool.CreateCaptureSession(&item)?;
    let _ = session.SetIsCursorCaptureEnabled(true); // viewers see your pointer
    let _ = session.SetIsBorderRequired(false); // no yellow border (Windows 11)
    session.StartCapture()?;
    Ok((Capture { session, pool }, rx))
}
