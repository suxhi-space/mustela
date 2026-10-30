import { describe, expect, it } from "vitest";
import { completionToken } from "./complete";
import { CHIP_RE, codeSpans } from "./complete";

describe("completionToken", () => {
  it("finds what's being completed at the caret", () => {
    expect(completionToken("hi @mi")).toEqual({ sigil: "@", q: "mi", start: 3 });
    expect(completionToken("see #")).toEqual({ sigil: "#", q: "", start: 4 });
    expect(completionToken(":fi")).toEqual({ sigil: ":", q: "fi", start: 0 });
    expect(completionToken("ping %mod")).toEqual({ sigil: "%", q: "mod", start: 5 });
  });
  it("leaves ordinary text alone", () => {
    expect(completionToken("time 10:3")).toBeNull(); // no space before the colon
    expect(completionToken("a: b")).toBeNull();
    expect(completionToken("mail me@home")).toBeNull();
    expect(completionToken("word :x")).toBeNull(); // emoji need two letters
  });
});

describe("chips", () => {
  const ids = (s: string) => [...s.matchAll(CHIP_RE)].map((m) => m[0]);
  it("matches mentions, channels, roles, emoji and message links", () => {
    const u = "01HZY3K8Q2N5X7V9B1C3D5F7G9";
    expect(ids(`<@${u}> <#${u}> <%${u}> :${u}: https://stoat.chat/server/${u}/channel/${u}/${u}`)).toHaveLength(5);
    expect(ids("<@nope with space> :notanid:")).toHaveLength(0);
  });
  it("knows where code is, so chips aren't drawn inside it", () => {
    expect(codeSpans("a `<@x>` b")).toEqual([[2, 8]]);
    expect(codeSpans("```\n<@x>\n```")).toEqual([[0, 12]]);
  });
});
