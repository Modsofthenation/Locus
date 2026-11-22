# Benchmarks

Locus can run the same coding tasks against several models as real, autonomous Host agent turns and track the results over time. It is a regression suite for two things at once: which model to use, and whether a change to Locus (prompt, tools, turn policy) made agents better or worse.

Settings → Benchmark, `locus bench …` (alias `locus eval …`) and `/api/benchmarks` are one runner.

## Cases

There are two kinds of case.

**Toy cases** (`fix-add`, `off-by-one`, `implement-slugify`, `missing-await`, `cross-file-feature`) are tiny JavaScript projects defined in `packages/shared/src/benchmark.ts`. Locus writes the files to a temp folder, the agent works, then Locus runs `npm test`. A case passes when the tests pass and the test files are byte-identical.

**Spec cases** are bug-fix tasks taken from real history. A spec points at a git repository and the commit just before a fix. The agent never sees the fix or its new tests:

1. Locus exports `baseCommit`'s tree into a fresh folder and makes it a one-commit repo, so `git log` shows nothing from the future.
2. `setup` runs (for example `npm ci`).
3. The agent gets the `prompt` (the issue text), plus the test command and the list of files it must not edit.
4. When the turn ends, Locus checks `protectedPaths` against the base, then copies the fix commit's versions of `protectedPaths` (the hidden tests) in and runs `testCommand`.
5. The case **passes** when every `failToPass` test passes, every `passToPass` test still passes, and the agent left `protectedPaths` alone. With both lists empty, the test command's exit code decides.

A case whose language toolchain is missing on the machine (`node`, `python3`/`python`, `go`, `cargo`, …) is `skipped` and is left out of pass rates.

### Built-in suite

`apps/server/fixtures/benchmark/` ships three small, offline, real-shaped repos, each with a bug and a hidden test:

| Case | Language | Bug |
| --- | --- | --- |
| `ts-retry-backoff` | TypeScript (Node type stripping, `node --test`) | Backoff delays grow linearly and ignore the cap |
| `py-semver-compare` | Python (`unittest`) | Versions compare as text, so 1.10 sorts before 1.9 |
| `go-wordwrap` | Go (`go test`) | Wrap drops the last line and wraps one word early |

Each folder holds `case.json`, `base/` (the tree before the fix) and `fix/` (the files the fix changed, tests included). `repo: "fixture:."` tells the runner to build a two-commit git repo from them (tags `locus-base` and `locus-fix`, fixed dates so the commit ids are stable). `apps/server/src/evals/benchmarkFixtures.test.ts` checks every fixture: hidden tests fail at base and pass at the fix.

A run with no `--suite` uses the toy cases plus this suite. Packaged desktop builds that do not ship the fixtures folder only list the toy cases; set `LOCUS_BENCHMARK_FIXTURES` to a checkout's `apps/server/fixtures/benchmark` to add them.

### Spec format

Spec files are JSON: one spec, an array of specs, or `{ "cases": [...] }`. A suite is a folder of `*.json` files and/or sub-folders with a `case.json`. A repo path also works: Locus reads its `.locus/benchmarks/` folder.

```json
{
  "id": "acme-1a2b3c4",
  "title": "Dates before 1970 render as NaN",
  "repo": "../..",
  "baseCommit": "1a2b3c4d5e6f…",
  "fixCommit": "9f8e7d6c5b4a…",
  "prompt": "Dates before 1970 render as NaN in the activity feed (#412).",
  "setup": "npm ci --no-audit --no-fund",
  "testCommand": "npm test",
  "failToPass": ["formats negative epochs"],
  "passToPass": ["formats today", "formats leap days"],
  "protectedPaths": ["test/date.test.ts"],
  "timeoutSec": 900,
  "language": "typescript",
  "issues": ["#412"]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique in the suite: lowercase letters, digits, `.`, `_`, `-`. |
| `repo` | yes | Local path (relative to the spec file), a clone URL (cloned once per run), or `fixture:<dir>`. |
| `baseCommit` | yes | Commit-ish the agent starts from: the parent of the fix. |
| `fixCommit` | no | The real fix. Hidden tests come from here; also provenance. Without it the base test files are used. |
| `prompt` | yes | The issue text the agent receives. |
| `setup` | no | Install command, run before the agent starts. |
| `testCommand` | yes | Shell command run at scoring time from the repo root. |
| `failToPass` | yes | Test ids that must go from failing to passing. `[]` means "exit code decides". |
| `passToPass` | no | Test ids that must stay green. |
| `protectedPaths` | no | Test files the agent must not edit; replaced by the fix's versions before scoring. |
| `timeoutSec` | no | Agent time limit, 10–21600. Default: the run's timeout (10 minutes). |
| `language` | no | `typescript`, `javascript`, `python`, `go`, `rust`, `java`, `ruby`, `other`. Used to skip cases without a toolchain. |
| `issues` | no | Issue references found in the fix commit message. |

Validation lives in `packages/shared/src/benchmarkSpec.ts` (`validateBenchmarkCaseSpec`, `parseBenchmarkSuiteJson`); `locus bench cases --suite <dir>` lists cases and any spec errors.

### Test ids

Locus reads per-test results from the test command's output. It understands TAP (`node --test` when not on a terminal), Node spec / Jest / Vitest check marks, pytest (`-rA` summary or `-v`), `unittest -v`, `go test -v` and `cargo test`. A required id matches a reported test exactly, or as a suffix after `::`, `.`, `/` or ` > ` (so `test_x` matches `tests/test_a.py::test_x`). A test missing from the output counts as not passing. Pick a test command that prints one line per test (for example `go test -v ./...`, `pytest -rA`, `node --test --test-reporter=tap`).

## Mining cases from history

```bash
locus bench mine ~/src/myrepo --since "6 months ago" --limit 5
```

The miner (`apps/server/src/evals/benchmarkMiner.ts`) walks `git log` (no merges, newest first, `--max-commits` default 500) for commits with one parent that change both source and test files (`--require-issue` keeps only commits that mention `#123`, `ABC-12` or an issue URL). For each candidate it drafts a spec:

- `baseCommit` = the parent, `fixCommit` = the commit
- `prompt` = the commit subject and body, minus trailers and a `fix:` prefix
- `protectedPaths` = the test files the commit changed
- `testCommand` / `setup` / `language` = `detectTestCommand(root)` on the fix tree (`npm`/`pnpm`/`yarn test`, `pytest -rA` or `unittest`, `go test -v ./...`, `cargo test`), or `--test-command` / `--setup` / `--no-setup`

Then it verifies the draft. It runs the tests at the parent plus the fix's test files (they must fail) and at the fix commit (they must pass). `failToPass` = tests that pass at the fix but not at base; `passToPass` = tests that pass at both. Only verified drafts are kept and written to `<repo>/.locus/benchmarks/<id>.json` (or `--out <dir>`; `--dry-run` writes nothing). Review the prompts before trusting the suite: commit messages describe the fix, not always the symptom.

Mining runs as a background job on the control plane (`POST /api/benchmarks/mine`, poll `GET /api/benchmarks/mine/:id`); the CLI prints progress as it goes.

## Results and tracking

Each run is saved as `~/.locus/benchmarks/<run>.json`. Per case it records status (`passed`, `failed`, `error`, `skipped`), why, the required tests that did not pass, tokens, estimated cost (provider rates), wall time, tool calls, the chat session (archived, open it from Settings → Benchmark), model and provider.

Every run carries a **harness version**: `<Locus version>[+<git sha7>].<hash8>`. The hash covers the Host system prompt for an autonomous agent, the Host tool list, the spec prompt wrapper and the scoring version, so a prompt or tool change shows up as a new harness even on the same release. The git sha comes from `LOCUS_GIT_SHA`, `GITHUB_SHA`, or `git rev-parse HEAD` when running from a checkout.

- `locus bench history` / `GET /api/benchmarks/history`: pass rate, cost per case, median time and run count per (provider, model, harness version).
- `locus bench compare <before> <after>` / `GET /api/benchmarks/compare?a=&b=`: per case, `fixed`, `broke`, `added`, `removed` (and, with `--all`, `still-passing` / `still-failing`). With repeats, a case counts as passing at ≥ 50% of its attempts. Two single-model runs on different models are compared case by case.
- Settings → Benchmark shows the same history table and a two-run compare.

## CI

`.github/workflows/benchmark.yml` runs the built-in suite weekly (and on demand) through `apps/server/bench/benchmarkCi.ts`, which boots a throwaway data dir, enables one built-in provider and runs the suite headless.

Configure under Settings → Secrets and variables → Actions:

| Name | Kind | Meaning |
| --- | --- | --- |
| `LOCUS_BENCH_API_KEY` | secret | Provider API key. Without it the job ends with a notice. |
| `LOCUS_BENCH_PROVIDER` | variable | Built-in provider kind or name (`anthropic`, `openai`, `OpenRouter`, …). |
| `LOCUS_BENCH_MODEL` | variable | Model id. |
| `LOCUS_BENCH_BASE_URL` | variable | Optional base URL override. |
| `LOCUS_BENCH_MAX_DROP` | variable | Optional allowed pass-rate drop below the baseline (0–1). |

The run JSON is uploaded as the `benchmark-run` artifact. The job fails when the pass rate is below `passRate - maxDrop` from `apps/server/bench/benchmark-baseline.json`. The committed baseline is a placeholder until the first real run: copy that run's pass rate (and model / harness version) into it.

## Safety

Spec cases run `setup` and `testCommand` from the spec file on your machine, and the agent runs on the Host, not in a container. Only run suites from repositories you trust. Fixture builds and clones live under `<tmp>/locus-benchmark-repos/<run>/`, apart from the agent's folder, and are removed when the run ends; a Host agent that goes looking outside its folder could still find them while the run is going.
