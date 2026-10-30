#!/usr/bin/env node
/**
 * Mustela sync server.
 *
 * Holds the parts of a Mustela profile that Stoat has no place for
 * (decorations, effects, frames, nameplates, profile colors, and since 1.2 a
 * banner per server) and live activity ("Playing …"), so other Mustela users
 * can see them.
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
 * one request ("who owns this session?") and never stored or logged. Only the
 * owner can change their profile. A profile is public unless its owner chose an
 * audience ("friends", or friends and chosen servers): then it's only returned to
 * linked viewers on the owner's allow list, and everyone else gets "no profile".
 * Per-server banners follow the same rule. They're plain pictures (checked to be
 * PNG, JPEG, WebP or GIF, at most 512 KB), stored as files next to data.json.
 */
import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.2.0";
const MAX_ALLOW = 5000;
const PROTOCOL = "v1";
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const NAME = (process.env.NAME ?? "Mustela sync").slice(0, 60);
const APIS = (process.env.STOAT_APIS ?? "https://stoat.chat/api").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const MAX_BODY = 192 * 1024; // room for an audience list of up to 5000 ids
const ACTIVITY_TTL = 3 * 60_000;
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // Stoat/Revolt ids are ULIDs
const MAX_IMAGE = 512 * 1024;
const MAX_IMAGES_PER_USER = 50;

/* ---------------------------------------------------------------- storage */
mkdirSync(DATA_DIR, { recursive: true });
const IMAGES = join(DATA_DIR, "images");
mkdirSync(IMAGES, { recursive: true });
const FILE = join(DATA_DIR, "data.json");
/** keys: sha256(key) -> userId; users: userId -> { profile, updatedAt, audience?, images? } (images: serverId -> { type, at }) */
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

/** The picture types a banner may be, by their first bytes (the declared type isn't trusted). */
function imageType(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.length > 6 && b.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  return null;
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    // Too big by its own say-so: answer without reading it.
    if (Number(req.headers["content-length"] ?? 0) > max) return reject(Object.assign(new Error("That picture is too large (512 KB at most)."), { status: 413 }));
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > max) { reject(Object.assign(new Error("That picture is too large (512 KB at most)."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Whether `viewer` (a linked user id, or undefined) may see `uid`'s profile. */
function canSee(u, uid, viewer) {
  if (!u?.audience) return true;
  return !!viewer && (viewer === uid || u.audience.allow.includes(viewer));
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
    // Optional audience (added in 1.1; older clients don't send one, which means public).
    let audience;
    if (isObj(body.audience) && (body.audience.mode === "friends" || body.audience.mode === "friends+servers")) {
      const allow = Array.isArray(body.audience.allow) ? body.audience.allow.filter((x) => typeof x === "string" && ID_RE.test(x)).slice(0, MAX_ALLOW) : [];
      audience = { mode: body.audience.mode, allow };
    }
    db.users[who.uid] = { profile: body.profile, updatedAt: Date.now(), ...(audience ? { audience } : {}), ...(db.users[who.uid]?.images ? { images: db.users[who.uid].images } : {}) };
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
    // Per-server banners (1.2): PUT/DELETE /image/<serverId> as the owner, GET /image/<userId>/<serverId>.
    const own = /^\/image\/([^/]+)$/.exec(rest);
    if (own && (req.method === "PUT" || req.method === "DELETE")) {
      const who = userFor(req);
      if (!who) return send(res, 401, { error: "Link this server again." });
      const sid = decodeURIComponent(own[1]);
      if (!ID_RE.test(sid)) return send(res, 400, { error: "That isn't a server id." });
      const u = (db.users[who.uid] ??= { profile: null, updatedAt: Date.now() });
      const file = join(IMAGES, `${who.uid}-${sid}`);
      if (req.method === "DELETE") {
        if (u.images) delete u.images[sid];
        rmSync(file, { force: true });
        save();
        return send(res, 204);
      }
      const bytes = await readRaw(req, MAX_IMAGE);
      const type = imageType(bytes);
      if (!type) return send(res, 415, { error: "Send a PNG, JPEG, WebP or GIF picture." });
      u.images ??= {};
      if (!u.images[sid] && Object.keys(u.images).length >= MAX_IMAGES_PER_USER) return send(res, 409, { error: "That's as many server banners as one person can have." });
      const tmp = file + ".tmp";
      writeFileSync(tmp, bytes);
      renameSync(tmp, file);
      u.images[sid] = { type, at: Date.now() };
      save();
      return send(res, 200, { at: u.images[sid].at });
    }
    const img = /^\/image\/([^/]+)\/([^/]+)$/.exec(rest);
    if (req.method === "GET" && img) {
      const uid = decodeURIComponent(img[1]), sid = decodeURIComponent(img[2]);
      if (!ID_RE.test(uid) || !ID_RE.test(sid)) return send(res, 400, { error: "That isn't an id." });
      const u = db.users[uid];
      const meta = u?.images?.[sid];
      if (!meta || !canSee(u, uid, userFor(req)?.uid)) return send(res, 404, { error: "No picture here." });
      let bytes;
      try { bytes = readFileSync(join(IMAGES, `${uid}-${sid}`)); } catch { return send(res, 404, { error: "No picture here." }); }
      res.writeHead(200, {
        "content-type": meta.type, "content-length": bytes.length,
        "access-control-allow-origin": "*", "cache-control": u.audience ? "private, max-age=300" : "public, max-age=300",
        "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'",
      });
      return res.end(bytes);
    }
    const prof = /^\/profile\/([^/]+)$/.exec(rest);
    if (req.method === "GET" && prof) {
      const uid = decodeURIComponent(prof[1]);
      if (!ID_RE.test(uid)) return send(res, 400, { error: "That isn't a user id." });
      let u = db.users[uid];
      let act = activity.get(uid);
      // A private profile is only for linked viewers on the owner's list (and the owner);
      // to anyone else it looks exactly like there's no profile at all.
      if (u && !canSee(u, uid, userFor(req)?.uid)) { u = undefined; act = undefined; }
      if (!u && !act) return send(res, 404, { error: "No profile here." });
      // images: which servers have a banner here, and when it last changed (for cache-busting links).
      const images = u?.images ? Object.fromEntries(Object.entries(u.images).map(([k, v]) => [k, v.at])) : undefined;
      return send(res, 200, { profile: u?.profile ?? null, updatedAt: u?.updatedAt ?? 0, activity: act && act.expires > Date.now() ? act.a : null, ...(images ? { images } : {}) });
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
