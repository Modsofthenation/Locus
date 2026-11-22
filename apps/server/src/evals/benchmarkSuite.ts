/**
 * Load benchmark case specs from disk, and stamp runs with a harness version.
 *
 * A suite is a folder of `*.json` spec files and/or sub-folders holding a `case.json` (the
 * fixture layout: `case.json` + `base/` + `fix/`). A repo path works too: its
 * `.locus/benchmarks/` folder is the suite. The built-in suite lives in
 * `apps/server/fixtures/benchmark/` (override with `LOCUS_BENCHMARK_FIXTURES`).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "@locus/providers";
import {
  BENCHMARK_SCORING_VERSION,
  HOST_TOOLS,
  benchmarkSpecPrompt,
  parseBenchmarkSuiteJson,
  type BenchmarkCaseSpec,
  type BenchmarkHarness,
} from "@locus/shared";

export interface LoadedBenchmarkSpec {
  spec: BenchmarkCaseSpec;
  /** Spec file path. */
  file: string;
  /** Folder that relative `repo` paths resolve against. */
  dir: string;
}

export interface LoadedSuite {
  root: string;
  cases: LoadedBenchmarkSpec[];
  /** `file: problem` lines for specs that did not validate. */
  errors: string[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The built-in fixture suite folder, when this install ships it (source checkouts do). */
export function builtinSuiteDir(): string | undefined {
  const candidates = [
    process.env.LOCUS_BENCHMARK_FIXTURES,
    join(HERE, "..", "..", "fixtures", "benchmark"),
    join(HERE, "fixtures", "benchmark"),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p));
}

async function loadFile(file: string, dir: string, out: LoadedSuite): Promise<void> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  if (text === undefined) {
    out.errors.push(`${file}: unreadable`);
    return;
  }
  const parsed = parseBenchmarkSuiteJson(text);
  out.errors.push(...parsed.errors.map((e) => `${file}: ${e}`));
  for (const spec of parsed.specs) out.cases.push({ spec, file, dir });
}

/** Load a suite folder, a single spec file, or a repo's `.locus/benchmarks/`. */
export async function loadBenchmarkSuite(path: string): Promise<LoadedSuite> {
  let root = resolve(path);
  const info = await stat(root).catch(() => undefined);
  if (!info) throw new Error(`Suite not found: ${root}`);
  const out: LoadedSuite = { root, cases: [], errors: [] };
  if (info.isFile()) {
    await loadFile(root, dirname(root), out);
    return out;
  }
  const repoSuite = join(root, ".locus", "benchmarks");
  if (existsSync(repoSuite)) out.root = root = repoSuite;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(root, entry.name);
    if (entry.isFile() && entry.name.endsWith(".json")) await loadFile(full, root, out);
    else if (entry.isDirectory() && existsSync(join(full, "case.json"))) {
      await loadFile(join(full, "case.json"), full, out);
    }
  }
  const seen = new Map<string, string>();
  out.cases = out.cases.filter((row) => {
    const prev = seen.get(row.spec.id);
    if (prev) {
      out.errors.push(`${row.file}: ${row.spec.id}: duplicate id (also in ${prev})`);
      return false;
    }
    seen.set(row.spec.id, row.file);
    return true;
  });
  return out;
}

function readVersion(): string {
  if (process.env.LOCUS_APP_VERSION) return process.env.LOCUS_APP_VERSION;
  for (const candidate of [join(HERE, "..", "..", "package.json"), join(HERE, "package.json")]) {
    try {
      const version = (JSON.parse(readFileSync(candidate, "utf8")) as { version?: string }).version;
      if (version) return version;
    } catch {
      /* try the next */
    }
  }
  return process.env.npm_package_version ?? "unknown";
}

function readGitSha(): string | undefined {
  const env = process.env.LOCUS_GIT_SHA ?? process.env.GITHUB_SHA;
  if (env?.trim()) return env.trim();
  try {
    return (
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: HERE,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 3000,
        windowsHide: true,
      })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

const SAMPLE_SPEC: BenchmarkCaseSpec = {
  id: "sample",
  repo: ".",
  baseCommit: "HEAD",
  prompt: "Sample",
  testCommand: "npm test",
  failToPass: [],
  passToPass: [],
  protectedPaths: ["test.js"],
};

let cachedHarness: BenchmarkHarness | undefined;

/**
 * Locus version, the app's git sha when running from a checkout, and a hash of the inputs that
 * shape a benchmark turn: the Host system prompt for an autonomous agent, the Host tool list,
 * the spec prompt wrapper and the scoring version.
 */
export function benchmarkHarness(): BenchmarkHarness {
  if (cachedHarness) return cachedHarness;
  const locusVersion = readVersion();
  const gitSha = readGitSha();
  let prompt = "";
  try {
    prompt = buildSystemPrompt({
      os: "ubuntu",
      runtime: "host",
      tools: HOST_TOOLS.map((name) => ({ name, description: "" })),
      autonomy: "autonomous",
    });
  } catch {
    prompt = "unavailable";
  }
  const configHash = createHash("sha256")
    .update(
      JSON.stringify({
        prompt,
        tools: HOST_TOOLS,
        specPrompt: benchmarkSpecPrompt(SAMPLE_SPEC),
        scoring: BENCHMARK_SCORING_VERSION,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  cachedHarness = {
    locusVersion,
    gitSha,
    configHash,
    key: `${locusVersion}${gitSha ? `+${gitSha.slice(0, 7)}` : ""}.${configHash.slice(0, 8)}`,
  };
  return cachedHarness;
}
