use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
  /// Desktop builds have no native call engine; the app uses the web one there.
  #[error("not supported on this platform")]
  Unsupported,
  #[cfg(mobile)]
  #[error(transparent)]
  PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
  fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
    s.serialize_str(self.to_string().as_ref())
  }
}
