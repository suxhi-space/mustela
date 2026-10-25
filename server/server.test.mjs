import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** A fake Stoat that knows one session. */
function fakeStoat() {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      if (req.url === "/api/users/@me" && req.headers["x-session-token"] === "good-session-token-123456") { res.end(JSON.stringify({ _id: UID })); return; }
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
