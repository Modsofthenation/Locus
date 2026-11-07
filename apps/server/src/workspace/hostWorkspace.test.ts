import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  browseDiskImages,
  browseHostDir,
  blockedHostDirReason,
  hostSaveFileName,
  resolveHostDir,
  resolveOptionalHostDir,
  saveHostFile,
} from "./hostWorkspace.js";

describe("host workspace folder", () => {
  it("resolves an existing absolute directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-dir-"));
    await expect(resolveHostDir(`  ${dir}  `)).resolves.toBe(await resolveHostDir(dir));
    await expect(resolveOptionalHostDir("")).resolves.toBeUndefined();
    await expect(resolveOptionalHostDir("   ")).resolves.toBeUndefined();
    await expect(resolveOptionalHostDir(dir)).resolves.toBe(await resolveHostDir(dir));
  });

  it("rejects relative, missing, and file paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-bad-"));
    const file = join(dir, "note.txt");
    await writeFile(file, "nope");
    await expect(resolveHostDir("relative/path")).rejects.toThrow(/absolute path/);
    await expect(resolveHostDir(join(dir, "missing"))).rejects.toThrow(/does not exist/);
    await expect(resolveHostDir(file)).rejects.toThrow(/not a directory/);
    await expect(resolveHostDir("/")).rejects.toThrow(/filesystem root/);
    await expect(resolveHostDir(homedir())).rejects.toThrow(/home directory/);
    const ssh = join(homedir(), ".ssh");
    expect(blockedHostDirReason(ssh)).toMatch(/\.ssh/);
    expect(blockedHostDirReason(dir, dir)).toMatch(/data directory/);
  });

  it("lists child folders and a parent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-browse-"));
    await mkdir(join(dir, "src"));
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "readme.md"), "hi");
    const listing = await browseHostDir(dir);
    expect(listing.path).toBe(await resolveHostDir(dir));
    expect(listing.parent).toBeTruthy();
    expect(listing.entries.map((row) => row.name)).toEqual(["docs", "src"]);
    expect(listing.entries.every((row) => row.kind === "dir")).toBe(true);
  });

  it("lists disk images and folders from the media directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "locus-image-browse-"));
    const media = join(dataDir, "media");
    await mkdir(media);
    await mkdir(join(media, "other"));
    await writeFile(join(media, "ubuntu.img"), "disk");
    await writeFile(join(media, "notes.txt"), "skip");
    const listing = await browseDiskImages(undefined, dataDir);
    expect(listing.path).toBe(media);
    expect(listing.entries).toEqual([
      { name: "other", path: join(media, "other"), kind: "dir" },
      { name: "ubuntu.img", path: join(media, "ubuntu.img"), kind: "file" },
    ]);
  });

  it("writes an exported file into an allowed folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-save-"));
    expect(hostSaveFileName("hero.stl")).toBe("hero.stl");
    expect(() => hostSaveFileName("../hero.stl")).toThrow(/path/);
    const saved = await saveHostFile({
      dir,
      filename: "hero.stl",
      contentBase64: Buffer.from("solid mesh\n", "utf8").toString("base64"),
    });
    expect(saved.path).toBe(join(await resolveHostDir(dir), "hero.stl"));
    expect(saved.bytes).toBe(11);
    expect(await readFile(saved.path, "utf8")).toBe("solid mesh\n");
    await expect(
      saveHostFile({
        dir,
        filename: "../escape.stl",
        contentBase64: Buffer.from("nope").toString("base64"),
      }),
    ).rejects.toThrow(/path/);
    await expect(saveHostFile({ dir, filename: "empty.stl", contentBase64: "" })).rejects.toThrow(
      /empty/,
    );
  });
});
