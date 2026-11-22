import { describe, expect, it } from "vitest";
import { parseLocusEnvironment } from "./environment.js";
import {
  describeVerifyPlan,
  detectVerifyPresets,
  parseVerifyConfig,
  resolveVerifyPlan,
  verifyPlanCommands,
  verifyTargetForPath,
  type VerifyPreset,
} from "./verify.js";

const ids = (presets: VerifyPreset[]) => presets.map((p) => `${p.root}:${p.id}`);
const steps = (preset: VerifyPreset | undefined) =>
  Object.fromEntries(Object.entries(preset?.steps ?? {}).map(([k, v]) => [k, v.command]));

describe("parseVerifyConfig", () => {
  it("parses commands, junit, timeout, and projects", () => {
    expect(
      parseVerifyConfig({
        test: " pytest -q ",
        lint: "ruff check .",
        typecheck: false,
        junit: "reports/*.xml",
        timeoutSec: 600,
        projects: [{ root: "./services/api/", test: "go test ./..." }],
      }),
    ).toEqual({
      config: {
        test: "pytest -q",
        lint: "ruff check .",
        typecheck: false,
        junit: "reports/*.xml",
        timeoutSec: 600,
        projects: [{ root: "services/api", test: "go test ./..." }],
      },
      errors: [],
    });
  });

  it("reports invalid fields and drops them", () => {
    const parsed = parseVerifyConfig({
      test: 42,
      timeoutSec: -1,
      junit: "",
      projects: [
        { root: "../escape" },
        { root: "/abs" },
        { root: "a", lint: "x" },
        { root: "a" },
        7,
      ],
    });
    expect(parsed.config).toEqual({ projects: [{ root: "a", lint: "x" }] });
    expect(parsed.errors).toEqual([
      "verify.test must be a command string or false",
      "verify.junit must be a non-empty glob string",
      "verify.timeoutSec must be a number between 1 and 7200",
      "verify.projects[0].root must be a relative sub-directory without ..",
      "verify.projects[1].root must be a relative sub-directory without ..",
      "verify.projects[3].root duplicates a",
      "verify.projects[4] must be an object",
    ]);
    expect(parseVerifyConfig(undefined)).toEqual({ errors: [] });
    expect(parseVerifyConfig("pytest")).toEqual({ errors: ["verify must be an object"] });
    expect(parseVerifyConfig({ projects: {} }).errors).toEqual([
      "verify.projects must be an array",
    ]);
  });

  it("is carried on LocusEnvironment, even alone", () => {
    expect(parseLocusEnvironment({ verify: { test: "cargo test" } })).toEqual({
      packages: undefined,
      install: undefined,
      ports: undefined,
      start: undefined,
      image: undefined,
      env: undefined,
      verify: { test: "cargo test" },
    });
    expect(parseLocusEnvironment({ install: "npm ci" })).not.toHaveProperty("verify");
  });
});

describe("detectVerifyPresets", () => {
  it("keeps npm scripts on the npm planner and picks pnpm / yarn from lockfiles", () => {
    const pkg = JSON.stringify({
      scripts: { test: "vitest run", lint: "eslint .", typecheck: "tsc" },
    });
    const npm = detectVerifyPresets({
      files: ["package.json", "package-lock.json"],
      contents: { "package.json": pkg },
    });
    expect(ids(npm)).toEqual([".:npm"]);
    expect(npm[0]!.steps.test).toEqual({
      command: "npm run test",
      script: { manager: "npm", name: "test" },
      source: "npm",
    });
    expect(steps(npm[0])).toEqual({
      test: "npm run test",
      lint: "npm run lint",
      typecheck: "npm run typecheck",
    });
    const pnpm = detectVerifyPresets({
      files: ["package.json", "pnpm-lock.yaml"],
      contents: { "package.json": pkg },
    });
    expect(pnpm[0]!.steps.test?.script).toEqual({ manager: "pnpm", name: "test" });
    const yarn = detectVerifyPresets({
      files: ["package.json", "yarn.lock"],
      contents: { "package.json": pkg },
    });
    expect(steps(yarn[0]).lint).toBe("yarn run lint");
  });

  it("routes unreadable or malformed package.json to the npm planner (fails closed)", () => {
    expect(steps(detectVerifyPresets({ files: ["package.json"] })[0])).toEqual({
      test: "npm run test",
      lint: "npm run lint",
    });
    expect(
      steps(detectVerifyPresets({ files: ["package.json"], contents: { "package.json": "{" } })[0]),
    ).toEqual({ test: "npm run test", lint: "npm run lint" });
  });

  it("falls through to other presets when package.json lacks a script", () => {
    const presets = detectVerifyPresets({
      files: ["package.json", "Makefile"],
      contents: {
        "package.json": "{}",
        Makefile: "test: build\n\tgo test ./...\nlint:\n\tgolangci-lint run\n",
      },
    });
    expect(ids(presets)).toEqual([".:make"]);
    expect(steps(presets[0])).toEqual({ test: "make test", lint: "make lint" });
  });

  it("detects Python with pytest, ruff, mypy, and uv / poetry runners", () => {
    const presets = detectVerifyPresets({
      files: ["pyproject.toml", "uv.lock", "src/app/__init__.py", "tests/test_app.py"],
      contents: {
        "pyproject.toml": "[tool.ruff]\nline-length = 100\n[tool.mypy]\nstrict = true\n",
      },
    });
    expect(ids(presets)).toEqual([".:python"]);
    expect(presets[0]!.steps.test).toMatchObject({
      command: "uv run pytest -q",
      junitFlag: "--junitxml",
      format: "pytest",
    });
    expect(steps(presets[0])).toEqual({
      test: "uv run pytest -q",
      lint: "uv run ruff check .",
      typecheck: "uv run mypy .",
    });
    const poetry = detectVerifyPresets({
      files: ["pyproject.toml", "poetry.lock", "setup.cfg"],
      contents: {
        "pyproject.toml": "[tool.pytest.ini_options]\n",
        "setup.cfg": "[flake8]\nmax-line-length=99\n",
      },
    });
    expect(steps(poetry[0])).toEqual({ test: "poetry run pytest -q", lint: "poetry run flake8" });
    const tox = detectVerifyPresets({
      files: ["tox.ini", "setup.py"],
      contents: { "tox.ini": "[tox]\nenvlist=py3\n" },
    });
    expect(steps(tox[0])).toEqual({ test: "tox -q" });
    expect(
      detectVerifyPresets({
        files: ["requirements.txt"],
        contents: { "requirements.txt": "flask\n" },
      }),
    ).toEqual([]);
  });

  it("detects Go, Rust, Maven, and Gradle with machine-readable output", () => {
    const go = detectVerifyPresets({ files: ["go.mod", "main.go"] });
    expect(go[0]!.steps.test).toMatchObject({
      command: "go test ./...",
      run: "go test -json ./...",
      format: "go-json",
    });
    expect(steps(go[0])).toEqual({
      test: "go test ./...",
      lint: "go vet ./...",
      typecheck: "go build ./...",
    });
    expect(go[0]!.steps.lint?.slow).toBe(true);

    const rust = detectVerifyPresets({
      files: ["Cargo.toml", "src/lib.rs", "crates/a/Cargo.toml"],
    });
    expect(ids(rust)).toEqual([".:rust"]);
    expect(steps(rust[0])).toEqual({
      test: "cargo test",
      lint: "cargo clippy --all-targets",
      typecheck: "cargo check --all-targets",
    });

    const maven = detectVerifyPresets({ files: ["pom.xml", "mvnw", "core/pom.xml"] });
    expect(ids(maven)).toEqual([".:maven"]);
    expect(maven[0]!.steps.test).toMatchObject({
      command: "./mvnw -B test",
      junit: "**/target/surefire-reports/TEST-*.xml",
    });

    const gradle = detectVerifyPresets({
      files: ["settings.gradle.kts", "gradlew", "app/build.gradle.kts"],
    });
    expect(ids(gradle)).toEqual([".:gradle"]);
    expect(gradle[0]!.steps.test).toMatchObject({
      command: "./gradlew test",
      junit: "**/build/test-results/**/*.xml",
    });
    expect(steps(detectVerifyPresets({ files: ["build.gradle"] })[0]).test).toBe("gradle test");
  });

  it("prefers JS, then Makefile, then language presets per step at one root", () => {
    const presets = detectVerifyPresets({
      files: ["package.json", "Makefile", "go.mod"],
      contents: {
        "package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
        Makefile: "test:\n\tgo test ./...\n",
      },
    });
    expect(ids(presets)).toEqual([".:npm", ".:make", ".:go"]);
    const [root] = resolveVerifyPlan(undefined, presets);
    expect(root!.steps.lint?.command).toBe("npm run lint");
    expect(root!.steps.test?.command).toBe("make test");
    expect(root!.steps.typecheck?.command).toBe("go build ./...");
    expect(root!.presets.sort()).toEqual(["go", "make", "npm"]);
  });

  it("finds polyglot sub-projects but not workspace members, fixtures, or vendored code", () => {
    const presets = detectVerifyPresets({
      files: [
        "package.json",
        "package-lock.json",
        "apps/web/package.json",
        "apps/desktop/src-tauri/Cargo.toml",
        "services/api/go.mod",
        "services/ml/pyproject.toml",
        "services/ml/tests/test_model.py",
        "tools/standalone/package.json",
        "tools/standalone/pnpm-lock.yaml",
        "node_modules/x/go.mod",
        "apps/server/fixtures/sample/Cargo.toml",
        "vendor/lib/go.mod",
        "scripts/Makefile",
      ],
      contents: {
        "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
        "tools/standalone/package.json": JSON.stringify({ scripts: { test: "jest" } }),
        "scripts/Makefile": "test:\n\techo\n",
      },
    });
    expect(ids(presets)).toEqual([
      ".:npm",
      "services/api:go",
      "services/ml:python",
      "tools/standalone:pnpm",
      "apps/desktop/src-tauri:rust",
    ]);
  });
});

describe("resolveVerifyPlan", () => {
  const presets = detectVerifyPresets({
    files: ["go.mod", "web/package.json", "web/package-lock.json"],
    contents: { "web/package.json": JSON.stringify({ scripts: { test: "vitest run" } }) },
  });

  it("lets config override presets per step, disable steps, and add JUnit globs", () => {
    const [root, web] = resolveVerifyPlan(
      { test: "go test -json -race ./...", lint: false, junit: undefined, timeoutSec: 300 },
      presets,
    );
    expect(root).toMatchObject({
      root: ".",
      timeoutSec: 300,
      steps: {
        test: { command: "go test -json -race ./...", source: "config", format: "go-json" },
        typecheck: { command: "go build ./...", source: "go" },
      },
    });
    expect(root!.steps.lint).toBeUndefined();
    expect(web).toMatchObject({ root: "web", steps: { test: { command: "npm run test" } } });

    const [withJunit] = resolveVerifyPlan({ test: "make ci", junit: "out/**/*.xml" }, presets);
    expect(withJunit!.steps.test).toEqual({
      command: "make ci",
      source: "config",
      junit: "out/**/*.xml",
      format: "junit",
    });
  });

  it("uses configured projects instead of detected ones and fills gaps from presets", () => {
    const targets = resolveVerifyPlan(
      { projects: [{ root: "web", lint: "npx eslint ." }, { root: "empty" }] },
      presets,
    );
    expect(targets.map((t) => t.root)).toEqual([".", "web"]);
    expect(targets[1]!.steps).toMatchObject({
      test: { command: "npm run test" },
      lint: { command: "npx eslint .", source: "config" },
    });
  });

  it("maps paths to the deepest target and lists commands", () => {
    const targets = resolveVerifyPlan(
      {
        projects: [
          { root: "svc", test: "a" },
          { root: "svc/inner", test: "b" },
        ],
      },
      [],
    );
    expect(verifyTargetForPath(targets, "svc/inner/x.go").root).toBe("svc/inner");
    expect(verifyTargetForPath(targets, "svc/x.go").root).toBe("svc");
    expect(verifyTargetForPath(targets, "svcx/y").root).toBe(".");
    expect(verifyTargetForPath(targets, "./README.md").root).toBe(".");
    expect(verifyPlanCommands(resolveVerifyPlan(undefined, presets))).toEqual([
      "go test ./...",
      "go vet ./...",
      "go build ./...",
      "npm run test",
    ]);
    expect(describeVerifyPlan(resolveVerifyPlan(undefined, presets))).toEqual([
      "(root): test `go test ./...`, lint `go vet ./...`, typecheck `go build ./...`",
      "web: test `npm run test`",
    ]);
  });
});
