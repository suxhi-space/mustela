//! Mustela's Android helpers. On desktop every command is a harmless stub.
use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::MustelaNative;
#[cfg(mobile)]
use mobile::MustelaNative;

pub trait MustelaNativeExt<R: Runtime> {
  fn mustela_native(&self) -> &MustelaNative<R>;
}

impl<R: Runtime, T: Manager<R>> MustelaNativeExt<R> for T {
  fn mustela_native(&self) -> &MustelaNative<R> {
    self.state::<MustelaNative<R>>().inner()
  }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("mustela-native")
    .invoke_handler(tauri::generate_handler![
      commands::accent, commands::start_call, commands::end_call, commands::set_mic, commands::call_state
    ])
    .setup(|app, api| {
      #[cfg(mobile)]
      let native = mobile::init(app, api)?;
      #[cfg(desktop)]
      let native = desktop::init(app, api)?;
      app.manage(native);
      Ok(())
    })
    .build()
}
