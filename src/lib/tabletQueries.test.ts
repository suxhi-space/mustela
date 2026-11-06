import { describe, expect, it } from "vitest";
import { adaptCss, adaptMedia } from "./tabletQueries";

describe("tablet queries", () => {
  it("narrow queries also match an upright tablet", () => {
    expect(adaptMedia("(max-width: 700px)")).toBe("(max-width: 700px), (max-width: 1100px) and (orientation: portrait)");
    expect(adaptMedia("(orientation: portrait), (max-width: 700px)")).toBe("(orientation: portrait), (max-width: 700px), (max-width: 1100px) and (orientation: portrait)");
  });
  it("wide queries need the tablet sideways (or a big screen)", () => {
    expect(adaptMedia("(pointer: coarse) and (min-width: 701px)")).toBe("(pointer: coarse) and (min-width: 701px) and (orientation: landscape), (pointer: coarse) and (min-width: 1101px)");
    expect(adaptMedia("(min-width: 1200px)")).toBe("(min-width: 1200px)");
    expect(adaptMedia("(max-width: 520px) and (max-height: 520px)")).toBe("(max-width: 520px) and (max-height: 520px)");
  });
  it("rewrites a stylesheet's rules", () => {
    expect(adaptCss("@media (max-width: 700px) { a { b: c } }")).toBe("@media (max-width: 700px), (max-width: 1100px) and (orientation: portrait) { a { b: c } }");
  });
});
