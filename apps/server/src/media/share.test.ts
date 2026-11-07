import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachmentFilename, listShareFiles, shareDest } from "./share.js";

describe("shareDest", () => {
  it("keeps uploads inside the share root", () => {
    expect(shareDest("/data/share", "notes.txt")).toBe(resolve("/data/share", "notes.txt"));
    expect(shareDest("/data/share", "dir/notes.txt")).toBe(resolve("/data/share", "notes.txt"));
    expect(shareDest("/data/share", "../escape.txt")).toBe(resolve("/data/share", "escape.txt"));
    expect(() => shareDest("/data/share", "..")).toThrow("Invalid filename");
    expect(() => shareDest("/data/share", ".")).toThrow("Invalid filename");
  });
});

describe("listShareFiles", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("lists regular files and skips directories", async () => {
    expect(await listShareFiles("/tmp/locus-missing-share")).toEqual([]);
    const dir = await mkdtemp(join(tmpdir(), "locus-share-"));
    dirs.push(dir);
    await writeFile(join(dir, "b.txt"), "bb");
    await writeFile(join(dir, "a.txt"), "a");
    await mkdir(join(dir, "subdir"));
    const files = await listShareFiles(dir);
    expect(files.map((f) => f.name)).toEqual(["a.txt", "b.txt"]);
    expect(files[0]?.guestPath).toBe("/mnt/host/a.txt");
    expect(files[0]?.size).toBe(1);
    expect((await listShareFiles(dir, "windows-11"))[0]?.guestPath).toBe("C:\\host\\a.txt");
  });
});

describe("attachmentFilename", () => {
  it("strips quotes from Content-Disposition names", () => {
    expect(attachmentFilename('evil".txt')).toBe("evil_.txt");
    expect(attachmentFilename("ok.txt")).toBe("ok.txt");
  });
});
