#!/usr/bin/env node
/**
 * Mustela build script.
 *
 *   node scripts/build.mjs                       pick a platform from a menu
 *   node scripts/build.mjs --platform linux      build one platform without asking
 *
 * Platforms: windows, macos, linux, android, web
 * Options:
 *   --version 1.2.3    the version to stamp on this build (asked if not given)
 *   --repo owner/repo  the GitHub repository the app checks for updates (a github.com link works too; "none" turns it off)
 *   --debug            debug build (faster to compile, slower to run)
 *   --bundles a,b      desktop installer types (default per platform, see below)
 *   --skip-install     don't run npm install
 *   --skip-icons       don't regenerate icons from icons/app-icon.png
 *   --yes              never ask questions (CI)
 *
 * Desktop apps can only be built on their own OS (Tauri doesn't cross-compile
 * installers): Windows on Windows, macOS on a Mac, Linux on Linux. Android can
 * be built from any of them. To build everything at once, use the "Release"
 * GitHub Actions workflow, which runs each platform on its own machine.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import * as tc from "./toolchain.mjs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = join(ROOT, "src-tauri");
const OUT = join(ROOT, "release");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
let VERSION = pkg.version;
/** "owner/repo" whose GitHub releases the app checks for updates; empty means update checks are off. */
let UPDATE_REPO = "";
const IS_WIN = process.platform === "win32";
const HOST = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";

/* ------------------------------------------------------------------ output helpers */
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c(1, s), dim = (s) => c(2, s), green = (s) => c(32, s), red = (s) => c(31, s), yellow = (s) => c(33, s), cyan = (s) => c(36, s);
const step = (s) => console.log(`\n${cyan("▸")} ${bold(s)}`);
const ok = (s) => console.log(`  ${green("✓")} ${s}`);
const warn = (s) => console.log(`  ${yellow("!")} ${s}`);
function fail(msg, fix) {
  console.error(`\n${red("✗")} ${bold(msg)}`);
  if (fix) console.error(fix.split("\n").map((l) => `  ${l}`).join("\n"));
  process.exit(1);
}

/* ------------------------------------------------------------------ args */
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (flag("help") || flag("h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*?/, "").replace(/^ \* ?/gm, ""));
  process.exit(0);
}
const DEBUG = flag("debug");
const YES = flag("yes") || !!process.env.CI;

/* ------------------------------------------------------------------ running commands */
function run(cmd, cmdArgs, { cwd = ROOT, env = {}, quiet = false } = {}) {
  if (!quiet) console.log(dim(`  $ ${cmd} ${cmdArgs.join(" ")}`));
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: quiet ? "pipe" : "inherit", env: { ...process.env, ...env }, shell: IS_WIN, encoding: "utf8" });
  if (r.error) return { ok: false, out: String(r.error.message) };
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const has = (cmd, versionArg = "--version") => run(cmd, [versionArg], { quiet: true });
const npx = (a, o) => run(IS_WIN ? "npx.cmd" : "npx", a, o);
const must = (r, what, fix) => { if (!r.ok) fail(`${what} failed.`, fix); };

/* ------------------------------------------------------------------ platforms */
const PLATFORMS = {
  windows: { label: "Windows", host: "windows", note: "NSIS installer (.exe) and MSI", bundles: "nsis,msi" },
  macos: { label: "macOS (Universal)", host: "macos", note: "Apple Silicon + Intel .app and .dmg", bundles: "app,dmg" },
  linux: { label: "Linux", host: "linux", note: "AppImage and .deb", bundles: "appimage,deb" },
  android: { label: "Android", host: "any", note: "Installable .apk (and .aab for Play Store)" },
  web: { label: "Web", host: "any", note: "Static site in dist/ (demo + Stoat login in a browser)" },
  server: { label: "Sync server", host: "any", note: "Package the self-hostable profile/activity server (Node or Docker)" },
};
const canBuild = (p) => PLATFORMS[p].host === "any" || PLATFORMS[p].host === HOST;

async function choosePlatform() {
  const given = opt("platform");
  if (given) {
    if (!PLATFORMS[given]) fail(`Unknown platform "${given}".`, `Use one of: ${Object.keys(PLATFORMS).join(", ")}`);
    return given;
  }
  if (YES || !process.stdin.isTTY) fail("No platform given.", "Pass --platform windows|macos|linux|android|web");
  const keys = Object.keys(PLATFORMS);
  console.log(`\n${bold("Mustela")} ${dim(`v${VERSION}`)}  ·  building on ${bold(HOST)}\n`);
  console.log("Which platform do you want to build?\n");
  keys.forEach((k, i) => {
    const p = PLATFORMS[k];
    const avail = canBuild(k) ? "" : dim(`  (needs a ${PLATFORMS[k].host === "macos" ? "Mac" : PLATFORMS[k].host[0].toUpperCase() + PLATFORMS[k].host.slice(1)} machine)`);
    console.log(`  ${bold(String(i + 1))}) ${p.label.padEnd(18)} ${dim(p.note)}${avail}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const def = String(keys.indexOf(HOST) + 1);
  const a = (await rl.question(`\nNumber [${def}]: `)).trim() || def;
  rl.close();
  const k = keys[Number(a) - 1] ?? keys.find((x) => x === a.toLowerCase());
  if (!k) fail(`"${a}" isn't one of the options.`);
  return k;
}

/* ------------------------------------------------------------------ version and update repository */
const BUILD_PREFS = join(ROOT, ".build.json");
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Accepts owner/repo or any github.com link to it (…/releases/latest included). */
function parseRepo(input) {
  const t = String(input ?? "").trim().replace(/\.git$/, "");
  if (!t || /^(none|off|no)$/i.test(t)) return "";
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(t) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(t);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function askRelease() {
  let prefs = {};
  try { prefs = JSON.parse(readFileSync(BUILD_PREFS, "utf8")); } catch {}
  let version = opt("version") ?? process.env.MUSTELA_VERSION;
  let repo = opt("repo") ?? process.env.MUSTELA_UPDATE_REPO;
  const interactive = !YES && process.stdin.isTTY;
  if (interactive && (version === undefined || repo === undefined)) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (version === undefined) version = (await rl.question(`\nVersion for this build [${VERSION}]: `)).trim() || VERSION;
    if (repo === undefined) {
      const def = prefs.repo ?? "";
      console.log(dim("  The app checks this repository's GitHub releases for updates. Type none to turn update checks off."));
      repo = (await rl.question(`GitHub repository or link${def ? ` [${def}]` : ""}: `)).trim() || def;
    }
    rl.close();
  }
  version = version || VERSION;
  if (!SEMVER.test(version)) fail(`"${version}" isn't a version number.`, "Use three numbers like 0.2.0, optionally with a suffix like 0.2.0-beta.1 or 0.2.0-build.2 (four numbers like 0.1.3.7 aren't allowed).");
  if (!msiVersion(version)) fail(`"${version}" is too big for a Windows installer.`, "The first two numbers can be at most 255 and the third at most 65535.");
  const parsed = parseRepo(repo ?? prefs.repo ?? "");
  if (parsed === null) fail(`"${repo}" isn't a GitHub repository.`, "Use owner/repo or a link like https://github.com/owner/repo/releases/latest");
  VERSION = version;
  UPDATE_REPO = parsed;
  stampVersion(version);
  try { writeFileSync(BUILD_PREFS, JSON.stringify({ repo: parsed }, null, 2) + "\n"); } catch {}
  ok(`Version ${version}`);
  ok(UPDATE_REPO ? `Updates from github.com/${UPDATE_REPO}/releases` : "Update checks off");
}

/** Writes the version everywhere it lives, so the installer, the app and Android's versionCode agree. */
function stampVersion(v) {
  const edit = (file, fn) => { const p = join(ROOT, file); const t = readFileSync(p, "utf8"); const n = fn(t); if (n !== t) writeFileSync(p, n); };
  edit("package.json", (t) => t.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`));
  edit("src-tauri/tauri.conf.json", (t) => t.replace(/("version":\s*")[^"]+(")/, `$1${v}$2`));
  edit("src-tauri/Cargo.toml", (t) => t.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${v}$2`));
  // The MSI installer only takes numbers (major.minor.patch.build): 0.1.3-build2 becomes 0.1.3.2.
  edit("src-tauri/tauri.windows.conf.json", (t) => {
    const j = JSON.parse(t);
    j.bundle ??= {}; j.bundle.windows ??= {}; j.bundle.windows.wix ??= {};
    j.bundle.windows.wix.version = msiVersion(v);
    return JSON.stringify(j, null, 2) + "\n";
  });
}

/** The version as Windows Installer wants it: four numbers, the last from any suffix (0.2.0-beta.3 → 0.2.0.3). */
function msiVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(v);
  if (!m) return null;
  const [maj, min, pat] = [+m[1], +m[2], +m[3]];
  const build = m[4] ? Math.min(65535, +(/(\d+)(?!.*\d)/.exec(m[4])?.[1] ?? 0)) : 0;
  if (maj > 255 || min > 255 || pat > 65535) return null;
  return `${maj}.${min}.${pat}.${build}`;
}

/** Passed to every build: Rust reads them at compile time, the interface through Vite. */
const releaseEnv = () => ({ MUSTELA_UPDATE_REPO: UPDATE_REPO, VITE_MUSTELA_UPDATE_REPO: UPDATE_REPO });

/* ------------------------------------------------------------------ prerequisite checks */
function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) fail(`Node.js ${process.versions.node} is too old.`, "Install Node.js 20 or newer from https://nodejs.org (or run ./build.sh, which can fetch one).");
  ok(`Node.js ${process.versions.node}`);
}

/* ------------------------------------------------------------------ steps */
function install() {
  if (flag("skip-install")) return;
  step("Installing JavaScript dependencies");
  const npm = IS_WIN ? "npm.cmd" : "npm";
  const lock = existsSync(join(ROOT, "package-lock.json"));
  if (lock && run(npm, ["ci", "--no-audit", "--no-fund"]).ok) return;
  // A lockfile from another OS or npm version can be out of step; a normal install repairs it.
  if (lock) warn("npm ci didn't work with this lockfile; falling back to npm install.");
  must(run(npm, ["install", "--no-audit", "--no-fund"]), "npm install", "Check your internet connection. If it keeps failing, delete node_modules and package-lock.json and try again.");
}

function icons() {
  if (flag("skip-icons")) return;
  const src = ["app-icon.png", "app-icon.svg"].map((f) => join(ROOT, "icons", f)).find((p) => existsSync(p));
  if (!src) { warn("No icons/app-icon.png found; keeping the current icons."); return; }
  step(`Generating app icons from ${relative(ROOT, src)}`);
  must(npx(["tauri", "icon", src]), "Icon generation", "icons/app-icon.png must be a square PNG, ideally 1024x1024 with transparency.");
  // macOS gets its own version on a rounded tile (the only platform where that shape is expected).
  const mac = join(ROOT, "icons", "app-icon-macos.png");
  if (existsSync(mac)) {
    const tmp = join(ROOT, "release", ".icons-macos");
    rmSync(tmp, { recursive: true, force: true });
    if (npx(["tauri", "icon", mac, "-o", tmp]).ok && existsSync(join(tmp, "icon.icns"))) { copyFileSync(join(tmp, "icon.icns"), join(TAURI, "icons", "icon.icns")); ok("macOS icon from icons/app-icon-macos.png"); }
    rmSync(tmp, { recursive: true, force: true });
  }
  // Optional hand-made overrides for platforms that need special shapes.
  const overrides = [
    ["icon.ico", "icon.ico"], ["icon.icns", "icon.icns"], ["32x32.png", "32x32.png"], ["128x128.png", "128x128.png"], ["128x128@2x.png", "128x128@2x.png"],
  ];
  for (const [from, to] of overrides) {
    const p = join(ROOT, "icons", "overrides", from);
    if (existsSync(p)) { copyFileSync(p, join(TAURI, "icons", to)); ok(`Using icons/overrides/${from}`); }
  }
}

function collect(platform, files) {
  const dest = join(OUT, platform);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const out = [];
  for (const f of files) {
    const ext = f.endsWith(".app") ? ".app" : /\.(tar\.gz|[^.]+)$/.exec(f)?.[0] ?? "";
    const tag = /(arm64|aarch64|x86_64|amd64|x64|universal)/i.exec(f)?.[1];
    const name = `Mustela_${VERSION}_${platform}${tag ? `_${tag}` : ""}${f.includes("debug") ? "_debug" : ""}${ext}`;
    const target = join(dest, name);
    if (statSync(f).isDirectory()) run(IS_WIN ? "xcopy" : "cp", IS_WIN ? [f, target, "/E", "/I", "/Q"] : ["-R", f, target], { quiet: true });
    else copyFileSync(f, target);
    out.push(target);
  }
  return out;
}

function findFiles(dir, re, depth = 6) {
  if (!existsSync(dir) || depth < 0) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (re.test(e.name)) out.push(p);
    else if (e.isDirectory()) out.push(...findFiles(p, re, depth - 1));
  }
  return out;
}

function buildDesktop(platform) {
  const p = PLATFORMS[platform];
  const bundles = opt("bundles") ?? p.bundles;
  const a = ["tauri", "build", "--bundles", bundles];
  if (platform === "macos") a.push("--target", "universal-apple-darwin");
  if (DEBUG) a.push("--debug");
  step(`Building Mustela for ${p.label}${DEBUG ? " (debug)" : ""}`);
  // AppImage tooling needs FUSE unless told to unpack itself; this works everywhere.
  const env = { ...releaseEnv(), ...(platform === "linux" ? { APPIMAGE_EXTRACT_AND_RUN: "1", NO_STRIP: "true" } : {}) };
  must(npx(a, { env }), "The build", "Scroll up for the first error. Most often it's a missing system library (see https://tauri.app/start/prerequisites/).");
  const base = join(TAURI, "target", platform === "macos" ? "universal-apple-darwin" : "", DEBUG ? "debug" : "release", "bundle");
  return collect(platform, findFiles(base, /\.(AppImage|deb|rpm|exe|msi|dmg)$|\.app$/));
}

/** A personal signing key, created once, so release APKs install and can be updated. */
function androidKeystore() {
  const dir = join(ROOT, ".signing");
  const props = join(dir, "keystore.properties");
  if (process.env.ANDROID_KEYSTORE_PATH) {
    return { path: process.env.ANDROID_KEYSTORE_PATH, pass: process.env.ANDROID_KEYSTORE_PASSWORD ?? "", alias: process.env.ANDROID_KEY_ALIAS ?? "mustela", keyPass: process.env.ANDROID_KEY_PASSWORD ?? process.env.ANDROID_KEYSTORE_PASSWORD ?? "" };
  }
  if (existsSync(props)) {
    const kv = Object.fromEntries(readFileSync(props, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
    return { path: join(dir, kv.storeFile ?? "release.keystore"), pass: kv.storePassword, alias: kv.keyAlias, keyPass: kv.keyPassword ?? kv.storePassword };
  }
  step("Creating your Android signing key (one time)");
  mkdirSync(dir, { recursive: true });
  const pass = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36)).join("").slice(0, 24);
  const path = join(dir, "release.keystore");
  must(run("keytool", ["-genkeypair", "-v", "-keystore", path, "-storepass", pass, "-keypass", pass, "-alias", "mustela", "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000", "-dname", "CN=Mustela, O=Mustela"], { quiet: true }),
    "Creating the signing key", "keytool comes with Java. Make sure Java 17+ is installed and on your PATH.");
  writeFileSync(props, `storeFile=release.keystore\nstorePassword=${pass}\nkeyAlias=mustela\nkeyPassword=${pass}\n`);
  warn(`Saved to ${relative(ROOT, dir)}/. Back this folder up and never commit it: updates must be signed with the same key.`);
  return { path, pass, alias: "mustela", keyPass: pass };
}

// LiveKit's Android SDK depends on com.github.davidliu:audioswitch, which is only published on JitPack.
// Declare the repository inside the generated project so the build works on any machine and CI, and never
// clashes with a leftover ~/.gradle/init.d/jitpack.init.gradle (delete that old file if you have one).
function ensureJitpack(gen) {
  // An older Mustela fix put JitPack in ~/.gradle/init.d/. Gradle refuses projects that declare their own
  // repositories when an init script adds one ("prefer settings repositories"), so retire that file.
  const old = join(os.homedir(), ".gradle", "init.d", "jitpack.init.gradle");
  if (existsSync(old) && readFileSync(old, "utf8").includes("jitpack.io")) {
    renameSync(old, `${old}.disabled`);
    warn(`Turned off ${old} (renamed to .disabled). Mustela now declares JitPack itself.`);
  }
  const line = 'maven { url = uri("https://jitpack.io") }';
  for (const f of ["build.gradle.kts", "settings.gradle.kts"]) {
    const p = join(gen, f);
    if (!existsSync(p)) continue;
    let t = readFileSync(p, "utf8");
    if (t.includes("jitpack.io")) continue;
    const next = t.replace(/(repositories\s*\{[^}]*?mavenCentral\(\))/g, `$1\n        ${line}`);
    if (next !== t) writeFileSync(p, next);
  }
}

async function buildAndroid() {
  step("Android toolchain");
  await tc.ensureJava();
  const sdk = await tc.ensureAndroidSdk();
  tc.ensureRustTargets(["aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"]);
  const gen = join(TAURI, "gen", "android");
  if (!existsSync(gen)) {
    step("Creating the Android project (first build only)");
    must(npx(["tauri", "android", "init", "--ci"]), "Android project setup");
  }
  ensureJitpack(gen); // LiveKit's audioswitch lives on JitPack; declared in the project, no ~/.gradle init script needed
  icons(); // after init, so the launcher icons land in the Android project too
  step(`Building Mustela for Android${DEBUG ? " (debug)" : ""}`);
  const a = ["tauri", "android", "build", "--apk", "--aab"];
  if (DEBUG) a.push("--debug");
  must(npx(a, { env: releaseEnv() }), "The Android build", "Scroll up for the first error. Check that the SDK Platform and NDK are installed (see README > Android).");
  const outputs = join(gen, "app", "build", "outputs");
  const apks = findFiles(join(outputs, "apk"), /\.apk$/);
  const aabs = findFiles(join(outputs, "bundle"), /\.aab$/);
  if (DEBUG) return collect("android", [...apks, ...aabs]);

  step("Signing the APK");
  const key = androidKeystore();
  const tools = tc.androidBuildTools(sdk);
  const signed = [];
  for (const apk of apks.filter((f) => /unsigned/.test(f))) {
    const aligned = apk.replace(/-unsigned\.apk$/, "-aligned.apk");
    const out = apk.replace(/-unsigned\.apk$/, "-signed.apk");
    must(run(tools.zipalign, ["-f", "-p", "4", apk, aligned], { quiet: true }), "zipalign");
    must(run(tools.apksigner, ["sign", "--ks", key.path, "--ks-pass", `pass:${key.pass}`, "--ks-key-alias", key.alias, "--key-pass", `pass:${key.keyPass}`, "--out", out, aligned], { quiet: true }), "apksigner");
    signed.push(out);
    ok(relative(ROOT, out));
  }
  for (const aab of aabs) {
    must(run("jarsigner", ["-keystore", key.path, "-storepass", key.pass, "-keypass", key.keyPass, aab, key.alias], { quiet: true }), "Signing the .aab");
  }
  return collect("android", [...(signed.length ? signed : apks), ...aabs]);
}

function buildServer() {
  step("Packaging the sync server");
  const dest = join(OUT, "mustela-sync-server");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of ["server.mjs", "package.json", "Dockerfile"]) cpSync(join(ROOT, "server", f), join(dest, f));
  console.log(dim("\n  Run it:     node server.mjs            (Node 20+, listens on port 8787)"));
  console.log(dim("  Or Docker:  docker build -t mustela-sync . && docker run -p 8787:8787 -v mustela-data:/data mustela-sync"));
  console.log(dim("  Then put it behind HTTPS and add its address in Mustela > Settings > Sync & servers."));
  return [dest];
}

function buildWeb() {
  step("Building the web version");
  must(run(IS_WIN ? "npm.cmd" : "npm", ["run", "build"], { env: releaseEnv() }), "The web build");
  const dest = join(OUT, "web");
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  run(IS_WIN ? "xcopy" : "cp", IS_WIN ? [join(ROOT, "dist"), dest, "/E", "/I", "/Q"] : ["-R", join(ROOT, "dist"), dest], { quiet: true });
  return [dest];
}

/* ------------------------------------------------------------------ main */
const platform = await choosePlatform();
if (!canBuild(platform)) {
  fail(`${PLATFORMS[platform].label} apps can't be built on ${HOST}.`,
    `Tauri builds desktop apps on their own OS. Options:\n` +
    `  • Run this script on a ${{ windows: "Windows PC", macos: "Mac", linux: "Linux machine" }[PLATFORMS[platform].host]}, or\n` +
    `  • Push to GitHub and run the "Release" workflow (Actions tab), choosing "${platform}".`);
}

if (platform !== "server") { step("Version and updates"); await askRelease(); }

step("Checking your setup");
tc.setAssumeYes(YES);
checkNode();
if (platform !== "web" && platform !== "server") await tc.ensureRust();
if (platform === "linux") await tc.ensureLinuxLibs();
if (platform === "windows") await tc.ensureMsvc();
if (platform === "macos") { await tc.ensureXcodeTools(); tc.ensureRustTargets(["aarch64-apple-darwin", "x86_64-apple-darwin"]); }

if (platform !== "server") install();
if (platform !== "android" && platform !== "web" && platform !== "server") icons();

const t0 = Date.now();
const files = platform === "server" ? buildServer() : platform === "web" ? buildWeb() : platform === "android" ? await buildAndroid() : buildDesktop(platform);
const mins = ((Date.now() - t0) / 60000).toFixed(1);

console.log(`\n${green("✓")} ${bold(`Mustela ${VERSION} for ${PLATFORMS[platform].label} is ready`)} ${dim(`(${mins} min)`)}\n`);
if (!files.length) warn("The build finished but no output files were found. Look in src-tauri/target/*/bundle.");
for (const f of files) console.log(`  ${relative(ROOT, f)}`);
if (platform === "android" && !DEBUG) console.log(dim("\n  Install on a phone: copy the .apk over and open it, or run  adb install <file>.apk"));
if (platform === "macos") console.log(dim("\n  Not notarized: on first launch, right-click the app > Open. See README > macOS."));
if (platform === "windows") console.log(dim("\n  Not code-signed: Windows SmartScreen may warn on first run (More info > Run anyway)."));
console.log();
