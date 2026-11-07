import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_LENS,
  ARCHITECTURE_SOURCE_EXTENSIONS,
  analyzeArchitecture,
  architectureFeature,
  architectureSection,
  formatArchitectureSuggestPrompt,
} from "./architecture.js";

const passThrough = `
export function loadInvoice(id: string) {
  return billing.loadInvoice(id);
}
export function computeTotal(rows: number[]) {
  return rows.reduce((sum, row) => sum + row, 0);
}
`;

const barrel = `
export { loadInvoice } from "./load";
export { saveInvoice } from "./save";
export { validateInvoice } from "./validate";
export type { Invoice } from "./types";
`;

const load = `export function loadInvoiceRecord(id: string) { return id; }\n`;
const validate = `export function validateInvoiceRecord(row: string) { return row; }\n`;
const save = `export function saveInvoiceRecord(row: string) { return row; }\n`;

const twoA = `export function createInvoiceDraft(input: string) { return input; }\n`;
const twoB = `export function createInvoiceDraft(input: string) { return input.trim(); }\n`;

const listA = `export const LAYERS = ["api", "jobs", "ui", "code"];\n`;
const listB = `const LAYERS = ["code", "api", "ui", "jobs"];\n`;

const outside = `import { hidden } from "../billing/internal/calc";\nexport function route() { return hidden; }\n`;
const inside = `export function hidden(id: string) { return id; }\n`;

const caller = `import { loadInvoice } from "./invoice";\nexport function page() { return loadInvoice("1"); }\n`;
const testCaller = `import { loadInvoice } from "../src/invoice";\n`;

describe("architecture analysis", () => {
  it("resolves relative imports for every source extension the checkout walks", () => {
    const analysis = analyzeArchitecture({
      repoName: "billing",
      files: [
        {
          path: "src/page.ts",
          text: `import { Widget } from "./Widget";\nexport const page = 1;\n`,
        },
        { path: "src/Widget.java", text: "public class Widget {}\n" },
      ],
    });
    expect(ARCHITECTURE_SOURCE_EXTENSIONS).toContain(".java");
    expect(analysis.files.find((row) => row.path === "src/Widget.java")?.importerCount).toBe(1);
    expect(analysis.files.find((row) => row.path === "src/Widget.java")?.importers).toEqual([
      "src/page.ts",
    ]);
  });

  it("names feature roots for monorepos and src trees", () => {
    expect(architectureFeature("packages/shared/src/architecture.ts")).toBe("packages/shared");
    expect(architectureFeature("src/invoice.ts")).toBe("src");
    expect(architectureFeature("billing/invoice.ts")).toBe("billing");
    expect(architectureFeature("README.md")).toBe("(root)");
  });

  it("flags pass-throughs, barrels, temporal splits, two ways, copied lists, and internals", () => {
    const analysis = analyzeArchitecture({
      repoName: "billing",
      files: [
        { path: "src/invoice.ts", text: passThrough },
        { path: "src/index.ts", text: barrel },
        { path: "src/invoice/load.ts", text: load },
        { path: "src/invoice/validate.ts", text: validate },
        { path: "src/invoice/save.ts", text: save },
        { path: "src/drafts/a.ts", text: twoA },
        { path: "src/drafts/b.ts", text: twoB },
        { path: "src/layers.ts", text: listA },
        { path: "src/other/layers.ts", text: listB },
        { path: "src/api/routes.ts", text: outside },
        { path: "billing/internal/calc.ts", text: inside },
        { path: "src/page.ts", text: caller },
        { path: "test/invoice.test.ts", text: testCaller },
      ],
    });
    const flags = analysis.findings.map((row) => row.flag);
    expect(flags).toContain("passthrough");
    expect(flags).toContain("shallow");
    expect(flags).toContain("temporal");
    expect(flags).toContain("two-ways");
    expect(flags).toContain("hand-synced");
    expect(flags).toContain("internals");
    expect(analysis.findings.find((row) => row.flag === "passthrough")?.paths).toEqual([
      "src/invoice.ts",
    ]);
    expect(analysis.findings.some((row) => row.title.includes("computeTotal"))).toBe(false);
    const pass = analysis.suggestions.find((row) => row.flag === "passthrough");
    expect(pass?.move).toBe("delete");
    expect(pass?.title).toMatch(/Delete/);

    const code = architectureSection(analysis, "code", "src/invoice.ts");
    expect(code.headline).toBe("2 importers · 1 improvement");
    expect(code.how.some((line) => line.includes("test/invoice.test.ts"))).toBe(true);
    expect(code.how.some((line) => line.includes("not proof"))).toBe(true);
    expect(code.findings.some((row) => row.flag === "passthrough")).toBe(true);

    const feature = architectureSection(analysis, "feature", "src");
    expect(feature.findings.length).toBeGreaterThan(0);
    expect(feature.headline).toMatch(/files/);

    const repo = architectureSection(analysis, "repo");
    expect(repo.suggestions.length).toBe(analysis.suggestions.length);
    expect(repo.how.some((line) => line.includes("Layers:"))).toBe(true);
  });

  it("does not treat a direct function or a logic-bearing index as a shallow barrel", () => {
    const analysis = analyzeArchitecture({
      repoName: "app",
      files: [
        {
          path: "src/index.ts",
          text: `export function run(input: string) {\n  return input.trim();\n}\n`,
        },
      ],
    });
    expect(analysis.findings).toEqual([]);
  });

  it("says a change is not safe when no test imports the file", () => {
    const analysis = analyzeArchitecture({
      repoName: "app",
      files: [
        { path: "src/invoice.ts", text: passThrough },
        { path: "src/page.ts", text: caller },
      ],
    });
    const code = architectureSection(analysis, "code", "src/invoice.ts");
    expect(code.headline).toBe("1 importer · 1 improvement");
    expect(code.how.some((line) => line.includes("Do not treat a change as safe"))).toBe(true);
  });

  it("puts the lens and the section into the improve prompt", () => {
    const analysis = analyzeArchitecture({
      repoName: "billing",
      files: [{ path: "src/invoice.ts", text: passThrough }],
    });
    const section = architectureSection(analysis, "code", "src/invoice.ts");
    const prompt = formatArchitectureSuggestPrompt({
      repoName: "billing",
      scope: "code",
      target: "src/invoice.ts",
      section,
    });
    expect(prompt).toContain(ARCHITECTURE_LENS);
    expect(prompt).toContain("Pass-through loadInvoice");
    expect(prompt).toContain("do not claim the change is safe");
    expect(prompt).not.toContain("poteto-mode");
  });
});
