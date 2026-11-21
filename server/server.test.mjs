import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const FRIEND = "01BX5ZZKBKACTAV9WEVGEMMVRZ";
const STRANGER = "01CXYZ7KBKACTAV9WEVGEMMVRZ";
const TOKENS = { "good-session-token-123456": UID, "friend-session-token-12345": FRIEND, "stranger-session-token-123": STRANGER };

/** A fake Stoat that knows one session. */
function fakeStoat() {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      const who = TOKENS[req.headers["x-session-token"]];
      if (req.url === "/api/users/@me" && who) { res.end(JSON.stringify({ _id: who })); return; }
      res.writeHead(401).end("{}");
    }).listen(0, "127.0.0.1", () => resolve(s));
  });
}

test("link, publish, read, activity", async () => {
  const stoat = await fakeStoat();
  const api = `http://127.0.0.1:${stoat.address().port}/api`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STOAT_APIS: api, DATA_DIR: mkdtempSync(join(tmpdir(), "mustela-")) }, stdio: "pipe" });
  await new Promise((r) => proc.stdout.once("data", r));
  const base = `http://127.0.0.1:${port}/v1`;
  try {
    const h = await (await fetch(`${base}/health`)).json();
    assert.equal(h.protocol, "v1");

    const bad = await fetch(`${base}/link`, { method: "POST", body: JSON.stringify({ api, token: "wrong-session-token-123456" }) });
    assert.equal(bad.status, 401);
    const other = await fetch(`${base}/link`, { method: "POST", body: JSON.stringify({ api: "https://evil.example/api", token: "good-session-token-123456" }) });
    assert.equal(other.status, 400);

    const { key, userId } = await (await fetch(`${base}/link`, { method: "POST", body: JSON.stringify({ api, token: "good-session-token-123456" }) })).json();
    assert.equal(userId, UID);

    assert.equal((await fetch(`${base}/profile`, { method: "PUT", body: JSON.stringify({ profile: { v: 1 } }) })).status, 401);
    assert.equal((await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ profile: { v: 1, decor: { preset: 2 } } }) })).status, 204);
    await fetch(`${base}/activity`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ activity: { kind: "playing", name: "Celeste", image: "http://not-https/x.png", buttons: [{ label: "Join", url: "https://example.com/j" }, { label: "Bad", url: "javascript:alert(1)" }, { label: "Three", url: "https://x.y" }] } }) });

    assert.equal((await fetch(`${base}/profile/${UID}`)).status, 401); // 1.5: a browser or anyone not linked gets nothing
    const got = await (await fetch(`${base}/profile/${UID}`, { headers: { authorization: `Bearer ${key}` } })).json();
    assert.deepEqual(got.profile, { v: 1, decor: { preset: 2 } });
    assert.equal(got.activity.name, "Celeste");
    assert.equal(got.activity.image, undefined); // only https images
    assert.deepEqual(got.activity.buttons, [{ label: "Join", url: "https://example.com/j" }, { label: "Three", url: "https://x.y" }]);

    // 1.4: the app can ask whether the server still knows its link
    assert.equal((await (await fetch(`${base}/me`, { headers: { authorization: `Bearer ${key}` } })).json()).userId, UID);
    assert.equal((await fetch(`${base}/me`, { headers: { authorization: "Bearer not-a-key" } })).status, 401);

    // A busy member list (lots of reads from one address) never blocks publishing your own activity.
    await Promise.all(Array.from({ length: 120 }, () => fetch(`${base}/profile/${STRANGER}`, { headers: { authorization: `Bearer ${key}` } })));
    assert.equal((await fetch(`${base}/activity`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ activity: { kind: "playing", name: "Celeste" } }) })).status, 204);

    // 1.4: several activities at once; older apps still get the first as `activity`
    await fetch(`${base}/activity`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ activities: [{ kind: "playing", name: "Celeste" }, { kind: "listening", name: "Spotify", details: "A song" }] }) });
    const both = await (await fetch(`${base}/profile/${UID}`, { headers: { authorization: `Bearer ${key}` } })).json();
    assert.deepEqual(both.activities.map((a) => a.name), ["Celeste", "Spotify"]);
    assert.equal(both.activity.name, "Celeste");

    // 1.4: many at once; people with nothing here are simply left out
    assert.equal((await fetch(`${base}/profiles`, { method: "POST", body: JSON.stringify({ ids: [UID] }) })).status, 401);
    const many = await (await fetch(`${base}/profiles`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ ids: [UID, STRANGER, "not-an-id", UID] }) })).json();
    assert.deepEqual(Object.keys(many.profiles), [UID]);
    assert.equal(many.profiles[UID].activity.name, "Celeste");
    assert.equal((await fetch(`${base}/profiles`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: "{}" })).status, 400);

    assert.equal((await fetch(`${base}/link`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } })).status, 204);
    assert.equal((await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: "{}" })).status, 401);
  } finally { proc.kill(); stoat.close(); }
});

test("private profiles are only shown to the owner's allow list", async () => {
  const stoat = await fakeStoat();
  const api = `http://127.0.0.1:${stoat.address().port}/api`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STOAT_APIS: api, DATA_DIR: mkdtempSync(join(tmpdir(), "mustela-")) }, stdio: "pipe" });
  await new Promise((r) => proc.stdout.once("data", r));
  const base = `http://127.0.0.1:${port}/v1`;
  const link = async (token) => (await (await fetch(`${base}/link`, { method: "POST", body: JSON.stringify({ api, token }) })).json()).key;
  try {
    const [owner, friend, stranger] = [await link("good-session-token-123456"), await link("friend-session-token-12345"), await link("stranger-session-token-123")];
    const put = await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${owner}` }, body: JSON.stringify({ profile: { v: 1 }, audience: { mode: "friends", allow: [FRIEND, "not-an-id"] } }) });
    assert.equal(put.status, 204);
    const read = (key) => fetch(`${base}/profile/${UID}`, key ? { headers: { authorization: `Bearer ${key}` } } : {});
    assert.equal((await read()).status, 401);          // not linked: nothing at all
    assert.equal((await read(stranger)).status, 404);  // not on the list
    assert.deepEqual((await (await read(friend)).json()).profile, { v: 1 });
    assert.equal((await read(owner)).status, 200);     // you always see your own
    // Going public again (no audience) shows it to everyone.
    await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${owner}` }, body: JSON.stringify({ profile: { v: 1 } }) });
    assert.equal((await read()).status, 401);
    assert.equal((await read(stranger)).status, 200);
    // 1.5: what you're doing only reaches the people your app lists (friends, people you share a server with).
    await fetch(`${base}/activity`, { method: "PUT", headers: { authorization: `Bearer ${owner}` }, body: JSON.stringify({ activities: [{ kind: "playing", name: "Celeste" }], allow: [FRIEND] }) });
    assert.equal((await (await read(friend)).json()).activities[0]?.name, "Celeste");
    assert.deepEqual((await (await read(stranger)).json()).activities, []);
    assert.equal((await (await read(owner)).json()).activities[0]?.name, "Celeste"); // your other devices
  } finally { proc.kill(); stoat.close(); }
});

test("per-server banners: upload, read, privacy, file checks", async () => {
  const stoat = await fakeStoat();
  const api = `http://127.0.0.1:${stoat.address().port}/api`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STOAT_APIS: api, DATA_DIR: mkdtempSync(join(tmpdir(), "mustela-")) }, stdio: "pipe" });
  await new Promise((r) => proc.stdout.once("data", r));
  const base = `http://127.0.0.1:${port}/v1`;
  const SID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
  const link = async (token) => (await (await fetch(`${base}/link`, { method: "POST", body: JSON.stringify({ api, token }) })).json()).key;
  try {
    const key = await link("good-session-token-123456");
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
    assert.equal((await fetch(`${base}/image/${SID}`, { method: "PUT", body: png })).status, 401);
    assert.equal((await fetch(`${base}/image/${SID}`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: Buffer.from("<script>alert(1)</script>") })).status, 415);
    assert.equal((await fetch(`${base}/image/${SID}`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: Buffer.alloc(600 * 1024, 0xff) })).status, 413);
    const up = await fetch(`${base}/image/${SID}`, { method: "PUT", headers: { authorization: `Bearer ${key}`, "content-type": "image/png" }, body: png });
    assert.equal(up.status, 200);

    // Publishing the profile afterwards keeps the picture.
    await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ profile: { v: 1 } }) });
    const prof = await (await fetch(`${base}/profile/${UID}`, { headers: { authorization: `Bearer ${key}` } })).json();
    assert.ok(prof.images[SID] > 0);
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`)).status, 401);
    const got = await fetch(`${base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${key}` } });
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);

    // Private profile: the picture is private too.
    const friendKey = await link("friend-session-token-12345");
    await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ profile: { v: 1 }, audience: { mode: "friends", allow: [FRIEND] } }) });
    const strangerKey = await link("stranger-session-token-123");
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${strangerKey}` } })).status, 404);
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${friendKey}` } })).status, 200);

    assert.equal((await fetch(`${base}/image/${SID}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } })).status, 204);
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${friendKey}` } })).status, 404);
  } finally { proc.kill(); stoat.close(); }
});

test("stored data is encrypted with DATA_KEY, and unlinking deletes everything", async () => {
  const stoat = await fakeStoat();
  const api = `http://127.0.0.1:${stoat.address().port}/api`;
  const dir = mkdtempSync(join(tmpdir(), "mustela-"));
  const DATA_KEY = Buffer.alloc(32, 9).toString("base64");
  const start = async (key) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const proc = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", STOAT_APIS: api, DATA_DIR: dir, DATA_KEY: key ?? "" }, stdio: "pipe" });
    await new Promise((r) => proc.stdout.once("data", r));
    return { proc, base: `http://127.0.0.1:${port}/v1` };
  };
  const SID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  let s = await start(DATA_KEY);
  try {
    const { key } = await (await fetch(`${s.base}/link`, { method: "POST", body: JSON.stringify({ api, token: "good-session-token-123456" }) })).json();
    const auth = { authorization: `Bearer ${key}` };
    await fetch(`${s.base}/profile`, { method: "PUT", headers: auth, body: JSON.stringify({ profile: { v: 1, decor: { preset: 7 } } }) });
    await fetch(`${s.base}/image/${SID}`, { method: "PUT", headers: auth, body: png });
    await new Promise((r) => setTimeout(r, 800)); // the save is batched

    // On disk: nothing readable, neither the profile nor the picture.
    const onDisk = readFileSync(join(dir, "data.json"));
    assert.equal(onDisk.subarray(0, 4).toString(), "MSE1");
    assert.ok(!onDisk.includes(Buffer.from(UID)) && !onDisk.includes(Buffer.from("decor")));
    assert.equal(readFileSync(join(dir, "images", `${UID}-${SID}`)).subarray(0, 4).toString(), "MSE1");

    // Restarted with the same key, everything is still there.
    s.proc.kill(); await new Promise((r) => setTimeout(r, 300));
    s = await start(DATA_KEY);
    assert.deepEqual((await (await fetch(`${s.base}/profile/${UID}`, { headers: auth })).json()).profile, { v: 1, decor: { preset: 7 } });
    assert.deepEqual(Buffer.from(await (await fetch(`${s.base}/image/${UID}/${SID}`, { headers: auth })).arrayBuffer()), png);

    // Unlink: profile, picture, activity and every link are gone.
    await fetch(`${s.base}/activity`, { method: "PUT", headers: auth, body: JSON.stringify({ activities: [{ kind: "playing", name: "Celeste" }] }) });
    assert.equal((await fetch(`${s.base}/me`, { method: "DELETE", headers: auth })).status, 204);
    const other = (await (await fetch(`${s.base}/link`, { method: "POST", body: JSON.stringify({ api, token: "friend-session-token-12345" }) })).json()).key;
    assert.equal((await fetch(`${s.base}/profile/${UID}`, { headers: { authorization: `Bearer ${other}` } })).status, 404);
    assert.equal((await fetch(`${s.base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${other}` } })).status, 404);
    assert.equal((await fetch(`${s.base}/me`, { headers: auth })).status, 401);
    assert.ok(!existsSync(join(dir, "images", `${UID}-${SID}`)));
  } finally { s.proc.kill(); stoat.close(); }
});
