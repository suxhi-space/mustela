import { describe, expect, it } from "vitest";
import { formatTime, inline, isJumbo, parse, plain, safeHref } from "./markdown";

const U = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

describe("inline markdown", () => {
  it("treats @everyone and @online as mentions, but not inside words or emails", () => {
    const nodes = (t: string) => (parse(t)[0] as { c: { t: string; v?: string }[] }).c;
    expect(nodes("@everyone hi").map((n) => n.t)).toEqual(["mass", "text"]);
    expect(nodes("hey @online")[1]).toEqual({ t: "mass", v: "online" });
    expect(nodes("me@everyone.com").every((n) => n.t === "text")).toBe(true);
    expect(nodes("@everyones").every((n) => n.t === "text")).toBe(true);
    expect(plain("@everyone look")).toBe("@everyone look");
  });

  it("reads GitHub-style embeds: #### headings and links with [brackets] in their text", () => {
    const b = parse("#### [[owner/repo] New comment on issue #60](https://github.com/owner/repo/issues/60)\nbody");
    expect(b[0]).toMatchObject({ t: "h", level: 3 });
    const link = (b[0] as { c: { t: string; href?: string }[] }).c[0]!;
    expect(link).toMatchObject({ t: "link", href: "https://github.com/owner/repo/issues/60" });
    expect(plain("#### [[a] b](https://x.y)")).toBe("[a] b");
  });

  it("parses emphasis, strike, spoiler and code", () => {
    expect(inline("**b** *i* ~~s~~ ||x|| `c`")).toEqual([
      { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " },
      { t: "i", c: [{ t: "text", v: "i" }] }, { t: "text", v: " " },
      { t: "s", c: [{ t: "text", v: "s" }] }, { t: "text", v: " " },
      { t: "spoiler", c: [{ t: "text", v: "x" }] }, { t: "text", v: " " },
      { t: "code", v: "c" },
    ]);
  });
  it("nests bold inside italic and leaves code untouched", () => {
    expect(inline("*a **b** c*")).toEqual([{ t: "i", c: [{ t: "text", v: "a " }, { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }] }]);
    expect(inline("`**not bold**`")).toEqual([{ t: "code", v: "**not bold**" }]);
  });
  it("does not treat snake_case or lone asterisks as emphasis", () => {
    expect(inline("snake_case_name and 2 * 3 * 4")).toEqual([{ t: "text", v: "snake_case_name and 2 * 3 * 4" }]);
  });
  it("keeps unmatched delimiters as text", () => {
    expect(inline("**open")).toEqual([{ t: "text", v: "**open" }]);
  });
  it("parses mentions, custom emoji, shortcodes and timestamps", () => {
    expect(inline(`<@${U}> <#${U}> <%${U}> :${U}: :fire: <t:0:R>`)).toEqual([
      { t: "user", id: U }, { t: "text", v: " " }, { t: "channel", id: U }, { t: "text", v: " " },
      { t: "role", id: U }, { t: "text", v: " " }, { t: "emoji", id: U }, { t: "text", v: " 🔥 " },
      { t: "time", unix: 0, style: "R" },
    ]);
  });
  it("links: only safe schemes, trailing punctuation stays outside", () => {
    expect(inline("see https://a.dev/x.")).toEqual([{ t: "text", v: "see " }, { t: "link", href: "https://a.dev/x", c: [{ t: "text", v: "https://a.dev/x" }] }, { t: "text", v: "." }]);
    expect(inline("[w](https://en.wikipedia.org/wiki/A_(b))")[0]).toMatchObject({ t: "link", href: "https://en.wikipedia.org/wiki/A_(b)" });
    expect(inline("(https://a.dev/p)")).toEqual([{ t: "text", v: "(" }, { t: "link", href: "https://a.dev/p", c: [{ t: "text", v: "https://a.dev/p" }] }, { t: "text", v: ")" }]);
    expect(inline("[click](javascript:alert(1))")).toEqual([{ t: "text", v: "[click](javascript:alert(1))" }]);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });
  it("supports escapes and line breaks", () => {
    expect(inline("\\*not\\*\nnext")).toEqual([{ t: "text", v: "*not*" }, { t: "br" }, { t: "text", v: "next" }]);
  });
  it("is bounded on hostile nesting", () => {
    const deep = "*".repeat(2000) + "x" + "*".repeat(2000);
    expect(() => inline(deep)).not.toThrow();
    const brackets = "[".repeat(3000);
    expect(() => parse(brackets)).not.toThrow();
  });
});

describe("blocks", () => {
  it("parses code fences, quotes, headings and lists", () => {
    const b = parse("# Title\n> quoted\n> more\n```ts\nlet a = 1;\n```\n- one\n- two\n1. first\npara");
    expect(b.map((x) => x.t)).toEqual(["h", "quote", "pre", "list", "list", "p"]);
    expect(b[2]).toEqual({ t: "pre", lang: "ts", v: "let a = 1;" });
    expect((b[3] as any).items.length).toBe(2);
    expect((b[4] as any).ordered).toBe(true);
  });
  it("an unclosed fence is plain text", () => {
    expect(parse("```\nno end")[0]!.t).toBe("p");
  });
  it("single-line code block", () => {
    expect(parse("```inline```")[0]).toEqual({ t: "pre", lang: "", v: "inline" });
  });
});

describe("helpers", () => {
  it("jumbo only for short emoji-only messages", () => {
    expect(isJumbo("🔥🔥")).toBe(true);
    expect(isJumbo(`:${U}: :fire:`)).toBe(true);
    expect(isJumbo("hi 🔥")).toBe(false);
    expect(isJumbo(":notanemoji:")).toBe(false);
    expect(isJumbo("🔥".repeat(30))).toBe(false);
  });
  it("plain text strips markup and resolves names", () => {
    expect(plain(`**hey** <@${U}> ||secret||`, { user: () => "Mika" })).toBe("hey @Mika ▒▒▒");
  });
  it("relative time", () => {
    expect(formatTime(0, "R", 120_000)).toMatch(/2 minutes ago/);
    expect(formatTime(Number.NaN, "R")).toBe("Invalid date");
  });
});
