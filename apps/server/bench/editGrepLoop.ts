/**
 * Agent edit → grep loop. After `file_write` / `apply_patch`, the session calls
 * `updateIndexPaths`, which rewrites files.jsonl. The trigram grep index keys its freshness
 * on that file's mtime/size, so the next indexed `grep` rebuilds every posting list.
 *
 *   npx tsx apps/server/bench/editGrepLoop.ts <repoDir> [--edits 5]
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { buildWorkspaceIndex, updateIndexPaths } from "../src/workspace/repoIndex.js";
import { grepIndexedWorkspace, settleGrepIndexBuilds } from "../src/workspace/grepIndex.js";

const args = process.argv.slice(2);
const root = resolve(args[0]!);
const edits = Number(args[args.indexOf("--edits") + 1] || 5);
const cacheDir = mkdtempSync(join(tmpdir(), "locus-editgrep-"));
const target = execFileSync("git", ["-C", root, "ls-files"], { maxBuffer: 1 << 28 })
  .toString()
  .split("\n")
  .find((p) => /\.(ts|js|py|go)$/.test(p))!;

const t = async (label: string, fn: () => Promise<unknown>) => {
  const t0 = performance.now();
  await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${label.padEnd(40)} ${String(ms).padStart(7)} ms`);
  return ms;
};

console.log(`== ${root} (editing ${target})`);
await buildWorkspaceIndex(root, { cacheDir, force: true });
await t("first grep (index builds in background)", () =>
  grepIndexedWorkspace({ root, pattern: "constructor", cacheDir }),
);
await t("background index build", () => settleGrepIndexBuilds());
await t("grep again (no edits)", () =>
  grepIndexedWorkspace({ root, pattern: "constructor", cacheDir }),
);
const after: number[] = [];
try {
  for (let i = 0; i < edits; i++) {
    writeFileSync(join(root, target), `// edit ${i}\n`, { flag: "a" });
    await t(`edit ${i + 1}: updateIndexPaths`, () => updateIndexPaths(root, cacheDir, [target]));
    after.push(
      await t(`edit ${i + 1}: next grep`, () =>
        grepIndexedWorkspace({ root, pattern: "constructor", cacheDir }),
      ),
    );
  }
} finally {
  execFileSync("git", ["-C", root, "checkout", "--", target]);
  rmSync(cacheDir, { recursive: true, force: true });
}
console.log(
  `  mean grep after an edit: ${Math.round(after.reduce((a, b) => a + b, 0) / after.length)} ms`,
);
