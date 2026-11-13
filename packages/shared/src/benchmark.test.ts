import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  parseBenchmarkTarget,
  scoreBenchmarkCase,
  summarizeBenchmark,
} from "./benchmark.js";

/** Known-good fixes, so a broken fixture fails here and not as a model's "failure". */
const REFERENCE: Record<string, Record<string, string>> = {
  "fix-add": { "src/add.js": "export function add(a, b) {\n  return a + b;\n}\n" },
  "off-by-one": {
    "src/paginate.js":
      "export function page(items, number, size) {\n  const start = (number - 1) * size;\n  return items.slice(start, start + size);\n}\nexport function pageCount(items, size) {\n  return Math.ceil(items.length / size);\n}\n",
  },
  "implement-slugify": {
    "src/slugify.js":
      'export function slugify(title) {\n  return title.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");\n}\n',
  },
  "missing-await": {
    "src/loader.js":
      "export async function loadAll(ids, fetchOne) {\n  const out = [];\n  for (const id of ids) out.push(await fetchOne(id));\n  return out;\n}\nexport async function total(ids, fetchOne) {\n  const rows = await loadAll(ids, fetchOne);\n  return rows.reduce((sum, row) => sum + row.amount, 0);\n}\n",
  },
  "cross-file-feature": {
    "src/price.js":
      'const SYMBOL = { USD: "$", EUR: "€", GBP: "£" };\nexport function formatPrice(cents, opts = {}) {\n  return `${SYMBOL[opts.currency ?? "USD"]}${(cents / 100).toFixed(2)}`;\n}\n',
    "src/cart.js":
      'import { formatPrice } from "./price.js";\nexport function cartTotal(cart) {\n  const cents = cart.items.reduce((sum, item) => sum + item.cents * item.qty, 0);\n  return formatPrice(cents, { currency: cart.currency });\n}\n',
  },
};

function write(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

function testsPass(root: string): boolean {
  try {
    execFileSync("npm", ["test", "--silent"], {
      cwd: root,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    return true;
  } catch {
    return false;
  }
}

describe("benchmark cases", () => {
  it("have unique ids, protected tests that exist, and a reference fix", () => {
    const ids = BENCHMARK_CASES.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of BENCHMARK_CASES) {
      for (const path of row.protectedFiles)
        expect(row.files[path], `${row.id}:${path}`).toBeDefined();
      expect(REFERENCE[row.id], row.id).toBeDefined();
    }
  });

  for (const row of BENCHMARK_CASES) {
    it(`${row.id}: fails as shipped, passes with the reference fix`, () => {
      const root = mkdtempSync(join(tmpdir(), `locus-bench-${row.id}-`));
      try {
        write(root, row.files);
        expect(testsPass(root)).toBe(false);
        write(root, REFERENCE[row.id]!);
        expect(testsPass(root)).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }, 30_000);
  }
});

describe("benchmark scoring", () => {
  it("fails edited tests even when they pass", () => {
    expect(
      scoreBenchmarkCase({ testsRan: true, testsOk: true, editedProtected: ["src/a.test.js"] }),
    ).toEqual({ status: "failed", reason: "tests edited: src/a.test.js" });
    expect(scoreBenchmarkCase({ testsRan: true, testsOk: true, editedProtected: [] }).status).toBe(
      "passed",
    );
    expect(
      scoreBenchmarkCase({ testsRan: true, testsOk: false, editedProtected: [], timedOut: true })
        .reason,
    ).toMatch(/timed out/);
  });

  it("parses provider/model with slashes in the model", () => {
    expect(parseBenchmarkTarget("openrouter/anthropic/claude")).toEqual({
      providerId: "openrouter",
      model: "anthropic/claude",
    });
    expect(parseBenchmarkTarget("nomodel")).toBeUndefined();
  });

  it("summarizes pass rate, cost and median time per target", () => {
    const a = { providerId: "p", model: "a" };
    const b = { providerId: "p", model: "b" };
    const [sa, sb] = summarizeBenchmark({
      targets: [a, b],
      results: [
        { caseId: "x", target: a, attempt: 1, status: "passed", usd: 0.01, durationMs: 1000 },
        { caseId: "y", target: a, attempt: 1, status: "failed", usd: 0.03, durationMs: 3000 },
        { caseId: "x", target: b, attempt: 1, status: "running" },
      ],
    });
    expect(sa).toMatchObject({ passed: 1, total: 2, passRate: 0.5, medianMs: 2000 });
    expect(sa!.usd).toBeCloseTo(0.04);
    expect(sb).toMatchObject({ passed: 0, total: 0, passRate: 0 });
  });
});
