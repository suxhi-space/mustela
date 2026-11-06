import { describe, expect, it } from "vitest";
import { quickTimes } from "../lib/scheduleTimes";

describe("schedule quick times", () => {
  it("offers tonight only before 6 PM and always tomorrow morning", () => {
    const morning = quickTimes(new Date(2026, 10, 6, 10, 0));
    expect(morning.map((x) => x.label)).toContain("Tonight at 8 PM");
    const night = quickTimes(new Date(2026, 10, 6, 21, 0));
    expect(night.map((x) => x.label)).not.toContain("Tonight at 8 PM");
    const tomorrow = night.find((x) => x.label === "Tomorrow at 9 AM")!;
    expect(new Date(tomorrow.at).getDate()).toBe(7);
    expect(new Date(tomorrow.at).getHours()).toBe(9);
  });
});
