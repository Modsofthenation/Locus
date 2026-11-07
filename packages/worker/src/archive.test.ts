import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archiveMemberUnsafe,
  packDirectory,
  unpackDirectory,
  safeWorkerSessionId,
} from "./archive.js";

describe("worker archive", () => {
  it("round-trips a directory tree", async () => {
    const src = await mkdtemp(join(tmpdir(), "locus-seed-src-"));
    const dest = await mkdtemp(join(tmpdir(), "locus-seed-dest-"));
    await mkdir(join(src, "src"), { recursive: true });
    await writeFile(join(src, "src", "hi.ts"), "export const n = 1;\n");
    await writeFile(join(src, "README.md"), "hello\n");
    const packed = await packDirectory(src);
    expect(packed.length).toBeGreaterThan(20);
    await unpackDirectory(packed, dest);
    expect(await readFile(join(dest, "README.md"), "utf8")).toBe("hello\n");
    expect(await readFile(join(dest, "src", "hi.ts"), "utf8")).toBe("export const n = 1;\n");
  });

  it("rejects unsafe session ids", () => {
    expect(safeWorkerSessionId("sess-1")).toBe("sess-1");
    expect(safeWorkerSessionId("../etc")).toBeUndefined();
    expect(safeWorkerSessionId("a/b")).toBeUndefined();
  });

  it("rejects archive members that escape the destination", () => {
    expect(archiveMemberUnsafe("src/ok.ts")).toBe(false);
    expect(archiveMemberUnsafe("./src/ok.ts")).toBe(false);
    expect(archiveMemberUnsafe("../etc/passwd")).toBe(true);
    expect(archiveMemberUnsafe("/etc/passwd")).toBe(true);
    expect(archiveMemberUnsafe("foo/../../etc/passwd")).toBe(true);
  });
});
