import { describe, expect, it } from "vitest";
import { mergeDocs, sameDoc, stampDoc, stampOf, type Doc } from "./merge";
import { DEFAULT_EXT, sanitizeExt } from "./ext";

const EXT_PARTS = [...Object.keys(DEFAULT_EXT), "entrySound", "doubleTap", "themes"];
const theme = { id: "t1", name: "Cosy", look: { seed: "#ff7a59" }, picture: false, at: 1, style: { backdrop: "plain", backdropBlur: false, panelOpacity: 80, panelBlur: true, depth: "classic", textSize: 15 } };

describe("synced settings merge part by part", () => {
  it("an older build's copy without saved themes never wipes them (the bug from 0.1.7-build1)", () => {
    // The tablet saved a theme at t=100 (new build, with stamps).
    const tablet = stampDoc({}, { ...DEFAULT_EXT, themes: [theme], updatedAt: 100 }, EXT_PARTS, 100);
    // The Mac on an older build saved its whole block later (t=200): it has no idea themes exist.
    const mac: Doc = { ...DEFAULT_EXT, favourites: ["c1"], updatedAt: 200 };
    const merged = mergeDocs(tablet, mac);
    expect(sanitizeExt(merged).themes?.map((t) => t.id)).toEqual(["t1"]); // kept
    expect(sanitizeExt(merged).favourites).toEqual(["c1"]); // the Mac's newer change still arrives
    // And the other way round (the Mac's copy is the local one after updating).
    expect(sanitizeExt(mergeDocs(mac, tablet)).themes?.map((t) => t.id)).toEqual(["t1"]);
  });

  it("deleting every theme on purpose still reaches other devices", () => {
    const a = stampDoc({}, { ...DEFAULT_EXT, themes: [theme], updatedAt: 100 }, EXT_PARTS, 100);
    const b = stampDoc(a, { ...DEFAULT_EXT, themes: [], updatedAt: 300 }, EXT_PARTS, 300);
    expect(sanitizeExt(mergeDocs(a, b)).themes).toEqual([]);
  });

  it("clearing an optional setting is saved as cleared, so an older copy doesn't bring it back", () => {
    const a = stampDoc({}, { ...DEFAULT_EXT, entrySound: "s1", updatedAt: 100 }, EXT_PARTS, 100);
    const cleared = stampDoc(a, { ...DEFAULT_EXT, updatedAt: 300 }, EXT_PARTS, 300);
    expect(cleared.entrySound).toBeNull();
    expect(sanitizeExt(mergeDocs(a, cleared)).entrySound).toBeUndefined();
    expect(sanitizeExt(mergeDocs(cleared, a)).entrySound).toBeUndefined();
  });

  it("each part comes from whichever device changed it last", () => {
    const base = stampDoc({}, { ...DEFAULT_EXT, updatedAt: 10 }, EXT_PARTS, 10);
    const phone = stampDoc(base, { ...DEFAULT_EXT, favourites: ["a"], updatedAt: 50 }, EXT_PARTS, 50);
    const pc = stampDoc(base, { ...DEFAULT_EXT, favEmoji: ["🔥"], updatedAt: 60 }, EXT_PARTS, 60);
    const m = sanitizeExt(mergeDocs(phone, pc));
    expect(m.favourites).toEqual(["a"]); // the phone's change isn't lost to the PC's later save
    expect(m.favEmoji).toEqual(["🔥"]);
  });

  it("keeps parts this build doesn't know (from a newer Mustela)", () => {
    const local = stampDoc({}, { ...DEFAULT_EXT, updatedAt: 10 }, EXT_PARTS, 10);
    const newer: Doc = { ...local, futureThing: { x: 1 }, stamps: { ...(local.stamps as object), futureThing: 20 }, updatedAt: 20 };
    const merged = mergeDocs(local, newer);
    expect(merged.futureThing).toEqual({ x: 1 });
    // A local change made by this build keeps it too.
    const changed = stampDoc(merged, { ...sanitizeExt(merged), favRail: true, updatedAt: 30 }, EXT_PARTS, 30);
    expect(changed.futureThing).toEqual({ x: 1 });
  });

  it("only stamps the parts that changed", () => {
    const a = stampDoc({}, { ...DEFAULT_EXT, updatedAt: 10 }, EXT_PARTS, 10);
    const b = stampDoc(a, { ...sanitizeExt(a), favRail: true, updatedAt: 20 }, EXT_PARTS, 20);
    expect(stampOf(b, "favRail")).toBe(20);
    expect(stampOf(b, "favourites")).toBe(10);
  });

  it("a merge with nothing new changes nothing (no needless upload)", () => {
    const a = stampDoc({}, { ...DEFAULT_EXT, themes: [theme], updatedAt: 10 }, EXT_PARTS, 10);
    expect(sameDoc(mergeDocs(a, a), a)).toBe(true);
  });
});
