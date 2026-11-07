import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  buildGrepIndex,
  candidateFileIds,
  containedGrepPath,
  ensureGrepIndex,
  grepIndexedWorkspace,
  grepLiterals,
  hostGrepPath,
  isOpenGrepPattern,
  parsePorcelainZ,
  trigrams,
} from "./grepIndex.js";
import { resetRipgrepCache } from "./workspaceGrep.js";

const execFileAsync = promisify(execFile);
const cleanup: string[] = [];

function ripgrepInstalled(): boolean {
  const probe = spawnSync("rg", ["--version"], { timeout: 2000, encoding: "utf8" });
  return probe.status === 0;
}

const HAS_RG = ripgrepInstalled();
if (process.env.CI && !HAS_RG) {
  throw new Error("ripgrep (rg) is required in CI for Instant Grep tests");
}

afterEach(async () => {
  resetRipgrepCache();
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "locus-grep-idx-"));
  cleanup.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(
    join(root, "src", "fold.ts"),
    "export function foldOldTurns() {\n  return 2;\n}\n",
  );
  await writeFile(join(root, "src", "other.ts"), "export function other() {\n  return 1;\n}\n");
  await writeFile(join(root, "docs", "notes.md"), "TODO ship the grep index\nFIXME later\n");
  for (let i = 0; i < 40; i += 1) {
    await writeFile(join(root, "src", `n${i}.ts`), `export const n${i} = ${i};\n`);
  }
  const cacheDir = join(root, ".locus-index");
  const paths = [
    "src/fold.ts",
    "src/other.ts",
    "docs/notes.md",
    ...Array.from({ length: 40 }, (_, i) => `src/n${i}.ts`),
  ];
  await execFileAsync("git", ["-C", root, "init"]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Test"]);
  await execFileAsync("git", ["-C", root, "add", "-A"]);
  await execFileAsync("git", ["-C", root, "commit", "-m", "init", "--no-gpg-sign"]);
  const index = await buildGrepIndex(root, cacheDir, paths);
  return { root, cacheDir, index };
}

describe("grep index", () => {
  it("treats open regex as a full-scan fallback", () => {
    expect(isOpenGrepPattern(".*")).toBe(true);
    expect(isOpenGrepPattern(".+")).toBe(true);
    expect(isOpenGrepPattern("foldOldTurns")).toBe(false);
    expect(isOpenGrepPattern("TODO|FIXME")).toBe(false);
    expect(grepLiterals("TODO|FIXME")).toEqual(["TODO", "FIXME"]);
    expect(trigrams("foldOldTurns")).toContain("fol");
  });

  it("maps guest /workspace paths onto the bind mount", () => {
    expect(hostGrepPath("/workspace")).toBe(".");
    expect(hostGrepPath("/workspace/src")).toBe("src");
    expect(hostGrepPath("src")).toBe("src");
  });

  it("rejects grep paths that leave the workspace", () => {
    const root = "/tmp/locus-ws";
    expect(containedGrepPath(root, "/workspace")).toBe(".");
    expect(containedGrepPath(root, "/workspace/src")).toBe("src");
    expect(containedGrepPath(root, "src/app.ts")).toBe("src/app.ts");
    expect(containedGrepPath(root, "/etc")).toBeUndefined();
    expect(containedGrepPath(root, "../../.ssh")).toBeUndefined();
    expect(containedGrepPath(root, "/workspace/../etc")).toBeUndefined();
  });

  it("does not search when the path escapes the workspace", async () => {
    const { root, cacheDir } = await fixture();
    const out = await grepIndexedWorkspace({
      root,
      cacheDir,
      pattern: "foldOldTurns",
      path: "/etc",
    });
    expect(out).toEqual({ output: "", usedIndex: false });
  });

  it("returns a tiny candidate set for a unique identifier", async () => {
    const { index } = await fixture();
    const ids = candidateFileIds(index, "foldOldTurns", false);
    expect(ids).toBeDefined();
    expect(ids!.length).toBeGreaterThan(0);
    expect(ids!.length).toBeLessThan(index.files.length / 4);
    expect(ids!.map((id) => index.files[id])).toContain("src/fold.ts");
  });

  it.skipIf(!HAS_RG)(
    "matches ripgrep files for foldOldTurns and finds overlay writes",
    async () => {
      const { root, cacheDir } = await fixture();
      const indexed = await grepIndexedWorkspace({
        root,
        pattern: "foldOldTurns",
        regex: false,
        cacheDir,
      });
      expect(indexed?.output).toMatch(/src\/fold\.ts:\d+:.*foldOldTurns/);
      expect(indexed?.usedIndex).toBe(true);
      expect(indexed?.candidates ?? 99).toBeLessThan(indexed?.files ?? 0);

      await writeFile(join(root, "src", "fresh.ts"), "export const overlayTokenZed = 1;\n");
      const overlay = await grepIndexedWorkspace({
        root,
        pattern: "overlayTokenZed",
        regex: false,
        cacheDir,
      });
      expect(overlay?.output).toMatch(/overlayTokenZed/);

      const open = await grepIndexedWorkspace({
        root,
        pattern: ".*",
        regex: true,
        cacheDir,
      });
      expect(open?.usedIndex).toBe(false);
      expect(open?.output).toMatch(/foldOldTurns|TODO|FIXME|n0/);
    },
  );

  it.skipIf(!HAS_RG)("does not full-scan when the index has no candidates", async () => {
    const { root, cacheDir } = await fixture();
    await writeFile(join(root, "hidden.ts"), "zzzHiddenTokenQq = 1;\n");
    await execFileAsync("git", ["-C", root, "add", "hidden.ts"]);
    await execFileAsync("git", ["-C", root, "commit", "-m", "hidden", "--no-gpg-sign"]);
    const missed = await grepIndexedWorkspace({
      root,
      pattern: "zzzHiddenTokenQq",
      regex: false,
      cacheDir,
    });
    expect(missed?.usedIndex).toBe(true);
    expect(missed?.output).toBe("");
  });

  it("parses porcelain -z renames as the new path", () => {
    expect(parsePorcelainZ("R  src/old.ts\0src/renamed.ts\0")).toEqual(["src/renamed.ts"]);
    expect(parsePorcelainZ("?? src/fresh.ts\0")).toEqual(["src/fresh.ts"]);
    expect(parsePorcelainZ(" M src/a.ts\0")).toEqual(["src/a.ts"]);
  });

  it("rebuilds when files.jsonl changes and still greps oversized files", async () => {
    const { root, cacheDir, index } = await fixture();
    await writeFile(
      join(cacheDir, "files.jsonl"),
      `${index.files.map((path) => JSON.stringify({ path })).join("\n")}\n`,
    );
    const first = await ensureGrepIndex(root, cacheDir);
    expect(first?.files).toContain("src/fold.ts");

    await writeFile(join(root, "src", "extra.ts"), "export const extraTokenQ = 1;\n");
    await writeFile(
      join(cacheDir, "files.jsonl"),
      `${[...index.files, "src/extra.ts"].map((path) => JSON.stringify({ path })).join("\n")}\n`,
    );
    const rebuilt = await ensureGrepIndex(root, cacheDir);
    const ids = candidateFileIds(rebuilt!, "extraTokenQ", false);
    expect(ids?.map((id) => rebuilt!.files[id])).toContain("src/extra.ts");

    const huge = `${"export const hugeTokenZed = 1;\n"}${"x".repeat(1_500_100)}`;
    await writeFile(join(root, "src", "huge.ts"), huge);
    const withHuge = await buildGrepIndex(root, cacheDir, [...index.files, "src/huge.ts"]);
    expect(withHuge.meta.unindexed).toContain("src/huge.ts");
    if (!HAS_RG) return;
    const hit = await grepIndexedWorkspace({
      root,
      pattern: "hugeTokenZed",
      regex: false,
      cacheDir,
    });
    expect(hit?.output).toMatch(/hugeTokenZed/);
  });
});
