import { describe, expect, it } from "vitest";
import { sanitizeServerLooks } from "./servers";

const SID = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

describe("per-server looks", () => {
  it("keeps valid entries and drops junk", () => {
    const s = sanitizeServerLooks({ [SID]: { bio: "hi", banner: 5, config: { frame: { preset: 4 } } }, "not an id!": { bio: "x" }, ["01HYYYYYYYYYYYYYYYYYYYYYYY"]: {} });
    expect(Object.keys(s)).toEqual([SID]);
    expect(s[SID]!.bio).toBe("hi");
    expect(s[SID]!.banner).toBe(5);
    expect(s[SID]!.config?.frame.preset).toBe(4);
  });
  it("caps bios and rejects odd shapes", () => {
    expect(sanitizeServerLooks([])).toEqual({});
    expect(sanitizeServerLooks({ [SID]: { bio: "x".repeat(5000), banner: -1 } })[SID]).toEqual({ bio: "x".repeat(2000) });
  });
});
