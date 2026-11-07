import { describe, expect, it } from "vitest";
import { parseGiphyHit, searchGifCatalog } from "./slackGif.js";

describe("GIF catalog search", () => {
  it("matches common Slack GIF queries that titles alone miss", () => {
    expect(searchGifCatalog("dog").map((row) => row.title)).toContain("Dog");
    expect(searchGifCatalog("lol").length).toBeGreaterThan(0);
    expect(searchGifCatalog("yes").length).toBeGreaterThan(0);
    expect(searchGifCatalog("thanks").map((row) => row.title)).toContain("Thank you");
    expect(searchGifCatalog("thumbs")[0]?.preview).toMatch(/giphy\.gif$/);
    expect(searchGifCatalog("xyzzy-not-a-gif")).toEqual([]);
  });

  it("returns the catalog for an empty query", () => {
    expect(searchGifCatalog("").length).toBeGreaterThan(8);
  });
});

describe("parseGiphyHit", () => {
  it("prefers a Slack-safe downsized GIF over original mp4", () => {
    const hit = parseGiphyHit({
      id: "abc",
      title: "Excited dog",
      images: {
        original: {
          url: "https://media.giphy.com/media/abc/giphy.mp4",
          mp4: "https://media.giphy.com/media/abc/giphy.mp4",
        },
        downsized: { url: "https://media.giphy.com/media/abc/giphy-downsized.gif" },
        fixed_height_small: { url: "https://media.giphy.com/media/abc/100.gif" },
      },
    });
    expect(hit).toEqual({
      id: "abc",
      title: "Excited dog",
      url: "https://media.giphy.com/media/abc/giphy-downsized.gif",
      preview: "https://media.giphy.com/media/abc/100.gif",
    });
  });

  it("skips hits that only have video renditions", () => {
    expect(
      parseGiphyHit({
        id: "vid",
        title: "clip",
        images: { original: { url: "https://media.giphy.com/media/vid/giphy.mp4" } },
      }),
    ).toBeUndefined();
  });

  it("does not use an MP4 as the picker preview", () => {
    const hit = parseGiphyHit({
      id: "mix",
      title: "mix",
      images: {
        original: { url: "https://media.giphy.com/media/mix/giphy.gif" },
        fixed_height_small: { url: "https://media.giphy.com/media/mix/200.mp4" },
      },
    });
    expect(hit?.preview).toBe("https://media.giphy.com/media/mix/giphy.gif");
  });
});
