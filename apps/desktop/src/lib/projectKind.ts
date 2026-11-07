export type ProjectKind = "react" | "next" | "vite" | "django" | "python" | "node" | "html" | "";

const NEXT_FILES = /(?:^|\/)next\.config\.(js|mjs|ts|cjs)$/i;
const VITE_FILES = /(?:^|\/)vite\.config\.(js|mjs|ts|cjs)$/i;
const DJANGO_FILES = /(?:^|\/)manage\.py$/i;
const PYTHON_FILES = /(?:^|\/)(pyproject\.toml|requirements\.txt|Pipfile|setup\.py)$/i;
const NODE_FILES = /(?:^|\/)package\.json$/i;
const HTML_FILES = /\.(html|htm)$/i;
const REACT_FILES = /\.(tsx|jsx)$/i;
const PY_FILES = /\.py$/i;
/** Docs/demo trees often ship their own Vite+React app and should not label the whole repo. */
const KIND_SKIP_PREFIX = /^(website|docs|examples?|benchmarks?|vendor|vendors|scripts|tests?)\//;

export function detectProjectKind(paths: readonly string[]): {
  kind: ProjectKind;
  label: string;
} {
  const all = paths.filter(Boolean);
  const files = all.filter((path) => !KIND_SKIP_PREFIX.test(path));
  return classifyProject(files.length ? files : all);
}

function classifyProject(files: string[]): { kind: ProjectKind; label: string } {
  if (files.some((path) => NEXT_FILES.test(path))) return { kind: "next", label: "Next.js" };
  if (files.some((path) => VITE_FILES.test(path))) {
    const react = files.some((path) => REACT_FILES.test(path));
    return react ? { kind: "react", label: "React (Vite)" } : { kind: "vite", label: "Vite" };
  }
  if (files.some((path) => DJANGO_FILES.test(path))) return { kind: "django", label: "Django" };
  if (files.some((path) => NODE_FILES.test(path)) && files.some((path) => REACT_FILES.test(path))) {
    return { kind: "react", label: "React" };
  }
  if (files.some((path) => NODE_FILES.test(path))) return { kind: "node", label: "Node" };
  if (files.some((path) => PYTHON_FILES.test(path)) || files.some((path) => PY_FILES.test(path))) {
    return { kind: "python", label: "Python" };
  }
  if (files.some((path) => HTML_FILES.test(path))) return { kind: "html", label: "HTML" };
  return { kind: "", label: "" };
}

export function looksDjangoTemplate(content: string): boolean {
  return /\{%[\s\S]+?%\}|\{\{[\s\S]+?\}\}|\{#[\s\S]+?#\}/.test(content.slice(0, 8_000));
}

export function languageForFile(
  path: string,
  content: string,
  project: ProjectKind,
  languageFromPath: (path: string) => string,
): string {
  const base = languageFromPath(path);
  if (base === "html" && (project === "django" || looksDjangoTemplate(content))) return "django";
  return base;
}

export function runHintForProject(kind: ProjectKind): string {
  if (kind === "django") return "python manage.py runserver";
  if (kind === "next") return "npm run dev";
  if (kind === "vite" || kind === "react") return "npm run dev";
  if (kind === "node") return "npm start";
  if (kind === "python") return "python main.py";
  return "";
}

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(__tests__|tests?)\//i;
const PY_TEST_FILE = /(^|\/)test_[^/]+\.py$|_test\.py$/i;

export function testCommandForPath(path: string, kind: ProjectKind): string | undefined {
  const file = path.replace(/\\/g, "/");
  const py =
    PY_TEST_FILE.test(file) || ((kind === "python" || kind === "django") && TEST_FILE.test(file));
  const js = TEST_FILE.test(file);
  if (!py && !js) return undefined;
  if (py || file.endsWith(".py")) return `python -m pytest ${file}`;
  return `npx vitest run ${file}`;
}

export function testCommandForDiagnostic(
  path: string,
  message: string,
  kind: ProjectKind,
): string | undefined {
  const fromPath = testCommandForPath(path, kind);
  if (fromPath) return fromPath;
  if (!/\b(vitest|jest|pytest|AssertionError|expect\()\b/i.test(message)) return undefined;
  const file = path.replace(/\\/g, "/");
  if (file.endsWith(".py") || kind === "python" || kind === "django") {
    return `python -m pytest ${file}`;
  }
  return `npx vitest run ${file}`;
}
