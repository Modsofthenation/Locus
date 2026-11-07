import { createServer, type Server } from "node:http";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLOUD_IMAGE_CATALOG } from "@locus/shared";
import {
  downloadConnectOptions,
  downloadToFile,
  fetchCloudImage,
  wrapDownloadError,
} from "./media.js";

const dirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => void,
): Promise<{ url: string; port: number }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

describe("cloud image download", () => {
  it("follows redirects and writes the file", async () => {
    const payload = Buffer.from("cloudimg");
    const { url } = await listen((req, res) => {
      if (req.url === "/release/ubuntu.img") {
        res.writeHead(302, { location: "/noble/ubuntu.img" });
        res.end();
        return;
      }
      expect(req.headers["user-agent"]).toMatch(/^Locus\//);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(payload);
    });
    const dir = await mkdtemp(join(tmpdir(), "locus-media-"));
    dirs.push(dir);
    const dest = join(dir, "ubuntu.img");
    await downloadToFile(`${url}/release/ubuntu.img`, dest);
    expect(await readFile(dest)).toEqual(payload);
    if (process.platform !== "win32") expect((await stat(dest)).mode & 0o777).toBe(0o600);
  });

  it("surfaces HTTP errors instead of fetch failed", async () => {
    const { url } = await listen((_req, res) => {
      res.writeHead(404);
      res.end("missing");
    });
    const dir = await mkdtemp(join(tmpdir(), "locus-media-"));
    dirs.push(dir);
    const dest = join(dir, "x.img");
    await expect(downloadToFile(`${url}/missing.img`, dest)).rejects.toThrow(
      /Download failed: HTTP 404/,
    );
    await expect(access(`${dest}.part`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not clobber an existing image when a later fetch fails", async () => {
    const { url } = await listen((_req, res) => {
      res.writeHead(500);
      res.end("nope");
    });
    const dir = await mkdtemp(join(tmpdir(), "locus-media-"));
    dirs.push(dir);
    const dest = join(dir, "ubuntu.img");
    await writeFile(dest, "keep-me");
    await expect(downloadToFile(`${url}/ubuntu.img`, dest)).rejects.toThrow(
      /Download failed: HTTP 500/,
    );
    expect(await readFile(dest, "utf8")).toBe("keep-me");
    await expect(access(`${dest}.part`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("includes the syscall code when the connection fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-media-"));
    dirs.push(dir);
    await expect(
      downloadToFile("http://127.0.0.1:1/ubuntu.img", join(dir, "x.img")),
    ).rejects.toThrow(/Download failed: ECONNREFUSED/);
  });

  it("wraps undici's fetch failed with the cause code", () => {
    const cause = Object.assign(new Error("connect ENETUNREACH"), { code: "ENETUNREACH" });
    const err = Object.assign(new TypeError("fetch failed"), { cause });
    expect(wrapDownloadError(err).message).toBe("Download failed: ENETUNREACH: fetch failed");
  });

  it("pins IPv4 and disables Happy Eyeballs on the first attempt", () => {
    expect(downloadConnectOptions(4)).toMatchObject({
      family: 4,
      autoSelectFamily: false,
    });
    expect(downloadConnectOptions(6)).toMatchObject({
      family: 6,
      autoSelectFamily: false,
    });
  });

  it("downloads via IPv4 when localhost also has an AAAA record", async () => {
    const payload = Buffer.from("v4-only");
    const { port } = await listen((_req, res) => {
      res.writeHead(200);
      res.end(payload);
    });
    const dir = await mkdtemp(join(tmpdir(), "locus-media-"));
    dirs.push(dir);
    const dest = join(dir, "ubuntu.img");
    await downloadToFile(`http://localhost:${port}/ubuntu.img`, dest);
    expect(await readFile(dest)).toEqual(payload);
  });

  it("saves a catalog image through fetchCloudImage", async () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const { url } = await listen((_req, res) => {
      res.writeHead(200);
      res.end(payload);
    });
    const item = CLOUD_IMAGE_CATALOG.find((c) => c.os === "ubuntu");
    expect(item).toBeTruthy();
    const previous = item!.url;
    item!.url = `${url}/ubuntu-24.04-server-cloudimg-amd64.img`;
    const dir = await mkdtemp(join(tmpdir(), "locus-media-"));
    dirs.push(dir);
    try {
      const downloaded = await fetchCloudImage(dir, "ubuntu");
      expect(downloaded.path).toContain("ubuntu-24.04-server-cloudimg-amd64.img");
      expect(await readFile(downloaded.path)).toEqual(payload);
    } finally {
      item!.url = previous;
    }
  });
});
