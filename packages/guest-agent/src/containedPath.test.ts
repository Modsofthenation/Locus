import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { containedPath, ensureParentInside } from "./containedPath.js";

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) =>
      rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }).catch(() => undefined),
    ),
  );
  cleanup = [];
});

describe("containedPath", () => {
  it.skipIf(process.platform === "win32")(
    "returns the real path inside the root and refuses a symlink out",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-contain-"));
      cleanup.push(dir);
      await writeFile(join(dir, "note.md"), "ok");
      await symlink("/etc/passwd", join(dir, "secret.md"));
      expect(await containedPath(dir, join(dir, "note.md"))).toBe(
        await realpath(join(dir, "note.md")),
      );
      expect(await containedPath(dir, join(dir, "secret.md"))).toBeUndefined();
    },
  );
});

describe("ensureParentInside", () => {
  it.skipIf(process.platform === "win32")(
    "creates nested parents and refuses a directory symlink out",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-parent-"));
      const outside = await mkdtemp(join(tmpdir(), "locus-parent-out-"));
      cleanup.push(dir, outside);
      expect(await ensureParentInside(dir, "src/app.ts")).toBe(join(await realpath(dir), "src"));
      await symlink(outside, join(dir, "src", "leak"));
      expect(await ensureParentInside(dir, "src/leak/pwn.txt")).toBeUndefined();
      expect(await readFile(join(outside, "pwn.txt"), "utf8").catch(() => "missing")).toBe(
        "missing",
      );
    },
  );
});
