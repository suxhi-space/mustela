import { describe, expect, it } from "vitest";
import { ulid, ulidBefore } from "./ulid";

describe("ulidBefore", () => {
  it("sorts just before the message, so it reads as unread", () => {
    const id = ulid(1_730_000_000_000);
    const before = ulidBefore(id);
    expect(before < id).toBe(true);
    expect(before.length).toBe(26);
    expect(before.slice(0, 10)).toBe(ulid(1_730_000_000_000 - 1).slice(0, 10));
    // and after anything from the millisecond before that
    expect(ulid(1_730_000_000_000 - 2) < before).toBe(true);
  });
});
