import { describe, expect, it } from "vitest";
import { sanitize } from "./settings";
import { PACKED_EMOJI_RE, PACK_PUA, toCodepoint, emojiUrl } from "../emoji";

describe("synced DM pins", () => {
  it("always keeps the default group and drops pins to unknown groups", () => {
    const s = sanitize({ v: 3, pins: { groups: [{ id: "g1", name: "Close friends", color: "#3fbf72" }], items: [{ channel: "a", group: "g1" }, { channel: "b", group: "nope" }] } });
    expect(s.pins.groups.map((g) => g.id)).toEqual(["pinned", "g1"]);
    expect(s.pins.items).toEqual([{ channel: "a", group: "g1" }]);
  });
  it("keeps one pin per conversation and rejects bad colors", () => {
    const s = sanitize({ v: 3, pins: { groups: [{ id: "g1", name: "x", color: "javascript:alert(1)" }], items: [{ channel: "a", group: "g1" }, { channel: "a", group: "pinned" }] } });
    expect(s.pins.items).toHaveLength(1);
    expect(s.pins.groups[1]!.color).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("falls back to Stoat's default emoji pack", () => {
    expect(sanitize({ v: 3, emojiPack: "comic-sans" }).emojiPack).toBe("fluent-3d");
    expect(sanitize({ v: 3, emojiPack: "twemoji" }).emojiPack).toBe("twemoji");
  });
});

describe("Stoat emoji packs", () => {
  it("names files the way Stoat does", () => {
    expect(toCodepoint("😃")).toBe("1f603");
    expect(toCodepoint("👍🏽")).toBe("1f44d-1f3fd");
    expect(emojiUrl("noto", "❤️")).toBe("https://static.stoat.chat/emoji/noto/2764-fe0f.svg?v=1");
  });
  it("reads a pack prefix in front of an emoji", () => {
    const m = "hi 🔥 and 👍".match(PACKED_EMOJI_RE)!;
    expect(m).toEqual(["🔥", "👍"]);
    expect(PACK_PUA[m[0]![0]!]).toBe("twemoji");
  });
});
