# Verify commands

The harness checks agent work in three places:

| Where | Step | Blocks? |
| --- | --- | --- |
| Before `git_push` / `git_pr` (harness rule 4) | `test` | Yes, unless the toolchain is missing on the host |
| After `file_write` / `apply_patch` | `lint` (fast commands only) | No. Output is appended to the tool result. |
| Model benchmark scoring | `test` | Scores the case |

The commands come from `.locus/environment.json` → `verify`. When that block is missing, presets are detected from the repo's files. The same commands also count as a verification run for the "verify before done" check (`codingTurnNeedsHuman`). So when an agent runs `bazel test //...` in a repo that configures it, the edit counts as tested.

## Config

```jsonc
// .locus/environment.json
{
  "install": "uv sync",
  "verify": {
    "test": "pytest -q",
    "lint": "ruff check .",
    "typecheck": "mypy .",
    "junit": "reports/**/*.xml", // optional: read JUnit XML after `test`
    "timeoutSec": 600, // optional: per step for this root
    "projects": [
      { "root": "services/api", "test": "go test ./...", "lint": "go vet ./..." },
      { "root": "web" } // no commands: use the presets detected in web/
    ]
  }
}
```

- Each of `test`, `lint` and `typecheck` takes a shell command, run with `sh -lc` from the project root. Set it to `false` (or `""`) to turn the step off without falling back to a preset. A step you leave out falls back to the preset detected at that root.
- `projects[].root` is a repo-relative sub-directory. It cannot be absolute or use `..`. When `projects` is present, it replaces the auto-detected sub-projects.
- `junit` is a glob (`**`, `*`, `?`) relative to the project root. Reports older than the run are ignored. When reports are found, they are the structured result. Otherwise the runner parses the command's output.
- `timeoutSec` must be between 1 and 7200. Defaults: test 600 s, typecheck 120 s, lint 30 s. A caller's explicit timeout (for example the benchmark's 120 s) wins.
- An invalid `verify` block fails closed. Every step returns a `runner` failure that lists the validation errors.

## Presets

Detection is a pure function (`detectVerifyPresets` in `@locus/shared`) over a shallow file listing (depth 4) and a few manifest bodies. At one root, the earliest preset that provides a step wins: JS, then Makefile, Rust, Go, Python, Maven, Gradle.

| Preset | Detected by | test | lint | typecheck |
| --- | --- | --- | --- | --- |
| npm | `package.json` | `npm run test` (affected workspaces, see below) | `npm run lint` | `npm run typecheck` |
| pnpm / yarn | `package.json` + `pnpm-lock.yaml` / `yarn.lock` | `pnpm run test` / `yarn run test` | `… run lint` | `… run typecheck` |
| Makefile | `test:` / `lint:` / `typecheck:` targets | `make test` | `make lint`* | `make typecheck`* |
| Rust | `Cargo.toml` | `cargo test` | `cargo clippy --all-targets`* | `cargo check --all-targets`* |
| Go | `go.mod` | `go test ./...` (run as `go test -json ./...`) | `go vet ./...`* | `go build ./...`* |
| Python | `pyproject.toml`, `setup.py`, `setup.cfg`, `tox.ini`, `pytest.ini`, `Pipfile`, `requirements.txt` | `pytest -q` (with a temp `--junitxml`) when pytest is configured or `test_*.py` exist, else `tox -q` | `ruff check .` or `flake8` when configured | `mypy .` or `pyright` when configured* |
| Maven | `pom.xml` | `mvn -B test` (`./mvnw` when present). Reads `**/target/surefire-reports/TEST-*.xml` | | `mvn -B -q compile`* |
| Gradle | `build.gradle[.kts]`, `settings.gradle[.kts]` | `gradle test` (`./gradlew` when present). Reads `**/build/test-results/**/*.xml` | `gradle check -x test`* | |

`*` marks slow steps. They compile the project, so post-edit lint skips them. Python commands get a `uv run ` or `poetry run ` prefix when `uv.lock` or `poetry.lock` exists. The npm preset keeps the npm-only behaviour exactly:

- It tests only the affected workspaces under `apps/` and `packages/`, including transitive dependents.
- It runs the full suite for repository-wide changes.
- It detects missing dependencies, and a malformed manifest fails closed.

pnpm and yarn use the same planner with their own binary, and fall back to npm when that binary is missing on the host.

**Sub-projects.** Manifests below the root become their own projects. Examples are `services/api/go.mod` and `apps/desktop/src-tauri/Cargo.toml`. These are not separate projects:

- workspace members (a nested `package.json` without its own lockfile)
- crates, modules or packages that the root build already covers (Cargo, Maven, Gradle and Python below a root of the same kind)
- anything under `node_modules`, `vendor`, `target`, `build`, `dist`, `.venv`, `fixtures`, `testdata` or `__tests__`

Go modules always count as separate projects, because `./...` stops at a nested `go.mod`.

## Scoping

When Git knows the base branch (`main` / `master`), the runner takes each changed file (except docs, README and `.locus-attachments`) and gives it to the deepest project whose root contains it. Files outside every project go to the root. Then only those projects run the step. In a polyglot repo, a Go-only change runs `go test` and skips the JS suite. The npm planner ignores files that belong to other projects. If the base is unknown or nothing differs from it, every project runs.

## Results

Every run returns a `WorkspaceScriptResult` (`apps/server/src/core/hooks.ts`):

- `failureKind` is one of: `test-failure`, `script-failure`, `timeout`, `missing-dependencies`, `runner`, `missing-toolchain`.
- `failedTests` lists the failing tests.
- `report` is a `TestReport` (`@locus/shared` → `testReport.ts`):

```ts
interface TestReport {
  framework: "junit" | "go" | "cargo" | "vitest" | "jest" | "pytest" | "mixed" | "unknown";
  passed: number;
  failed: number; // failed + errored cases
  skipped: number; // skipped, ignored, todo, xfail
  durationMs?: number;
  failures: Array<{ name: string; file?: string; message?: string }>; // capped at 50
}
```

The parsers are `parseJUnitXml`, `parseGoTestJson`, `parseCargoTestOutput`, `parseVitestOutput`, `parseJestOutput` and `parsePytestOutput`. `parseTestOutput(text, hint?)` sniffs the format. `mergeTestReports` sums reports across projects. `formatTestReport` prints the short summary that leads the publish-gate block message.

When the gate blocks, the message names the command to re-run. Running that command (or another command with the same program and sub-command) counts as verification.

## Missing toolchains and the host limitation

The publish gate and post-edit lint run **on the host** against the workspace directory. Docker agents expose that directory through the bind mount. The commands run with the host's `PATH`, not inside the agent's container. A Go repo edited in a `locus/agent` container is therefore tested with the host's `go`.

When the host lacks the command, the result is `failureKind: "missing-toolchain"` and the push is **not** blocked. Examples are exit 127, `command not found`, `No module named pytest`, or no JDK. A trace event records that the gate was skipped, and post-edit lint prints a one-line skip note. If another project in the same run has real failures, the run still blocks. To get a real gate, install the toolchain on the host, or point `verify.test` at a command that runs where the tools exist (for example `docker compose run --rm api go test ./...`).
