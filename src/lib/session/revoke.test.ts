import { describe, expect, it, vi } from "vitest";
import { revokeSession } from "./revoke";
import { DEFAULT_API } from "../backend/login";

const s = { _id: "a", token: "tok", user_id: "u" };
describe("revokeSession", () => {
  it("posts to the right instance with the session token header", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await revokeSession(undefined, s, f as any)).toBe(true);
    expect(f).toHaveBeenCalledWith(`${DEFAULT_API}/auth/session/logout`, { method: "POST", headers: { "x-session-token": "tok" } });
    await revokeSession("https://chat.example.org/api/", s, f as any);
    expect((f.mock.calls[1] as any)[0]).toBe("https://chat.example.org/api/auth/session/logout");
  });
  it("never throws, and reports failure", async () => {
    expect(await revokeSession(undefined, s, (async () => { throw new Error("offline"); }) as any)).toBe(false);
    expect(await revokeSession(undefined, s, (async () => new Response(null, { status: 401 })) as any)).toBe(false);
  });
});
