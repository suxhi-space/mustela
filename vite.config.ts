import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Which screens this build ships: "desktop" (Windows, macOS, Linux), "mobile" (Android and iOS: phones and tablets),
 * or "auto" (the web build and `npm run dev`: picks when the page loads). Only the chosen set ends up in the build.
 * Tauri tells us the platform it's building for; MUSTELA_UI or `--mode mobile|desktop` override it (npm run dev:mobile).
 */
const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
const uiFor = (mode: string) => process.env.MUSTELA_UI ?? (mode === "mobile" || mode === "desktop" ? mode : null) ?? (tauriPlatform === "android" || tauriPlatform === "ios" ? "mobile" : tauriPlatform ? "desktop" : "auto");

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig(({ mode }) => ({
  plugins: [solid()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __UI__: JSON.stringify(uiFor(mode)) },
  clearScreen: false,
  // The Rust build folder is huge and changes constantly: watching it can crash the dev server.
  server: { port: 1420, strictPort: true, host: process.env.TAURI_DEV_HOST || false, watch: { ignored: ["**/src-tauri/**", "**/release/**"] } },
  // Audio worklets must stay real files: the app only runs its own scripts, never data: or blob: ones.
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: (file) => (file.endsWith(".js") ? false : undefined) },
  test: { environment: "node", exclude: ["server/**", "node_modules/**", "src-tauri/**"] },
}));
