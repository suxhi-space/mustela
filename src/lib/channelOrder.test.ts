import { describe, expect, it } from "vitest";
import { moveCategory, moveChannel } from "./channelOrder";

const cats = () => [{ id: "A", title: "A", channels: ["a1", "a2"] }, { id: "B", title: "B", channels: ["b1"] }];

describe("channel order", () => {
  it("moves a channel before another, across categories", () => {
    expect(moveChannel(cats(), "a1", { before: "b1" }).map((c) => c.channels)).toEqual([["a2"], ["a1", "b1"]]);
    expect(moveChannel(cats(), "a2", { before: "a1" })[0]!.channels).toEqual(["a2", "a1"]);
  });
  it("drops into the end of a category, or out of every category", () => {
    expect(moveChannel(cats(), "a1", { into: "B" })[1]!.channels).toEqual(["b1", "a1"]);
    expect(moveChannel(cats(), "a1", { into: null }).flatMap((c) => c.channels)).toEqual(["a2", "b1"]);
    expect(moveChannel(cats(), "x", { into: "A" })[0]!.channels).toEqual(["a1", "a2", "x"]);
  });
  it("reorders categories", () => {
    expect(moveCategory(cats(), "B", "A").map((c) => c.id)).toEqual(["B", "A"]);
    expect(moveCategory(cats(), "A", null).map((c) => c.id)).toEqual(["B", "A"]);
    expect(moveCategory(cats(), "A", "A").map((c) => c.id)).toEqual(["A", "B"]);
  });
});
