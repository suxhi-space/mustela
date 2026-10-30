#!/usr/bin/env node
/**
 * Refreshes vendor/stoat.js.tgz from Stoat's SDK repository (the same source Stoat's web app builds from).
 *
 *   node scripts/update-sdk.mjs            newest commit on main
 *   node scripts/update-sdk.mjs <commit>   a specific commit
 *
 * Needs git and Node. Then run npm install, npm run typecheck and npm test.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Packed as a tarball, not a folder: npm links a folder dependency, and Windows can't make that
// link on some drives (exFAT, network shares) or without Developer Mode. A tarball is just unpacked.
const TARBALL = join(ROOT, "vendor", "stoat.js.tgz");
const REPO = "https://github.com/stoatchat/javascript-client-sdk";
const IS_WIN = process.platform === "win32";

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: IS_WIN });
  if (r.status !== 0) { console.error(`✗ ${cmd} failed`); process.exit(1); }
}

const tmp = mkdtempSync(join(tmpdir(), "stoat-sdk-"));
try {
  const commit = process.argv[2];
  run("git", ["clone", "--quiet", ...(commit ? [] : ["--depth", "1"]), REPO, "sdk"], tmp);
  const src = join(tmp, "sdk");
  if (commit) run("git", ["checkout", "--quiet", commit], src);
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: src, encoding: "utf8" }).stdout.trim();
  run(IS_WIN ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--legacy-peer-deps"], src);
  run(IS_WIN ? "npx.cmd" : "npx", ["tsc"], src);

  const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  const DEST = join(tmp, "pack", "stoat.js");
  cpSync(join(src, "lib"), join(DEST, "lib"), { recursive: true });
  cpSync(join(src, "LICENSE"), join(DEST, "LICENSE"));
  const out = { name: pkg.name, version: `${pkg.version}-mustela.${head.slice(0, 7)}`, type: pkg.type, exports: pkg.exports, types: pkg.types, license: pkg.license, repository: pkg.repository, dependencies: pkg.dependencies };
  writeFileSync(join(DEST, "package.json"), JSON.stringify(out, null, 2) + "\n");
  writeFileSync(join(DEST, "README.md"), `# stoat.js (vendored)\n\nStoat's JavaScript SDK, built from ${REPO} at commit \`${head}\`.\nMIT licence (see LICENSE).\n\nnpm's releases lag behind what Stoat's own web app uses (it builds the SDK from source too).\nRefresh it with \`node scripts/update-sdk.mjs\`.\n`);
  run(IS_WIN ? "npm.cmd" : "npm", ["pack", "--pack-destination", join(tmp, "pack")], DEST);
  rmSync(TARBALL, { force: true });
  cpSync(join(tmp, "pack", `stoat.js-${out.version}.tgz`), TARBALL);
  console.log(`\n✓ vendor/stoat.js.tgz is now ${out.version}. Run npm install, npm run typecheck and npm test.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
