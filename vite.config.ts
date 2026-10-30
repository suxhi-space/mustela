import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig({
  plugins: [solid()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  // The Rust build folder is huge and changes constantly: watching it can crash the dev server.
  server: { port: 1420, strictPort: true, host: process.env.TAURI_DEV_HOST || false, watch: { ignored: ["**/src-tauri/**", "**/release/**"] } },
  // Audio worklets must stay real files: the app only runs its own scripts, never data: or blob: ones.
  build: { target: "es2022", sourcemap: false, assetsInlineLimit: (file) => (file.endsWith(".js") ? false : undefined) },
  test: { environment: "node", exclude: ["server/**", "node_modules/**", "src-tauri/**"] },
});
