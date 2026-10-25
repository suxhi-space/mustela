import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Tauri expects a fixed dev port and no screen clearing.
export default defineConfig({
  plugins: [solid()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: process.env.TAURI_DEV_HOST || false },
  build: { target: "es2022", sourcemap: false },
  test: { environment: "node", exclude: ["server/**", "node_modules/**", "src-tauri/**"] },
});
