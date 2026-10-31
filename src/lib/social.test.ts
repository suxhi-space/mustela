import { describe, expect, it } from "vitest";
import { socialLinks, videoSite } from "./social";

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
  });
});
