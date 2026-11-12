import { describe, expect, it } from "vitest";
import { shortAgo } from "./time";

describe("shortAgo", () => {
  const now = new Date("2026-11-10T12:00:00Z").getTime();
  const ago = (ms: number) => shortAgo(new Date(now - ms), now);
  it("counts like Discord's search", () => {
    expect(ago(10e3)).toBe("now");
    expect(ago(5 * 60e3)).toBe("5m");
    expect(ago(3 * 3600e3)).toBe("3h");
    expect(ago(25 * 86400e3)).toBe("25d");
    expect(ago(95 * 86400e3)).toBe("3mo");
    expect(ago(800 * 86400e3)).toBe("2y");
  });
});
