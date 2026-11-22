/**
 * Test-command detector for the benchmark miner.
 *
 * A repo's own `.locus/environment.json` `verify.test` (plus `install` as setup) wins, so the
 * miner and the publish gate agree on how a repo is tested. Otherwise fall back to commands
 * that print one line per test, which `parseTestResults` needs to score fail-to-pass ids
 * (the verify presets prefer machine formats such as `go test -json` instead).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseVerifyConfig, type BenchmarkLanguage } from "@locus/shared";

export interface DetectedTestCommand {
  /** Shell command that runs the suite with per-test output the result parser understands. */
  command: string;
  /** Install step, when the project needs one. */
  setup?: string;
  language: BenchmarkLanguage;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Detect how to run a checkout's tests: npm, pytest / unittest, go test or cargo test. */
export function detectTestCommand(root: string): DetectedTestCommand | undefined {
  const has = (name: string) => existsSync(join(root, name));
  const configured = configuredTestCommand(root);
  const fallback = detectFromManifests(root, has);
  if (configured) {
    return {
      command: configured.command,
      setup: configured.setup ?? fallback?.setup,
      language: fallback?.language ?? "other",
    };
  }
  return fallback;
}

/** `.locus/environment.json` → `verify.test` and `install`, when the repo declares them. */
function configuredTestCommand(root: string): { command: string; setup?: string } | undefined {
  const text = readText(join(root, ".locus", "environment.json"));
  if (!text) return undefined;
  let raw: { verify?: unknown; install?: unknown };
  try {
    raw = JSON.parse(text) as { verify?: unknown; install?: unknown };
  } catch {
    return undefined;
  }
  const test = parseVerifyConfig(raw.verify).config?.test;
  if (typeof test !== "string" || !test.trim()) return undefined;
  const setup =
    typeof raw.install === "string" && raw.install.trim() ? raw.install.trim() : undefined;
  return { command: test.trim(), setup };
}

function detectFromManifests(
  root: string,
  has: (name: string) => boolean,
): DetectedTestCommand | undefined {
  if (has("package.json")) {
    let pkg: {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    } = {};
    try {
      pkg = JSON.parse(readText(join(root, "package.json")));
    } catch {
      /* malformed: treat as no scripts */
    }
    const test = pkg.scripts?.test?.trim();
    if (test && !/no test specified/i.test(test)) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const ts = has("tsconfig.json") || "typescript" in deps;
      const hasDeps = Object.keys(deps).length > 0;
      const setup = !hasDeps
        ? undefined
        : has("pnpm-lock.yaml")
          ? "pnpm install --frozen-lockfile"
          : has("yarn.lock")
            ? "yarn install --frozen-lockfile"
            : has("package-lock.json")
              ? "npm ci --no-audit --no-fund"
              : "npm install --no-audit --no-fund";
      const runner = has("pnpm-lock.yaml")
        ? "pnpm test"
        : has("yarn.lock")
          ? "yarn test"
          : "npm test";
      return { command: runner, setup, language: ts ? "typescript" : "javascript" };
    }
  }

  if (has("go.mod")) return { command: "go test -v ./...", language: "go" };

  if (has("Cargo.toml")) return { command: "cargo test", language: "rust" };

  const pyproject = readText(join(root, "pyproject.toml"));
  const requirements =
    readText(join(root, "requirements.txt")) + readText(join(root, "requirements-dev.txt"));
  const python =
    pyproject ||
    requirements ||
    has("setup.py") ||
    has("setup.cfg") ||
    has("pytest.ini") ||
    has("tox.ini") ||
    has("tests/__init__.py");
  if (python) {
    const pytest =
      has("pytest.ini") ||
      has("conftest.py") ||
      /pytest/i.test(pyproject) ||
      /pytest/i.test(requirements) ||
      /\[tool:pytest\]/.test(readText(join(root, "setup.cfg")));
    const setup = requirements
      ? `python3 -m pip install -r ${has("requirements-dev.txt") ? "requirements-dev.txt" : "requirements.txt"}`
      : pyproject && /\[project\]|\[tool\.poetry\]/.test(pyproject)
        ? "python3 -m pip install -e ."
        : undefined;
    return {
      command: pytest ? "python3 -m pytest -rA" : "python3 -m unittest discover -t . -v",
      setup,
      language: "python",
    };
  }

  return undefined;
}
