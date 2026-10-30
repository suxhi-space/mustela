import { describe, expect, it } from "vitest";
import { inviteFromLink } from "../lib/invite";

describe("invite links", () => {
  it("finds the code in Stoat's invite links", () => {
    expect(inviteFromLink("https://stt.gg/AbCd1234")).toBe("AbCd1234");
    expect(inviteFromLink("https://stoat.chat/invite/AbCd1234/")).toBe("AbCd1234");
    expect(inviteFromLink("https://app.stoat.chat/invite/xyz123")).toBe("xyz123");
    expect(inviteFromLink("mustela://invite/AbCd1234")).toBe("AbCd1234");
  });
  it("ignores everything else", () => {
    expect(inviteFromLink("https://stt.gg/discover")).toBeNull();
    expect(inviteFromLink("https://example.com/AbCd1234")).toBeNull();
    expect(inviteFromLink("https://stoat.chat/pricing")).toBeNull();
  });
});
