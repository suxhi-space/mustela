//! Sign-in tokens in the system keychain (Windows Credential Manager, macOS Keychain, the Linux Secret Service).
//!
//! The page keeps only a placeholder for each account's token and asks for the real one here when it starts. Where
//! no keychain service is running (some Linux setups), `vault_available` says so and the page keeps the token in its
//! own storage as before, so nobody gets locked out.
//!
//! Entries are named after the account ("session:official#01H…"); nothing else is stored, and a token is never
//! logged.

const SERVICE: &str = "app.mustela.client";

fn entry(account: &str) -> Result<keyring::Entry, String> {
    // Account ids are "<instance>#<user id>" or similar: short, printable. Anything else is refused.
    if account.is_empty() || account.len() > 300 || account.chars().any(|c| c.is_control()) {
        return Err("bad account".into());
    }
    keyring::Entry::new(SERVICE, &format!("session:{account}")).map_err(|e| e.to_string())
}

/// Runs a keychain call off the main thread (the Secret Service talks over D-Bus; macOS may show a prompt).
async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Whether a keychain is there to use: writes, reads back and removes a test entry.
#[tauri::command]
pub async fn vault_available() -> bool {
    off_thread(|| {
        let e = entry("probe")?;
        e.set_password("ok").map_err(|e| e.to_string())?;
        let back = e.get_password().map_err(|e| e.to_string())?;
        let _ = e.delete_credential();
        Ok(back == "ok")
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn vault_get(account: String) -> Result<Option<String>, String> {
    off_thread(move || match entry(&account)?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    })
    .await
}

#[tauri::command]
pub async fn vault_set(account: String, secret: String) -> Result<(), String> {
    if secret.is_empty() || secret.len() > 2000 {
        return Err("bad secret".into());
    }
    off_thread(move || entry(&account)?.set_password(&secret).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn vault_delete(account: String) -> Result<(), String> {
    off_thread(move || match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    })
    .await
}
