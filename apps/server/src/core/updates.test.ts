import { describe, expect, it } from "vitest";
import { checkGithubRelease, githubReleaseToUpdate } from "./updates.js";

const release = {
  tag_name: "v0.4.3",
  name: "0.4.3",
  body: "Fixes",
  html_url: "https://github.com/Modsofthenation/Locus/releases/tag/v0.4.3",
  assets: [
    {
      name: "Locus-0.4.3.AppImage",
      browser_download_url: "https://example/Locus-0.4.3.AppImage",
    },
    { name: "Locus-0.4.3.dmg", browser_download_url: "https://example/Locus-0.4.3.dmg" },
  ],
};

describe("githubReleaseToUpdate", () => {
  it("reports an available Linux AppImage", () => {
    const update = githubReleaseToUpdate("0.4.2", "linux", release);
    expect(update.status).toBe("available");
    expect(update.latest).toBe("v0.4.3");
    expect(update.asset).toEqual({
      name: "Locus-0.4.3.AppImage",
      url: "https://example/Locus-0.4.3.AppImage",
    });
  });

  it("reports up-to-date when the tag matches", () => {
    expect(githubReleaseToUpdate("0.4.3", "darwin", release).status).toBe("up-to-date");
    expect(githubReleaseToUpdate("v0.4.3", "darwin", release).asset?.name).toBe("Locus-0.4.3.dmg");
  });
});

describe("checkGithubRelease", () => {
  it("explains a missing latest release", async () => {
    const update = await checkGithubRelease({
      current: "0.4.2",
      platform: "linux",
      fetchFn: (async () => new Response("Not Found", { status: 404 })) as typeof fetch,
    });
    expect(update.status).toBe("unavailable");
    expect(update.message).toMatch(/no GitHub release found/i);
  });

  it("returns the parsed latest release", async () => {
    const update = await checkGithubRelease({
      current: "0.4.2",
      platform: "darwin",
      fetchFn: (async () =>
        new Response(JSON.stringify(release), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch,
    });
    expect(update.status).toBe("available");
    expect(update.asset?.name).toBe("Locus-0.4.3.dmg");
  });
});
