import { describe, expect, it } from "vitest";
import { linkCards, linksIn, socialLinks } from "./social";

type E = { url?: string; kind: string; title?: string; image?: unknown; video?: unknown; gif?: boolean };
const site = (url: string, extra: Partial<E> = {}): E => ({ kind: "website", url, title: "Post", image: { url: "https://cdn/x.jpg" }, ...extra });

describe("links in a message", () => {
  it("never takes the spoiler marks into the link", () => {
    expect(linksIn("||https://kkinstagram.com/reel/AbC1/||")).toEqual([{ url: "https://kkinstagram.com/reel/AbC1/", spoiler: true, noEmbed: false }]);
    expect(socialLinks("||https://tnktok.com/@a/video/123||")).toEqual(["https://tnktok.com/@a/video/123"]);
  });
  it("marks a link spoilered if any copy of it is", () => {
    expect(linksIn("https://example.com/a ||https://example.com/a/||").map((l) => l.spoiler)).toEqual([true]);
  });
  it("skips links in code and knows <link> has no preview", () => {
    expect(linksIn("`https://a.com/x` <https://b.com/y>")).toEqual([{ url: "https://b.com/y", spoiler: false, noEmbed: true }]);
  });
});

describe("one card per link", () => {
  it("a spoilered kkinstagram reel: one card, covered, even with two Stoat cards", () => {
    const u = "https://kkinstagram.com/reel/AbC1/";
    const cards = linkCards(`||${u}||`, [{ kind: "image", url: u, image: {} }, site("https://www.instagram.com/seblan01/reel/AbC1/")]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "social", url: u, spoiler: true });
  });
  it("a picture Stoat got from a mirror's redirect belongs to the link", () => {
    const cards = linkCards("||https://tnktok.com/@a/video/123||", [{ kind: "image", url: "https://cdn.tnktok.com/thumb.jpg", image: {} }]);
    expect(cards).toEqual([expect.objectContaining({ kind: "social", spoiler: true })]);
  });
  it("tumblr blog links and tumblr.com links are the same post", () => {
    const cards = linkCards("https://staff.tumblr.com/post/7654321098/hello", [site("https://www.tumblr.com/staff/7654321098/hello", { video: {} })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.kind).toBe("embed");
  });
  it("the same embed sent twice (after an edit) shows once", () => {
    const u = "https://example.com/page";
    expect(linkCards(u, [site(u), site(u)])).toHaveLength(1);
  });
  it("a Stoat card with a video is kept instead of Mustela's own", () => {
    const u = "https://fxtwitter.com/a/status/1";
    expect(linkCards(u, [site(u, { video: {} })])).toEqual([expect.objectContaining({ kind: "embed", spoiler: false })]);
  });
  it("skips empty site-name-only cards and invite links", () => {
    expect(linkCards("https://example.com/a", [{ kind: "website", url: "https://example.com/a" }])).toEqual([]);
    expect(linkCards("https://stt.gg/abcd", [site("https://stt.gg/abcd")], (u) => u.includes("stt.gg"))).toEqual([]);
  });
  it("cards of a spoilered message that match no link stay covered", () => {
    expect(linkCards("||https://a.com/x||", [{ kind: "image", url: "https://a.com/x", image: {} }, { kind: "image", image: {} }]).map((c) => c.spoiler)).toEqual([true, true]);
  });
});
