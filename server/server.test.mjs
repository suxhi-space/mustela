import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
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
    await fetch(`${base}/activity`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ activity: { kind: "playing", name: "Celeste", image: "http://not-https/x.png" } }) });

    const got = await (await fetch(`${base}/profile/${UID}`)).json();
    assert.deepEqual(got.profile, { v: 1, decor: { preset: 2 } });
    assert.equal(got.activity.name, "Celeste");
    assert.equal(got.activity.image, undefined); // only https images

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
    assert.equal((await read()).status, 404);          // anonymous (and 0.1.0 clients): no profile
    assert.equal((await read(stranger)).status, 404);  // not on the list
    assert.deepEqual((await (await read(friend)).json()).profile, { v: 1 });
    assert.equal((await read(owner)).status, 200);     // you always see your own
    // Going public again (no audience) shows it to everyone.
    await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${owner}` }, body: JSON.stringify({ profile: { v: 1 } }) });
    assert.equal((await read()).status, 200);
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
    const prof = await (await fetch(`${base}/profile/${UID}`)).json();
    assert.ok(prof.images[SID] > 0);
    const got = await fetch(`${base}/image/${UID}/${SID}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);

    // Private profile: the picture is private too.
    const friendKey = await link("friend-session-token-12345");
    await fetch(`${base}/profile`, { method: "PUT", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ profile: { v: 1 }, audience: { mode: "friends", allow: [FRIEND] } }) });
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`)).status, 404);
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${friendKey}` } })).status, 200);

    assert.equal((await fetch(`${base}/image/${SID}`, { method: "DELETE", headers: { authorization: `Bearer ${key}` } })).status, 204);
    assert.equal((await fetch(`${base}/image/${UID}/${SID}`, { headers: { authorization: `Bearer ${friendKey}` } })).status, 404);
  } finally { proc.kill(); stoat.close(); }
});
