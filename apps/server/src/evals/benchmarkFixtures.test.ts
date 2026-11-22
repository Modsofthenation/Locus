import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lookupTestOutcome, parseTestResults } from "@locus/shared";
import {
  FIXTURE_BASE_TAG,
  FIXTURE_FIX_TAG,
  exportCommit,
  git,
  gitShowFile,
  missingToolchain,
  resolveCaseRepo,
  resolveCommit,
  runShell,
} from "./benchmarkRepo.js";
import { classifyVerification } from "./benchmarkMiner.js";
import { builtinSuiteDir, loadBenchmarkSuite } from "./benchmarkSuite.js";

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const suiteDir = builtinSuiteDir();

describe("built-in benchmark fixtures", async () => {
  it("ships a suite with TypeScript, Python and Go cases that all validate", async () => {
    expect(suiteDir).toBeDefined();
    const suite = await loadBenchmarkSuite(suiteDir!);
    expect(suite.errors).toEqual([]);
    const languages = suite.cases.map((c) => c.spec.language);
    expect(languages).toEqual(expect.arrayContaining(["typescript", "python", "go"]));
  });

  const suite = suiteDir ? await loadBenchmarkSuite(suiteDir) : { cases: [] };
  for (const { spec, dir } of suite.cases) {
    const missing = missingToolchain(spec.language);
    it.skipIf(Boolean(missing))(
      `${spec.id}: hidden tests fail at base and pass at the fix`,
      async () => {
        const work = await mkdtemp(join(tmpdir(), `locus-fixture-${spec.id}-`));
        dirs.push(work);
        const repo = await resolveCaseRepo(spec, dir, join(work, "repos"));
        // Deterministic fixture commits: the tags resolve and the agent's base has one parent.
        const base = await resolveCommit(repo, FIXTURE_BASE_TAG);
        const fix = await resolveCommit(repo, FIXTURE_FIX_TAG);
        expect((await git(["rev-parse", `${fix}^`], repo)).trim()).toBe(base);

        const atBase = join(work, "base");
        await exportCommit(repo, base, atBase);
        for (const rel of spec.protectedPaths) {
          const body = await gitShowFile(repo, fix, rel);
          const target = join(atBase, ...rel.split("/"));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, body!);
        }
        const atFix = join(work, "fix");
        await exportCommit(repo, fix, atFix);

        const a = await runShell(spec.testCommand, atBase, 120_000);
        const b = await runShell(spec.testCommand, atFix, 120_000);
        const ra = parseTestResults(a.output);
        const rb = parseTestResults(b.output);
        for (const id of spec.failToPass) {
          expect(lookupTestOutcome(ra, id), `${id} at base\n${a.output}`).not.toBe("passed");
          expect(lookupTestOutcome(rb, id), `${id} at fix\n${b.output}`).toBe("passed");
        }
        for (const id of spec.passToPass) {
          expect(lookupTestOutcome(ra, id), `${id} at base\n${a.output}`).toBe("passed");
          expect(lookupTestOutcome(rb, id), `${id} at fix\n${b.output}`).toBe("passed");
        }
        const verdict = classifyVerification({ ok: a.ok, results: ra }, { ok: b.ok, results: rb });
        expect(verdict.verified, verdict.reason).toBe(true);
        expect(new Set(verdict.failToPass)).toEqual(new Set(spec.failToPass));
      },
      120_000,
    );
  }
});
