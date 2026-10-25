# Android build fixes: how to merge

Drop the contents of this folder onto the repo root (keep the folder structure), then run the script.

```
mustela-fixes/
├── scripts/apply-android-fixes.sh                 new
├── src-tauri/capabilities/desktop.json            new
└── src-tauri/gradle/jitpack.init.gradle           new
```

Only new files, so nothing existing is overwritten. For example, from the repo root:

```bash
cp -R /path/to/mustela-fixes/. .
chmod +x scripts/apply-android-fixes.sh
./scripts/apply-android-fixes.sh
```

## What each fix does

### 1. `Permission autostart:default not found` (Rust build step)
`tauri-plugin-autostart` only exists on desktop, but the shared capability file listed its permission, so the Android build failed.
- `capabilities/desktop.json` holds `autostart:default`, limited to macOS, Windows and Linux.
- `apply-android-fixes.sh` removes any `autostart:*` entry from the other capability files (usually `default.json`).

Also make sure these match, if they don't already:
- `lib.rs` registers the plugin only under `#[cfg(desktop)]`.
- `Cargo.toml` lists `tauri-plugin-autostart` under `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`.

### 2. `Could not find com.github.davidliu:audioswitch` (Gradle step)
LiveKit's Android SDK depends on `audioswitch`, which is only published on JitPack. `jitpack.init.gradle` adds JitPack as a repository for every Gradle build. The script copies it to `~/.gradle/init.d/`.

Note: this init script lives in your home folder, so it applies to this machine only. On CI or another machine, run the script again (or add the JitPack repo to `src-tauri/gen/android/build.gradle.kts` and the plugin's `android/build.gradle.kts`).

## Not blockers
The AGP 9 deprecation warnings, the large-chunk warning, and the `sounds.ts` import warning don't stop the build.
