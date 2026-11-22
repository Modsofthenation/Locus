import { describe, expect, it } from "vitest";
import {
  CODE_INTEL_READ_TOOL_NAMES,
  codeIntelLanguage,
  codeIntelToolSchema,
  codeRenameDiffFromResult,
  codeRenameRefusal,
  findSymbolInText,
  formatDefinitionResult,
  formatDiagnostics,
  formatPostEditDiagnostics,
  formatReferences,
  formatRenameResult,
  formatSnippet,
  identifierAt,
  isCodeIntelReadToolName,
  isCodeIntelToolName,
  parseCodeIntelTarget,
  parseCodeRenameName,
  pickSymbolCandidate,
  renameUnifiedDiff,
  symbolColumnInLine,
} from "./codeIntel.js";
import { isPlanReadTool } from "./plan.js";
import { REVIEW_TOOLS } from "./recipes.js";
import { isRuntimeToolName } from "./workingState.js";
import { isControlPlaneToolName, parseToolAllowlist, toolsRunInParallel } from "./tools.js";
import { SUPERVISED_ALWAYS_ASK } from "./autonomy.js";
import { toolActivityLabel, toolChipLabel } from "./toolChip.js";
import { validateToolArgs } from "../toolArgs.js";
import { isWorkspaceSearchTool } from "../opsRouting.js";
import { foldCodingVerifyFlags, isCodingMutateTool, CODING_LOOP_HABIT } from "../codingLoop.js";
import { workspaceChangesFromMessages } from "../workspaceChanges.js";
import { parseUnifiedDiff } from "../patch.js";
import type { ChatMessage } from "./session.js";

describe("parseCodeIntelTarget", () => {
  it("converts 1-based line/column to 0-based", () => {
    expect(
      parseCodeIntelTarget("code_definition", { path: "src/a.ts", line: 3, column: 7 }),
    ).toEqual({ ok: true, value: { path: "src/a.ts", line: 2, character: 6 } });
  });

  it("accepts numeric strings and col / character aliases", () => {
    const parsed = parseCodeIntelTarget("code_references", { path: "a.py", line: "10", col: "1" });
    expect(parsed).toEqual({ ok: true, value: { path: "a.py", line: 9, character: 0 } });
  });

  it("accepts a symbol with or without path", () => {
    expect(parseCodeIntelTarget("code_definition", { symbol: "Session.require" })).toEqual({
      ok: true,
      value: { symbol: "Session.require" },
    });
    expect(
      parseCodeIntelTarget("code_definition", { symbol: "greet", path: "a.ts", line: 4 }),
    ).toEqual({ ok: true, value: { symbol: "greet", path: "a.ts", line: 3 } });
  });

  it("rejects zero / negative / non-numeric positions and missing column", () => {
    const zero = parseCodeIntelTarget("code_definition", { path: "a.ts", line: 0, column: 1 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toMatch(/1-based line/);
    const bad = parseCodeIntelTarget("code_definition", { path: "a.ts", line: 2, column: "x" });
    expect(bad.ok).toBe(false);
    const noCol = parseCodeIntelTarget("code_definition", { path: "a.ts", line: 2 });
    expect(noCol.ok).toBe(false);
    if (!noCol.ok) expect(noCol.error).toMatch(/column/);
    const nothing = parseCodeIntelTarget("code_definition", {});
    expect(nothing.ok).toBe(false);
    const noPath = parseCodeIntelTarget("code_definition", { line: 1, column: 1 });
    expect(noPath.ok).toBe(false);
  });
});

describe("parseCodeRenameName", () => {
  it("needs one identifier", () => {
    expect(parseCodeRenameName("greetUser")).toEqual({ ok: true, value: "greetUser" });
    expect(parseCodeRenameName("$el")).toEqual({ ok: true, value: "$el" });
    expect(parseCodeRenameName("two words").ok).toBe(false);
    expect(parseCodeRenameName("1abc").ok).toBe(false);
    expect(parseCodeRenameName(undefined).ok).toBe(false);
  });
});

describe("symbol helpers", () => {
  it("finds whole-word columns, using the leaf of dotted names", () => {
    expect(symbolColumnInLine("const greeting = greet(name);", "greet")).toBe(17);
    expect(symbolColumnInLine("  async require(id) {", "Session.require")).toBe(8);
    expect(symbolColumnInLine("const greeting = 1;", "greet")).toBe(-1);
    expect(symbolColumnInLine("$x = $x + 1", "$x")).toBe(0);
  });

  it("finds the first occurrence in text and the identifier under a column", () => {
    expect(findSymbolInText("a\nb greet()\n", "greet")).toEqual({ line: 1, character: 2 });
    expect(findSymbolInText("nothing", "greet")).toBeUndefined();
    expect(identifierAt("return greet(name)", 9)).toBe("greet");
  });

  it("picks one declaration and explains ambiguity", () => {
    const rows = [
      { path: "a.ts", line: 3, symbol: "Session.require" },
      { path: "b.ts", line: 9, symbol: "Store.require" },
      { path: "c.ts", line: 1, symbol: "greet" },
    ];
    expect(pickSymbolCandidate("code_definition", rows, "greet")).toEqual({
      ok: true,
      value: rows[2],
    });
    expect(pickSymbolCandidate("code_definition", rows, "Session.require")).toEqual({
      ok: true,
      value: rows[0],
    });
    const ambiguous = pickSymbolCandidate("code_definition", rows, "require");
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.reason).toBe("ambiguous");
      expect(ambiguous.error).toContain("a.ts:3");
      expect(ambiguous.error).toContain("b.ts:9");
    }
    expect(pickSymbolCandidate("code_definition", rows, "require", { path: "b.ts" }).ok).toBe(true);
    const missing = pickSymbolCandidate("code_definition", rows, "nope");
    expect(!missing.ok && missing.reason).toBe("missing");
  });
});

describe("codeIntelLanguage", () => {
  it("dispatches by extension", () => {
    expect(codeIntelLanguage("src/a.tsx")).toBe("typescript");
    expect(codeIntelLanguage("lib/x.mjs")).toBe("typescript");
    expect(codeIntelLanguage("types.d.ts")).toBe("typescript");
    expect(codeIntelLanguage("app/models.py")).toBe("python");
    expect(codeIntelLanguage("main.go")).toBe("go");
    expect(codeIntelLanguage("src/lib.rs")).toBe("rust");
    expect(codeIntelLanguage("A.java")).toBe("java");
    expect(codeIntelLanguage("README.md")).toBeUndefined();
  });
});

describe("formatting", () => {
  it("formats definitions 1-based with a snippet and hover", () => {
    const text = formatDefinitionResult({
      from: { path: "app.ts", line: 1, character: 10, symbol: "greet" },
      definitions: [
        {
          path: "util.ts",
          line: 0,
          character: 16,
          snippet: formatSnippet(["export function greet() {", "  return 1;", "}"], 0, 2),
        },
      ],
      hover: "function greet(): number",
    });
    expect(text).toContain("`greet` at app.ts:2:11");
    expect(text).toContain("function greet(): number");
    expect(text).toContain("Definition: util.ts:1:17");
    expect(text).toContain("1 | export function greet() {");
    expect(text).not.toContain("3 | }");
  });

  it("says when there is no definition", () => {
    expect(
      formatDefinitionResult({ from: { path: "a.ts", line: 0, character: 0 }, definitions: [] }),
    ).toMatch(/No definition found .*a\.ts:1:1/);
  });

  it("groups references by file and caps them", () => {
    const items = [
      { path: "b.ts", line: 4, character: 2, text: "  greet();" },
      { path: "a.ts", line: 0, character: 16, text: "export function greet() {}" },
      { path: "b.ts", line: 1, character: 9, text: "import { greet } from './a';" },
    ];
    const text = formatReferences({
      from: { path: "a.ts", line: 0, character: 16, symbol: "greet" },
      items,
    });
    expect(text.split("\n")[0]).toBe("3 references to `greet` in 2 files");
    expect(text).toMatch(/b\.ts\n {2}2:10 {2}import \{ greet \}[^\n]*\n {2}5:3 {2}greet\(\);/);
    const capped = formatReferences({ from: items[1]!, items, limit: 1 });
    expect(capped).toContain("… 2 more");
  });

  it("formats diagnostics compactly, errors first, info dropped", () => {
    const text = formatDiagnostics({
      checked: ["a.ts", "b.ts"],
      diagnostics: [
        { path: "b.ts", startLine: 0, startCharacter: 0, message: "unused", severity: "warning" },
        {
          path: "a.ts",
          startLine: 2,
          startCharacter: 6,
          message: "Type 'string' is not assignable to type 'number'.\n  details",
          severity: "error",
        },
        { path: "a.ts", startLine: 1, startCharacter: 0, message: "hint", severity: "info" },
      ],
    });
    expect(text.split("\n")).toEqual([
      "1 error, 1 warning in 2 files (checked 2)",
      "a.ts:3:7 error: Type 'string' is not assignable to type 'number'.",
      "b.ts:1:1 warning: unused",
    ]);
    expect(formatDiagnostics({ checked: ["a.ts"], diagnostics: [] })).toBe(
      "No errors or warnings in 1 file: a.ts.",
    );
  });

  it("post-edit diagnostics are errors only and capped", () => {
    const errors = Array.from({ length: 12 }, (_, i) => ({
      path: "a.ts",
      startLine: i,
      startCharacter: 0,
      message: `bad ${i}`,
      severity: "error" as const,
    }));
    const text = formatPostEditDiagnostics({ errors, cap: 10 })!;
    expect(text.split("\n")).toHaveLength(12);
    expect(text).toContain("… 2 more");
    expect(
      formatPostEditDiagnostics({
        errors: [{ ...errors[0]!, severity: "warning" }],
      }),
    ).toBeUndefined();
    expect(formatPostEditDiagnostics({ errors: [], repeated: 2 })).toMatch(/2 earlier type errors/);
  });

  it("rename diff round-trips through parseUnifiedDiff and change tracking", () => {
    const files = [
      {
        path: "a.ts",
        before: "export const greet = 1;\nuse(greet);\n",
        after: "export const hello = 1;\nuse(hello);\n",
      },
      { path: "b.ts", before: "x\ngreet\n", after: "x\nhello\n" },
    ];
    const diff = renameUnifiedDiff(files);
    const parsed = parseUnifiedDiff(diff);
    expect(parsed.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    const output = formatRenameResult({ oldName: "greet", newName: "hello", files });
    expect(output).toContain("Renamed `greet` → `hello` in 2 files (3 lines):");
    expect(output).toContain("- a.ts: 2 lines");
    expect(codeRenameDiffFromResult(output)).toBe(diff);
    const messages = [
      {
        id: "m",
        role: "assistant",
        content: "",
        createdAt: "",
        toolCalls: [
          {
            id: "t",
            name: "code_rename",
            arguments: { path: "a.ts", line: 1, column: 14, newName: "hello" },
            result: output,
            startedAt: "",
            finishedAt: "x",
          },
        ],
      },
    ] as unknown as ChatMessage[];
    expect(workspaceChangesFromMessages(messages)).toEqual([
      { path: "a.ts", additions: 2, deletions: 2 },
      { path: "b.ts", additions: 1, deletions: 1 },
    ]);
  });
});

describe("harness wiring", () => {
  it("read tools are runtime, plan-mode, parallel-safe, review and search tools", () => {
    for (const name of CODE_INTEL_READ_TOOL_NAMES) {
      expect(isCodeIntelToolName(name)).toBe(true);
      expect(isCodeIntelReadToolName(name)).toBe(true);
      expect(isRuntimeToolName(name)).toBe(true);
      expect(isControlPlaneToolName(name)).toBe(true);
      expect(isPlanReadTool(name)).toBe(true);
      expect(REVIEW_TOOLS as string[]).toContain(name);
      expect(isWorkspaceSearchTool(name)).toBe(true);
    }
    expect(toolsRunInParallel(["code_definition", "code_references", "grep"])).toBe(true);
  });

  it("rename is a mutate, not a read", () => {
    expect(isCodeIntelReadToolName("code_rename")).toBe(false);
    expect(isPlanReadTool("code_rename")).toBe(false);
    expect(REVIEW_TOOLS as string[]).not.toContain("code_rename");
    expect(isWorkspaceSearchTool("code_rename")).toBe(false);
    expect(isCodingMutateTool("code_rename")).toBe(true);
    expect(SUPERVISED_ALWAYS_ASK as readonly string[]).toContain("code_rename");
    expect(
      foldCodingVerifyFlags([{ name: "code_rename", arguments: { path: "src/a.ts" } }]),
    ).toEqual({ mutated: true, verified: false });
  });

  it("allowlists accept code-intel names", () => {
    expect(parseToolAllowlist("ubuntu", ["grep", "code_references"], "docker")).toEqual([
      "grep",
      "code_references",
    ]);
  });

  it("validates arguments against the advertised schema", () => {
    const schema = codeIntelToolSchema("code_rename")!;
    expect(validateToolArgs("code_rename", { symbol: "a" }, schema)).toMatch(/newName/);
    expect(
      validateToolArgs("code_definition", { line: "x" }, codeIntelToolSchema("code_definition")),
    ).toMatch(/line must be a number/);
    expect(codeIntelToolSchema("grep")).toBeUndefined();
  });

  it("refuses rename on mirrors, review sessions and read-only allowlists", () => {
    expect(codeRenameRefusal({ runtime: "host" })).toBeUndefined();
    expect(codeRenameRefusal({ runtime: "docker", allowedTools: ["apply_patch"] })).toBeUndefined();
    expect(codeRenameRefusal({ runtime: "vm" })).toMatch(/Host or Docker/);
    expect(codeRenameRefusal({ runtime: "host", worker: true })).toMatch(/Host or Docker/);
    expect(codeRenameRefusal({ runtime: "docker", kind: "review" })).toMatch(/review/);
    expect(codeRenameRefusal({ runtime: "docker", allowedTools: ["grep"] })).toMatch(/allowlist/);
  });

  it("chips and activity labels", () => {
    expect(toolChipLabel("code_definition", { path: "src/app.ts", line: 3, column: 5 })).toContain(
      "definition",
    );
    expect(toolChipLabel("code_references", { symbol: "greet" })).toContain("greet");
    expect(toolActivityLabel("code_rename", { symbol: "greet", newName: "hello" })).toBe(
      "Renamed greet → hello",
    );
    expect(toolActivityLabel("code_diagnostics", {})).toBe("Checked diagnostics for changed files");
    expect(toolActivityLabel("code_definition", { path: "src/app.ts", line: 3, column: 5 })).toBe(
      "Went to app.ts:3:5",
    );
  });

  it("coding loop guidance prefers code navigation over grep", () => {
    expect(CODING_LOOP_HABIT).toMatch(/code_definition \/ code_references over grep/);
  });
});
