import type { TestOutputFormat } from "../testReport.js";

/**
 * Language-agnostic verification for the harness (publish test gate, post-edit
 * lint, benchmarks). A repo can pin commands in `.locus/environment.json`
 * under `verify`; otherwise {@link detectVerifyPresets} picks presets from a
 * file listing (npm/pnpm/yarn, Python, Go, Rust, Maven, Gradle, Makefile).
 */

export type VerifyStep = "test" | "lint" | "typecheck";
export const VERIFY_STEPS: readonly VerifyStep[] = ["test", "lint", "typecheck"];

/** One root's verify commands. `false` disables the step (no preset fallback). */
export interface VerifyCommands {
  test?: string | false;
  lint?: string | false;
  typecheck?: string | false;
  /** JUnit XML glob relative to the project root, read after `test` (e.g. `build/test-results/**\/*.xml`). */
  junit?: string;
  /** Per-step timeout in seconds (all steps of this root). */
  timeoutSec?: number;
}

/** A sub-project in a polyglot monorepo; changed files under `root` run its commands. */
export interface VerifyProject extends VerifyCommands {
  /** Repo-relative POSIX directory, e.g. `services/api`. */
  root: string;
}

/** `.locus/environment.json` → `verify`. */
export interface VerifyConfig extends VerifyCommands {
  /** When present, replaces auto-detected sub-projects. */
  projects?: VerifyProject[];
}

export interface VerifyConfigParse {
  config?: VerifyConfig;
  errors: string[];
}

export const MAX_VERIFY_TIMEOUT_SEC = 7200;

function normalizeRoot(raw: string): string | undefined {
  const root = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!root || root === ".") return ".";
  if (root.startsWith("/") || /^[A-Za-z]:/.test(root)) return undefined;
  if (root.split("/").some((part) => part === ".." || part === "")) return undefined;
  return root;
}

function parseCommands(
  value: Record<string, unknown>,
  where: string,
  errors: string[],
): VerifyCommands {
  const out: VerifyCommands = {};
  for (const step of VERIFY_STEPS) {
    const raw = value[step];
    if (raw === undefined || raw === null) continue;
    if (raw === false) out[step] = false;
    else if (typeof raw === "string" && raw.trim()) out[step] = raw.trim();
    else if (typeof raw === "string") out[step] = false;
    else errors.push(`${where}.${step} must be a command string or false`);
  }
  if (value.junit !== undefined) {
    if (typeof value.junit === "string" && value.junit.trim()) out.junit = value.junit.trim();
    else errors.push(`${where}.junit must be a non-empty glob string`);
  }
  if (value.timeoutSec !== undefined) {
    const n = value.timeoutSec;
    if (typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_VERIFY_TIMEOUT_SEC)
      out.timeoutSec = n;
    else
      errors.push(`${where}.timeoutSec must be a number between 1 and ${MAX_VERIFY_TIMEOUT_SEC}`);
  }
  return out;
}

/**
 * Validate a `verify` block. Invalid fields are dropped and reported in
 * `errors`; `config` is undefined when the block is absent or not an object.
 */
export function parseVerifyConfig(raw: unknown): VerifyConfigParse {
  const errors: string[] = [];
  if (raw === undefined || raw === null) return { errors };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["verify must be an object"] };
  }
  const value = raw as Record<string, unknown>;
  const config: VerifyConfig = parseCommands(value, "verify", errors);
  if (value.projects !== undefined) {
    if (!Array.isArray(value.projects)) {
      errors.push("verify.projects must be an array");
    } else {
      const projects: VerifyProject[] = [];
      const seen = new Set<string>();
      value.projects.forEach((item, index) => {
        const where = `verify.projects[${index}]`;
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push(`${where} must be an object`);
          return;
        }
        const row = item as Record<string, unknown>;
        const root = typeof row.root === "string" ? normalizeRoot(row.root) : undefined;
        if (!root || root === ".") {
          errors.push(`${where}.root must be a relative sub-directory without ..`);
          return;
        }
        if (seen.has(root)) {
          errors.push(`${where}.root duplicates ${root}`);
          return;
        }
        seen.add(root);
        projects.push({ root, ...parseCommands(row, where, errors) });
      });
      config.projects = projects;
    }
  }
  return { config, errors };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type VerifyPresetId =
  "npm" | "pnpm" | "yarn" | "make" | "rust" | "go" | "python" | "maven" | "gradle";

/** How one step runs at one root. */
export interface VerifyCommandPlan {
  /** Shell command as the agent would type it (also what counts as a verify run). */
  command: string;
  /** Command actually run when it differs (e.g. `go test -json ./...`). */
  run?: string;
  /** Parser hint for captured output. */
  format?: TestOutputFormat;
  /** JUnit XML glob, relative to the root, read after the run. */
  junit?: string;
  /**
   * `pytest`-style runners that accept `--junitxml=<path>`: the runner appends
   * a temp report path and reads it back.
   */
  junitFlag?: string;
  /** Too slow for per-edit feedback (compiles the project). */
  slow?: boolean;
  /** npm-family scripts keep the npm workspace planner (affected workspaces, missing-deps). */
  script?: { manager: "npm" | "pnpm" | "yarn"; name: VerifyStep };
  source: "config" | VerifyPresetId;
}

export interface VerifyPreset {
  id: VerifyPresetId;
  /** Repo-relative POSIX directory, `.` for the repo root. */
  root: string;
  steps: Partial<Record<VerifyStep, VerifyCommandPlan>>;
}

export interface VerifyDetectInput {
  /** Repo-relative POSIX paths (files only), typically a shallow walk. */
  files: string[];
  /**
   * Small manifest bodies keyed by repo-relative path (package.json,
   * Makefile, pyproject.toml, setup.cfg, tox.ini, requirements*.txt).
   */
  contents?: Record<string, string>;
}

/** Directory names never searched for nested projects. */
const SKIP_DIR =
  /(?:^|\/)(?:node_modules|\.git|vendor|target|build|dist|out|\.venv|venv|__pycache__|\.tox|\.gradle|\.mvn|\.locus-attachments|fixtures|__fixtures__|testdata|test-data|__tests__)(?:\/|$)/;

/** Files the server should read into {@link VerifyDetectInput.contents}. */
export function verifyManifestNames(): string[] {
  return [
    "package.json",
    "Makefile",
    "makefile",
    "GNUmakefile",
    "pyproject.toml",
    "setup.cfg",
    "tox.ini",
    "requirements.txt",
    "requirements-dev.txt",
    "requirements_dev.txt",
  ];
}

function dirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : path.slice(0, index);
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function joinRel(root: string, name: string): string {
  return root === "." ? name : `${root}/${name}`;
}

function under(root: string, path: string): boolean {
  return root === "." || path === root || path.startsWith(`${root}/`);
}

interface RootFacts {
  root: string;
  names: Set<string>;
  /** Paths relative to the root (any depth in the listing). */
  rel: string[];
  read: (name: string) => string | undefined;
}

function scriptsOf(body: string | undefined): Record<string, string> | undefined | "invalid" {
  if (body === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid";
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (scripts === undefined) return {};
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return "invalid";
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(scripts)) {
      if (typeof value !== "string") return "invalid";
      out[key] = value;
    }
    return out;
  } catch {
    return "invalid";
  }
}

function jsPreset(facts: RootFacts): VerifyPreset | undefined {
  if (!facts.names.has("package.json")) return undefined;
  const id: VerifyPresetId = facts.names.has("pnpm-lock.yaml")
    ? "pnpm"
    : facts.names.has("yarn.lock")
      ? "yarn"
      : "npm";
  const scripts = scriptsOf(facts.read("package.json"));
  const steps: VerifyPreset["steps"] = {};
  for (const step of VERIFY_STEPS) {
    // Unreadable or malformed manifests go through the npm planner, which fails closed.
    const has =
      scripts === undefined || scripts === "invalid"
        ? step !== "typecheck"
        : Boolean(scripts[step]?.trim());
    if (!has) continue;
    steps[step] = {
      command: `${id} run ${step}`,
      script: { manager: id, name: step },
      source: id,
    };
  }
  return { id, root: facts.root, steps };
}

function makeTargets(body: string | undefined): Set<string> {
  const targets = new Set<string>();
  if (!body) return targets;
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+)*)\s*::?(?!=)/.exec(line);
    if (!match) continue;
    for (const name of match[1]!.split(/\s+/)) targets.add(name);
  }
  return targets;
}

function makePreset(facts: RootFacts): VerifyPreset | undefined {
  const file = ["GNUmakefile", "makefile", "Makefile"].find((name) => facts.names.has(name));
  if (!file) return undefined;
  const targets = makeTargets(facts.read(file));
  const steps: VerifyPreset["steps"] = {};
  if (targets.has("test")) steps.test = { command: "make test", source: "make" };
  if (targets.has("lint")) steps.lint = { command: "make lint", source: "make", slow: true };
  if (targets.has("typecheck"))
    steps.typecheck = { command: "make typecheck", source: "make", slow: true };
  return Object.keys(steps).length ? { id: "make", root: facts.root, steps } : undefined;
}

function rustPreset(facts: RootFacts): VerifyPreset | undefined {
  if (!facts.names.has("Cargo.toml")) return undefined;
  return {
    id: "rust",
    root: facts.root,
    steps: {
      test: { command: "cargo test", format: "cargo", source: "rust" },
      lint: { command: "cargo clippy --all-targets", source: "rust", slow: true },
      typecheck: { command: "cargo check --all-targets", source: "rust", slow: true },
    },
  };
}

function goPreset(facts: RootFacts): VerifyPreset | undefined {
  if (!facts.names.has("go.mod")) return undefined;
  return {
    id: "go",
    root: facts.root,
    steps: {
      test: {
        command: "go test ./...",
        run: "go test -json ./...",
        format: "go-json",
        source: "go",
      },
      lint: { command: "go vet ./...", source: "go", slow: true },
      typecheck: { command: "go build ./...", source: "go", slow: true },
    },
  };
}

const PYTHON_MARKERS = [
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "tox.ini",
  "pytest.ini",
  "Pipfile",
  "requirements.txt",
];

function pythonPreset(facts: RootFacts): VerifyPreset | undefined {
  if (!PYTHON_MARKERS.some((name) => facts.names.has(name))) return undefined;
  const pyproject = facts.read("pyproject.toml") ?? "";
  const setupCfg = facts.read("setup.cfg") ?? "";
  const tox = facts.read("tox.ini") ?? "";
  const requirements = ["requirements.txt", "requirements-dev.txt", "requirements_dev.txt"]
    .map((name) => facts.read(name) ?? "")
    .join("\n");
  const prefix = facts.names.has("uv.lock")
    ? "uv run "
    : facts.names.has("poetry.lock")
      ? "poetry run "
      : "";
  const hasTestFiles = facts.rel.some(
    (path) =>
      /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/.test(path) || /(?:^|\/)conftest\.py$/.test(path),
  );
  const pytest =
    facts.names.has("pytest.ini") ||
    /\[tool\.pytest/.test(pyproject) ||
    /\[tool:pytest\]/.test(setupCfg) ||
    /^\[pytest\]/m.test(tox) ||
    /\bpytest\b/i.test(requirements) ||
    /\bpytest\b/.test(pyproject) ||
    hasTestFiles;
  const steps: VerifyPreset["steps"] = {};
  if (pytest) {
    steps.test = {
      command: `${prefix}pytest -q`,
      format: "pytest",
      junitFlag: "--junitxml",
      source: "python",
    };
  } else if (facts.names.has("tox.ini")) {
    steps.test = { command: "tox -q", format: "pytest", source: "python" };
  }
  if (
    facts.names.has("ruff.toml") ||
    facts.names.has(".ruff.toml") ||
    /\[tool\.ruff/.test(pyproject)
  ) {
    steps.lint = { command: `${prefix}ruff check .`, source: "python" };
  } else if (facts.names.has(".flake8") || /^\[flake8\]/m.test(setupCfg + "\n" + tox)) {
    steps.lint = { command: `${prefix}flake8`, source: "python" };
  }
  if (
    facts.names.has("mypy.ini") ||
    facts.names.has(".mypy.ini") ||
    /\[tool\.mypy/.test(pyproject) ||
    /^\[mypy\]/m.test(setupCfg)
  ) {
    steps.typecheck = { command: `${prefix}mypy .`, source: "python", slow: true };
  } else if (facts.names.has("pyrightconfig.json") || /\[tool\.pyright/.test(pyproject)) {
    steps.typecheck = { command: `${prefix}pyright`, source: "python", slow: true };
  }
  return { id: "python", root: facts.root, steps };
}

function mavenPreset(facts: RootFacts): VerifyPreset | undefined {
  if (!facts.names.has("pom.xml")) return undefined;
  const mvn = facts.names.has("mvnw") ? "./mvnw" : "mvn";
  return {
    id: "maven",
    root: facts.root,
    steps: {
      test: {
        command: `${mvn} -B test`,
        junit: "**/target/surefire-reports/TEST-*.xml",
        format: "junit",
        source: "maven",
      },
      typecheck: { command: `${mvn} -B -q compile`, source: "maven", slow: true },
    },
  };
}

function gradlePreset(facts: RootFacts): VerifyPreset | undefined {
  const marker = [
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
  ].some((name) => facts.names.has(name));
  if (!marker) return undefined;
  const gradle = facts.names.has("gradlew") ? "./gradlew" : "gradle";
  return {
    id: "gradle",
    root: facts.root,
    steps: {
      test: {
        command: `${gradle} test`,
        junit: "**/build/test-results/**/*.xml",
        format: "junit",
        source: "gradle",
      },
      lint: { command: `${gradle} check -x test`, source: "gradle", slow: true },
    },
  };
}

/** Root resolution order: earlier presets win a step at the same root. */
const DETECTORS: Array<(facts: RootFacts) => VerifyPreset | undefined> = [
  jsPreset,
  makePreset,
  rustPreset,
  goPreset,
  pythonPreset,
  mavenPreset,
  gradlePreset,
];

/** Build tools whose root build already covers nested manifests of the same kind (Go modules do not). */
const COVERS_NESTED: Partial<Record<VerifyPresetId, true>> = {
  rust: true,
  maven: true,
  gradle: true,
  python: true,
};

const ROOT_MARKERS = new Set([
  "package.json",
  "Makefile",
  "makefile",
  "GNUmakefile",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  ...PYTHON_MARKERS,
]);

function family(id: VerifyPresetId): string {
  return id === "pnpm" || id === "yarn" ? "npm" : id;
}

/**
 * Detect verify presets from a file listing. Returns presets for the repo
 * root (`.`) and nested project roots, ordered by root (root first) then by
 * preset priority. Pure: callers supply manifest bodies via `contents`.
 */
export function detectVerifyPresets(input: VerifyDetectInput): VerifyPreset[] {
  const files = input.files
    .map((file) => file.replace(/\\/g, "/").replace(/^\.\/+/, ""))
    .filter((file) => file && !file.startsWith("../"));
  const roots = new Set<string>(["."]);
  for (const file of files) {
    if (!ROOT_MARKERS.has(baseOf(file))) continue;
    const dir = dirOf(file);
    if (dir !== "." && SKIP_DIR.test(dir)) continue;
    roots.add(dir);
  }
  const ordered = [...roots].sort((a, b) =>
    a === "."
      ? -1
      : b === "."
        ? 1
        : a.split("/").length - b.split("/").length || a.localeCompare(b),
  );
  const accepted: VerifyPreset[] = [];
  for (const root of ordered) {
    const rel = files
      .filter((file) => under(root, file))
      .map((file) => (root === "." ? file : file.slice(root.length + 1)));
    const names = new Set(rel.filter((file) => !file.includes("/")));
    const facts: RootFacts = {
      root,
      names,
      rel,
      read: (name) => input.contents?.[joinRel(root, name)],
    };
    for (const detect of DETECTORS) {
      const preset = detect(facts);
      if (!preset || !Object.keys(preset.steps).length) continue;
      if (root !== ".") {
        const fam = family(preset.id);
        if (fam === "npm") {
          // A nested package.json is a workspace member unless it carries its own lockfile.
          const ownLock = [
            "package-lock.json",
            "pnpm-lock.yaml",
            "yarn.lock",
            "npm-shrinkwrap.json",
          ];
          if (!ownLock.some((lock) => names.has(lock))) continue;
        } else {
          const covered = accepted.some(
            (row) =>
              row.root !== root &&
              under(row.root, root) &&
              family(row.id) === fam &&
              COVERS_NESTED[row.id],
          );
          if (covered) continue;
        }
        // Make orchestration below the root only matters when nothing else claims the dir.
        if (preset.id === "make") continue;
      }
      accepted.push(preset);
    }
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/** Commands for one root after merging config over presets. */
export interface VerifyTarget {
  /** Repo-relative POSIX directory, `.` for the repo root. */
  root: string;
  steps: Partial<Record<VerifyStep, VerifyCommandPlan>>;
  timeoutSec?: number;
  /** Preset ids that contributed (for display). */
  presets: VerifyPresetId[];
}

function sniffFormat(command: string): TestOutputFormat | undefined {
  if (/\bgo\s+test\b.*\s-json\b/.test(command)) return "go-json";
  if (/\bcargo\s+(?:test|nextest)\b/.test(command)) return "cargo";
  if (/\bpytest\b/.test(command)) return "pytest";
  if (/\bvitest\b/.test(command)) return "vitest";
  if (/\bjest\b/.test(command)) return "jest";
  return undefined;
}

function mergeTarget(
  root: string,
  commands: VerifyCommands | undefined,
  presets: VerifyPreset[],
): VerifyTarget {
  const atRoot = presets.filter((preset) => preset.root === root);
  const steps: VerifyTarget["steps"] = {};
  const used = new Set<VerifyPresetId>();
  for (const step of VERIFY_STEPS) {
    const configured = commands?.[step];
    if (configured === false) continue;
    if (typeof configured === "string") {
      const format = sniffFormat(configured);
      steps[step] = {
        command: configured,
        source: "config",
        ...(format ? { format } : {}),
        ...(step === "test" && commands?.junit ? { junit: commands.junit, format: "junit" } : {}),
      };
      continue;
    }
    const preset = atRoot.find((row) => row.steps[step]);
    if (!preset) continue;
    used.add(preset.id);
    const plan = preset.steps[step]!;
    steps[step] =
      step === "test" && commands?.junit
        ? { ...plan, junit: commands.junit, format: "junit" }
        : plan;
  }
  return {
    root,
    steps,
    ...(commands?.timeoutSec ? { timeoutSec: commands.timeoutSec } : {}),
    presets: [...used],
  };
}

/**
 * Merge a `verify` config over detected presets. The first target is always
 * the repo root; the rest are sub-projects (config `projects` when given,
 * otherwise nested detected presets). Targets without any step are dropped
 * except the root.
 */
export function resolveVerifyPlan(
  config: VerifyConfig | undefined,
  presets: VerifyPreset[],
): VerifyTarget[] {
  const root = mergeTarget(".", config, presets);
  const projectRoots = config?.projects
    ? config.projects.map((project) => project.root)
    : [...new Set(presets.map((preset) => preset.root).filter((dir) => dir !== "."))];
  const projects = projectRoots
    .map((dir) =>
      mergeTarget(
        dir,
        config?.projects?.find((project) => project.root === dir),
        presets,
      ),
    )
    .filter((target) => Object.keys(target.steps).length);
  return [root, ...projects];
}

/** Deepest target whose root contains `path` (repo-relative POSIX). */
export function verifyTargetForPath(targets: VerifyTarget[], path: string): VerifyTarget {
  const norm = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  let best = targets[0]!;
  for (const target of targets) {
    if (target.root === ".") continue;
    if (!under(target.root, norm)) continue;
    if (best.root === "." || target.root.length > best.root.length) best = target;
  }
  return best;
}

/** Every command a target plan would run, for "did the agent verify?" detection and prompts. */
export function verifyPlanCommands(targets: VerifyTarget[]): string[] {
  const out = new Set<string>();
  for (const target of targets) {
    for (const step of VERIFY_STEPS) {
      const plan = target.steps[step];
      if (plan) out.add(plan.command);
    }
  }
  return [...out];
}

/** One line per target for prompts and docs: `services/api: test `go test ./...``. */
export function describeVerifyPlan(targets: VerifyTarget[]): string[] {
  return targets
    .filter((target) => Object.keys(target.steps).length)
    .map((target) => {
      const parts = VERIFY_STEPS.filter((step) => target.steps[step]).map(
        (step) => `${step} \`${target.steps[step]!.command}\``,
      );
      return `${target.root === "." ? "(root)" : target.root}: ${parts.join(", ")}`;
    });
}
