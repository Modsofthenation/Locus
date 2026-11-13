/**
 * Workspace performance benchmark against real repositories.
 *
 *   npx tsx apps/server/bench/repoPerf.ts <repoDir> [<repoDir> ...] [--runs 3] [--out results.json]
 *
 * Measures the control-plane code paths that scale with repo size: the repo index
 * (Quick Open / repo_map), the trigram grep index used by the agent `grep` tool, the
 * Files-pane search, the Files tree listing, and git status / dirty stats. For each
 * operation it records wall time (median of N runs), the worst event-loop stall seen
 * while it ran, heap growth, and on-disk cache size.
 *
 * Repos are benchmarked read-only except for a handful of scratch files written to
 * simulate an edited checkout (removed again at the end).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { formatRepoMap, searchRepoMap } from "@locus/shared";
import {
  buildWorkspaceIndex,
  getWorkspaceIndex,
  resetWorkspaceIndexCache,
} from "../src/workspace/repoIndex.js";
import {
  buildGrepIndex,
  dropGrepIndex,
  grepIndexedWorkspace,
  loadGrepIndex,
} from "../src/workspace/grepIndex.js";
import { grepWorkspace, resolveRipgrep } from "../src/workspace/workspaceGrep.js";
import { listWorkspace } from "../src/workspace/workspaceFiles.js";
import { workspaceGitStatus } from "../src/workspace/workspaceGit.js";
import {
  gitWorkspaceChanges,
  resetGitWorkspaceChangesCache,
} from "../src/workspace/gitWorkspaceChanges.js";

type Sample = {
  op: string;
  medianMs: number;
  minMs: number;
  maxMs: number;
  /** Worst single event-loop stall while the op ran (ms). */
  maxLoopStallMs: number;
  heapDeltaMb?: number;
  note?: string;
};

type RepoResult = {
  repo: string;
  trackedFiles: number;
  checkoutMb: number;
  samples: Sample[];
  facts: Record<string, number | string | boolean | undefined>;
};

const args = process.argv.slice(2);
const runs = Number(flag("--runs") ?? 3);
const out = flag("--out");
const repos = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  const r = spawnSync("du", ["-sb", dir], { encoding: "utf8" });
  return Number(r.stdout.split("\t")[0] ?? 0);
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
const r1 = (n: number) => Math.round(n * 10) / 10;

async function measure<T>(
  op: string,
  n: number,
  fn: (i: number) => Promise<T>,
  opts: { before?: () => void | Promise<void>; note?: (v: T) => string } = {},
): Promise<{ sample: Sample; last: T }> {
  const times: number[] = [];
  let stall = 0;
  let heapDelta = 0;
  let last!: T;
  for (let i = 0; i < n; i++) {
    await opts.before?.();
    global.gc?.();
    const heap0 = process.memoryUsage().heapUsed;
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    const t0 = performance.now();
    last = await fn(i);
    times.push(performance.now() - t0);
    // Let the histogram's timer fire once more so a purely synchronous op is recorded too.
    await new Promise((r) => setTimeout(r, 12));
    h.disable();
    stall = Math.max(stall, h.max / 1e6);
    heapDelta = Math.max(heapDelta, process.memoryUsage().heapUsed - heap0);
  }
  const sample: Sample = {
    op,
    medianMs: r1(median(times)),
    minMs: r1(Math.min(...times)),
    maxMs: r1(Math.max(...times)),
    maxLoopStallMs: r1(stall),
    heapDeltaMb: mb(heapDelta),
    ...(opts.note ? { note: opts.note(last) } : {}),
  };
  console.log(
    `  ${op.padEnd(44)} ${String(sample.medianMs).padStart(9)} ms  stall ${String(sample.maxLoopStallMs).padStart(7)} ms  heap +${sample.heapDeltaMb} MB${sample.note ? `  (${sample.note})` : ""}`,
  );
  return { sample, last };
}

/** Pick realistic search terms from the repo itself so every repo gets comparable queries. */
function pickQueries(paths: string[]): { file: string; symbol: string } {
  const src = paths.filter((p) => /\.(ts|js|py|go|rs|java)$/.test(p) && !/test/i.test(p));
  const mid = src[Math.floor(src.length / 2)] ?? paths[0] ?? "index";
  const stem = basename(mid).replace(/\.[^.]+$/, "");
  return { file: stem.slice(0, Math.max(4, Math.min(8, stem.length))), symbol: stem };
}

async function benchRepo(dir: string): Promise<RepoResult> {
  const root = resolve(dir);
  const name = basename(root);
  const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 1 << 28 })
    .toString()
    .split("\0")
    .filter(Boolean);
  const result: RepoResult = {
    repo: name,
    trackedFiles: tracked.length,
    checkoutMb: mb(dirBytes(root) - dirBytes(join(root, ".git"))),
    samples: [],
    facts: {},
  };
  console.log(`\n== ${name}: ${tracked.length} tracked files, ${result.checkoutMb} MB checkout`);
  const push = (s: Sample) => result.samples.push(s);
  const scratch = mkdtempSync(join(tmpdir(), `locus-bench-${name}-`));
  const cacheDir = (i: number | string) => join(scratch, `idx-${i}`);

  // --- Repo index (Quick Open, repo_map, Files pane "Indexing N") -------------------
  {
    const { sample, last } = await measure(
      "index: cold build",
      runs,
      (i) => buildWorkspaceIndex(root, { cacheDir: cacheDir(`cold-${i}`), force: true }),
      {
        before: () => resetWorkspaceIndexCache(),
        note: (r) =>
          `${r.stats.files} files, read ${r.stats.read}, truncated=${!!r.stats.truncated}`,
      },
    );
    push(sample);
    result.facts.indexFiles = last.stats.files;
    result.facts.indexTruncated = !!last.stats.truncated;
    result.facts.indexSymbols = last.map.files.reduce((n, f) => n + f.symbols.length, 0);
    result.facts.indexSymbolFiles = last.map.files.filter((f) => f.symbols.length).length;
    result.facts.indexCacheMb = mb(dirBytes(cacheDir("cold-0")));
  }
  push(
    (
      await measure(
        "index: warm rebuild (force, mtime reuse)",
        runs,
        () => buildWorkspaceIndex(root, { cacheDir: cacheDir("cold-0"), force: true }),
        {
          before: () => resetWorkspaceIndexCache(),
          note: (r) => `reused ${r.stats.reused}, read ${r.stats.read}`,
        },
      )
    ).sample,
  );
  push(
    (
      await measure(
        "index: hydrate from disk (new process)",
        runs,
        () => getWorkspaceIndex(root, { cacheDir: cacheDir("cold-0") }),
        { before: () => resetWorkspaceIndexCache() },
      )
    ).sample,
  );
  const built = await getWorkspaceIndex(root, { cacheDir: cacheDir("cold-0") });
  const q = pickQueries(built.map.files.map((f) => f.path));
  result.facts.queryFile = q.file;
  push(
    (
      await measure(
        "repo_map: formatRepoMap (no query)",
        runs,
        async () => formatRepoMap(built.map, {}),
        { note: (s) => `${Math.round(s.length / 1024)} KB output` },
      )
    ).sample,
  );
  push(
    (
      await measure(
        "repo_map: per-turn ranked prompt (query+rank)",
        runs,
        async () =>
          formatRepoMap(built.map, {
            query: `fix the ${q.symbol} handler and update tests for src config`,
            rank: true,
          }),
        { note: (s) => `${Math.round(s.length / 1024)} KB output` },
      )
    ).sample,
  );
  push(
    (
      await measure(
        `quick open: searchRepoMap("${q.file}")`,
        Math.max(runs, 5),
        async () => searchRepoMap(built.map, q.file, { limit: 50 }),
        { note: (r) => `${r.length} hits` },
      )
    ).sample,
  );
  push(
    (
      await measure("quick open: searchRepoMap per keystroke x6", Math.max(runs, 5), async () => {
        for (let k = 1; k <= Math.min(6, q.file.length); k++)
          searchRepoMap(built.map, q.file.slice(0, k), { limit: 50 });
      })
    ).sample,
  );

  // --- Trigram grep index (agent `grep` tool on Docker/Host) ------------------------
  {
    const paths = built.map.files.map((f) => f.path);
    const { sample, last } = await measure(
      "grep index: build",
      runs,
      (i) => buildGrepIndex(root, cacheDir(`grep-${i}`), paths),
      { note: (g) => `${g.files.length} files, ${g.postings.size} grams` },
    );
    push(sample);
    result.facts.grepGrams = last.postings.size;
    result.facts.grepPostingsMb = mb(fileBytes(join(cacheDir("grep-0"), "grep-postings.bin")));
    // ensureGrepIndex reads files.jsonl from the same dir: seed the main cache dir.
    await buildGrepIndex(root, cacheDir("cold-0"), paths);
    push(
      (
        await measure(
          "grep index: load from disk (once per process)",
          runs,
          () => loadGrepIndex(cacheDir("cold-0")),
          { before: () => dropGrepIndex() },
        )
      ).sample,
    );
  }
  const rg = await resolveRipgrep();
  const greps: Array<[string, string]> = [
    ["selective literal", q.symbol],
    ["common word", "return"],
    ["regex", "function\\s+\\w+Error"],
    ["no match", "zzqxLocusNoSuchTokenqq"],
  ];
  for (const [label, pattern] of greps) {
    push(
      (
        await measure(
          `agent grep (indexed): ${label}`,
          runs,
          () => grepIndexedWorkspace({ root, pattern, cacheDir: cacheDir("cold-0") }),
          {
            note: (r) =>
              `usedIndex=${r?.usedIndex} candidates=${r?.candidates ?? "-"} ${Math.round((r?.output.length ?? 0) / 1024)} KB`,
          },
        )
      ).sample,
    );
    push(
      (
        await measure(
          `agent grep (no index): ${label}`,
          runs,
          () => grepIndexedWorkspace({ root, pattern }),
          { note: (r) => `${Math.round((r?.output.length ?? 0) / 1024)} KB` },
        )
      ).sample,
    );
    if (rg) {
      push(
        (
          await measure(`baseline rg -l: ${label}`, runs, async () =>
            spawnSync(rg, ["-l", "--no-config", "-e", pattern, "."], {
              cwd: root,
              maxBuffer: 1 << 28,
            }),
          )
        ).sample,
      );
    }
  }

  // --- Files pane search (/api/.../workspace/grep) ----------------------------------
  for (const [label, pattern] of greps.slice(0, 2)) {
    push(
      (
        await measure(`files search: ${label}`, runs, () => grepWorkspace(root, pattern, 80), {
          note: (r) => `${r.items.length} hits truncated=${!!r.truncated}`,
        })
      ).sample,
    );
  }
  push(
    (
      await measure(
        "files search: common word (walk fallback)",
        1,
        () => grepWorkspace(root, "return", 80, { engine: "walk" }),
        { note: (r) => `${r.items.length} hits` },
      )
    ).sample,
  );

  // --- Files tree ---------------------------------------------------------------
  push(
    (
      await measure("list: depth 1", runs, () => listWorkspace(root, "", 1), {
        note: (r) => `${r.length} entries`,
      })
    ).sample,
  );
  push(
    (
      await measure("list: full tree (no depth)", runs, () => listWorkspace(root, ""), {
        note: (r) => `${r.length} entries`,
      })
    ).sample,
  );

  // --- Git status / dirty stats ---------------------------------------------------
  push(
    (
      await measure("git: status (clean)", runs, () => workspaceGitStatus(root), {
        note: (s) => `${s.files.length} files`,
      })
    ).sample,
  );
  push(
    (
      await measure("git: dirty stats (clean)", runs, () => gitWorkspaceChanges(root), {
        before: () => resetGitWorkspaceChangesCache(),
      })
    ).sample,
  );
  // Simulate an agent mid-task: 50 modified tracked files + 200 untracked files.
  const modified = tracked.filter((p) => /\.(ts|js|py|go|md)$/.test(p)).slice(0, 50);
  const untracked: string[] = [];
  try {
    for (const p of modified) writeFileSync(join(root, p), "// locus bench\n", { flag: "a" });
    for (let i = 0; i < 200; i++) {
      const p = join(root, `locus-bench-untracked-${i}.txt`);
      writeFileSync(p, `bench ${i}\n`);
      untracked.push(p);
    }
    push(
      (
        await measure(
          "git: status (50 mod + 200 untracked)",
          runs,
          () => workspaceGitStatus(root),
          {
            note: (s) => `${s.files.length} files`,
          },
        )
      ).sample,
    );
    push(
      (
        await measure(
          "git: dirty stats (50 mod + 200 untracked)",
          runs,
          () => gitWorkspaceChanges(root),
          {
            before: () => resetGitWorkspaceChangesCache(),
            note: (r) => `${r.length} rows`,
          },
        )
      ).sample,
    );
    push(
      (
        await measure(
          "index: incremental rebuild after edits",
          runs,
          () => buildWorkspaceIndex(root, { cacheDir: cacheDir("cold-0"), force: true }),
          { before: () => resetWorkspaceIndexCache(), note: (r) => `read ${r.stats.read}` },
        )
      ).sample,
    );
  } finally {
    execFileSync("git", ["-C", root, "checkout", "--", ...modified]);
    for (const p of untracked) unlinkSync(p);
  }

  rmSync(scratch, { recursive: true, force: true });
  return result;
}

const all: RepoResult[] = [];
for (const dir of repos) all.push(await benchRepo(dir));
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        when: new Date().toISOString(),
        node: process.version,
        runs,
        ripgrep: Boolean(await resolveRipgrep()),
        ctags: spawnSync("ctags", ["--version"]).status === 0,
        results: all,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${out}`);
}
