import { mkdirSync, writeFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { PatchFile } from "@locus/shared";
import { PatchCard } from "./PatchCard";
import { highlightSource } from "@/lib/highlight";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILE_COUNT = 36;
const LINES_PER_FILE = 60;
const ARTIFACT = "/opt/cursor/artifacts/pr_diff_perf.json";

function makeFiles(fileCount: number, linesPerFile: number): PatchFile[] {
  return Array.from({ length: fileCount }, (_, i) => {
    const rows = Array.from({ length: linesPerFile }, (_, j) => {
      if (j % 3 === 0) return { kind: "del" as const, text: `const old_${i}_${j} = ${j};` };
      if (j % 3 === 1) return { kind: "add" as const, text: `const next_${i}_${j} = ${j};` };
      return { kind: "ctx" as const, text: `export function keep_${i}_${j}() { return ${j}; }` };
    });
    return {
      path: `src/mod${i}.ts`,
      kind: "update" as const,
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          oldLines: rows.filter((row) => row.kind !== "add").map((row) => row.text),
          newLines: rows.filter((row) => row.kind !== "del").map((row) => row.text),
          rows,
        },
      ],
    };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("PatchCard review perf", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    if (host?.isConnected) {
      act(() => root.unmount());
      host.remove();
    }
  });

  function destroy() {
    act(() => root.unmount());
    host.remove();
  }

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const start = performance.now();
    act(() => {
      root.render(node);
    });
    return performance.now() - start;
  }

  it("renders a multi-file review diff without expanding every file", { timeout: 15_000 }, () => {
    const files = makeFiles(FILE_COUNT, LINES_PER_FILE);
    const reviewTimes: number[] = [];
    const stackedTimes: number[] = [];
    let reviewLines = 0;
    let stackedLines = 0;
    let selectMs = 0;

    for (let i = 0; i < 3; i++) {
      reviewTimes.push(
        render(
          <PatchCard
            files={files}
            density="review"
            focusPath={files[0]!.path}
            onLineSelect={() => undefined}
          />,
        ),
      );
      reviewLines = host.querySelectorAll(".patch-line").length;
      destroy();
    }

    render(
      <PatchCard
        files={files}
        density="review"
        focusPath={files[0]!.path}
        onLineSelect={() => undefined}
      />,
    );
    const selectStart = performance.now();
    act(() => {
      root.render(
        <PatchCard
          files={files}
          density="review"
          focusPath={files[0]!.path}
          selected={{ path: files[0]!.path, line: 2, side: "RIGHT" }}
          onLineSelect={() => undefined}
        />,
      );
    });
    selectMs = performance.now() - selectStart;
    expect(host.querySelector(".patch-line.selected")).toBeTruthy();
    destroy();

    for (let i = 0; i < 3; i++) {
      stackedTimes.push(
        render(<PatchCard files={files} density="chat" onLineSelect={() => undefined} />),
      );
      stackedLines = host.querySelectorAll(".patch-line").length;
      destroy();
    }

    const unique: string[] = [];
    for (let i = 0; i < 400; i++) unique.push(`const value_${i} = ${i};`);
    const highlightUniqueStart = performance.now();
    for (const line of unique) highlightSource(line, "ts");
    const highlightUniqueMs = performance.now() - highlightUniqueStart;
    const highlightRepeatStart = performance.now();
    for (let i = 0; i < unique.length; i++) highlightSource(unique[0]!, "ts");
    const highlightRepeatMs = performance.now() - highlightRepeatStart;

    const report = {
      files: FILE_COUNT,
      linesPerFile: LINES_PER_FILE,
      reviewMedianMs: Number(median(reviewTimes).toFixed(2)),
      reviewTimesMs: reviewTimes.map((ms) => Number(ms.toFixed(2))),
      reviewLines,
      stackedMedianMs: Number(median(stackedTimes).toFixed(2)),
      stackedTimesMs: stackedTimes.map((ms) => Number(ms.toFixed(2))),
      stackedLines,
      selectMs: Number(selectMs.toFixed(2)),
      highlightUniqueMs: Number(highlightUniqueMs.toFixed(2)),
      highlightRepeatMs: Number(highlightRepeatMs.toFixed(2)),
      speedup: Number((median(stackedTimes) / Math.max(median(reviewTimes), 0.01)).toFixed(2)),
    };
    try {
      mkdirSync("/opt/cursor/artifacts", { recursive: true });
      writeFileSync(ARTIFACT, `${JSON.stringify(report, null, 2)}\n`);
    } catch {
      /* cloud artifacts mount is optional (CI / local) */
    }
    // eslint-disable-next-line no-console
    console.log("PR diff perf", report);

    expect(reviewLines).toBe(LINES_PER_FILE);
    expect(stackedLines).toBe(0);
    expect(median(reviewTimes)).toBeLessThan(400);
    expect(selectMs).toBeLessThan(250);
    expect(highlightRepeatMs).toBeLessThan(highlightUniqueMs);
  });
});
