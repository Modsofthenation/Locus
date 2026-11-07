import { describe, expect, it } from "vitest";
import { buildLoadPath } from "./loadpath.js";
import {
  applyChangeStackSummaries,
  buildChangeStack,
  buildChangeStackFromPatch,
  formatChangeStackSummaryPrompt,
  parseChangeStack,
  parseChangeStackSummaryResponse,
  patchFilesForLayer,
  pullFilesFromUnifiedDiff,
  safeChangeStackHeadSha,
  type ChangeStack,
} from "./changeStack.js";
import { parseFilePatch } from "./patch.js";

const serializerPatch = `@@ -1,6 +1,8 @@
 class InvoiceSerializer:
     class Meta:
-        fields = ("id", "total")
+        fields = ("id", "total", "currency")
+    def get_currency(self):
+        return self.object.currency
`;

const pagePatch = `@@ -1,8 +1,9 @@
 import { fetchInvoice } from "./invoiceApi";
 import { InvoiceForm } from "./InvoiceForm";
+import { currencyLabel } from "./format";
 export function InvoicePage() {
-  return <InvoiceForm />;
+  return <InvoiceForm currency={currencyLabel} />;
 }
`;

const apiPatch = `@@ -1,5 +1,6 @@
 export function fetchInvoice(id) {
-  return fetch("/api/invoices/" + id);
+  return fetch("/api/invoices/" + id + "?currency=1");
 }
`;

const testPatch = `@@ -1,5 +1,6 @@
 def test_invoice_serializer():
     data = InvoiceSerializer().data
+    assert "currency" in data
     assert "total" in data
`;

const docsPatch = `@@ -1,1 +1,2 @@
 # Guide
+See currency.
`;

const meta = {
  repoId: "11111111-1111-1111-1111-111111111111",
  number: 12,
  headSha: "abcdef123456",
  generatedAt: "2026-09-04T00:00:00.000Z",
};

function stackOf(
  files: Array<{ path: string; status?: "added" | "modified" | "removed"; patch?: string }>,
): ChangeStack {
  const rows = files.map((file) => ({
    path: file.path,
    status: file.status ?? ("modified" as const),
    patch: file.patch,
  }));
  return buildChangeStack(rows, buildLoadPath(rows), meta);
}

describe("buildChangeStack", () => {
  it("orders API before tests inside a cohort and keeps a disconnected UI cohort separate", () => {
    const stack = stackOf([
      { path: "billing/serializers.py", patch: serializerPatch },
      { path: "frontend/src/invoiceApi.ts", patch: apiPatch },
      { path: "frontend/src/InvoicePage.tsx", patch: pagePatch },
      { path: "billing/tests.py", patch: testPatch },
    ]);
    expect(stack.source).toBe("heuristic");
    expect(stack.headSha).toBe("abcdef123456");
    expect(stack.cohorts.length).toBe(2);
    const billing = stack.cohorts.find((cohort) =>
      cohort.layers.some((layer) =>
        layer.ranges.some((range) => range.path === "billing/serializers.py"),
      ),
    );
    const frontend = stack.cohorts.find((cohort) =>
      cohort.layers.some((layer) =>
        layer.ranges.some((range) => range.path === "frontend/src/InvoicePage.tsx"),
      ),
    );
    expect(billing?.layers.map((layer) => layer.title)).toEqual(["API", "Tests"]);
    expect(frontend?.layers.map((layer) => layer.title)).toContain("UI");
    expect(frontend).not.toBe(billing);
    const apiLayer = billing!.layers[0]!;
    expect(apiLayer.ranges[0]!.path).toBe("billing/serializers.py");
    expect(apiLayer.ranges[0]!.startLine).toBe(1);
    expect(apiLayer.ranges[0]!.endLine).toBeGreaterThanOrEqual(apiLayer.ranges[0]!.startLine);
    expect(apiLayer.ranges[0]!.side).toBe("RIGHT");
    expect(apiLayer.ranges[0]!.header).toMatch(/^@@ -/);
    expect(stack.markdown).toMatch(/## Change stack/);
    expect(stack.markdown).toMatch(/Layer 1 · API/);
  });

  it("splits disconnected docs into a second cohort", () => {
    const stack = stackOf([
      { path: "billing/serializers.py", patch: serializerPatch },
      { path: "billing/tests.py", patch: testPatch },
      { path: "docs/guide.md", patch: docsPatch },
    ]);
    expect(stack.cohorts.length).toBe(2);
    const paths = stack.cohorts.map((cohort) =>
      cohort.layers.flatMap((layer) => layer.ranges.map((range) => range.path)),
    );
    expect(paths[0]).toEqual(
      expect.arrayContaining(["billing/serializers.py", "billing/tests.py"]),
    );
    expect(paths[0]).not.toContain("docs/guide.md");
    expect(paths[1]).toContain("docs/guide.md");
  });

  it("omits generated lockfiles that load path drops", () => {
    const stack = stackOf([
      { path: "billing/serializers.py", patch: serializerPatch },
      {
        path: "package-lock.json",
        patch: '@@ -1,1 +1,2 @@\n {\n+  "lockfileVersion": 3\n',
      },
      {
        path: "dist/app.min.js",
        patch: "@@ -1,1 +1,2 @@\n code\n+more\n",
      },
    ]);
    const all = stack.files.map((file) => file.path);
    expect(all).toContain("billing/serializers.py");
    expect(all).not.toContain("package-lock.json");
    expect(all).not.toContain("dist/app.min.js");
  });

  it("counts inline comments that land in a range", () => {
    const rows = [
      { path: "billing/serializers.py", status: "modified" as const, patch: serializerPatch },
    ];
    const stack = buildChangeStack(rows, buildLoadPath(rows), {
      ...meta,
      comments: [
        {
          id: "c1",
          body: "nit",
          path: "billing/serializers.py",
          line: 4,
          createdAt: "2026-09-04T00:00:00.000Z",
        },
      ],
    });
    expect(stack.cohorts[0]!.layers[0]!.commentCount).toBe(1);
  });
});

describe("patchFilesForLayer", () => {
  it("keeps only hunks that belong to the layer ranges", () => {
    const file = parseFilePatch(
      "src/app.ts",
      "@@ -1,2 +1,2 @@\n keep\n-old\n+new\n@@ -40,1 +40,2 @@\n ctx\n+added\n",
    );
    const filtered = patchFilesForLayer([file], {
      id: "c1-l1",
      title: "Code",
      intent: "consumer",
      fileCount: 1,
      commentCount: 0,
      ranges: [
        {
          path: "src/app.ts",
          startLine: 1,
          endLine: 2,
          side: "RIGHT",
          header: "@@ -1,2 +1,2 @@",
          summary: "Update app.ts",
        },
      ],
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.hunks).toHaveLength(1);
    expect(filtered[0]!.hunks[0]!.newStart).toBe(1);
  });
});

describe("parseChangeStack", () => {
  it("round-trips a heuristic snapshot", () => {
    const stack = stackOf([{ path: "billing/serializers.py", patch: serializerPatch }]);
    const parsed = parseChangeStack(JSON.parse(JSON.stringify(stack)));
    expect(parsed?.cohorts[0]!.id).toBe(stack.cohorts[0]!.id);
    expect(parsed?.files[0]!.path).toBe("billing/serializers.py");
    expect(parseChangeStack(null)).toBeUndefined();
    expect(parseChangeStack({ repoId: "x" })).toBeUndefined();
  });

  it("round-trips a layer mermaid diagram", () => {
    const stack = stackOf([{ path: "billing/serializers.py", patch: serializerPatch }]);
    stack.cohorts[0]!.layers[0]!.diagram = {
      kind: "sequence",
      mermaid: "sequenceDiagram\n  A->>B: hop",
    };
    const parsed = parseChangeStack(JSON.parse(JSON.stringify(stack)));
    expect(parsed?.cohorts[0]!.layers[0]!.diagram?.kind).toBe("sequence");
    expect(parsed?.cohorts[0]!.layers[0]!.diagram?.mermaid).toMatch(/sequenceDiagram/);
  });
});

describe("heuristic diagrams", () => {
  it("adds a sequence diagram when UI hops to an API module", () => {
    const stack = stackOf([
      { path: "frontend/src/invoiceApi.ts", patch: apiPatch },
      { path: "frontend/src/InvoicePage.tsx", patch: pagePatch },
    ]);
    const layers = stack.cohorts.flatMap((cohort) => cohort.layers);
    const diagram = layers.map((layer) => layer.diagram).find(Boolean);
    expect(diagram?.kind).toBe("sequence");
    expect(diagram?.mermaid).toMatch(/sequenceDiagram/);
    expect(diagram?.mermaid).toMatch(/->>/);
  });

  it("adds an ERD on schema layers with model symbols", () => {
    const stack = stackOf([
      {
        path: "billing/models.py",
        patch: `@@ -1,4 +1,8 @@
 class Invoice:
     id = models.UUIDField()
+    currency = models.CharField()
+class InvoiceLine:
+    invoice = models.ForeignKey(Invoice)
`,
      },
    ]);
    const layer = stack.cohorts[0]!.layers[0]!;
    expect(layer.title).toBe("Schema");
    expect(layer.diagram?.kind).toBe("erd");
    expect(layer.diagram?.mermaid).toMatch(/erDiagram/);
    expect(layer.diagram?.mermaid).toMatch(/Invoice/);
    expect(layer.diagram?.mermaid).not.toMatch(/relates/);
  });

  it("adds a state diagram when a status machine is edited", () => {
    const stack = stackOf([
      {
        path: "billing/invoiceStatus.ts",
        patch: `@@ -1,4 +1,6 @@
 export type InvoiceStatus =
   | "draft"
+  | "open"
+  | "paid"
   | "void";
`,
      },
    ]);
    const diagram = stack.cohorts[0]!.layers[0]!.diagram;
    expect(diagram?.kind).toBe("state");
    expect(diagram?.mermaid).toMatch(/stateDiagram/);
    expect(diagram?.mermaid).toMatch(/draft/);
  });
});

describe("change stack summaries", () => {
  it("applies model titles and range summaries by id", () => {
    const stack = stackOf([{ path: "billing/serializers.py", patch: serializerPatch }]);
    const range = stack.cohorts[0]!.layers[0]!.ranges[0]!;
    const next = applyChangeStackSummaries(stack, {
      cohorts: [
        {
          id: stack.cohorts[0]!.id,
          title: "Invoice currency contract",
          summary: "Serializer now exposes currency.",
          layers: [
            {
              id: stack.cohorts[0]!.layers[0]!.id,
              ranges: [
                {
                  path: range.path,
                  startLine: range.startLine,
                  summary: "Add currency to the serializer fields.",
                },
              ],
              diagram: {
                kind: "sequence",
                mermaid: "sequenceDiagram\n  Client->>API: GET invoice",
              },
            },
          ],
        },
      ],
    });
    expect(next.source).toBe("heuristic+model");
    expect(next.cohorts[0]!.title).toBe("Invoice currency contract");
    expect(next.cohorts[0]!.layers[0]!.ranges[0]!.summary).toBe(
      "Add currency to the serializer fields.",
    );
    expect(next.cohorts[0]!.layers[0]!.diagram?.mermaid).toMatch(/Client->>API/);
    expect(applyChangeStackSummaries(stack, { cohorts: [] }).source).toBe("heuristic");
  });

  it("parses fenced JSON and ignores empty replacements", () => {
    const parsed = parseChangeStackSummaryResponse(
      'Here you go:\n```json\n{"cohorts":[{"id":"c1","title":"Auth refresh"}]}\n```\n',
    );
    expect(parsed?.cohorts?.[0]!.title).toBe("Auth refresh");
    expect(parseChangeStackSummaryResponse("not json")).toBeUndefined();
  });

  it("includes clipped hunks in the summary prompt", () => {
    const stack = stackOf([{ path: "billing/serializers.py", patch: serializerPatch }]);
    const prompt = formatChangeStackSummaryPrompt(stack, [
      { path: "billing/serializers.py", patch: serializerPatch },
    ]);
    expect(prompt).toMatch(/Return JSON only/);
    expect(prompt).toMatch(/billing\/serializers\.py/);
    expect(prompt).toMatch(/get_currency/);
  });
});

describe("buildChangeStackFromPatch", () => {
  it("builds a walkthrough from a unified turn diff", () => {
    const patch = [
      "diff --git a/src/app.ts b/src/app.ts",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,1 +1,2 @@",
      " export const n = 1",
      "+export const m = 2",
    ].join("\n");
    expect(pullFilesFromUnifiedDiff(patch)[0]!.path).toBe("src/app.ts");
    const stack = buildChangeStackFromPatch(patch, { ...meta, number: 1, headSha: "cp1" });
    expect(stack.files[0]!.path).toBe("src/app.ts");
    expect(stack.cohorts[0]!.layers[0]!.ranges.length).toBeGreaterThan(0);
  });
});

describe("safeChangeStackHeadSha", () => {
  it("accepts git shas and rejects path junk", () => {
    expect(safeChangeStackHeadSha("ABCDEF123456")).toBe("abcdef123456");
    expect(safeChangeStackHeadSha("../etc/passwd")).toBeUndefined();
    expect(safeChangeStackHeadSha("short")).toBeUndefined();
  });
});
