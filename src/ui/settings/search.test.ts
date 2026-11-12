import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { searchHit } from "./search";
// @ts-expect-error plain JS build script
import { build, render } from "../../../scripts/settings-index.mjs";

describe("settings search", () => {
  it("matches every word on word starts", () => {
    expect(searchHit("input volume", "Input volume")).toBe(true);
    expect(searchHit("in vol", "Input volume")).toBe(true);
    expect(searchHit("volume input", "Input volume")).toBe(true);
    expect(searchHit("put", "Input volume")).toBe(false);
    expect(searchHit("sounds", "Entry sound")).toBe(true);
    expect(searchHit("  ", "Anything")).toBe(false);
    expect(searchHit("two-factor", "Two-factor authentication")).toBe(true);
  });
  it("index is up to date with the Settings pages (run node scripts/settings-index.mjs)", () => {
    expect(readFileSync("src/ui/settings/searchIndex.ts", "utf8")).toBe(render(build()));
  });
});
