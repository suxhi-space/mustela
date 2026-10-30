import { describe, expect, it } from "vitest";
import { compareVersions } from "../cloud";
import { DEFAULT_EXT, EXT_KEY, parseExt, sanitizeExt } from "./ext";
import { SYNC_KEY } from "./settings";

describe("newer settings (their own sync key)", () => {
  it("never shares 0.1.0's key", () => expect(EXT_KEY).not.toBe(SYNC_KEY));
  it("cleans up whatever it's given", () => {
    expect(sanitizeExt({ privacy: { mode: "everybody!", servers: [1, "x"] }, updatedAt: -5 })).toEqual({ ...DEFAULT_EXT, privacy: { mode: "everyone", servers: ["x"] } });
    expect(sanitizeExt({ privacy: { mode: "friends+servers", servers: ["a"] }, updatedAt: 9 }).privacy.mode).toBe("friends+servers");
  });
  it("only reads its own format", () => {
    expect(parseExt('{"v":1,"privacy":{"mode":"friends"}}')?.privacy.mode).toBe("friends");
    expect(parseExt('{"v":3}')).toBeNull();
  });
  it("keeps channel pins and favorites as clean id lists", () => {
    const s = sanitizeExt({ channelPins: ["a", "a", 5, "b", "x".repeat(99)], favourites: "nope" });
    expect(s.channelPins).toEqual(["a", "b"]);
    expect(s.favourites).toEqual([]);
    expect(parseExt("not json")).toBeNull();
  });
  it("compares sync server versions", () => {
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
  });
});
describe("favorite categories", () => {
  it("keeps valid categories and drops links to missing ones", () => {
    const e = sanitizeExt({
      favourites: ["c1", "c2", "c3"],
      favGroups: [{ id: "g1", name: "  Gaming ", color: "#ABCDEF" }, { id: "g1", name: "dup" }, { id: "", name: "x" }, { id: "g2", color: "red" }],
      favIn: { c1: "g1", c2: "nope", c9: "g1", c3: 5 },
      favRail: "yes",
    });
    expect(e.favGroups).toEqual([{ id: "g1", name: "Gaming", color: "#abcdef" }, { id: "g2", name: "Category", color: "#f0b232" }]);
    expect(e.favIn).toEqual({ c1: "g1" });
    expect(e.favRail).toBe(false);
  });
  it("defaults for old settings", () => {
    const e = sanitizeExt({ favourites: ["c1"] });
    expect(e.favGroups).toEqual([]);
    expect(e.favIn).toEqual({});
    expect(e.favRail).toBe(false);
  });
});
