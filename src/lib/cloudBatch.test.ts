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
