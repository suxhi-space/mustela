import { describe, expect, it } from "vitest";
import { sameEmbed, socialLinks, videoSite } from "./social";

describe("social links", () => {
  it("spots the sites and their embed mirrors", () => {
    expect(socialLinks("look https://www.xfuraffinity.net/view/66547325/ and https://www.kkinstagram.com/reel/De0cudiRIbE/.")).toEqual([
      "https://www.xfuraffinity.net/view/66547325/", "https://www.kkinstagram.com/reel/De0cudiRIbE/",
    ]);
    expect(socialLinks("https://staff.tumblr.com/post/1 https://example.com/a https://x.com/")).toEqual(["https://staff.tumblr.com/post/1"]);
  });
  it("knows which are video sites", () => {
    expect(videoSite("https://vxtwitter.com/a/status/1")).toBe(true);
    expect(videoSite("https://rxddit.com/r/a/comments/1")).toBe(true);
    expect(videoSite("https://www.furaffinity.net/view/1/")).toBe(false);
  });
});

import { samePost } from "./social";
describe("same post", () => {
  it("matches across mirrors", () => {
    expect(samePost("https://www.xfuraffinity.net/view/66547325/", "https://www.furaffinity.net/view/66547325")).toBe(true);
    expect(samePost("https://kkinstagram.com/reel/A/", "https://www.instagram.com/reel/A/")).toBe(true);
    expect(samePost("https://x.com/a/status/1", "https://x.com/a/status/2")).toBe(false);
    expect(sameEmbed("https://vxinstagram.com/reel/AbC/", "https://www.instagram.com/reel/AbC")).toBe(true);
    expect(sameEmbed("https://example.com/reel/AbC", "https://www.instagram.com/reel/AbC")).toBe(false);
  });
  it("previews one card when the same reel is pasted twice", () => {
    expect(socialLinks("https://www.instagram.com/reel/AbC/ https://www.vxinstagram.com/reel/AbC/")).toEqual([
      "https://www.instagram.com/reel/AbC/",
    ]);
  });
});
