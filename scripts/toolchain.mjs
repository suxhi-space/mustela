/**
 * Finds the build tools Mustela needs and installs the missing ones.
 *
 * What gets installed where:
 *  - Rust: the official rustup installer, into ~/.cargo (your user only).
 *  - Java 17 and the Android SDK + NDK: downloaded into ~/.mustela/toolchain
 *    (your user only, nothing system-wide). Existing installs are reused.
 *  - Linux libraries: your package manager, with sudo. Asks first.
 *  - Xcode command line tools (macOS): Apple's installer dialog.
 *  - Visual Studio Build Tools (Windows): winget. Asks first.
 *
 * Nothing is installed without saying so first, and anything that needs an
 * admin password asks before running.
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import os from "node:os";

export const IS_WIN = process.platform === "win32";
export const HOST = IS_WIN ? "windows" : process.platform === "darwin" ? "macos" : "linux";
const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const SEP = IS_WIN ? ";" : ":";
export const TOOLCHAIN = process.env.MUSTELA_TOOLCHAIN ?? join(os.homedir(), ".mustela", "toolchain");

/* ------------------------------------------------------------------ console */
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s) => c(1, s), dim = (s) => c(2, s), green = (s) => c(32, s), red = (s) => c(31, s), yellow = (s) => c(33, s), cyan = (s) => c(36, s);
export const step = (s) => console.log(`\n${cyan("▸")} ${bold(s)}`);
export const ok = (s) => console.log(`  ${green("✓")} ${s}`);
export const warn = (s) => console.log(`  ${yellow("!")} ${s}`);
export const info = (s) => console.log(`  ${dim(s)}`);
export function fail(msg, fix) {
  console.error(`\n${red("✗")} ${bold(msg)}`);
  if (fix) console.error(fix.split("\n").map((l) => `  ${l}`).join("\n"));
  process.exit(1);
}

let assumeYes = false;
export const setAssumeYes = (v) => { assumeYes = v; };

export async function ask(question, def = true) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  ${yellow("?")} ${question} ${dim(def ? "[Y/n]" : "[y/N]")} `)).trim().toLowerCase();
  rl.close();
  return a ? a.startsWith("y") : def;
}

/* ------------------------------------------------------------------ processes */
export function run(cmd, args, { cwd, env = {}, quiet = false, input } = {}) {
  if (!quiet) console.log(dim(`  $ ${cmd} ${args.join(" ")}`));
  const r = spawnSync(cmd, args, {
    cwd, input, encoding: "utf8", env: { ...process.env, ...env },
    stdio: quiet ? "pipe" : input !== undefined ? ["pipe", "inherit", "inherit"] : "inherit",
    shell: IS_WIN && !/\.exe$/i.test(cmd),
  });
  if (r.error) return { ok: false, out: String(r.error.message) };
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
export const has = (cmd, arg = "--version") => run(cmd, [arg], { quiet: true });
export const addPath = (dir) => { if (!process.env.PATH.split(SEP).includes(dir)) process.env.PATH = `${dir}${SEP}${process.env.PATH}`; };

/* ------------------------------------------------------------------ downloads */
export async function download(url, dest) {
  mkdirSync(join(dest, ".."), { recursive: true });
  const name = url.split("/").pop().split("?")[0];
  let res;
  try { res = await fetch(url, { redirect: "follow" }); }
  catch (e) { fail(`Couldn't download ${name}.`, `${e.cause?.message ?? e.message}\nCheck your internet connection, then run the build again.`); }
  if (!res.ok || !res.body) fail(`Couldn't download ${name} (HTTP ${res.status}).`, url);
  const total = Number(res.headers.get("content-length")) || 0;
  let got = 0, last = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    got += chunk.length;
    if (process.stdout.isTTY && Date.now() - last > 200) {
      last = Date.now();
      const mb = (n) => (n / 1048576).toFixed(0);
      process.stdout.write(`\r  ${dim(`↓ ${name}  ${mb(got)}${total ? ` / ${mb(total)}` : ""} MB`)}   `);
    }
  });
  const tmp = `${dest}.part`;
  await pipeline(body, createWriteStream(tmp));
  renameSync(tmp, dest);
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[2K");
  ok(`Downloaded ${name}`);
  return dest;
}

export function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  let r;
  if (/\.zip$/i.test(archive)) {
    if (IS_WIN || HOST === "macos") r = run("tar", ["-xf", archive, "-C", into], { quiet: true }); // bsdtar reads zip
    else if (has("unzip", "-v").ok) r = run("unzip", ["-q", "-o", archive, "-d", into], { quiet: true });
    else r = run("python3", ["-c", "import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", archive, into], { quiet: true });
  } else {
    r = run("tar", ["-xzf", archive, "-C", into], { quiet: true });
  }
  if (!r.ok) fail(`Couldn't unpack ${archive}.`, r.out.slice(0, 600));
  // zip extraction through Python loses the executable bit
  if (!IS_WIN) run("chmod", ["-R", "u+x", into], { quiet: true });
}

const newest = (dir, re = /./) => existsSync(dir)
  ? readdirSync(dir).filter((v) => re.test(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop()
  : undefined;

/* ------------------------------------------------------------------ Rust */
export async function ensureRust() {
  addPath(join(os.homedir(), ".cargo", "bin")); // installed but the terminal hasn't picked it up yet
  let r = has("cargo");
  if (r.ok) { ok(r.out.trim()); return; }
  warn("Rust isn't installed.");
  if (!(await ask("Install Rust now with the official installer (rustup, for your user only)?"))) {
    fail("Rust is needed to build the app.", "Install it from https://rustup.rs, then run this again.");
  }
  const dir = join(TOOLCHAIN, "downloads");
  if (IS_WIN) {
    const triple = ARCH === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
    const exe = await download(`https://static.rust-lang.org/rustup/dist/${triple}/rustup-init.exe`, join(dir, "rustup-init.exe"));
    if (!run(exe, ["-y", "--profile", "minimal", "--default-toolchain", "stable"]).ok) fail("Rust installation failed.");
  } else {
    const sh = await download("https://sh.rustup.rs", join(dir, "rustup-init.sh"));
    if (!run("sh", [sh, "-y", "--profile", "minimal", "--default-toolchain", "stable"]).ok) fail("Rust installation failed.");
  }
  r = has("cargo");
  if (!r.ok) fail("Rust was installed but can't be found.", "Open a new terminal and run the build again.");
  ok(r.out.trim());
}

export function ensureRustTargets(targets) {
  const list = run("rustup", ["target", "list", "--installed"], { quiet: true });
  if (!list.ok) { warn(`rustup not found; make sure these Rust targets are installed: ${targets.join(", ")}`); return; }
  const missing = targets.filter((t) => !list.out.split(/\s+/).includes(t));
  if (missing.length && !run("rustup", ["target", "add", ...missing]).ok) fail("Adding Rust targets failed.");
  ok(`Rust targets: ${targets.join(", ")}`);
}

/* ------------------------------------------------------------------ macOS */
export async function ensureXcodeTools() {
  if (run("xcode-select", ["-p"], { quiet: true }).ok) { ok("Xcode command line tools"); return; }
  warn("Xcode command line tools aren't installed. A macOS dialog will open: click Install.");
  run("xcode-select", ["--install"], { quiet: true });
  const t0 = Date.now();
  process.stdout.write(`  ${dim("Waiting for the installer to finish…")}`);
  while (!run("xcode-select", ["-p"], { quiet: true }).ok) {
    if (Date.now() - t0 > 45 * 60_000) fail("Timed out waiting for the Xcode command line tools.", "Finish the install, then run the build again.");
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},5000)"]);
  }
  process.stdout.write("\n");
  ok("Xcode command line tools");
}

/* ------------------------------------------------------------------ Linux */
const LINUX = {
  apt: { detect: "apt-get", install: ["apt-get", "install", "-y"], update: ["apt-get", "update"],
    pkgs: ["libwebkit2gtk-4.1-dev", "build-essential", "curl", "wget", "file", "libxdo-dev", "libssl-dev", "libayatana-appindicator3-dev", "librsvg2-dev", "patchelf", "pkg-config", "unzip"] },
  dnf: { detect: "dnf", install: ["dnf", "install", "-y"],
    pkgs: ["webkit2gtk4.1-devel", "openssl-devel", "curl", "wget", "file", "libappindicator-gtk3-devel", "librsvg2-devel", "libxdo-devel", "patchelf", "pkgconf-pkg-config", "unzip", "gcc", "gcc-c++", "make"] },
  pacman: { detect: "pacman", install: ["pacman", "-S", "--needed", "--noconfirm"],
    pkgs: ["webkit2gtk-4.1", "base-devel", "curl", "wget", "file", "openssl", "appmenu-gtk-module", "libappindicator-gtk3", "librsvg", "xdotool", "patchelf", "unzip"] },
  zypper: { detect: "zypper", install: ["zypper", "--non-interactive", "install"],
    pkgs: ["webkit2gtk3-devel", "libopenssl-devel", "curl", "wget", "file", "libappindicator3-1", "librsvg-devel", "patchelf", "unzip", "gcc", "gcc-c++", "make"] },
};

export function linuxPackageManager() {
  for (const [name, pm] of Object.entries(LINUX)) if (has(pm.detect, "--version").ok) return { name, ...pm };
  return null;
}

export async function ensureLinuxLibs() {
  const libs = ["webkit2gtk-4.1", "gtk+-3.0", "librsvg-2.0"];
  const missing = () => (has("pkg-config").ok ? libs.filter((l) => !run("pkg-config", ["--exists", l], { quiet: true }).ok) : ["pkg-config", ...libs]);
  if (!missing().length) { ok("WebKitGTK and GTK development libraries"); return; }
  const pm = linuxPackageManager();
  if (!pm) fail(`Missing Linux build libraries: ${missing().join(", ")}`, "Install WebKitGTK 4.1 development packages for your distro: https://tauri.app/start/prerequisites/");
  warn(`Missing Linux build libraries: ${missing().join(", ")}`);
  const sudo = process.getuid?.() === 0 ? [] : ["sudo"];
  const cmd = [...sudo, ...pm.install, ...pm.pkgs];
  info(cmd.join(" "));
  if (!(await ask(`Install them with ${pm.name}? (asks for your password)`))) fail("These libraries are needed to build.", `Run:\n  ${cmd.join(" ")}`);
  if (pm.update) run(sudo[0] ?? pm.update[0], sudo.length ? pm.update : pm.update.slice(1));
  if (!run(cmd[0], cmd.slice(1)).ok) fail("Installing the libraries failed.", "Scroll up for the package manager's error.");
  if (missing().length) fail(`Still missing: ${missing().join(", ")}`, "Your distro may name these packages differently. See https://tauri.app/start/prerequisites/");
  ok("WebKitGTK and GTK development libraries");
}

/* ------------------------------------------------------------------ Windows */
export async function ensureMsvc() {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const found = existsSync(vswhere) && run(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { quiet: true }).out.trim();
  if (found) { ok("Visual Studio C++ build tools"); }
  else {
    warn("The Visual Studio C++ build tools aren't installed (Rust needs them on Windows).");
    const args = ["install", "--id", "Microsoft.VisualStudio.2022.BuildTools", "-e", "--accept-package-agreements", "--accept-source-agreements",
      "--override", "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"];
    if (!has("winget", "--version").ok) fail("Install \"Visual Studio Build Tools\" with \"Desktop development with C++\".", "https://visualstudio.microsoft.com/visual-cpp-build-tools/\nThen run the build again.");
    if (!(await ask("Install them now with winget? (about 2 GB, may ask for admin rights)"))) fail("The C++ build tools are needed.", "https://visualstudio.microsoft.com/visual-cpp-build-tools/");
    if (!run("winget", args).ok) fail("Installing the build tools failed.", "Install them by hand: https://visualstudio.microsoft.com/visual-cpp-build-tools/");
    ok("Visual Studio C++ build tools");
  }
  const r = run("rustc", ["-vV"], { quiet: true });
  if (r.ok && !/host: .*msvc/.test(r.out)) { run("rustup", ["default", "stable-msvc"]); }
}

/* ------------------------------------------------------------------ Java */
function javaMajor(bin) {
  const r = run(bin, ["-version"], { quiet: true });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(r.out);
  return r.ok && m ? (m[1] === "1" ? Number(m[2]) : Number(m[1])) : 0;
}

export async function ensureJava() {
  const homes = [
    process.env.JAVA_HOME,
    join("/Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "Android", "Android Studio", "jbr"),
    "/opt/android-studio/jbr", join(os.homedir(), "android-studio", "jbr"),
    ...(() => { const d = join(TOOLCHAIN, "jdk"); const v = newest(d); return v ? [HOST === "macos" ? join(d, v, "Contents", "Home") : join(d, v)] : []; })(),
  ].filter(Boolean);
  for (const h of homes) {
    const bin = join(h, "bin", IS_WIN ? "java.exe" : "java");
    if (existsSync(bin) && javaMajor(bin) >= 17) { useJava(h); return; }
  }
  if (javaMajor("java") >= 17) { ok(`Java ${javaMajor("java")}`); return; }

  warn("Java 17+ isn't installed (Android builds need it).");
  if (!(await ask("Download Java 17 (Eclipse Temurin, ~190 MB) into ~/.mustela/toolchain?"))) fail("Java 17+ is needed for Android.", "Install it from https://adoptium.net and run the build again.");
  const osName = HOST === "macos" ? "mac" : HOST;
  const arch = ARCH === "arm64" ? "aarch64" : "x64";
  const ext = IS_WIN ? "zip" : "tar.gz";
  const file = await download(`https://api.adoptium.net/v3/binary/latest/17/ga/${osName}/${arch}/jdk/hotspot/normal/eclipse`, join(TOOLCHAIN, "downloads", `jdk17.${ext}`));
  const dir = join(TOOLCHAIN, "jdk");
  rmSync(dir, { recursive: true, force: true });
  extract(file, dir);
  const v = newest(dir);
  if (!v) fail("Java download was empty.");
  useJava(HOST === "macos" ? join(dir, v, "Contents", "Home") : join(dir, v));
}

function useJava(home) {
  process.env.JAVA_HOME = home;
  addPath(join(home, "bin"));
  ok(`Java ${javaMajor(join(home, "bin", IS_WIN ? "java.exe" : "java"))}  ${dim(home)}`);
}

/* ------------------------------------------------------------------ Android SDK */
// Google keeps old command-line-tools builds available; the first that downloads wins.
const CMDLINE_BUILDS = ["13114758", "11076708"];
export const ANDROID_PACKAGES = ["platform-tools", "platforms;android-34", "build-tools;35.0.0", "ndk;27.0.12077973"];
/** The mustela-native plugin compiles against API 37 when it exists; 34 is the fallback floor. */
const OPTIONAL_PACKAGES = ["platforms;android-37", "platforms;android-36"];

export async function ensureAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    join(os.homedir(), "Library", "Android", "sdk"), join(os.homedir(), "Android", "Sdk"),
    join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"), join(TOOLCHAIN, "android-sdk"),
  ].filter((p) => p && existsSync(p));
  let sdk = candidates[0];
  if (!sdk) {
    warn("The Android SDK isn't installed.");
    if (!(await ask("Download the Android SDK command-line tools, platform, build tools and NDK (~1.5 GB) into ~/.mustela/toolchain?"))) {
      fail("The Android SDK is needed.", "Install Android Studio (https://developer.android.com/studio) or let this script download the SDK.");
    }
    sdk = join(TOOLCHAIN, "android-sdk");
  }
  process.env.ANDROID_HOME = sdk;
  process.env.ANDROID_SDK_ROOT = sdk;

  const sdkmanager = await ensureSdkManager(sdk);
  const installed = (p) => existsSync(join(sdk, ...p.split(";")));
  const missing = ANDROID_PACKAGES.filter((p) => !installed(p) && !(p.startsWith("ndk;") && newest(join(sdk, "ndk"), /^\d/)) && !(p.startsWith("build-tools;") && newest(join(sdk, "build-tools"), /^\d/)));
  const optional = OPTIONAL_PACKAGES.filter((p) => !installed(p));
  if (missing.length || optional.length) {
    step("Installing Android SDK packages");
    // Licenses must be accepted once; feed "y" to every prompt.
    run(sdkmanager, [`--sdk_root=${sdk}`, "--licenses"], { input: "y\n".repeat(40), quiet: true });
    if (missing.length && !run(sdkmanager, [`--sdk_root=${sdk}`, ...missing], { input: "y\n".repeat(10) }).ok) fail("Installing Android SDK packages failed.", "Scroll up for sdkmanager's error.");
    for (const p of optional) if (!run(sdkmanager, [`--sdk_root=${sdk}`, p], { input: "y\n".repeat(5), quiet: true }).ok) info(`${p} isn't available yet; the build will use an older platform.`);
  }
  const ndkV = newest(join(sdk, "ndk"), /^\d/);
  if (!ndkV) fail("The Android NDK couldn't be found after installing.");
  process.env.NDK_HOME = process.env.NDK_HOME && existsSync(process.env.NDK_HOME) ? process.env.NDK_HOME : join(sdk, "ndk", ndkV);
  addPath(join(sdk, "platform-tools"));
  ok(`Android SDK  ${dim(sdk)}`);
  ok(`Android NDK  ${dim(process.env.NDK_HOME)}`);
  return sdk;
}

async function ensureSdkManager(sdk) {
  const exe = (base) => join(base, "bin", IS_WIN ? "sdkmanager.bat" : "sdkmanager");
  const tools = join(sdk, "cmdline-tools");
  const found = [join(tools, "latest"), ...(existsSync(tools) ? readdirSync(tools).map((v) => join(tools, v)) : []), join(sdk, "tools")].find((d) => existsSync(exe(d)));
  if (found) return exe(found);
  const plat = HOST === "macos" ? "mac" : HOST === "windows" ? "win" : "linux";
  const dl = join(TOOLCHAIN, "downloads");
  let zip;
  for (const b of CMDLINE_BUILDS) {
    try {
      const res = await fetch(`https://dl.google.com/android/repository/commandlinetools-${plat}-${b}_latest.zip`, { method: "HEAD" });
      if (res.ok) { zip = await download(`https://dl.google.com/android/repository/commandlinetools-${plat}-${b}_latest.zip`, join(dl, `cmdline-tools-${b}.zip`)); break; }
    } catch { /* try the next build */ }
  }
  if (!zip) fail("Couldn't download the Android command-line tools.", "Check your internet connection, or install Android Studio and run the build again.");
  const tmp = join(dl, "cmdline-tools-unpacked");
  rmSync(tmp, { recursive: true, force: true });
  extract(zip, tmp);
  mkdirSync(tools, { recursive: true });
  rmSync(join(tools, "latest"), { recursive: true, force: true });
  renameSync(join(tmp, "cmdline-tools"), join(tools, "latest"));
  ok("Android command-line tools");
  return exe(join(tools, "latest"));
}

export function androidBuildTools(sdk) {
  const dir = join(sdk, "build-tools");
  const v = newest(dir, /^\d/);
  if (!v) fail("Android Build-Tools not found.");
  const exe = (n) => join(dir, v, IS_WIN ? (n === "apksigner" ? `${n}.bat` : `${n}.exe`) : n);
  return { zipalign: exe("zipalign"), apksigner: exe("apksigner") };
}

export const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
