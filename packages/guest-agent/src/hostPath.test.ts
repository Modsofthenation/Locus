import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lexicalHostPath, resolveReadPath, resolveWritePath } from "./hostPath.js";

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.map((d) => rm(d, { recursive: true, force: true })));
  cleanup = [];
});

describe("lexicalHostPath", () => {
  it("maps /workspace files and rejects traversal", () => {
    const root = "/tmp/ws";
    expect(lexicalHostPath("/workspace", root)).toBe(root);
    expect(lexicalHostPath("/workspace/src/a.ts", root)).toBe(join(root, "src", "a.ts"));
    expect(lexicalHostPath("/workspace/../etc/passwd", root)).toBeUndefined();
    expect(lexicalHostPath("/workspace/foo/../../etc/passwd", root)).toBeUndefined();
    expect(lexicalHostPath("/etc/passwd", root)).toBeUndefined();
  });
});

describe("resolveWritePath / resolveReadPath", () => {
  it.skipIf(process.platform === "win32")("refuses .. and symlink escape on write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-hostpath-"));
    const outside = await mkdtemp(join(tmpdir(), "locus-hostpath-out-"));
    cleanup.push(dir, outside);
    await writeFile(join(outside, "secret.txt"), "nope");
    await mkdir(join(dir, "src"), { recursive: true });
    await symlink(outside, join(dir, "leak"));
    expect(await resolveWritePath("/workspace/../secret.txt", dir)).toBeUndefined();
    expect(await resolveWritePath("/workspace/leak/secret.txt", dir)).toBeUndefined();
    expect(await resolveReadPath("/workspace/leak/secret.txt", dir)).toBeUndefined();
    const dest = await resolveWritePath("/workspace/src/a.ts", dir);
    expect(dest).toBe(join(dir, "src", "a.ts"));
    await writeFile(dest!, "ok");
    expect(await readFile(join(dir, "src", "a.ts"), "utf8")).toBe("ok");
  });
});
