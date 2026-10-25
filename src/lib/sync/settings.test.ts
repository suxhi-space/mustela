import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, parseRemote, pullSettings, pushSettings, resolve, sanitize, SYNC_KEY } from "./settings";
import { sanitizeDevice, DEFAULT_DEVICE } from "../device";

describe("sanitize", () => {
  it("clamps and repairs hostile input", () => {
    const s = sanitize({
      look: { theme: "neon", seed: "javascript:alert(1)", mode: "purple", amoled: "yes" },
      profile: { decor: { preset: 77, hue: NaN, speed: 99 }, effect: { preset: 3, hue: -50, intensity: 500 }, theme: { primary: "red" } },
      maxRating: "lol", updatedAt: -1,
    });
    expect(s.look).toEqual(DEFAULT_SETTINGS.look);
    expect(s.profile.decor.preset).toBe(0); // unknown preset -> none
    expect(s.profile.effect).toEqual({ preset: 3, hue: 309, speed: 8, intensity: 15 });
    expect(s.profile.theme).toBeNull();
    expect(s.maxRating).toBe("heavy");
    expect(s.updatedAt).toBe(0);
  });
  it("accepts custom themes with a valid seed", () => {
    expect(sanitize({ look: { theme: "custom", seed: "#AABBCC" } }).look).toMatchObject({ theme: "custom", seed: "#aabbcc" });
  });
  it("handles non-objects", () => {
    for (const x of [null, undefined, 5, "str", []]) expect(sanitize(x)).toEqual(DEFAULT_SETTINGS);
  });
  it("is idempotent", () => {
    const a = sanitize({ look: { theme: "sakura", mode: "dark" }, profile: { frame: { preset: 2, hue: 100, speed: 3, intensity: 4 } }, updatedAt: 5 });
    expect(sanitize(a)).toEqual(a);
  });
});

describe("parseRemote", () => {
  it("returns null for junk, missing, and other versions", () => {
    expect(parseRemote(undefined)).toBeNull();
    expect(parseRemote("{nope")).toBeNull();
    expect(parseRemote(JSON.stringify({ v: 1, theme: {} }))).toBeNull();
  });
});

describe("resolve (last write wins)", () => {
  const at = (n: number) => ({ ...DEFAULT_SETTINGS, updatedAt: n });
  it("takes newer remote, doesn't push", () => expect(resolve(at(1), at(2))).toMatchObject({ winner: { updatedAt: 2 }, push: false }));
  it("keeps newer local and pushes", () => expect(resolve(at(3), at(2))).toMatchObject({ winner: { updatedAt: 3 }, push: true }));
  it("no churn on ties", () => expect(resolve(at(2), at(2)).push).toBe(false));
  it("first run with no remote pushes only if user changed something", () => {
    expect(resolve(at(0), null).push).toBe(false);
    expect(resolve(at(9), null).push).toBe(true);
  });
});

describe("api round trip", () => {
  it("pushes under the right key with a timestamp and pulls it back", async () => {
    const store: Record<string, [number, string]> = {};
    const api: any = {
      post: vi.fn(async (path: string, body: any) => {
        if (path === "/sync/settings/set") { store[SYNC_KEY] = [body.timestamp, body[SYNC_KEY]]; return {}; }
        return store;
      }),
    };
    const s = sanitize({ ...DEFAULT_SETTINGS, updatedAt: 42, look: { theme: "plum", mode: "dark" } });
    await pushSettings(api, s);
    expect(store[SYNC_KEY]![0]).toBe(42);
    expect(await pullSettings(api)).toEqual(s);
  });
});

describe("device settings", () => {
  it("repairs junk and never syncs", () => {
    expect(sanitizeDevice(null)).toEqual(DEFAULT_DEVICE);
    expect(sanitizeDevice({ density: "huge", opacity: 5, material: "x", showMembers: false })).toMatchObject({ density: "default", opacity: 40, material: "none", showMembers: false });
    expect(sanitizeDevice({ opacity: 1000 }).opacity).toBe(100);
  });
});

describe("v3 migration", () => {
  it("drops the Halo that v2 turned on by default, keeps a chosen one", () => {
    const halo = { preset: 1, hue: 210, speed: 6, intensity: 9 };
    expect(sanitize({ v: 2, profile: { decor: halo } }).profile.decor.preset).toBe(0);
    expect(sanitize({ v: 2, profile: { decor: { ...halo, hue: 30 } } }).profile.decor.preset).toBe(1);
    expect(sanitize({ v: 3, profile: { decor: halo } }).profile.decor.preset).toBe(1);
  });
  it("accepts v2 and v3 remotes and sanitises new fields", () => {
    expect(parseRemote(JSON.stringify({ v: 2 }))?.v).toBe(3);
    const s = sanitize({ v: 3, look: { variant: "bogus", contrast: 7, gradient: { on: true, seed2: "zzz", angle: 999 } },
      favGifs: [{ url: "javascript:x", preview: "https://a" }, { url: "https://gifbox.me/view/a", preview: "https://p" }], cloud: { servers: ["ftp://x", "https://sync.example"] } });
    expect(s.look.variant).toBe("vibrant");
    expect(s.look.contrast).toBe(0);
    expect(s.look.gradient).toEqual({ on: true, seed2: "#a05cf0", angle: 360 });
    expect(s.favGifs.map((g) => g.url)).toEqual(["https://gifbox.me/view/a"]);
    expect(s.cloud.servers).toEqual(["https://sync.example"]);
  });
});
