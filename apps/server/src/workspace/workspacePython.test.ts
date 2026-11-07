import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indentFromEditorConfig } from "./workspaceEditorConfig.js";
import {
  completePythonFile,
  detectPythonProject,
  inspectPythonFile,
  PYTHON_LIB_PREFIX,
  pythonLibraryRelFromAbs,
  readPythonLibraryFile,
  referencesPythonFile,
  resetWorkspacePython,
  resolvePylspCommand,
  resolvePythonInterpreter,
  setPythonInterpreterOverride,
} from "./workspacePython.js";

let cleanup: string[] = [];
const envPython = process.env.LOCUS_PYTHON;
const envVenv = process.env.VIRTUAL_ENV;
afterEach(async () => {
  resetWorkspacePython();
  setPythonInterpreterOverride(undefined);
  if (envPython === undefined) delete process.env.LOCUS_PYTHON;
  else process.env.LOCUS_PYTHON = envPython;
  if (envVenv === undefined) delete process.env.VIRTUAL_ENV;
  else process.env.VIRTUAL_ENV = envVenv;
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanup = [];
});

describe("detectPythonProject", () => {
  it("labels Django from manage.py and settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-django-"));
    cleanup.push(dir);
    await mkdir(join(dir, "config"));
    await writeFile(join(dir, "manage.py"), "#!/usr/bin/env python\n");
    await writeFile(join(dir, "config", "settings.py"), "SECRET_KEY = 'x'\nINSTALLED_APPS = []\n");
    const detected = detectPythonProject(dir);
    expect(detected.kind).toBe("django");
    expect(detected.djangoSettings).toBe("config.settings");
  });

  it("reads DJANGO_SETTINGS_MODULE from manage.py in a src layout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-django-src-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src", "config"), { recursive: true });
    await mkdir(join(dir, "src", "blog"), { recursive: true });
    await writeFile(
      join(dir, "manage.py"),
      '#!/usr/bin/env python\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\n',
    );
    await writeFile(join(dir, "src", "config", "settings.py"), "SECRET_KEY = 'x'\n");
    await writeFile(join(dir, "src", "blog", "apps.py"), "class BlogConfig: name = 'blog'\n");
    const detected = detectPythonProject(dir);
    expect(detected.kind).toBe("django");
    expect(detected.djangoSettings).toBe("config.settings");
    expect(detected.extraPaths.some((path) => path.endsWith("src"))).toBe(true);
  });

  it("maps a src/settings.py path to config.settings when src is on extraPaths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-django-src-settings-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src", "config"), { recursive: true });
    await writeFile(join(dir, "manage.py"), "#!/usr/bin/env python\n");
    await writeFile(join(dir, "src", "config", "settings.py"), "SECRET_KEY = 'x'\n");
    const detected = detectPythonProject(dir);
    expect(detected.kind).toBe("django");
    expect(detected.djangoSettings).toBe("config.settings");
  });

  it("labels Flask from an app factory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-flask-"));
    cleanup.push(dir);
    await writeFile(join(dir, "app.py"), "from flask import Flask\napp = Flask(__name__)\n");
    expect(detectPythonProject(dir).kind).toBe("flask");
  });

  it("labels Flask from an src-layout package", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-flask-src-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src", "flask"), { recursive: true });
    await writeFile(join(dir, "pyproject.toml"), '[project]\nname = "flask"\ndependencies = []\n');
    await writeFile(join(dir, "src", "flask", "__init__.py"), "from .app import Flask\n");
    expect(detectPythonProject(dir).kind).toBe("flask");
    expect(detectPythonProject(dir).extraPaths.some((path) => path.endsWith("src"))).toBe(true);
  });
});

describe("resolvePythonInterpreter", () => {
  async function touchVenv(root: string, name: string) {
    const bin = join(root, name, process.platform === "win32" ? "Scripts" : "bin");
    await mkdir(bin, { recursive: true });
    const python = join(bin, process.platform === "win32" ? "python.exe" : "python");
    await writeFile(python, "");
    return python;
  }

  it("finds a project .venv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-py-venv-"));
    cleanup.push(dir);
    delete process.env.LOCUS_PYTHON;
    delete process.env.VIRTUAL_ENV;
    const python = await touchVenv(dir, ".venv");
    expect(resolvePythonInterpreter(dir)).toBe(python);
  });

  it.skipIf(process.platform === "win32")(
    "uses python.defaultInterpreterPath from .vscode/settings.json",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-py-vscode-"));
      cleanup.push(dir);
      delete process.env.LOCUS_PYTHON;
      delete process.env.VIRTUAL_ENV;
      const python = await touchVenv(dir, ".customenv");
      await mkdir(join(dir, ".vscode"));
      await writeFile(
        join(dir, ".vscode", "settings.json"),
        JSON.stringify({
          "python.defaultInterpreterPath":
            "${workspaceFolder}/.customenv/" +
            (process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
        }),
      );
      await touchVenv(dir, ".venv");
      expect(resolvePythonInterpreter(dir)).toBe(python);
    },
  );

  it("uses pyrightconfig venvPath and venv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-py-pyright-"));
    cleanup.push(dir);
    delete process.env.LOCUS_PYTHON;
    delete process.env.VIRTUAL_ENV;
    const python = await touchVenv(dir, "envs/django");
    await writeFile(
      join(dir, "pyrightconfig.json"),
      JSON.stringify({ venvPath: ".", venv: "envs/django" }),
    );
    expect(resolvePythonInterpreter(dir)).toBe(python);
  });

  it.skipIf(process.platform === "win32")(
    "lets Settings / LOCUS_PYTHON override a local venv",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "locus-py-override-"));
      cleanup.push(dir);
      delete process.env.VIRTUAL_ENV;
      await touchVenv(dir, ".venv");
      const python = await touchVenv(dir, "conda-env");
      setPythonInterpreterOverride(
        "${workspaceFolder}/conda-env/" +
          (process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      );
      expect(resolvePythonInterpreter(dir)).toBe(python);
    },
  );
});

describe("indentFromEditorConfig", () => {
  it("reads indent_size for matching globs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-editorconfig-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, ".editorconfig"),
      "root = true\n\n[*.py]\nindent_style = space\nindent_size = 4\n\n[*.{ts,tsx}]\nindent_size = 2\n",
    );
    expect(indentFromEditorConfig(dir, "src/app.py")).toEqual({ indent: "    ", tabSize: 4 });
    expect(indentFromEditorConfig(dir, "src/app.ts")).toEqual({ indent: "  ", tabSize: 2 });
  });
});

function pylspInstalled(): boolean {
  const cmd = resolvePylspCommand();
  if (!cmd) return false;
  const probe = spawnSync(cmd.command, [...cmd.args, "--help"], {
    timeout: 8_000,
    encoding: "utf8",
  });
  return probe.status === 0;
}

describe("completePythonFile", () => {
  it("completes a local function through pylsp when installed", async () => {
    if (!pylspInstalled()) return;
    const dir = await mkdtemp(join(tmpdir(), "locus-pylsp-"));
    cleanup.push(dir);
    const content = "def greet_name(name):\n    return name\n\ngreet_";
    await writeFile(join(dir, "app.py"), `${content}\n`);
    const result = await completePythonFile({
      root: dir,
      rel: "app.py",
      content,
      line: 3,
      character: 6,
    });
    expect(result.source).toBe("python");
    expect(result.items.some((item) => item.label.includes("greet_name"))).toBe(true);
  }, 20_000);
});

describe("python library locations", () => {
  it("maps site-packages files under __python__ instead of a file URI", () => {
    expect(
      pythonLibraryRelFromAbs("/home/me/.local/lib/python3.12/site-packages/django/shortcuts.py"),
    ).toBe(`${PYTHON_LIB_PREFIX}django/shortcuts.py`);
    expect(
      pythonLibraryRelFromAbs(
        "C:\\Users\\me\\AppData\\Roaming\\Python\\Python312\\site-packages\\flask\\app.py",
      ),
    ).toBe(`${PYTHON_LIB_PREFIX}flask/app.py`);
  });

  it("does not treat workspace files as library paths", () => {
    expect(pythonLibraryRelFromAbs("/tmp/project/blog/models.py")).toBe("");
  });
});

describe("inspectPythonFile Django", () => {
  it("goes to a local model and opens Django shortcuts from site-packages", async () => {
    if (!pylspInstalled()) return;
    const dir = await mkdtemp(join(tmpdir(), "locus-django-nav-"));
    cleanup.push(dir);
    await mkdir(join(dir, "src", "blog"), { recursive: true });
    await mkdir(join(dir, "src", "config"), { recursive: true });
    await writeFile(
      join(dir, "manage.py"),
      'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")\n',
    );
    await writeFile(join(dir, "src", "config", "__init__.py"), "");
    await writeFile(
      join(dir, "src", "config", "settings.py"),
      "SECRET_KEY = 'x'\nINSTALLED_APPS = ['blog']\n",
    );
    await writeFile(join(dir, "src", "blog", "__init__.py"), "");
    const models = "class Post:\n    title = 't'\n";
    await writeFile(join(dir, "src", "blog", "models.py"), models);
    const views =
      "from django.shortcuts import render\nfrom blog.models import Post\n\ndef index():\n    return Post\n";
    await writeFile(join(dir, "src", "blog", "views.py"), views);
    const post = await inspectPythonFile({
      root: dir,
      rel: "src/blog/views.py",
      content: views,
      line: 1,
      character: 24,
    });
    expect(post.definition).toEqual({ path: "src/blog/models.py", line: 0, character: 6 });
    const refs = await referencesPythonFile({
      root: dir,
      rel: "src/blog/models.py",
      content: models,
      line: 0,
      character: 6,
    });
    expect(refs.items.some((item) => item.path === "src/blog/views.py")).toBe(true);
    const render = await inspectPythonFile({
      root: dir,
      rel: "src/blog/views.py",
      content: views,
      line: 0,
      character: 32,
    });
    if (!render.definition) return;
    expect(render.definition.path.startsWith(PYTHON_LIB_PREFIX)).toBe(true);
    expect(render.definition.path).not.toMatch(/^file:/);
    const lib = readPythonLibraryFile(dir, render.definition.path);
    expect(lib?.content).toMatch(/def render/);
  }, 30_000);
});
