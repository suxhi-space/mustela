#!/usr/bin/env node
/**
 * Mustela Mustela server.
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
 *   NAME          shown to clients (default "Mustela server")
 *   STOAT_APIS    comma-separated Stoat API bases accounts may come from
 *                 (default https://stoat.chat/api). Only these are ever contacted.
 *   TRUST_PROXY   "1" to take the client IP from X-Forwarded-For (behind a reverse proxy)
 *
 * Privacy: linking sends this server a Stoat session token once. It is used for
 * one request ("who owns this session?") and never stored or logged. Only the
 * owner can change their profile. A profile is public unless its owner chose an
 * audience ("friends", or friends and chosen servers): then it's only returned to
 * linked viewers on the owner's allow list, and everyone else gets "no profile".
 * Reading anything needs a link too (1.5): a browser or anyone without one gets nothing. What someone is playing
 * only goes to the people their app lists (friends, people they share a server with). Per-server banners follow
 * the profile's rule. They're plain pictures (checked to be
 * PNG, JPEG, WebP or GIF, at most 512 KB), stored as files next to data.json.
 * With DATA_KEY set, data.json and the banners are stored encrypted (AES-256-GCM). Link keys are kept only as
 * SHA-256 hashes. Nothing about requests is logged. Unlinking from the app (DELETE /me) deletes everything kept
 * about that person: profile, banners, activity and every device's link.
 */
import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.5.0";
const MAX_ALLOW = 5000;
const NEED_LINK = "Link this server to see profiles.";
const MAX_BATCH = 100;
const MAX_ACTIVITIES = 5;
const PROTOCOL = "v1";
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR ?? "./data";
const NAME = (process.env.NAME ?? "Mustela server").slice(0, 60);
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

/*
 * Encryption on disk: with DATA_KEY set (32 random bytes, base64; setup.sh makes one and keeps it in .env, outside
 * the data folder and its backups), data.json and every banner are stored sealed with AES-256-GCM. The files and the
 * daily backups are unreadable without the key, and tampering is detected. Without DATA_KEY, plain files as before.
 * Old plain files are read as they are and sealed the next time they're written (data.json and banners at start).
 */
const MAGIC = Buffer.from("MSE1");
const DATA_KEY = (() => {
  const k = process.env.DATA_KEY ? Buffer.from(process.env.DATA_KEY, "base64") : null;
  if (k && k.length !== 32) { console.error("DATA_KEY must be 32 bytes, base64 (setup.sh makes one)."); process.exit(1); }
  return k;
})();
const sealed = (b) => b.length > 32 && b.subarray(0, 4).equals(MAGIC);
function seal(plain) {
  if (!DATA_KEY) return plain;
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", DATA_KEY, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}
function unseal(b) {
  if (!sealed(b)) return b;
  if (!DATA_KEY) throw new Error("This data is encrypted: start the server with its DATA_KEY.");
  const d = createDecipheriv("aes-256-gcm", DATA_KEY, b.subarray(4, 16));
  d.setAuthTag(b.subarray(16, 32));
  return Buffer.concat([d.update(b.subarray(32)), d.final()]);
}
const writeSealed = (file, bytes) => { const tmp = file + ".tmp"; writeFileSync(tmp, seal(bytes), { mode: 0o600 }); renameSync(tmp, file); };

/** keys: sha256(key) -> userId; users: userId -> { profile, updatedAt, audience?, images? } (images: serverId -> { type, at }) */
let db = { keys: {}, users: {} };
let raw = null;
try { raw = readFileSync(FILE); } catch { /* first run */ }
if (raw) {
  // A missing or wrong key stops here, before anything is overwritten.
  try { db = { keys: {}, users: {}, ...JSON.parse(unseal(raw).toString("utf8")) }; }
  catch (e) { console.error(sealed(raw) ? "Can't read data.json: DATA_KEY is missing or isn't the key it was saved with." : `Can't read data.json: ${e.message}`); process.exit(1); }
}
// Seal what was stored plain before DATA_KEY was set.
if (DATA_KEY) {
  if (raw && !sealed(raw)) writeSealed(FILE, Buffer.from(JSON.stringify(db)));
  for (const f of readdirSync(IMAGES)) {
    if (f.endsWith(".tmp")) continue;
    const p = join(IMAGES, f), b = readFileSync(p);
    if (!sealed(b)) writeSealed(p, b);
  }
}
/** Activity lives in memory only: it's stale within minutes anyway. */
const activity = new Map();

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeSealed(FILE, Buffer.from(JSON.stringify(db))); // sealed with DATA_KEY; only this server's user can read it
  }, 500);
}

const hash = (k) => createHash("sha256").update(k).digest("hex");
function userFor(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.authorization ?? "");
  if (!m) return null;
  // Looked up by the key's SHA-256, so timing says nothing about the key itself (and it stays fast with many people).
  const h = hash(m[1]);
  return Object.hasOwn(db.keys, h) ? { uid: db.keys[h], h } : null;
}

/* ---------------------------------------------------------------- limits */
const buckets = new Map();
// Reading and writing are counted apart, so opening a big member list (lots of reads) can never use up what's
// needed to publish your own profile or activity. Everyone behind one home connection shares an address, so the
// read allowance is generous: 300 at once, 10 more a second.
const LIMITS = { read: { burst: 300, rate: 10 }, write: { burst: 30, rate: 1 } };
function allowed(ip, cost = 1, kind = "read") {
  const now = Date.now(), lim = LIMITS[kind], key = `${kind}:${ip}`;
  const b = buckets.get(key) ?? { t: now, n: lim.burst };
  b.n = Math.min(lim.burst, b.n + ((now - b.t) / 1000) * lim.rate);
  b.t = now;
  if (b.n < cost) { buckets.set(key, b); return false; }
  b.n -= cost; buckets.set(key, b);
  return true;
}
setInterval(() => { const cut = Date.now() - 120_000; for (const [k, v] of buckets) if (v.t < cut) buckets.delete(k); for (const [k, v] of activity) if (v.expires < Date.now()) activity.delete(k); }, 60_000).unref();

/* ---------------------------------------------------------------- validation */
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x, n) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : undefined);
const https = (u) => (u && u.startsWith("https://") ? u : undefined);
function cleanButtons(b) {
  if (!Array.isArray(b)) return undefined;
  const out = b.flatMap((x) => {
    const label = isObj(x) ? str(x.label, 32) : undefined;
    const url = isObj(x) ? https(str(x.url, 512)) : undefined;
    return label && url ? [{ label, url }] : [];
  }).slice(0, 2);
  return out.length ? out : undefined;
}
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
    endsAt: Number.isFinite(a.endsAt) ? a.endsAt : undefined,
    largeText: str(a.largeText, 128),
    smallImage: https(str(a.smallImage, 512)),
    icon: https(str(a.icon, 512)),
    smallText: str(a.smallText, 128),
    buttons: cleanButtons(a.buttons),
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

/**
 * Someone's profile as one viewer may see it, or null. A private profile is only for linked viewers on the owner's
 * list (and the owner); to anyone else it looks exactly like there's no profile at all.
 */
function profileFor(uid, viewer) {
  let u = db.users[uid];
  let act = activity.get(uid);
  if (u && !canSee(u, uid, viewer)) { u = undefined; act = undefined; }
  // What you're doing: only your friends and people you share a Stoat server with (your app sends that list), even
  // when your profile is for everyone. Apps from before 1.5 send no list: then linked viewers, as before.
  if (act && viewer !== uid && u?.actAllow && !u.actAllow.includes(viewer)) act = undefined;
  if (!u && !act) return null;
  // images: which servers have a banner here, and when it last changed (for cache-busting links).
  const images = u?.images ? Object.fromEntries(Object.entries(u.images).map(([k, v]) => [k, v.at])) : undefined;
  const live = act && act.expires > Date.now();
  return { profile: u?.profile ?? null, updatedAt: u?.updatedAt ?? 0, activity: live ? act.a : null, activities: live ? act.all ?? [act.a] : [], ...(images ? { images } : {}) };
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

  /** Unlinking from the app: everything about this person goes (profile, banners, activity, every device's link). */
  "DELETE /me": async (req) => {
    const who = userFor(req);
    if (!who) return [401, { error: "Link this server again." }];
    for (const [h, uid] of Object.entries(db.keys)) if (uid === who.uid) delete db.keys[h];
    const u = db.users[who.uid];
    for (const sid of Object.keys(u?.images ?? {})) rmSync(join(IMAGES, `${who.uid}-${sid}`), { force: true });
    delete db.users[who.uid];
    activity.delete(who.uid);
    save();
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

  // 1.4: "do you still know me?", so the app can relink by itself when this server's data was reset.
  "GET /me": async (req) => {
    const who = userFor(req);
    return who ? [200, { userId: who.uid }] : [401, { error: "Link this server again." }];
  },

  // 1.4: many profiles in one request (a member list, a busy chat), so a server for many people stays light.
  "POST /profiles": async (req) => {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x) => typeof x === "string" && ID_RE.test(x)))].slice(0, MAX_BATCH) : null;
    if (!ids) return [400, { error: "Missing ids." }];
    const viewer = userFor(req)?.uid;
    if (!viewer) return [401, { error: NEED_LINK }];
    const profiles = {};
    for (const id of ids) { const p = profileFor(id, viewer); if (p) profiles[id] = p; }
    return [200, { profiles }];
  },

  "PUT /activity": async (req) => {
    const who = userFor(req);
    if (!who) return [401, { error: "Link this server again." }];
    const body = await readBody(req);
    // 1.4: several at once (a game and music, like Discord). Older apps send just `activity`; they get the first back.
    const list = (Array.isArray(body.activities) ? body.activities : [body.activity]).map(cleanActivity).filter(Boolean).slice(0, MAX_ACTIVITIES);
    if (list.length) activity.set(who.uid, { a: list[0], all: list, expires: Date.now() + ACTIVITY_TTL }); else activity.delete(who.uid);
    // 1.5: who may see it (friends and people you share a server with). Sent when it changes; kept until replaced.
    if (Array.isArray(body.allow)) {
      const u = (db.users[who.uid] ??= { profile: null, updatedAt: Date.now() });
      u.actAllow = [...new Set(body.allow.filter((x) => typeof x === "string" && ID_RE.test(x)))].slice(0, MAX_ALLOW);
      save();
    }
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
  // Linking asks Stoat each time, so it costs more.
  // Reading (profiles, pictures, many profiles at once) is cheap; linking asks Stoat each time, so it costs more.
  const reading = req.method === "GET" || (req.method === "POST" && rest === "/profiles");
  if (!allowed(ip, reading ? 1 : rest === "/link" && req.method === "POST" ? 5 : 1, reading ? "read" : "write")) return send(res, 429, { error: "Slow down a little." });
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
      writeSealed(file, bytes);
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
      const viewer = userFor(req)?.uid;
      if (!viewer) return send(res, 401, { error: NEED_LINK });
      if (!meta || !canSee(u, uid, viewer)) return send(res, 404, { error: "No picture here." });
      let bytes;
      try { bytes = unseal(readFileSync(join(IMAGES, `${uid}-${sid}`))); } catch { return send(res, 404, { error: "No picture here." }); }
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
      const viewer = userFor(req)?.uid;
      if (!viewer) return send(res, 401, { error: NEED_LINK });
      const p = profileFor(uid, viewer);
      return p ? send(res, 200, p) : send(res, 404, { error: "No profile here." });
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

// Connections that trickle data in slowly to tie the server up are cut off.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => console.log(`${NAME} ${VERSION} on http://${HOST}:${PORT}/${PROTOCOL}/health · accounts from ${APIS.join(", ")}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { clearTimeout(saveTimer); try { writeSealed(FILE, Buffer.from(JSON.stringify(db))); } catch { /* best effort */ } process.exit(0); });
