#!/usr/bin/env bash
# Applies the Android build fixes to a Mustela checkout.
# Safe to run more than once. Run from the repo root:  ./scripts/apply-android-fixes.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
caps="$root/src-tauri/capabilities"
init_src="$root/src-tauri/gradle/jitpack.init.gradle"
init_dst="$HOME/.gradle/init.d/jitpack.init.gradle"

echo "▸ Removing autostart:default from shared capability files"
# autostart is desktop-only; it now lives in capabilities/desktop.json (platforms-limited).
python3 - "$caps" <<'PY'
import json, sys, pathlib
caps = pathlib.Path(sys.argv[1])
for f in sorted(caps.glob("*.json")):
    if f.name == "desktop.json":
        continue
    data = json.loads(f.read_text())
    perms = data.get("permissions")
    if not isinstance(perms, list):
        continue
    kept = [p for p in perms if not (isinstance(p, str) and p.startswith("autostart:"))]
    if len(kept) != len(perms):
        data["permissions"] = kept
        f.write_text(json.dumps(data, indent=2) + "\n")
        print(f"  patched {f.name}")
    else:
        print(f"  {f.name}: nothing to remove")
PY

echo "▸ Installing JitPack Gradle init script"
mkdir -p "$(dirname "$init_dst")"
cp "$init_src" "$init_dst"
echo "  installed $init_dst"

if [ -x "$root/src-tauri/gen/android/gradlew" ]; then
  echo "▸ Stopping any running Gradle daemon"
  "$root/src-tauri/gen/android/gradlew" --project-dir "$root/src-tauri/gen/android" --stop >/dev/null 2>&1 || true
fi

echo "✓ Done. Now run ./build.sh and choose 4 (Android)."
