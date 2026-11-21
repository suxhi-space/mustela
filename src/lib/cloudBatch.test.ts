import { describe, expect, it, vi, afterEach } from "vitest";
import { Cloud } from "./cloud";

const A = "01ARZ3NDEKTSV4RRFFQ69G5FAV", B = "01BX5ZZKBKACTAV9WEVGEMMVRZ", C = "01CXYZ7KBKACTAV9WEVGEMMVRZ";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("profile requests to Mustela servers", () => {
  it("go out as one request for many people (servers 1.4+)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      const ids = JSON.parse(String(init?.body ?? "{}")).ids as string[];
      expect(ids.sort()).toEqual([A, B, C].sort());
      return json(200, { profiles: { [A]: { profile: { v: 1 }, updatedAt: 5, activity: null } } });
    }));
    const c = new Cloud("https://stoat.chat/api", () => null, () => "me");
    c.setServers(["https://srv.example"]);
    const [a, b, cc] = await Promise.all([c.fetchProfile(A), c.fetchProfile(B), c.fetchProfile(C)]);
    expect(calls).toEqual(["POST https://srv.example/v1/profiles"]);
    expect(a?.updatedAt).toBe(5);
    expect(b).toBeNull();
    expect(cc).toBeNull();
  });

  it("fall back to one request per person on an older server", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/profiles")) return json(404, { error: "Not found." });
      if (url.endsWith(A)) return json(200, { profile: { v: 1 }, updatedAt: 7, activity: null });
      return json(404, { error: "No profile here." });
    }));
    const c = new Cloud("https://stoat.chat/api", () => null, () => "me");
    c.setServers(["https://old.example"]);
    const [a, b] = await Promise.all([c.fetchProfile(A), c.fetchProfile(B)]);
    expect(a?.updatedAt).toBe(7);
    expect(b).toBeNull();
    expect(calls[0]).toBe("POST https://old.example/v1/profiles");
    // Remembered: the next one goes straight to the old way.
    await c.fetchProfile(C);
    expect(calls.filter((x) => x.endsWith("/profiles")).length).toBe(1);
  });
});

describe("a Mustela server that forgot this device's link", () => {
  it("links again by itself and sends the update again", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    let keyOk = "old-key", puts = 0, links = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
      if (url.endsWith("/link")) { links++; keyOk = "new-key"; return json(200, { key: "new-key", userId: "me" }); }
      if (url.endsWith("/activity")) { puts++; return auth === `Bearer ${keyOk}` && keyOk === "new-key" ? new Response(null, { status: 204 }) : json(401, { error: "Link this server again." }); }
      return json(404, { error: "Not found." });
    }));
    const c = new Cloud("https://stoat.chat/api", () => "a-stoat-session-token", () => "me");
    c.setServers(["https://srv.example"]);
    (c as unknown as { saveKey(s: string, k: string): void }).saveKey("https://srv.example", "old-key");
    const r = await c.setActivity([{ kind: "playing", name: "Celeste" }]);
    expect(links).toBe(1);
    expect(puts).toBe(2);       // refused, then sent again after relinking
    expect(r.failed).toBe(0);
    expect(c.keyFor("https://srv.example")).toBe("new-key");
  });
});

describe("a Mustela server that only answers linked people", () => {
  it("shows no profile and stops asking until you link it", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/profiles") || url.includes("/profile/")) { asked++; return json(401, { error: "Link this server to see profiles." }); }
      return json(404, { error: "Not found." });
    }));
    const c = new Cloud("https://stoat.chat/api", () => "a-stoat-session-token", () => "me");
    c.setServers(["https://locked.example"]);
    expect(await c.fetchProfile("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBeNull();
    expect(await c.fetchProfile("01BX5ZZKBKACTAV9WEVGEMMVRZ", true)).toBeNull();
    expect(asked).toBe(1); // the second person wasn't asked for: the server needs a link first
  });
});
