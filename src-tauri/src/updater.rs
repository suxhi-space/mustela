//! Updates from the GitHub releases of the repository this build was made for.
//!
//! The build script asks for the repository and passes it in as `MUSTELA_UPDATE_REPO`
//! (owner/repo). No repository means update checks are off.
//!
//! Safety rules:
//!  - only `https://github.com/<repo>/releases/download/…` files are downloaded, and redirects may only
//!    go to GitHub's own download hosts;
//!  - the file must match the SHA-256 GitHub lists for that asset, or it's thrown away;
//!  - nothing runs unless the person pressed Install.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;

pub const REPO: Option<&str> = option_env!("MUSTELA_UPDATE_REPO");
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_BYTES: u64 = 400 * 1024 * 1024;
const DOWNLOAD_HOSTS: [&str; 3] = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

pub fn repo() -> Option<&'static str> {
    REPO.map(str::trim).filter(|r| !r.is_empty() && r.split('/').count() == 2)
}

/// How this copy was installed, which decides which file to fetch and what Install does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind { WindowsNsis, MacosDmg, LinuxAppimage, LinuxDeb, Android, Ios, Other }

impl Kind {
    pub fn current() -> Kind {
        if cfg!(target_os = "windows") { Kind::WindowsNsis }
        else if cfg!(target_os = "macos") { Kind::MacosDmg }
        else if cfg!(target_os = "android") { Kind::Android }
        else if cfg!(target_os = "ios") { Kind::Ios }
        else if cfg!(target_os = "linux") {
            if std::env::var_os("APPIMAGE").is_some() { Kind::LinuxAppimage } else { Kind::LinuxDeb }
        } else { Kind::Other }
    }
    /// Installed in place by Mustela itself. Everything else opens the file or the release page.
    pub fn self_installs(self) -> bool { matches!(self, Kind::WindowsNsis | Kind::LinuxAppimage) }
}

/// Picks this platform's file from a release. Names follow scripts/build.mjs:
/// `Mustela_<version>_<platform>[_<arch>].<ext>`.
pub fn pick_asset<'a>(kind: Kind, arch: &str, assets: &'a [Asset]) -> Option<&'a Asset> {
    let lower = |a: &Asset| a.name.to_ascii_lowercase();
    let arch_ok = |n: &str| {
        let tags: &[&str] = match arch { "x86_64" => &["x86_64", "amd64", "x64"], "aarch64" => &["aarch64", "arm64"], _ => &[] };
        // A file without an architecture tag is taken to fit any.
        tags.iter().any(|t| n.contains(t)) || !["x86_64", "amd64", "x64", "aarch64", "arm64", "i686", "armv7"].iter().any(|t| n.contains(t))
    };
    let (platform, ext): (&str, &[&str]) = match kind {
        Kind::WindowsNsis => ("windows", &[".exe"]),
        Kind::MacosDmg => ("macos", &[".dmg"]),
        Kind::LinuxAppimage => ("linux", &[".appimage"]),
        Kind::LinuxDeb => ("linux", &[".deb"]),
        Kind::Android => ("android", &[".apk"]),
        Kind::Ios | Kind::Other => return None,
    };
    assets.iter().find(|a| {
        let n = lower(a);
        n.contains(platform) && ext.iter().any(|e| n.ends_with(e)) && !n.contains("debug") && (kind == Kind::MacosDmg || arch_ok(&n))
    })
}

/// 1.2.3 and 1.2.3-beta.1. A pre-release sorts before its release.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64, Option<String>)> {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let (core, pre) = match v.split_once('-') { Some((c, p)) => (c, Some(p.to_string())), None => (v, None) };
    let mut it = core.split('.').map(|p| p.parse::<u64>().ok());
    let (a, b, c) = (it.next()??, it.next()??, it.next()??);
    if it.next().is_some() { return None; }
    Some((a, b, c, pre))
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let (Some(n), Some(o)) = (parse_version(candidate), parse_version(current)) else { return false };
    if (n.0, n.1, n.2) != (o.0, o.1, o.2) { return (n.0, n.1, n.2) > (o.0, o.1, o.2); }
    match (&n.3, &o.3) { (None, Some(_)) => true, (Some(a), Some(b)) => a > b, _ => false }
}

#[derive(Deserialize, Clone, Debug)]
pub struct Asset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    /// "sha256:<hex>", filled in by GitHub for release assets.
    #[serde(default)]
    pub digest: Option<String>,
}

#[derive(Deserialize, Debug)]
struct Release { tag_name: String, html_url: String, #[serde(default)] body: Option<String>, #[serde(default)] draft: bool, #[serde(default)] prerelease: bool, #[serde(default)] assets: Vec<Asset> }

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    /// The release page, for platforms that can't install by themselves.
    pub page: String,
    pub file: Option<String>,
    pub size: u64,
    /// True when Install will put the new version in place and restart.
    pub self_installs: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config { pub version: &'static str, pub repo: Option<&'static str>, pub kind: Kind }

pub fn config() -> Config { Config { version: VERSION, repo: repo(), kind: Kind::current() } }

fn client() -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|a| {
        let ok = a.url().scheme() == "https" && a.url().host_str().is_some_and(|h| DOWNLOAD_HOSTS.contains(&h)) && a.previous().len() < 6;
        if ok { a.follow() } else { a.error("redirect to a host that isn't GitHub") }
    });
    reqwest::Client::builder()
        .user_agent(concat!("Mustela/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .redirect(policy)
        .build()
        .map_err(|e| e.to_string())
}

async fn latest(repo: &str) -> Result<Release, String> {
    let r = client()?
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .header("accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send().await.map_err(|_| "Couldn't reach GitHub.".to_string())?;
    if r.status() == reqwest::StatusCode::NOT_FOUND { return Err(format!("github.com/{repo} has no releases yet.")); }
    if !r.status().is_success() { return Err(format!("GitHub answered {}.", r.status().as_u16())); }
    r.json::<Release>().await.map_err(|_| "GitHub's answer didn't make sense.".to_string())
}

/// The newer release for this platform, or None when this copy is up to date.
pub async fn check() -> Result<Option<(UpdateInfo, Option<Asset>)>, String> {
    let Some(repo) = repo() else { return Err("This build has no update repository.".into()) };
    let rel = latest(repo).await?;
    if rel.draft || rel.prerelease || !is_newer(&rel.tag_name, VERSION) { return Ok(None); }
    let kind = Kind::current();
    let asset = pick_asset(kind, std::env::consts::ARCH, &rel.assets).cloned();
    let info = UpdateInfo {
        version: rel.tag_name.trim_start_matches(['v', 'V']).to_string(),
        notes: rel.body.unwrap_or_default().chars().take(4000).collect(),
        page: if rel.html_url.starts_with(&format!("https://github.com/{repo}/")) { rel.html_url } else { format!("https://github.com/{repo}/releases/latest") },
        file: asset.as_ref().map(|a| a.name.clone()),
        size: asset.as_ref().map_or(0, |a| a.size),
        self_installs: kind.self_installs() && asset.as_ref().is_some_and(|a| a.digest.is_some()),
    };
    Ok(Some((info, asset)))
}

/// Downloads an asset into `dest`, checking where it comes from, its size and its SHA-256.
pub async fn download(asset: &Asset, dest: &std::path::Path, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let repo = repo().ok_or("This build has no update repository.")?;
    if !asset.browser_download_url.starts_with(&format!("https://github.com/{repo}/releases/download/")) {
        return Err("That file isn't from this app's releases.".into());
    }
    let want = asset.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")).map(str::to_ascii_lowercase)
        .ok_or("GitHub didn't list a checksum for this file, so it won't be installed.")?;
    if asset.size > MAX_BYTES { return Err("The update is unexpectedly large.".into()); }
    let mut r = client()?.get(&asset.browser_download_url).timeout(Duration::from_secs(900)).send().await
        .map_err(|_| "The download didn't start.".to_string())?;
    if !r.status().is_success() { return Err(format!("The download failed ({}).", r.status().as_u16())); }
    let total = r.content_length().unwrap_or(asset.size);
    let mut hash = Sha256::new();
    let mut buf: Vec<u8> = Vec::with_capacity(total.min(MAX_BYTES) as usize);
    while let Some(chunk) = r.chunk().await.map_err(|_| "The download was interrupted.".to_string())? {
        if buf.len() as u64 + chunk.len() as u64 > MAX_BYTES { return Err("The update is unexpectedly large.".into()); }
        hash.update(&chunk);
        buf.extend_from_slice(&chunk);
        progress(buf.len() as u64, total);
    }
    let got: String = hash.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if got != want { return Err("The download didn't match GitHub's checksum, so it was thrown away.".into()); }
    std::fs::write(dest, &buf).map_err(|e| format!("Couldn't save the update: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn a(n: &str) -> Asset { Asset { name: n.into(), size: 1, browser_download_url: String::new(), digest: None } }

    #[test]
    fn versions() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("0.2.0", "0.2.0-beta.1"));
        assert!(!is_newer("0.2.0-beta.1", "0.2.0"));
        assert!(!is_newer("nightly", "0.1.0"));
    }

    #[test]
    fn picks_the_right_file() {
        let list = vec![
            a("Mustela_0.2.0_windows_x64.msi"), a("Mustela_0.2.0_windows_x64.exe"), a("Mustela_0.2.0_macos_universal.dmg"),
            a("Mustela_0.2.0_linux_amd64.deb"), a("Mustela_0.2.0_linux_amd64.AppImage"), a("Mustela_0.2.0_linux_aarch64.AppImage"),
            a("Mustela_0.2.0_android.apk"), a("Mustela_0.2.0_android.aab"),
        ];
        assert_eq!(pick_asset(Kind::WindowsNsis, "x86_64", &list).unwrap().name, "Mustela_0.2.0_windows_x64.exe");
        assert_eq!(pick_asset(Kind::MacosDmg, "aarch64", &list).unwrap().name, "Mustela_0.2.0_macos_universal.dmg");
        assert_eq!(pick_asset(Kind::LinuxAppimage, "aarch64", &list).unwrap().name, "Mustela_0.2.0_linux_aarch64.AppImage");
        assert_eq!(pick_asset(Kind::LinuxAppimage, "x86_64", &list).unwrap().name, "Mustela_0.2.0_linux_amd64.AppImage");
        assert_eq!(pick_asset(Kind::LinuxDeb, "x86_64", &list).unwrap().name, "Mustela_0.2.0_linux_amd64.deb");
        assert_eq!(pick_asset(Kind::Android, "aarch64", &list).unwrap().name, "Mustela_0.2.0_android.apk");
        assert!(pick_asset(Kind::Ios, "aarch64", &list).is_none());
    }
}
