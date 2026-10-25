import { describe, expect, it } from "vitest";
import { sanitizeActivity, validServerUrl } from "./cloud";
import { fmtDate, fmtTime, setTimePrefs } from "./time";
import { buildRoles, gradientEnd } from "./theme/palette";
import { contrast, parseHex } from "./color";
import { sanitize, DEFAULT_SETTINGS } from "./sync/settings";
import { EMOJI_RE, emojiName } from "./emoji";

describe("sync server urls", () => {
  it("accepts https and localhost only", () => {
    expect(validServerUrl("https://sync.example.com/")).toBe("https://sync.example.com");
    expect(validServerUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(validServerUrl("http://sync.example.com")).toBeNull();
    expect(validServerUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("activity from servers", () => {
  it("keeps only safe, bounded fields", () => {
    const a = sanitizeActivity({ kind: "listening", name: "  Lo-fi  ", image: "http://x/a.png", details: "x".repeat(500), extra: 1 });
    expect(a).toEqual({ kind: "listening", name: "Lo-fi", details: "x".repeat(128), state: undefined, startedAt: undefined, image: undefined, appId: undefined });
    expect(sanitizeActivity({ name: "" })).toBeNull();
    expect(sanitizeActivity("Playing")).toBeNull();
    expect(sanitizeActivity({ name: "Game", kind: "evil" })!.kind).toBe("playing");
  });
});

describe("time format", () => {
  const d = new Date(2026, 9, 4, 15, 4);
  it("follows the chosen clock and date style", () => {
    setTimePrefs({ time: "24", date: "iso" });
    expect(fmtTime(d)).toMatch(/15:04/);
    expect(fmtDate(d)).toBe("2026-10-04");
    setTimePrefs({ time: "12", date: "eu" });
    expect(fmtTime(d)).toMatch(/3:04/);
    expect(fmtDate(d)).toBe("04/10/2026");
    setTimePrefs({ time: "auto", date: "us" });
    expect(fmtDate(d)).toBe("10/4/2026");
  });
});

describe("palette styles and contrast", () => {
  const variants = ["tonal", "vibrant", "expressive", "fidelity", "content", "neutral", "monochrome", "rainbow", "fruit"] as const;
  for (const v of variants) for (const mode of ["light", "dark"] as const) {
    it(`${v} ${mode}: text stays readable`, () => {
      const r = buildRoles("#7b4fa0", mode, { variant: v, contrast: 0 });
      expect(contrast(parseHex(r.onSurface!)!, parseHex(r.surface!)!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseHex(r.onPrimary!)!, parseHex(r.primary!)!)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("high contrast pulls text further from the background", () => {
    const n = buildRoles("#1a9bb0", "dark", { contrast: 0 }), h = buildRoles("#1a9bb0", "dark", { contrast: 1 });
    expect(contrast(parseHex(h.onSurfaceVariant!)!, parseHex(h.surface!)!)).toBeGreaterThan(contrast(parseHex(n.onSurfaceVariant!)!, parseHex(n.surface!)!));
  });
  it("gradient end is a real color", () => { expect(gradientEnd("#a05cf0", "dark")).toMatch(/^#[0-9a-f]{6}$/); });
});

describe("synced soundboard links", () => {
  it("keeps https links and clamps clips to 10 seconds", () => {
    const s = sanitize({ ...DEFAULT_SETTINGS, sounds: [
      { id: "a", url: "https://x.example/a.mp3", name: "Boom", emoji: "💥", start: 2, end: 30, volume: 3 },
      { id: "b", url: "http://x.example/b.mp3" },
      { id: "c", url: "javascript:alert(1)" },
    ] });
    expect(s.sounds).toHaveLength(1);
    expect(s.sounds[0]).toMatchObject({ start: 2, end: 12, volume: 1 });
  });
});

describe("emoji names", () => {
  it("finds emoji in text and names them", () => {
    expect("hi 🔥 and 👍🏽 ok".match(EMOJI_RE)).toEqual(["🔥", "👍🏽"]);
    expect(emojiName("🔥")).toBe("fire");
    expect(emojiName("❤️")).toBe("heart");
  });
});
