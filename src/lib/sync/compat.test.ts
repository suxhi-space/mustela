import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, parseRemote, sanitize, SYNC_KEY } from "./settings";
import { packProfile as pack, unpackProfile as unpack } from "../profile/pack";

/**
 * People are upgrading from Mustela 0.1.0, and some will run 0.1.0 and a newer
 * version side by side for a while. These pin the formats 0.1.0 reads, so a
 * change that would wipe someone's synced settings or profile fails here first.
 * New settings go under a separate sync key (see docs/REBUILD-PLAN.md), never
 * into this one.
 */
describe("compatibility with Mustela 0.1.0", () => {
  it("keeps the same Stoat sync key and format version", () => {
    expect(SYNC_KEY).toBe("mustela:settings");
    expect(DEFAULT_SETTINGS.v).toBe(3);
  });

  it("reads a settings blob written by 0.1.0", () => {
    const old = JSON.stringify({
      v: 3, look: { theme: "custom", seed: "#3366ff", mode: "dark", amoled: true, variant: "vibrant", contrast: 0.5, gradient: { on: true, seed2: "#ff6633", angle: 90 } },
      favGifs: [{ url: "https://media.gifbox.me/x.gif", preview: "https://media.gifbox.me/x.webp" }], sounds: [],
      locale: { time: "24", date: "iso" }, cloud: { servers: [], banner: true }, profile: {}, maxRating: "good",
      pins: { groups: [{ id: "pinned", name: "Pinned", color: "#f0b232" }], items: [{ channel: "01ABC", group: "pinned" }] },
      emojiPack: "twemoji", updatedAt: 1761700000000,
    });
    const s = parseRemote(old)!;
    expect(s.look).toMatchObject({ theme: "custom", seed: "#3366ff", mode: "dark", amoled: true, variant: "vibrant" });
    expect(s.favGifs).toHaveLength(1);
    expect(s.pins.items).toEqual([{ channel: "01ABC", group: "pinned" }]);
    expect(s.emojiPack).toBe("twemoji");
    expect(s.updatedAt).toBe(1761700000000);
  });

  it("writes only fields 0.1.0 understands under the shared key", () => {
    const keys = Object.keys(sanitize({})).sort();
    expect(keys).toEqual(["cloud", "emojiPack", "favGifs", "locale", "look", "maxRating", "pins", "profile", "sounds", "updatedAt", "v"]);
  });

  it("packs profiles in the banner format 0.1.0 decodes", () => {
    const bytes = pack(DEFAULT_SETTINGS.profile);
    expect(bytes[0]! >> 4).toBe(2); // version nibble
    expect(unpack(bytes)).not.toBeNull();
  });
});
