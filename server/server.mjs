#!/usr/bin/env node
/**
 * Mustela sync server.
 *
 * Holds the parts of a Mustela profile that Stoat has no place for
 * (decorations, effects, frames, nameplates, profile colors) and live activity
 * ("Playing …"), so other Mustela users can see them.
 *
 * No dependencies: Node 20+ only. Data is one JSON file, written atomically.
 *
 *   PORT=8787 DATA_DIR=./data node server.mjs
 *
 * Environment:
 *   PORT          port to listen on (default 8787)
 *   HOST          interface (default 0.0.0.0)
 *   DATA_DIR      where data.json lives (default ./data)
 *   NAME          shown to clients (default "Mustela sync")
 *   STOAT_APIS    comma-separated Stoat API bases accounts may come from
 *                 (default https://stoat.chat/api). Only these are ever contacted.
 *   TRUST_PROXY   "1" to take the client IP from X-Forwarded-For (behind a reverse proxy)
 *
 * Privacy: linking sends this server a Stoat session token once. It is used for
 * one request ("who owns this session?") and never stored or logged. Reading
 * profiles is public; only the owner can change theirs.
 */
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.0.0";
const PROTOCOL = "v1";
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const NAME = (process.env.NAME ?? "Mustela sync").slice(0, 60);
const APIS = (process.env.STOAT_APIS ?? "https://stoat.chat/api").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const MAX_BODY = 32 * 1024;
const ACTIVITY_TTL = 3 * 60_000;
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // Stoat/Revolt ids are ULIDs

/* ---------------------------------------------------------------- storage */
mkdirSync(DATA_DIR, { recursive: true });
const FILE = join(DATA_DIR, "data.json");
/** keys: sha256(key) -> userId; users: userId -> { profile, updatedAt } */
let db = { keys: {}, users: {} };
try { db = { keys: {}, users: {}, ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch { /* first run */ }
/** Activity lives in memory only: it's stale within minutes anyway. */
const activity = new Map();

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, FILE);
  }, 500);
}

const hash = (k) => createHash("sha256").update(k).digest("hex");
function userFor(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "");
  if (!m) return null;
  const h = hash(m[1]);
  for (const [stored, uid] of Object.entries(db.keys)) {
    if (stored.length === h.length && timingSafeEqual(Buffer.from(stored), Buffer.from(h))) return { uid, h };
  }
  return null;
}

/* ---------------------------------------------------------------- limits */
const buckets = new Map();
function allowed(ip, cost = 1) {
  const now = Date.now();
  const b = buckets.get(ip) ?? { t: now, n: 60 };
  b.n = Math.min(60, b.n + ((now - b.t) / 1000) * 2); // 60 burst, 2/s refill
  b.t = now;
  if (b.n < cost) { buckets.set(ip, b); return false; }
  b.n -= cost; buckets.set(ip, b);
  return true;
}
setInterval(() => { const cut = Date.now() - 120_000; for (const [k, v] of buckets) if (v.t < cut) buckets.delete(k); for (const [k, v] of activity) if (v.expires < Date.now()) activity.delete(k); }, 60_000).unref();

/* ---------------------------------------------------------------- validation */
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x, n) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : undefined);
function cleanActivity(a) {
  if (!isObj(a)) return null;
  const name = str(a.name, 128);
  if (!name) return null;
  const kind = ["playing", "listening", "watching", "streaming", "competing"].includes(a.kind) ? a.kind : "playing";
  const image = str(a.image, 512);
  return {
    kind, name, details: str(a.details, 128), state: str(a.state, 128),
    startedAt: Number.isFinite(a.startedAt) ? a.startedAt : undefined,
    image: image && image.startsWith("https://") ? image : undefined,
    appId: str(a.appId, 32),
  };
}

/* ---------------------------------------------------------------- http */
function send(res, status, body) {
  const json = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, PUT, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error("That's too large."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("Send JSON."), { status: 400 })); } });
    req.on("error", reject);
  });
}

async function whoOwns(api, token) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${api}/users/@me`, { headers: { "x-session-token": token }, signal: ctl.signal, redirect: "error" });
    if (r.status === 401 || r.status === 403) return null;
    if (!r.ok) throw new Error(`Stoat answered ${r.status}`);
    const u = await r.json();
    return typeof u?._id === "string" && ID_RE.test(u._id) ? u._id : null;
  } finally { clearTimeout(t); }
}

const routes = {
  "GET /health": async () => [200, { name: NAME, version: VERSION, protocol: PROTOCOL, instances: APIS }],

  "POST /link": async (req) => {
    const body = await readBody(req);
    const api = typeof body.api === "string" ? body.api.replace(/\/+$/, "") : "";
    if (!APIS.includes(api)) return [400, { error: `This server only accepts accounts from ${APIS.join(", ")}.` }];
    if (typeof body.token !== "string" || body.token.length < 20 || body.token.length > 200) return [400, { error: "Missing session." }];
    let uid;
    try { uid = await whoOwns(api, body.token); } catch { return [502, { error: "Couldn't reach Stoat to confirm your account. Try again." }]; }
    if (!uid) return [401, { error: "Stoat didn't recognise that session. Sign in again." }];
    const key = randomBytes(32).toString("base64url");
    // One key per user: linking again replaces the old one.
    for (const [h, u] of Object.entries(db.keys)) if (u === uid) delete db.keys[h];
    db.keys[hash(key)] = uid;
    save();
    return [200, { key, userId: uid }];
  },

  "DELETE /link": async (req) => {
    const who = userFor(req);
    if (who) { delete db.keys[who.h]; save(); }
    return [204];
  },

  "PUT /profile": async (req) => {
    const who = userFor(req);
    if (!who) return [401, { error: "Link this server again." }];
    const body = await readBody(req);
    if (body.profile !== null && !isObj(body.profile)) return [400, { error: "Send a profile." }];
    const json = JSON.stringify(body.profile);
    if (json.length > 16 * 1024) return [413, { error: "That profile is too large." }];
    db.users[who.uid] = { profile: body.profile, updatedAt: Date.now() };
    save();
    return [204];
  },

  "PUT /activity": async (req) => {
    const who = userFor(req);
    if (!who) return [401, { error: "Link this server again." }];
    const body = await readBody(req);
    const a = cleanActivity(body.activity);
    if (a) activity.set(who.uid, { a, expires: Date.now() + ACTIVITY_TTL }); else activity.delete(who.uid);
    return [204];
  },
};

const server = createServer(async (req, res) => {
  const ip = (TRUST_PROXY && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
  if (req.method === "OPTIONS") return send(res, 204);
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.startsWith(`/${PROTOCOL}/`)) return send(res, 404, { error: "Not found." });
  const rest = path.slice(PROTOCOL.length + 1);
  if (!allowed(ip, req.method === "GET" ? 1 : 3)) return send(res, 429, { error: "Slow down a little." });
  try {
    const prof = /^\/profile\/([^/]+)$/.exec(rest);
    if (req.method === "GET" && prof) {
      const uid = decodeURIComponent(prof[1]);
      if (!ID_RE.test(uid)) return send(res, 400, { error: "That isn't a user id." });
      const u = db.users[uid];
      const act = activity.get(uid);
      if (!u && !act) return send(res, 404, { error: "No profile here." });
      return send(res, 200, { profile: u?.profile ?? null, updatedAt: u?.updatedAt ?? 0, activity: act && act.expires > Date.now() ? act.a : null });
    }
    const h = routes[`${req.method} ${rest}`];
    if (!h) return send(res, 404, { error: "Not found." });
    const [status, body] = await h(req);
    send(res, status, body);
  } catch (e) {
    send(res, e?.status ?? 500, { error: e?.status ? e.message : "Something went wrong." });
    if (!e?.status) console.error(new Date().toISOString(), req.method, path, e?.message); // never logs bodies or tokens
  }
});

server.listen(PORT, HOST, () => console.log(`${NAME} ${VERSION} on http://${HOST}:${PORT}/${PROTOCOL}/health · accounts from ${APIS.join(", ")}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { clearTimeout(saveTimer); try { writeFileSync(FILE, JSON.stringify(db)); } catch { /* best effort */ } process.exit(0); });
