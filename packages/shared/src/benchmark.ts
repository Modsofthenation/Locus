/**
 * Model benchmark: small, dependency-free coding tasks run as real Host agent turns against
 * a chosen provider and model. Each case starts with failing tests; it passes when
 * `npm test` passes afterwards and the test files are unchanged.
 */

export interface BenchmarkCase {
  id: string;
  title: string;
  prompt: string;
  /** Workspace files, path → contents. */
  files: Record<string, string>;
  /** Files the agent must not modify (the tests). */
  protectedFiles: string[];
}

export interface BenchmarkTarget {
  providerId: string;
  model: string;
}

export type BenchmarkCaseStatus = "pending" | "running" | "passed" | "failed" | "error";

export interface BenchmarkCaseResult {
  caseId: string;
  target: BenchmarkTarget;
  attempt: number;
  status: BenchmarkCaseStatus;
  /** Why it failed: "tests failed", "tests edited", "timed out", "needs a human: …". */
  reason?: string;
  sessionId?: string;
  startedAt?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Estimated from the provider's published or configured rates. */
  usd?: number;
  toolCalls?: number;
  testOutput?: string;
}

export type BenchmarkRunStatus = "running" | "done" | "cancelled" | "error";

export interface BenchmarkRun {
  id: string;
  createdAt: string;
  finishedAt?: string;
  status: BenchmarkRunStatus;
  error?: string;
  targets: BenchmarkTarget[];
  caseIds: string[];
  repeat: number;
  results: BenchmarkCaseResult[];
}

export interface BenchmarkTargetSummary {
  target: BenchmarkTarget;
  passed: number;
  total: number;
  /** 0–1. Finished cases only. */
  passRate: number;
  usd?: number;
  medianMs?: number;
  tokens: number;
}

const PKG = (name: string, test: string) =>
  `${JSON.stringify(
    { name: `locus-bench-${name}`, private: true, type: "module", scripts: { test } },
    null,
    2,
  )}\n`;

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "fix-add",
    title: "Fix a one-line bug",
    prompt: "The tests in src/add.test.js fail. Make add(2, 3) return 5. Do not change the tests.",
    files: {
      "package.json": PKG("fix-add", "node --test src/add.test.js"),
      "src/add.js": "export function add(a, b) {\n  return a;\n}\n",
      "src/add.test.js": [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { add } from "./add.js";',
        "",
        'test("adds two numbers", () => {',
        "  assert.equal(add(2, 3), 5);",
        "  assert.equal(add(-1, 1), 0);",
        "});",
        "",
      ].join("\n"),
    },
    protectedFiles: ["src/add.test.js"],
  },
  {
    id: "off-by-one",
    title: "Find an off-by-one",
    prompt: "`npm test` fails. Find and fix the bug in src/paginate.js. Do not change the tests.",
    files: {
      "package.json": PKG("off-by-one", "node --test src/paginate.test.js"),
      "src/paginate.js": [
        "/** Split items into pages of `size`. Page numbers start at 1. */",
        "export function page(items, number, size) {",
        "  const start = number * size;",
        "  return items.slice(start, start + size);",
        "}",
        "",
        "export function pageCount(items, size) {",
        "  return Math.floor(items.length / size);",
        "}",
        "",
      ].join("\n"),
      "src/paginate.test.js": [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { page, pageCount } from "./paginate.js";',
        "",
        "const items = [1, 2, 3, 4, 5, 6, 7];",
        "",
        'test("first page", () => assert.deepEqual(page(items, 1, 3), [1, 2, 3]));',
        'test("last partial page", () => assert.deepEqual(page(items, 3, 3), [7]));',
        'test("page count rounds up", () => assert.equal(pageCount(items, 3), 3));',
        'test("exact pages", () => assert.equal(pageCount([1, 2, 3, 4], 2), 2));',
        "",
      ].join("\n"),
    },
    protectedFiles: ["src/paginate.test.js"],
  },
  {
    id: "implement-slugify",
    title: "Implement from tests",
    prompt:
      "Implement slugify in src/slugify.js so the tests in src/slugify.test.js pass. Do not change the tests.",
    files: {
      "package.json": PKG("slugify", "node --test src/slugify.test.js"),
      "src/slugify.js": [
        "/** Turn a title into a URL slug. */",
        "export function slugify(title) {",
        '  throw new Error("not implemented");',
        "}",
        "",
      ].join("\n"),
      "src/slugify.test.js": [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { slugify } from "./slugify.js";',
        "",
        'test("lowercases and joins words", () => assert.equal(slugify("Hello World"), "hello-world"));',
        'test("drops punctuation", () => assert.equal(slugify("Ship it, now!"), "ship-it-now"));',
        'test("collapses separators", () => assert.equal(slugify("  a --  b  "), "a-b"));',
        'test("strips accents", () => assert.equal(slugify("Crème Brûlée"), "creme-brulee"));',
        'test("keeps digits", () => assert.equal(slugify("Top 10 Tips"), "top-10-tips"));',
        "",
      ].join("\n"),
    },
    protectedFiles: ["src/slugify.test.js"],
  },
  {
    id: "missing-await",
    title: "Fix an async bug",
    prompt:
      "The tests for src/loader.js fail intermittently and return the wrong totals. Fix the bug. Do not change the tests.",
    files: {
      "package.json": PKG("missing-await", "node --test src/loader.test.js"),
      "src/loader.js": [
        "export async function loadAll(ids, fetchOne) {",
        "  const out = [];",
        "  for (const id of ids) {",
        "    out.push(fetchOne(id));",
        "  }",
        "  return out;",
        "}",
        "",
        "export async function total(ids, fetchOne) {",
        "  const rows = await loadAll(ids, fetchOne);",
        "  return rows.reduce((sum, row) => sum + row.amount, 0);",
        "}",
        "",
      ].join("\n"),
      "src/loader.test.js": [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { loadAll, total } from "./loader.js";',
        "",
        "const fetchOne = async (id) => ({ id, amount: id * 10 });",
        "",
        'test("loads rows in order", async () => {',
        "  assert.deepEqual(await loadAll([1, 2], fetchOne), [",
        "    { id: 1, amount: 10 },",
        "    { id: 2, amount: 20 },",
        "  ]);",
        "});",
        "",
        'test("sums amounts", async () => assert.equal(await total([1, 2, 3], fetchOne), 60));',
        "",
      ].join("\n"),
    },
    protectedFiles: ["src/loader.test.js"],
  },
  {
    id: "cross-file-feature",
    title: "Add a feature across files",
    prompt:
      'Add a `currency` option to formatPrice in src/price.js (default "USD") and make src/cart.js pass the cart\'s currency through. The tests describe the behaviour. Do not change the tests.',
    files: {
      "package.json": PKG("cross-file", "node --test src/price.test.js src/cart.test.js"),
      "src/price.js": [
        "export function formatPrice(cents) {",
        "  return `$${(cents / 100).toFixed(2)}`;",
        "}",
        "",
      ].join("\n"),
      "src/cart.js": [
        'import { formatPrice } from "./price.js";',
        "",
        "export function cartTotal(cart) {",
        "  const cents = cart.items.reduce((sum, item) => sum + item.cents * item.qty, 0);",
        "  return formatPrice(cents);",
        "}",
        "",
      ].join("\n"),
      "src/price.test.js": [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { formatPrice } from "./price.js";',
        "",
        'test("defaults to USD", () => assert.equal(formatPrice(1234), "$12.34"));',
        'test("euros", () => assert.equal(formatPrice(500, { currency: "EUR" }), "€5.00"));',
        'test("pounds", () => assert.equal(formatPrice(99, { currency: "GBP" }), "£0.99"));',
        "",
      ].join("\n"),
      "src/cart.test.js": [
        'import assert from "node:assert/strict";',
        'import { test } from "node:test";',
        'import { cartTotal } from "./cart.js";',
        "",
        'test("uses the cart currency", () => {',
        "  const cart = {",
        '    currency: "EUR",',
        "    items: [",
        "      { cents: 250, qty: 2 },",
        "      { cents: 100, qty: 1 },",
        "    ],",
        "  };",
        '  assert.equal(cartTotal(cart), "€6.00");',
        "});",
        "",
        'test("defaults to USD", () => assert.equal(cartTotal({ items: [{ cents: 5, qty: 3 }] }), "$0.15"));',
        "",
      ].join("\n"),
    },
    protectedFiles: ["src/price.test.js", "src/cart.test.js"],
  },
];

export function benchmarkCase(id: string): BenchmarkCase | undefined {
  return BENCHMARK_CASES.find((row) => row.id === id);
}

export function benchmarkTargetKey(target: BenchmarkTarget): string {
  return `${target.providerId}/${target.model}`;
}

/** Parse `provider/model` (model may itself contain slashes). */
export function parseBenchmarkTarget(raw: string): BenchmarkTarget | undefined {
  const text = raw.trim();
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) return undefined;
  return { providerId: text.slice(0, slash), model: text.slice(slash + 1) };
}

export function scoreBenchmarkCase(input: {
  testsRan: boolean;
  testsOk: boolean;
  editedProtected: string[];
  timedOut?: boolean;
  needsHuman?: string;
  error?: string;
}): { status: "passed" | "failed" | "error"; reason: string } {
  if (input.error) return { status: "error", reason: input.error };
  if (input.editedProtected.length) {
    return { status: "failed", reason: `tests edited: ${input.editedProtected.join(", ")}` };
  }
  if (!input.testsRan) return { status: "failed", reason: "tests did not run" };
  if (!input.testsOk) {
    if (input.timedOut) return { status: "failed", reason: "timed out with failing tests" };
    return { status: "failed", reason: "tests failed" };
  }
  return {
    status: "passed",
    reason: input.timedOut ? "passed (hit the time limit)" : "tests passed",
  };
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarizeBenchmark(
  run: Pick<BenchmarkRun, "targets" | "results">,
): BenchmarkTargetSummary[] {
  return run.targets.map((target) => {
    const key = benchmarkTargetKey(target);
    const rows = run.results.filter(
      (row) =>
        benchmarkTargetKey(row.target) === key &&
        (row.status === "passed" || row.status === "failed" || row.status === "error"),
    );
    const passed = rows.filter((row) => row.status === "passed").length;
    const costs = rows.map((row) => row.usd).filter((v): v is number => typeof v === "number");
    return {
      target,
      passed,
      total: rows.length,
      passRate: rows.length ? passed / rows.length : 0,
      usd: costs.length ? costs.reduce((a, b) => a + b, 0) : undefined,
      medianMs: median(rows.map((row) => row.durationMs ?? 0).filter((ms) => ms > 0)),
      tokens: rows.reduce((sum, row) => sum + (row.inputTokens ?? 0) + (row.outputTokens ?? 0), 0),
    };
  });
}
