import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendPostEditDiagnostics,
  editedPathsFromTool,
  postEditDiagnostics,
  resetAgentCodeIntel,
  runCodeIntelTool,
} from "./agentCodeIntel.js";
import { resetWorkspaceComplete } from "./workspaceComplete.js";

const UTIL = [
  "export function greet(name: string): string {",
  "  return `hi ${name}`;",
  "}",
  "",
  "export class Store {",
  "  load(id: string): number {",
  "    return id.length;",
  "  }",
  "}",
  "",
].join("\n");

const APP = [
  'import { greet, Store } from "./util";',
  "",
  'export const message = greet("ada");',
  "export const size = new Store().load(message);",
  "",
].join("\n");

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
  },
  include: ["*.ts"],
});

let dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "locus-code-intel-"));
  dirs.push(dir);
  await writeFile(join(dir, "tsconfig.json"), TSCONFIG);
  await writeFile(join(dir, "util.ts"), UTIL);
  await writeFile(join(dir, "app.ts"), APP);
  return dir;
}

afterEach(async () => {
  resetWorkspaceComplete();
  resetAgentCodeIntel();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  dirs = [];
});

describe("code_definition", () => {
  it("jumps from a 1-based usage to the declaration with a snippet", async () => {
    const root = await fixture();
    // `greet` in `export const message = greet("ada");` — line 3, column 24.
    const result = await runCodeIntelTool(
      "code_definition",
      { path: "app.ts", line: 3, column: 24 },
      { root },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("`greet` at app.ts:3:24");
    expect(result.output).toContain("Definition: util.ts:1:17");
    expect(result.output).toContain("1 | export function greet(name: string): string {");
    expect(result.output).toMatch(/function greet\(name: string\): string/);
  });

  it("resolves a symbol name through workspace symbols", async () => {
    const root = await fixture();
    const result = await runCodeIntelTool("code_definition", { symbol: "Store.load" }, { root });
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Definition: util.ts:6:3");
  });

  it("explains an unsupported file instead of throwing", async () => {
    const root = await fixture();
    await writeFile(join(root, "notes.md"), "# hi\n");
    const result = await runCodeIntelTool(
      "code_definition",
      { path: "notes.md", line: 1, column: 1 },
      { root },
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Use grep/);
  });

  it("reports a missing language server as actionable text", async () => {
    const root = await fixture();
    await writeFile(join(root, "main.go"), "package main\n\nfunc main() {}\n");
    const prev = process.env.LOCUS_GOPLS;
    process.env.LOCUS_GOPLS = join(root, "no-such-gopls");
    try {
      const result = await runCodeIntelTool(
        "code_references",
        { path: "main.go", line: 3, column: 6 },
        { root },
      );
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/^gopls not found .*use grep/);
    } finally {
      if (prev === undefined) delete process.env.LOCUS_GOPLS;
      else process.env.LOCUS_GOPLS = prev;
    }
  });
});

describe("code_references", () => {
  it("groups references by file with line text", async () => {
    const root = await fixture();
    const result = await runCodeIntelTool(
      "code_references",
      { path: "util.ts", symbol: "greet" },
      { root },
    );
    expect(result.ok).toBe(true);
    expect(result.output.split("\n")[0]).toBe("3 references to `greet` in 2 files");
    expect(result.output).toMatch(/app\.ts\n {2}1:10 {2}import \{ greet, Store \}/);
    expect(result.output).toContain('3:24  export const message = greet("ada");');
    expect(result.output).toMatch(/util\.ts\n {2}1:17 {2}export function greet/);
  });

  it("errors clearly on an ambiguous symbol", async () => {
    const root = await fixture();
    await writeFile(join(root, "other.ts"), "export function greet(): void {}\n");
    const result = await runCodeIntelTool("code_references", { symbol: "greet" }, { root });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/ambiguous/);
    expect(result.output).toContain("other.ts:1");
    expect(result.output).toContain("util.ts:1");
  });
});

describe("code_symbols", () => {
  it("outlines a file and searches workspace symbols", async () => {
    const root = await fixture();
    const outline = await runCodeIntelTool("code_symbols", { path: "util.ts" }, { root });
    expect(outline.output).toContain("1  function greet");
    expect(outline.output).toContain("6  method Store.load");
    const search = await runCodeIntelTool("code_symbols", { query: "gree" }, { root });
    expect(search.output).toContain("greet  util.ts:1");
    const none = await runCodeIntelTool("code_symbols", {}, { root });
    expect(none.ok).toBe(false);
  });
});

describe("code_diagnostics", () => {
  it("reports type errors in the given files", async () => {
    const root = await fixture();
    await writeFile(join(root, "bad.ts"), 'const n: number = "x";\nexport { n };\n');
    const result = await runCodeIntelTool(
      "code_diagnostics",
      { paths: ["bad.ts", "app.ts", "README.md"] },
      { root },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("1 error, 0 warnings in 1 file (checked 2)");
    expect(result.output).toMatch(/bad\.ts:1:7 error: Type 'string' is not assignable/);
    expect(result.output).toContain("Skipped: README.md (unsupported language)");
  });
});

describe("code_rename", () => {
  it("renames across files on disk and returns a summary plus diff", async () => {
    const root = await fixture();
    const result = await runCodeIntelTool(
      "code_rename",
      { path: "util.ts", line: 1, column: 17, newName: "welcome" },
      { root },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Renamed `greet` → `welcome` in 2 files (3 lines):");
    expect(result.output).toContain("- app.ts: 2 lines");
    expect(result.output).toContain("- util.ts: 1 line");
    expect(result.output).toContain("diff --git a/app.ts b/app.ts");
    expect(await readFile(join(root, "util.ts"), "utf8")).toContain("export function welcome(");
    const app = await readFile(join(root, "app.ts"), "utf8");
    expect(app).toContain('import { welcome, Store } from "./util";');
    expect(app).toContain('welcome("ada")');
    expect(result.edited?.map((file) => file.path).sort()).toEqual(["app.ts", "util.ts"]);
    expect(result.edited?.find((file) => file.path === "util.ts")?.before).toBe(UTIL);

    const check = await runCodeIntelTool("code_diagnostics", { paths: ["app.ts"] }, { root });
    expect(check.output).toMatch(/^No errors or warnings/);
  });

  it("refuses a bad new name and a non-identifier position", async () => {
    const root = await fixture();
    const bad = await runCodeIntelTool(
      "code_rename",
      { path: "util.ts", line: 1, column: 17, newName: "two words" },
      { root },
    );
    expect(bad.ok).toBe(false);
    const blank = await runCodeIntelTool(
      "code_rename",
      { path: "util.ts", line: 4, column: 1, newName: "x" },
      { root },
    );
    expect(blank.ok).toBe(false);
    expect(await readFile(join(root, "util.ts"), "utf8")).toBe(UTIL);
  });
});

describe("post-edit diagnostics", () => {
  it("appends only new errors for touched files", async () => {
    const root = await fixture();
    await writeFile(join(root, "app.ts"), `${APP}export const broken: number = "nope";\n`);
    const first = await postEditDiagnostics({ root, paths: ["/workspace/app.ts"], key: "s1" });
    expect(first).toMatch(/^Type errors in edited files \(not reverted, 1 new error\):/);
    expect(first).toMatch(/app\.ts:5:14 error: Type 'string' is not assignable/);
    const again = await postEditDiagnostics({ root, paths: ["app.ts"], key: "s1" });
    expect(again).toMatch(/1 earlier type error still present/);
    await writeFile(join(root, "app.ts"), APP);
    expect(await postEditDiagnostics({ root, paths: ["app.ts"], key: "s1" })).toBeUndefined();
  });

  it("wraps tool results and respects the off switch / mirrors", async () => {
    const root = await fixture();
    await writeFile(join(root, "util.ts"), `${UTIL}export const x: number = "s";\n`);
    const base = { ok: true, output: "patched" };
    const input = {
      name: "file_write",
      args: { path: "util.ts" },
      root,
      key: "s2",
      enabled: true,
      live: true,
    };
    expect((await appendPostEditDiagnostics(base, { ...input, enabled: false })).output).toBe(
      "patched",
    );
    expect((await appendPostEditDiagnostics(base, { ...input, live: false })).output).toBe(
      "patched",
    );
    expect((await appendPostEditDiagnostics(base, { ...input, name: "grep" })).output).toBe(
      "patched",
    );
    const out = await appendPostEditDiagnostics(base, input);
    expect(out.output).toMatch(/^patched\n\nType errors in edited files/);
  });

  it("extracts edited paths from file_write and apply_patch", () => {
    expect(editedPathsFromTool("file_write", { path: "/workspace/src/a.ts" }, "/root")).toEqual([
      "src/a.ts",
    ]);
    const patch = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-a", "+b"].join("\n");
    expect(editedPathsFromTool("apply_patch", { patch, cwd: "/workspace/pkg" }, "/root")).toEqual([
      "pkg/src/a.ts",
    ]);
  });
});
