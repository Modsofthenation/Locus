import { classifyLoadPathFile, type LoadPathLayer } from "./loadpath.js";

/**
 * Distilled from pstack's architect red flags, blast-radius, and the
 * thermo-nuclear quality bar. Heuristic and local — not those skills, and
 * not a model call. Suggestions preserve behaviour and prefer deletion.
 */
export const ARCHITECTURE_LENS = [
  "Architecture lens (deep modules, blast radius, behaviour-preserving structure):",
  "Prefer a small interface that hides a real decision. A shallow module is a large surface with little policy behind it. A deep call chain is not a deep module.",
  "Delete pass-throughs. A method that forwards the same arguments adds a layer and hides nothing.",
  "Do not split one decision into load, validate, and save modules. Group code by the knowledge it owns.",
  "One way to do a task. Two copies drift. Move callers and delete the extra in the same change.",
  "One list. Derive the others. If a list cannot be derived, the build should fail when the copies disagree.",
  "Internals stay unreachable. An import of another module's internal, private, or internals path is the new interface.",
  "Name the blast radius from imports in this checkout. A test that imports the file is the check to run. The importer list is not proof the change is safe. Say so when no test imports it.",
  "Suggestions preserve behaviour. Apply the deletion test: if removing the abstraction would concentrate complexity rather than move it, delete it. Do not add a wrapper, a compatibility shim, or a second path.",
  "Verify every finding in the tree before editing. Drop findings the code does not support. Do not re-litigate a written decision in Locus.md, CONTEXT.md, or an ADR unless the friction is the finding.",
].join(" ");

export const ARCHITECTURE_PLAYBOOK = [
  "You are improving architecture in /workspace.",
  "The user message is a heuristic brief: deep modules, pass-throughs, temporal splits, two ways, hand-synced lists, sealed internals, and blast radius.",
  "Verify each finding in the tree. Drop findings the code does not support.",
  "Apply the suggestions that still hold. Preserve behaviour. Prefer deletion over a new abstraction.",
  "Run the test that imports the changed code. If none does, say so. Do not claim the change is safe without that run.",
  "Do not re-litigate Locus.md, CONTEXT.md, or an ADR unless a finding is the friction.",
].join(" ");

export const ARCHITECTURE_BASIS =
  "Deep modules, one owner of a decision, one way, derived lists, sealed internals, and blast radius from imports.";

export const ARCH_SCOPES = ["repo", "feature", "code"] as const;
export type ArchScope = (typeof ARCH_SCOPES)[number];

export const ARCH_FLAGS = [
  "two-ways",
  "hand-synced",
  "internals",
  "temporal",
  "passthrough",
  "shallow",
  "reader-load",
] as const;
export type ArchFlag = (typeof ARCH_FLAGS)[number];

export type ArchMove = "delete" | "deepen" | "own" | "derive" | "seal";

export interface ArchSourceFile {
  path: string;
  text: string;
}

export interface ArchFinding {
  id: string;
  flag: ArchFlag;
  title: string;
  detail: string;
  paths: string[];
}

export interface ArchSuggestion {
  id: string;
  flag: ArchFlag;
  move: ArchMove;
  title: string;
  detail: string;
  paths: string[];
}

export interface ArchFileSummary {
  path: string;
  feature: string;
  importerCount: number;
  importers: string[];
  flags: ArchFlag[];
}

export interface ArchFeatureSummary {
  path: string;
  fileCount: number;
  findingCount: number;
}

export interface ArchitectureCheckout {
  sessionId: string;
  runtime: "host" | "docker";
  label: string;
}

export interface ArchitectureAnalysis {
  repoId?: string;
  repoName: string;
  generatedAt: string;
  source: "heuristic";
  basis: string;
  truncated: boolean;
  fileCount: number;
  unavailable?: string;
  checkout?: ArchitectureCheckout;
  features: ArchFeatureSummary[];
  files: ArchFileSummary[];
  findings: ArchFinding[];
  suggestions: ArchSuggestion[];
  howRepo: string[];
  howFeature: Record<string, string[]>;
}

export interface ArchSection {
  scope: ArchScope;
  target: string;
  headline: string;
  how: string[];
  findings: ArchFinding[];
  suggestions: ArchSuggestion[];
}

const FLAG_RANK: Record<ArchFlag, number> = {
  "two-ways": 0,
  "hand-synced": 1,
  internals: 2,
  temporal: 3,
  passthrough: 4,
  shallow: 5,
  "reader-load": 6,
};

const MOVE: Record<ArchFlag, ArchMove> = {
  "two-ways": "delete",
  "hand-synced": "derive",
  internals: "seal",
  temporal: "own",
  passthrough: "delete",
  shallow: "deepen",
  "reader-load": "own",
};

const SUGGESTION: Record<ArchFlag, (title: string) => string> = {
  "two-ways": (title) => `Keep one ${title} and delete the other in the same change.`,
  "hand-synced": () => "Keep one list and derive the others.",
  internals: () => "Stop at the public seam. Make that internal unreachable from outside.",
  temporal: () => "Group these stages in the module that owns the decision.",
  passthrough: (title) => `Delete ${title} and call the module that finishes the operation.`,
  shallow: () => "Shrink the public surface, or hide one real decision behind it.",
  "reader-load": () => "Move one decision into the module that already owns it.",
};

const DETAIL: Record<ArchFlag, string> = {
  "two-ways":
    "Two modules export the same operation. An edit that finds one of them leaves the other behind.",
  "hand-synced":
    "The same string list is copied in more than one file. Adding an item means editing every copy.",
  internals:
    "A caller imports an internal, private, or internals path. That path is now part of the interface.",
  temporal:
    "Load, validate, and save are split into siblings. They repeat one representation across a boundary.",
  passthrough: "The body forwards its arguments and adds no policy.",
  shallow: "The file exposes many names and hides little behaviour.",
  "reader-load":
    "This file is long enough that a reader cannot hold it. Pull one decision out instead of adding a layer.",
};

const NAME_STOP = new Set([
  "default",
  "main",
  "setup",
  "create",
  "update",
  "delete",
  "get",
  "set",
  "render",
  "init",
  "run",
  "start",
  "stop",
  "build",
  "parse",
  "format",
  "test",
  "handler",
  "index",
  "config",
  "options",
  "props",
  "state",
  "value",
  "data",
  "item",
  "items",
  "name",
  "type",
  "list",
  "map",
  "filter",
  "reduce",
  "load",
  "save",
  "validate",
  "open",
  "close",
  "read",
  "write",
  "send",
  "post",
  "put",
  "patch",
  "query",
  "execute",
  "call",
  "apply",
  "make",
  "handle",
  "process",
  "convert",
  "normalize",
  "serialize",
  "transform",
  "helper",
  "utils",
  "util",
]);

const TEMPORAL = new Set([
  "load",
  "validate",
  "transform",
  "save",
  "parse",
  "normalize",
  "serialize",
]);

const LAYER_ORDER: LoadPathLayer[] = [
  "permissions",
  "api",
  "schema",
  "jobs",
  "code",
  "ui",
  "tests",
];

const MONOREPO_ROOTS = new Set(["apps", "packages", "services", "crates", "libs"]);
const MAX_FINDINGS = 60;
const MAX_IMPORTERS = 8;
const READER_LOAD_LINES = 1000;

/** One list. Checkout walks and relative import resolution both read it. */
export const ARCHITECTURE_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".rb",
  ".cs",
  ".vue",
  ".svelte",
] as const;

const RELATIVE_EXT = ARCHITECTURE_SOURCE_EXTENSIONS;

export function isArchScope(value: unknown): value is ArchScope {
  return value === "repo" || value === "feature" || value === "code";
}

export function architectureFeature(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return "(root)";
  const top = parts[0]!;
  if (MONOREPO_ROOTS.has(top) && parts.length >= 3) return `${top}/${parts[1]}`;
  if (top === "src") return "src";
  return top;
}

export function emptyArchitectureAnalysis(
  repoName: string,
  unavailable: string,
  generatedAt = new Date().toISOString(),
): ArchitectureAnalysis {
  return {
    repoName,
    generatedAt,
    source: "heuristic",
    basis: ARCHITECTURE_BASIS,
    truncated: false,
    fileCount: 0,
    unavailable,
    features: [],
    files: [],
    findings: [],
    suggestions: [],
    howRepo: [unavailable],
    howFeature: {},
  };
}

export function analyzeArchitecture(input: {
  repoName: string;
  files: ArchSourceFile[];
  truncated?: boolean;
  generatedAt?: string;
}): ArchitectureAnalysis {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const files = input.files
    .map((file) => ({ path: file.path.replace(/\\/g, "/").replace(/^\/+/, ""), text: file.text }))
    .filter((file) => file.path && !file.path.split("/").includes(".."));
  const pathSet = new Set(files.map((file) => file.path));
  const parsed = files.map((file) => parseFile(file, pathSet));
  const importers = new Map<string, string[]>();
  for (const file of parsed) {
    for (const target of file.localImports) {
      const list = importers.get(target) ?? [];
      list.push(file.path);
      importers.set(target, list);
    }
  }

  const findings: ArchFinding[] = [];
  for (const file of parsed) {
    if (file.barrelCount && !isTestPath(file.path)) {
      findings.push(
        finding(
          "shallow",
          `barrel:${file.path}`,
          `Shallow barrel ${file.path}`,
          `${file.path} re-exports ${file.barrelCount} modules and adds no policy.`,
          [file.path],
        ),
      );
    }
    for (const pass of file.passThroughs) {
      findings.push(
        finding(
          "passthrough",
          `pass:${file.path}:${pass.name}`,
          `Pass-through ${pass.name}`,
          `${file.path} exports ${pass.name}, which only forwards to ${pass.callee}.`,
          [file.path],
        ),
      );
    }
    if (
      !file.barrelCount &&
      !isTestPath(file.path) &&
      file.symbols.length >= 8 &&
      file.lines <= 120
    ) {
      findings.push(
        finding(
          "shallow",
          `shallow:${file.path}`,
          `Shallow module ${file.path}`,
          `${file.path} exports ${file.symbols.length} names in ${file.lines} lines.`,
          [file.path],
        ),
      );
    }
  }

  const byDir = new Map<string, Map<string, string[]>>();
  for (const file of parsed) {
    if (isTestPath(file.path) || !file.temporal) continue;
    const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "(root)";
    const tokens = byDir.get(dir) ?? new Map<string, string[]>();
    const paths = tokens.get(file.temporal) ?? [];
    paths.push(file.path);
    tokens.set(file.temporal, paths);
    byDir.set(dir, tokens);
  }
  for (const [dir, tokens] of byDir) {
    if (tokens.size < 3) continue;
    const paths = [...tokens.values()].flat();
    findings.push(
      finding(
        "temporal",
        `temporal:${dir}`,
        `Temporal split in ${dir}`,
        `${dir} splits ${[...tokens.keys()].sort().join(", ")} into separate files.`,
        paths,
      ),
    );
  }

  const byName = new Map<string, string[]>();
  for (const file of parsed) {
    if (isTestPath(file.path) || file.barrelCount) continue;
    for (const name of file.functions) {
      if (name.length < 6 || NAME_STOP.has(name)) continue;
      const paths = byName.get(name) ?? [];
      if (!paths.includes(file.path)) paths.push(file.path);
      byName.set(name, paths);
    }
  }
  for (const [name, paths] of byName) {
    if (paths.length < 2) continue;
    findings.push(
      finding(
        "two-ways",
        `two:${name}`,
        `Two ways to ${name}`,
        `${paths.length} files export ${name}.`,
        paths,
      ),
    );
  }

  const byList = new Map<string, { items: string[]; paths: string[] }>();
  for (const file of parsed) {
    for (const items of file.stringLists) {
      const key = [...items].sort().join("\u0000");
      const row = byList.get(key) ?? { items, paths: [] };
      if (!row.paths.includes(file.path)) row.paths.push(file.path);
      byList.set(key, row);
    }
  }
  for (const [key, row] of byList) {
    if (row.paths.length < 2) continue;
    const preview = row.items.slice(0, 4).join(", ");
    findings.push(
      finding(
        "hand-synced",
        `list:${hashKey(key)}`,
        "Hand-synced list",
        `The same list (${preview}) is copied in ${row.paths.length} files.`,
        row.paths,
      ),
    );
  }

  for (const file of parsed) {
    if (pathIsInternal(file.path)) continue;
    for (const spec of file.internalSpecs) {
      findings.push(
        finding(
          "internals",
          `internal:${file.path}:${spec}`,
          `Import of internals from ${file.path}`,
          `${file.path} imports ${spec}.`,
          [file.path],
        ),
      );
    }
  }

  const long = parsed
    .filter((file) => !isTestPath(file.path) && file.lines >= READER_LOAD_LINES)
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 3);
  for (const file of long) {
    findings.push(
      finding(
        "reader-load",
        `lines:${file.path}`,
        `High reader load in ${file.path}`,
        `${file.path} is ${file.lines} lines.`,
        [file.path],
      ),
    );
  }

  findings.sort((a, b) => FLAG_RANK[a.flag] - FLAG_RANK[b.flag] || a.id.localeCompare(b.id));
  const kept = findings.slice(0, MAX_FINDINGS);
  const suggestions = kept.map(suggestionFor);
  const flagsByPath = new Map<string, ArchFlag[]>();
  for (const row of kept) {
    for (const path of row.paths) {
      const flags = flagsByPath.get(path) ?? [];
      if (!flags.includes(row.flag)) flags.push(row.flag);
      flagsByPath.set(path, flags);
    }
  }

  const featureFiles = new Map<string, string[]>();
  for (const file of parsed) {
    const feature = architectureFeature(file.path);
    const list = featureFiles.get(feature) ?? [];
    list.push(file.path);
    featureFiles.set(feature, list);
  }
  let featureNames = [...featureFiles.keys()].sort(
    (a, b) =>
      (featureFiles.get(b)?.length ?? 0) - (featureFiles.get(a)?.length ?? 0) || a.localeCompare(b),
  );
  if (featureNames.length > 24) {
    const keep = new Set(featureNames.slice(0, 23));
    const dropped = [...featureFiles.keys()].filter(
      (feature) => feature !== "(other)" && !keep.has(feature),
    );
    const other = [...(featureFiles.get("(other)") ?? [])];
    for (const feature of dropped) {
      other.push(...(featureFiles.get(feature) ?? []));
      featureFiles.delete(feature);
    }
    if (other.length) featureFiles.set("(other)", other);
    featureNames = [...featureFiles.keys()];
  }

  const howFeature: Record<string, string[]> = {};
  const features: ArchFeatureSummary[] = featureNames.map((path) => {
    const paths = featureFiles.get(path) ?? [];
    const owned = new Set(paths);
    const findingCount = kept.filter((row) => row.paths.some((item) => owned.has(item))).length;
    howFeature[path] = featureHow(path, paths, parsed, importers);
    return { path, fileCount: paths.length, findingCount };
  });
  features.sort((a, b) => b.fileCount - a.fileCount || a.path.localeCompare(b.path));

  const fileRows: ArchFileSummary[] = parsed
    .map((file) => {
      const all = importers.get(file.path) ?? [];
      return {
        path: file.path,
        feature: featureFiles.has(architectureFeature(file.path))
          ? architectureFeature(file.path)
          : "(other)",
        importerCount: all.length,
        importers: all.slice(0, MAX_IMPORTERS),
        flags: flagsByPath.get(file.path) ?? [],
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const howRepo = [
    input.truncated
      ? `${files.length} source files scanned (the walk stopped early).`
      : `${files.length} source files scanned.`,
    features.length
      ? `Features: ${features
          .slice(0, 8)
          .map((feature) => `${feature.path} (${feature.fileCount})`)
          .join(", ")}.`
      : "No feature directories.",
    layerSentence(parsed.map((file) => file.path)),
    kept.length
      ? `${kept.length} improvement${kept.length === 1 ? "" : "s"} on this pass.`
      : "No structural red flags on this pass.",
  ];

  return {
    repoName: input.repoName,
    generatedAt,
    source: "heuristic",
    basis: ARCHITECTURE_BASIS,
    truncated: Boolean(input.truncated),
    fileCount: files.length,
    features,
    files: fileRows,
    findings: kept,
    suggestions,
    howRepo,
    howFeature,
  };
}

export function architectureSection(
  analysis: ArchitectureAnalysis,
  scope: ArchScope,
  target?: string,
): ArchSection {
  if (scope === "repo") {
    return {
      scope,
      target: analysis.repoName,
      headline: analysis.unavailable
        ? "No checkout to analyse"
        : `${plural(analysis.fileCount, "file")} · ${plural(analysis.features.length, "feature")} · ${plural(analysis.suggestions.length, "improvement")}`,
      how: analysis.howRepo,
      findings: analysis.findings,
      suggestions: analysis.suggestions,
    };
  }
  if (scope === "feature") {
    const name = target?.trim() || analysis.features[0]?.path || "";
    const feature = analysis.features.find((row) => row.path === name);
    const findings = analysis.findings.filter((row) =>
      row.paths.some((path) => fileFeature(analysis, path) === name),
    );
    const ids = new Set(findings.map((row) => row.id));
    return {
      scope,
      target: name,
      headline: feature
        ? `${plural(feature.fileCount, "file")} · ${plural(findings.length, "improvement")}`
        : "That feature is not in this checkout",
      how: feature
        ? (analysis.howFeature[name] ?? [])
        : ["Pick a feature directory from the scan."],
      findings,
      suggestions: analysis.suggestions.filter((row) => ids.has(row.id)),
    };
  }
  const path = target?.trim() ?? "";
  const file = analysis.files.find((row) => row.path === path);
  const findings = analysis.findings.filter((row) => row.paths.includes(path));
  const ids = new Set(findings.map((row) => row.id));
  return {
    scope,
    target: path,
    headline: file
      ? `${plural(file.importerCount, "importer")} · ${plural(findings.length, "improvement")}`
      : "That file is not in this checkout",
    how: file ? codeHow(file) : ["Pick a source file from the scan."],
    findings,
    suggestions: analysis.suggestions.filter((row) => ids.has(row.id)),
  };
}

export function formatArchitectureMarkdown(section: ArchSection): string {
  const lines = [
    `## Architecture · ${section.scope}`,
    section.target ? `Target: ${section.target}` : "",
    section.headline,
    "",
    "### How it is shaped",
    ...section.how.map((line) => `- ${line}`),
    "",
    "### Findings",
    ...(section.findings.length
      ? section.findings.map((row) => `- ${row.title}: ${row.detail} (${row.paths.join(", ")})`)
      : ["- None on this pass."]),
    "",
    "### Improvements",
    ...(section.suggestions.length
      ? section.suggestions.map((row) => `- ${row.title} ${row.detail} (${row.paths.join(", ")})`)
      : ["- None on this pass."]),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export function formatArchitectureSuggestPrompt(input: {
  repoName: string;
  scope: ArchScope;
  target?: string;
  section: ArchSection;
  unavailable?: string;
}): string {
  return [
    `Improve the architecture of ${input.repoName} (${input.scope}${input.target ? `: ${input.target}` : ""}).`,
    "",
    ARCHITECTURE_LENS,
    "",
    input.unavailable ?? "",
    formatArchitectureMarkdown(input.section),
    "",
    "Work in /workspace. Verify each finding against the code before editing. Drop any finding the tree does not support. Apply the remaining suggestions. Preserve behaviour. Do not add a wrapper or a second way. Run the test that imports the code you change. If no test imports it, say that and do not claim the change is safe.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function architectureSessionTitle(
  repoName: string,
  scope: ArchScope,
  target?: string,
): string {
  if (scope === "repo" || !target) return `Architecture · ${repoName}`;
  const leaf = target.split("/").filter(Boolean).pop() || scope;
  return `Architecture · ${leaf}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function fileFeature(analysis: ArchitectureAnalysis, path: string): string {
  return analysis.files.find((file) => file.path === path)?.feature ?? architectureFeature(path);
}

function codeHow(file: ArchFileSummary): string[] {
  const lines = [
    `Feature ${file.feature}.`,
    file.importerCount
      ? `Imported by ${file.importerCount}: ${file.importers.join(", ")}.`
      : "Nothing else in this checkout imports this file.",
  ];
  const tests = file.importers.filter((path) => isTestPath(path));
  if (tests.length) {
    lines.push(
      `The limiting check is ${tests[0]}. Run it before treating a change as safe. The importer list is not proof.`,
    );
  } else if (file.importerCount) {
    lines.push("No test in this checkout imports this file. Do not treat a change as safe.");
  }
  if (file.flags.length) lines.push(`Flags: ${file.flags.join(", ")}.`);
  return lines;
}

function featureHow(
  feature: string,
  paths: string[],
  parsed: ParsedFile[],
  importers: Map<string, string[]>,
): string[] {
  const outside: string[] = [];
  for (const path of paths) {
    const callers = importers.get(path) ?? [];
    if (callers.some((caller) => architectureFeature(caller) !== feature)) outside.push(path);
  }
  const entries = (
    outside.length
      ? outside
      : paths.filter((path) => /\/index\.[^.]+$/.test(path) || path.endsWith("/index"))
  ).slice(0, 4);
  return [
    layerSentence(paths),
    entries.length
      ? `Callers enter through ${entries.join(", ")}.`
      : "No outside caller in this checkout.",
    `${paths.length} files in ${feature}.`,
  ];
}

function layerSentence(paths: string[]): string {
  const counts = new Map<LoadPathLayer, number>();
  for (const path of paths) {
    const layer = classifyLoadPathFile(path).layer;
    counts.set(layer, (counts.get(layer) ?? 0) + 1);
  }
  const parts = LAYER_ORDER.filter((layer) => counts.has(layer)).map(
    (layer) => `${layer} ${counts.get(layer)}`,
  );
  return parts.length ? `Layers: ${parts.join(", ")}.` : "No layer mix.";
}

function suggestionFor(row: ArchFinding): ArchSuggestion {
  const noun = row.flag === "passthrough" ? row.title.replace(/^Pass-through\s+/, "") : row.title;
  return {
    id: row.id,
    flag: row.flag,
    move: MOVE[row.flag],
    title: SUGGESTION[row.flag](noun),
    detail: DETAIL[row.flag],
    paths: row.paths,
  };
}

function finding(
  flag: ArchFlag,
  id: string,
  title: string,
  detail: string,
  paths: string[],
): ArchFinding {
  return { id, flag, title, detail, paths: [...new Set(paths)].slice(0, 8) };
}

function hashKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33 + value.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

interface ParsedFile {
  path: string;
  lines: number;
  symbols: string[];
  functions: string[];
  passThroughs: Array<{ name: string; callee: string }>;
  barrelCount?: number;
  temporal?: string;
  stringLists: string[][];
  localImports: string[];
  internalSpecs: string[];
}

function parseFile(file: ArchSourceFile, paths: Set<string>): ParsedFile {
  const stripped = stripComments(file.text);
  const symbols = exportedSymbols(stripped);
  const functions = [
    ...stripped.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g),
  ].map((match) => match[1]!);
  const passThroughs: Array<{ name: string; callee: string }> = [];
  if (!isTestPath(file.path)) {
    for (const fn of exportedFunctions(stripped)) {
      const callee = passCallee(fn.name, fn.params, fn.body);
      if (callee) passThroughs.push({ name: fn.name, callee });
    }
    for (const arrow of exportedArrows(stripped)) {
      const callee = passCallee(arrow.name, arrow.params, arrow.body);
      if (callee) passThroughs.push({ name: arrow.name, callee });
    }
  }
  const localImports: string[] = [];
  const internalSpecs: string[] = [];
  for (const spec of importSpecs(stripped)) {
    const resolved = spec.startsWith(".") ? resolveRelative(file.path, spec, paths) : undefined;
    if (resolved && !localImports.includes(resolved)) localImports.push(resolved);
    const internal = pathIsInternal(spec) || (resolved ? pathIsInternal(resolved) : false);
    if (internal && !pathIsInternal(file.path) && !internalSpecs.includes(spec)) {
      internalSpecs.push(spec);
    }
  }
  return {
    path: file.path,
    lines: file.text.split("\n").length,
    symbols,
    functions,
    passThroughs,
    barrelCount: isBarrel(stripped),
    temporal: isTestPath(file.path) ? undefined : temporalToken(file.path),
    stringLists: stringArrays(stripped),
    localImports,
    internalSpecs,
  };
}

function isTestPath(path: string): boolean {
  return classifyLoadPathFile(path).layer === "tests";
}

function pathIsInternal(path: string): boolean {
  return /(?:^|\/)(?:internal|internals|private)(?:\/|$)/.test(path.replace(/\\/g, "/"));
}

function temporalToken(path: string): string | undefined {
  const base =
    path
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "";
  const bits = base
    .split(/[^A-Za-z]+/)
    .flatMap((word) => word.replace(/([a-z])([A-Z])/g, "$1 $2").split(" "))
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  const last = bits[bits.length - 1];
  return last && TEMPORAL.has(last) ? last : undefined;
}

function isBarrel(text: string): number | undefined {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 4) return undefined;
  const re = /^export\s+(?:type\s+)?(?:\{[^}]*\}|\*|[\w]+)\s+from\s+['"][^'"]+['"];?$/;
  if (!lines.every((line) => re.test(line))) return undefined;
  return lines.length;
}

function exportedSymbols(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    names.push(match[1]!);
  }
  for (const match of text.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) names.push(match[1]!);
  for (const match of text.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)) names.push(match[1]!);
  return names;
}

function exportedFunctions(text: string): Array<{ name: string; params: string[]; body: string }> {
  const out: Array<{ name: string; params: string[]; body: string }> = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
  for (const match of text.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const body = readDelimited(text, open, "{", "}");
    if (body == null) continue;
    out.push({ name: match[1]!, params: paramNames(match[2]!), body });
  }
  return out;
}

function exportedArrows(text: string): Array<{ name: string; params: string[]; body: string }> {
  const out: Array<{ name: string; params: string[]; body: string }> = [];
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*([^\n]+)/g;
  for (const match of text.matchAll(re)) {
    const rhs = match[3]!.trim().replace(/;\s*$/, "");
    const block = rhs.match(/^\{?\s*return\s+([\s\S]+?)\}\s*$/);
    const body = block ? `return ${block[1]}` : `return ${rhs}`;
    out.push({ name: match[1]!, params: paramNames(match[2]!), body });
  }
  return out;
}

function passCallee(name: string, params: string[], body: string): string | undefined {
  const flat = body
    .trim()
    .replace(/;+\s*$/, "")
    .replace(/\s+/g, " ");
  if (flat.includes("{") || flat.includes(";")) return undefined;
  const match = flat.match(/^return\s+([A-Za-z_$][\w$.]*)\s*\((.*)\)\s*$/);
  if (!match) return undefined;
  const callee = match[1]!;
  if (callee === name) return undefined;
  const args = match[2]!
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (args.some((arg) => !/^[A-Za-z_$][\w$]*$/.test(arg))) return undefined;
  if (args.length !== params.length) return undefined;
  const paramSet = new Set(params);
  if (!args.every((arg) => paramSet.has(arg))) return undefined;
  return callee;
}

function paramNames(raw: string): string[] {
  return raw
    .split(",")
    .map((part) =>
      part
        .trim()
        .split(/[=:]/)[0]
        ?.trim()
        .replace(/^\.\.\./, "")
        .replace(/\?$/, ""),
    )
    .filter((name): name is string => Boolean(name && /^[A-Za-z_$][\w$]*$/.test(name)));
}

function importSpecs(text: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of text.matchAll(re)) {
    const spec = (match[1] || match[2] || "").trim();
    if (spec && !specs.includes(spec)) specs.push(spec);
  }
  return specs;
}

function resolveRelative(from: string, spec: string, paths: Set<string>): string | undefined {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const raw = normalizePosix(dir ? `${dir}/${spec}` : spec);
  const candidates = [
    raw,
    ...RELATIVE_EXT.map((ext) => `${raw}${ext}`),
    ...RELATIVE_EXT.map((ext) => `${raw}/index${ext}`),
  ];
  return candidates.find((candidate) => paths.has(candidate));
}

function normalizePosix(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function stringArrays(text: string): string[][] {
  const out: string[][] = [];
  const re = /=\s*\[/g;
  for (const match of text.matchAll(re)) {
    const open = match.index + match[0].length - 1;
    const body = readDelimited(text, open, "[", "]");
    if (body == null) continue;
    const items = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((item) => item[1]!).filter(Boolean);
    const leftover = body.replace(/['"][^'"]*['"]/g, "");
    if (/[A-Za-z0-9_]/.test(leftover)) continue;
    if (items.length >= 4) out.push(items);
  }
  return out;
}

function readDelimited(text: string, open: number, left: string, right: string): string | null {
  if (text[open] !== left) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === left) depth += 1;
    else if (ch === right) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    } else if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(text, i);
    }
  }
  return null;
}

function skipString(text: string, start: number): number {
  const quote = text[start]!;
  for (let i = start + 1; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === quote) return i;
  }
  return text.length;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}
