import { describe, expect, it } from "vitest";
import { detectPlatform } from "./platform";

describe("detectPlatform", () => {
  it("recognizes each target", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)", true)).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", true)).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true)).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)", true)).toBe("linux");
  });
  it("is 'web' outside the app, except Android", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0)", false)).toBe("web");
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14)", false)).toBe("android");
  });
});
