#!/usr/bin/env node
/**
 * Signed updates: every release file gets a small `<file>.sig` next to it, and installed copies of Mustela only install
 * an update whose signature matches the public key they were built with (on top of GitHub's checksum). So even someone
 * who got into the GitHub account couldn't push a fake update.
 *
 *   node scripts/sign.mjs --new-key        make the key (once, ever): the private half goes to
 *                                          ~/.mustela/update-signing/update-key.pem, the public half to src-tauri/update-key.pub
 *   node scripts/sign.mjs <files...>       sign release files someone else built (e.g. the Linux AppImage)
 *   node scripts/sign.mjs --check <files>  check existing .sig files
 *
 * The private key can also come from the MUSTELA_UPDATE_KEY environment variable (the .pem's contents), for GitHub's
 * release workflow. Back the .pem up somewhere safe: if it's lost, installed copies can't update themselves any more
 * (people would have to download the next version by hand).
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_KEY_FILE = join(ROOT, "src-tauri", "update-key.pub");
export const PRIVATE_KEY_FILE = join(process.env.MUSTELA_UPDATE_KEY_DIR || join(os.homedir(), ".mustela", "update-signing"), "update-key.pem");

/** The public key this project's builds trust (base64 of the raw 32-byte Ed25519 key), or null before --new-key. */
export function publicKey() {
  if (!existsSync(PUBLIC_KEY_FILE)) return null;
  const k = readFileSync(PUBLIC_KEY_FILE, "utf8").trim();
  return /^[A-Za-z0-9+/]{43}=$/.test(k) ? k : null;
}

/** The private key from MUSTELA_UPDATE_KEY or the .pem file, or null. */
export function privateKey() {
  const env = process.env.MUSTELA_UPDATE_KEY?.trim();
  const pem = env ? (env.includes("BEGIN") ? env : Buffer.from(env, "base64").toString("utf8")) : existsSync(PRIVATE_KEY_FILE) ? readFileSync(PRIVATE_KEY_FILE, "utf8") : null;
  if (!pem) return null;
  try { return createPrivateKey(pem); } catch { throw new Error("The update signing key couldn't be read (MUSTELA_UPDATE_KEY or " + PRIVATE_KEY_FILE + ")."); }
}

const rawPublic = (key) => (key.type === "public" ? key : createPublicKey(key)).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

/** Whether this computer holds the private half of the project's update key. */
export function ownsKey() {
  const pub = publicKey();
  if (!pub) return false;
  try { const key = privateKey(); return !!key && rawPublic(key) === pub; } catch { return false; }
}

/** Signs each file (writes `<file>.sig`). Refuses if the private key doesn't belong to the project's public key. */
export function signFiles(files) {
  const pub = publicKey();
  const key = privateKey();
  if (!pub) throw new Error("This project has no update key yet. Make one with: node scripts/sign.mjs --new-key");
  if (!key) throw new Error(`No private update key here. Copy update-key.pem into ${dirname(PRIVATE_KEY_FILE)} (or set MUSTELA_UPDATE_KEY).`);
  if (rawPublic(key) !== pub) throw new Error("This private key doesn't match src-tauri/update-key.pub, so apps wouldn't accept what it signs.");
  const out = [];
  for (const f of files) {
    if (f.endsWith(".sig")) continue;
    const sig = sign(null, readFileSync(f), key).toString("base64");
    writeFileSync(`${f}.sig`, sig + "\n");
    out.push(`${f}.sig`);
  }
  return out;
}

function checkFiles(files) {
  const pub = publicKey();
  if (!pub) throw new Error("No src-tauri/update-key.pub to check against.");
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(pub, "base64")]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  let bad = 0;
  for (const f of files.filter((x) => !x.endsWith(".sig"))) {
    const ok = existsSync(`${f}.sig`) && verify(null, readFileSync(f), key, Buffer.from(readFileSync(`${f}.sig`, "utf8").trim(), "base64"));
    console.log(`${ok ? "✓" : "✗"} ${f}`);
    if (!ok) bad++;
  }
  if (bad) process.exitCode = 1;
}

function newKey() {
  if (publicKey() || existsSync(PRIVATE_KEY_FILE)) {
    throw new Error("An update key already exists. Making a new one would stop installed copies from updating themselves, so this won't replace it.");
  }
  const { publicKey: pub, privateKey: priv } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(PRIVATE_KEY_FILE), { recursive: true });
  writeFileSync(PRIVATE_KEY_FILE, priv.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  try { chmodSync(PRIVATE_KEY_FILE, 0o600); } catch { /* Windows */ }
  writeFileSync(PUBLIC_KEY_FILE, rawPublic(pub) + "\n");
  console.log(`Made the update key.
  Private (keep secret, back it up): ${PRIVATE_KEY_FILE}
  Public (commit this):              ${PUBLIC_KEY_FILE}

Copy the private .pem to every computer you build releases on (same folder), or set MUSTELA_UPDATE_KEY.
Builds from now on only install updates signed with it.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === "--new-key") newKey();
    else if (args[0] === "--check") checkFiles(args.slice(1));
    else if (args.length) for (const s of signFiles(args)) console.log(`signed: ${s}`);
    else console.log("Usage: node scripts/sign.mjs --new-key | <files...> | --check <files...>");
  } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
}
