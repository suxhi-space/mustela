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
/// The public half of the project's update key (base64 of a raw Ed25519 key), from src-tauri/update-key.pub at build
/// time (scripts/build.mjs). When it's set, an update is only installed if its `.sig` file matches (scripts/sign.mjs).
pub const UPDATE_KEY: Option<&str> = option_env!("MUSTELA_UPDATE_PUBKEY");
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_BYTES: u64 = 400 * 1024 * 1024;
const DOWNLOAD_HOSTS: [&str; 3] = ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];

pub fn repo() -> Option<&'static str> {
    REPO.map(str::trim).filter(|r| !r.is_empty() && r.split('/').count() == 2)
}

/// How this copy was installed, which decides which file to fetch and what Install does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Kind { WindowsNsis, MacosDmg, LinuxAppimage, LinuxDeb, LinuxRpm, Flatpak, Android, Ios, Other }

impl Kind {
    pub fn current() -> Kind {
        if cfg!(target_os = "windows") { Kind::WindowsNsis }
        else if cfg!(target_os = "macos") { Kind::MacosDmg }
        else if cfg!(target_os = "android") { Kind::Android }
        else if cfg!(target_os = "ios") { Kind::Ios }
        else if cfg!(target_os = "linux") { linux_kind() } else { Kind::Other }
    }
    /// Installed in place by Mustela itself. Everything else opens the file or the release page (and a Flatpak is
    /// updated by its app store, so it's offered nothing).
    pub fn self_installs(self) -> bool { matches!(self, Kind::WindowsNsis | Kind::LinuxAppimage | Kind::MacosDmg | Kind::Android) }
}

/// The update key this build trusts, if it was built with one.
pub fn signing_key() -> Option<[u8; 32]> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD.decode(UPDATE_KEY?.trim()).ok()?;
    raw.try_into().ok()
}

/// Whether `sig_b64` (a `.sig` file's text) is a valid Ed25519 signature of `data` by `key`.
pub fn verify_signature(data: &[u8], sig_b64: &str, key: &[u8; 32]) -> bool {
    use base64::Engine;
    let Ok(sig) = base64::engine::general_purpose::STANDARD.decode(sig_b64.trim()) else { return false };
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key).verify(data, &sig).is_ok()
}

/// How this Linux copy was installed: the AppImage and Flatpak say so themselves; otherwise whichever package manager
/// owns the running program (an .rpm on Fedora/openSUSE, a .deb on Ubuntu/Debian/Mint). Worked out once.
fn linux_kind() -> Kind {
    static KIND: std::sync::OnceLock<Kind> = std::sync::OnceLock::new();
    *KIND.get_or_init(|| {
        if std::env::var_os("FLATPAK_ID").is_some() { return Kind::Flatpak; }
        if std::env::var_os("APPIMAGE").is_some() { return Kind::LinuxAppimage; }
        let exe = std::env::current_exe().ok();
        let owns = |tool: &str, args: &[&str]| exe.as_ref().is_some_and(|e| {
            std::process::Command::new(tool).args(args).arg(e).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
                .status().is_ok_and(|s| s.success())
        });
        if owns("rpm", &["-qf"]) { Kind::LinuxRpm }
        else { Kind::LinuxDeb } // dpkg, or nothing found: the .deb, as before
    })
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
        Kind::LinuxRpm => ("linux", &[".rpm"]),
        Kind::Android => ("android", &[".apk"]),
        Kind::Flatpak | Kind::Ios | Kind::Other => return None,
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
    match (&n.3, &o.3) { (None, Some(_)) => true, (Some(a), Some(b)) => natural_cmp(a, b).is_gt(), _ => false }
}

/// Compares suffixes with their numbers as numbers: build10 comes after build9, beta.2 after beta.1.
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    fn parts(s: &str) -> Vec<Result<u64, String>> {
        let mut out = vec![];
        let mut cur = String::new();
        for c in s.chars() {
            if !cur.is_empty() && c.is_ascii_digit() != cur.chars().next().unwrap().is_ascii_digit() { out.push(std::mem::take(&mut cur)); }
            cur.push(c);
        }
        if !cur.is_empty() { out.push(cur); }
        out.into_iter().map(|p| p.parse::<u64>().map_err(|_| p.to_ascii_lowercase())).collect()
    }
    let (pa, pb) = (parts(a), parts(b));
    for (x, y) in pa.iter().zip(pb.iter()) {
        let o = match (x, y) {
            (Ok(x), Ok(y)) => x.cmp(y),
            (Err(x), Err(y)) => x.cmp(y),
            (Ok(_), Err(_)) => std::cmp::Ordering::Less,
            (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
        };
        if o.is_ne() { return o; }
    }
    pa.len().cmp(&pb.len())
}

/// The version a release really holds, read from its files' names (`Mustela_<version>_<platform>…`),
/// not from its tag: a tag is just a label someone typed and can say anything.
pub fn asset_version(name: &str) -> Option<String> {
    let rest = name.strip_prefix("Mustela_").or_else(|| name.strip_prefix("mustela_"))?;
    let v = rest.split('_').next()?;
    parse_version(v).map(|_| v.to_string())
}

#[derive(Deserialize, Clone, Debug)]
pub struct Asset {
    pub name: String,
    pub size: u64,
    pub browser_download_url: String,
    /// "sha256:<hex>", filled in by GitHub for release assets.
    #[serde(default)]
    pub digest: Option<String>,
    /// The `<name>.sig` file beside it in the same release (signed updates).
    #[serde(skip)]
    pub sig_url: Option<String>,
}

#[derive(Deserialize, Debug)]
struct Release { #[serde(default)] tag_name: String, html_url: String, #[serde(default)] body: Option<String>, #[serde(default)] draft: bool, #[serde(default)] prerelease: bool, #[serde(default)] assets: Vec<Asset> }

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

/// The repository's recent releases, newest first.
async fn releases(repo: &str) -> Result<Vec<Release>, String> {
    let r = client()?
        .get(format!("https://api.github.com/repos/{repo}/releases?per_page=30"))
        .header("accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(20))
        .send().await.map_err(|_| "Couldn't reach GitHub.".to_string())?;
    if r.status() == reqwest::StatusCode::NOT_FOUND { return Err(format!("github.com/{repo} can't be found.")); }
    if !r.status().is_success() { return Err(format!("GitHub answered {}.", r.status().as_u16())); }
    r.json::<Vec<Release>>().await.map_err(|_| "GitHub's answer didn't make sense.".to_string())
}

/// Out of a list of releases, the newest version for this platform: (release, its version, its file).
/// Only releases with a file for this system count, so a release made for another platform first is never
/// offered here (it would only send you to a page with nothing to install). Each release's version comes from
/// that file's name, or its tag when the file isn't named that way. Drafts and pre-releases are skipped.
fn best<'a>(list: &'a [Release], kind: Kind, arch: &str) -> Option<(&'a Release, String, Option<&'a Asset>)> {
    let mut found: Option<(&Release, String, Option<&Asset>)> = None;
    for rel in list.iter().filter(|r| !r.draft && !r.prerelease) {
        let Some(asset) = pick_asset(kind, arch, &rel.assets) else { continue };
        let version = asset_version(&asset.name)
            .or_else(|| parse_version(&rel.tag_name).map(|_| rel.tag_name.trim().trim_start_matches(['v', 'V']).to_string()));
        let Some(version) = version else { continue };
        if found.as_ref().is_none_or(|(_, v, _)| is_newer(&version, v)) { found = Some((rel, version, Some(asset))); }
    }
    found
}

/// The newer release for this platform, or None when this copy is up to date.
pub async fn check() -> Result<Option<(UpdateInfo, Option<Asset>)>, String> {
    let Some(repo) = repo() else { return Err("This build has no update repository.".into()) };
    let list = releases(repo).await?;
    let kind = Kind::current();
    let Some((rel, version, asset)) = best(&list, kind, std::env::consts::ARCH) else { return Ok(None) };
    if !is_newer(&version, VERSION) { return Ok(None); }
    let asset = asset.cloned().map(|mut a| {
        let sig = format!("{}.sig", a.name);
        a.sig_url = rel.assets.iter().find(|x| x.name == sig).map(|x| x.browser_download_url.clone());
        a
    });
    let info = UpdateInfo {
        version,
        notes: rel.body.clone().unwrap_or_default().chars().take(4000).collect(),
        page: if rel.html_url.starts_with(&format!("https://github.com/{repo}/")) { rel.html_url.clone() } else { format!("https://github.com/{repo}/releases/latest") },
        file: asset.as_ref().map(|a| a.name.clone()),
        size: asset.as_ref().map_or(0, |a| a.size),
        // With an update key, only a signed file is installed (an unsigned one is left to the release page).
        self_installs: kind.self_installs() && asset.as_ref().is_some_and(|a| a.digest.is_some() && (signing_key().is_none() || a.sig_url.is_some())),
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
    if let Some(key) = signing_key() {
        let url = asset.sig_url.as_deref().ok_or("This update isn't signed, so it won't be installed. Get it from the release page.")?;
        if !url.starts_with(&format!("https://github.com/{repo}/releases/download/")) { return Err("That signature isn't from this app's releases.".into()); }
        let r = client()?.get(url).timeout(Duration::from_secs(30)).send().await.map_err(|_| "Couldn't get the update's signature.".to_string())?;
        if !r.status().is_success() { return Err("Couldn't get the update's signature.".into()); }
        let sig = r.bytes().await.map_err(|_| "Couldn't get the update's signature.".to_string())?;
        if sig.len() > 1024 || !verify_signature(&buf, &String::from_utf8_lossy(&sig), &key) {
            return Err("The update's signature didn't match, so it was thrown away.".into());
        }
    }
    std::fs::write(dest, &buf).map_err(|e| format!("Couldn't save the update: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn a(n: &str) -> Asset { Asset { name: n.into(), size: 1, browser_download_url: String::new(), digest: None, sig_url: None } }

    #[test]
    fn versions() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("0.2.0", "0.2.0-beta.1"));
        assert!(!is_newer("0.2.0-beta.1", "0.2.0"));
        assert!(!is_newer("nightly", "0.1.0"));
        assert!(is_newer("0.1.3-build10", "0.1.3-build9"));
        assert!(is_newer("0.1.3-build5", "0.1.3-build4"));
        assert!(!is_newer("0.1.3-build4", "0.1.3-build4"));
    }

    fn rel(tag: &str, files: &[&str]) -> Release {
        Release { tag_name: tag.into(), html_url: String::new(), body: None, draft: false, prerelease: false, assets: files.iter().map(|n| a(n)).collect() }
    }

    #[test]
    fn version_comes_from_the_files_not_the_tag() {
        // The tag was mistyped as 1.2.3-build4; the files say what it really is.
        let list = vec![rel("1.2.3-build4", &["Mustela_0.1.3-build4_windows_x64.exe", "Mustela_0.1.3-build4_android_universal.apk"])];
        let (_, v, f) = best(&list, Kind::WindowsNsis, "x86_64").unwrap();
        assert_eq!(v, "0.1.3-build4");
        assert_eq!(f.unwrap().name, "Mustela_0.1.3-build4_windows_x64.exe");
        assert!(!is_newer(&v, "0.1.3-build4"));
        // Several releases: the newest version wins whatever order or tags they have.
        let list = vec![
            rel("latest", &["Mustela_0.1.3-build5_linux_amd64.AppImage"]),
            rel("x", &["Mustela_0.1.3-build10_linux_amd64.AppImage"]),
            rel("v9.9.9", &["Mustela_0.1.2_linux_amd64.AppImage"]),
        ];
        assert_eq!(best(&list, Kind::LinuxAppimage, "x86_64").unwrap().1, "0.1.3-build10");
        // A newer release for another system only is never offered.
        let list = vec![
            rel("b6", &["Mustela_0.1.5-build6_windows_x64.exe"]),
            rel("b5", &["Mustela_0.1.5-build5_windows_x64.exe", "Mustela_0.1.5-build5_android_universal.apk"]),
        ];
        assert_eq!(best(&list, Kind::Android, "aarch64").unwrap().1, "0.1.5-build5");
        assert_eq!(best(&list, Kind::WindowsNsis, "x86_64").unwrap().1, "0.1.5-build6");
        assert!(best(&list, Kind::MacosDmg, "aarch64").is_none());
        assert_eq!(asset_version("Mustela_0.1.3-build4_android_universal.apk").as_deref(), Some("0.1.3-build4"));
        assert_eq!(asset_version("notes.txt"), None);
    }

    #[test]
    fn signatures_from_the_signing_script_verify() {
        use base64::Engine;
        // Made by scripts/sign.mjs with a throwaway key: the Node side and this side must agree.
        let key: [u8; 32] = base64::engine::general_purpose::STANDARD.decode("ZVSFWYi4xb4JRzhxISRpNZ1QHpGTapS7lAqFgsY9u3c=").unwrap().try_into().unwrap();
        let sig = "e6OVw0mdFCGJZI8TYakCc5F3ovHs3BXJvyIgYhBMJCoVymyfVizMIqKcG4IGd6Qlx4N+tI5vXdfmaCGXCyGlCA==\n";
        assert!(verify_signature(b"hello\n", sig, &key));
        assert!(!verify_signature(b"hello\ntampered\n", sig, &key));
        assert!(!verify_signature(b"hello\n", "not base64!", &key));
    }

    #[test]
    fn picks_the_right_file() {
        let list = vec![
            a("Mustela_0.2.0_windows_x64.msi"), a("Mustela_0.2.0_windows_x64.exe"), a("Mustela_0.2.0_macos_universal.dmg"),
            a("Mustela_0.2.0_linux_amd64.deb"), a("Mustela_0.2.0_linux_x86_64.rpm"), a("Mustela_0.2.0_linux_amd64.AppImage"), a("Mustela_0.2.0_linux_aarch64.AppImage"),
            a("Mustela_0.2.0_android.apk"), a("Mustela_0.2.0_android.aab"),
        ];
        assert_eq!(pick_asset(Kind::WindowsNsis, "x86_64", &list).unwrap().name, "Mustela_0.2.0_windows_x64.exe");
        assert_eq!(pick_asset(Kind::MacosDmg, "aarch64", &list).unwrap().name, "Mustela_0.2.0_macos_universal.dmg");
        assert_eq!(pick_asset(Kind::LinuxAppimage, "aarch64", &list).unwrap().name, "Mustela_0.2.0_linux_aarch64.AppImage");
        assert_eq!(pick_asset(Kind::LinuxAppimage, "x86_64", &list).unwrap().name, "Mustela_0.2.0_linux_amd64.AppImage");
        assert_eq!(pick_asset(Kind::LinuxDeb, "x86_64", &list).unwrap().name, "Mustela_0.2.0_linux_amd64.deb");
        assert_eq!(pick_asset(Kind::LinuxRpm, "x86_64", &list).unwrap().name, "Mustela_0.2.0_linux_x86_64.rpm");
        assert!(pick_asset(Kind::Flatpak, "x86_64", &list).is_none());
        assert_eq!(pick_asset(Kind::Android, "aarch64", &list).unwrap().name, "Mustela_0.2.0_android.apk");
        assert!(pick_asset(Kind::Ios, "aarch64", &list).is_none());
    }
}
