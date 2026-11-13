import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  UpdateChecker,
  checkGithubRelease,
  downloadAndVerifyUpdate,
  githubReleaseToUpdate,
} from "./updates.js";

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
    {
      name: "SHA256SUMS-linux",
      browser_download_url: "https://example/SHA256SUMS-linux",
    },
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
    expect(update.checksums).toEqual({
      name: "SHA256SUMS-linux",
      url: "https://example/SHA256SUMS-linux",
    });
  });

  it("downloads an installer only when SHA-256 matches SHA256SUMS", async () => {
    const bytes = Buffer.from("installer");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const dir = await mkdtemp(join(tmpdir(), "locus-update-"));
    const result = await downloadAndVerifyUpdate({
      asset: { name: "Locus.AppImage", url: "https://example/Locus.AppImage" },
      checksums: { name: "SHA256SUMS-linux", url: "https://example/SHA256SUMS-linux" },
      destDir: dir,
      fetchFn: (async (input) => {
        const url = String(input);
        if (url.endsWith("SHA256SUMS-linux")) {
          return new Response(`${sha}  Locus.AppImage\n`, { status: 200 });
        }
        return new Response(bytes, { status: 200 });
      }) as typeof fetch,
    });
    expect(result.verified).toBe(true);
    expect(result.sha256).toBe(sha);
    expect(await readFile(result.path)).toEqual(bytes);
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

describe("UpdateChecker", () => {
  it("serves repeat checks from cache for an hour and refreshes on demand", async () => {
    let calls = 0;
    let now = 1_000_000;
    const checker = new UpdateChecker(
      async ({ current }) => {
        calls += 1;
        return { status: "up-to-date" as const, current, latest: "v0.20.0" };
      },
      () => now,
    );
    await checker.get({ current: "0.20.0", platform: "linux" });
    await checker.get({ current: "0.20.0", platform: "linux" });
    expect(calls).toBe(1);
    await checker.get({ current: "0.20.0", platform: "linux", refresh: true });
    expect(calls).toBe(2);
    now += 61 * 60 * 1000;
    const fresh = await checker.get({ current: "0.20.0", platform: "linux" });
    expect(calls).toBe(3);
    expect(fresh.checkedAt).toBe(new Date(now).toISOString());
  });

  it("retries an unavailable result after ten minutes", async () => {
    let calls = 0;
    let now = 0;
    const checker = new UpdateChecker(
      async ({ current }) => {
        calls += 1;
        return { status: "unavailable" as const, current, message: "offline" };
      },
      () => now,
    );
    await checker.get({ current: "0.20.0", platform: "linux" });
    now += 5 * 60 * 1000;
    await checker.get({ current: "0.20.0", platform: "linux" });
    expect(calls).toBe(1);
    now += 6 * 60 * 1000;
    await checker.get({ current: "0.20.0", platform: "linux" });
    expect(calls).toBe(2);
  });
});
