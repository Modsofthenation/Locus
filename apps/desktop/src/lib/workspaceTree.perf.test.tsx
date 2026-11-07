import { mkdirSync, writeFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceTree,
  countWorkspaceTreeNodes,
  filterWorkspaceTree,
  WORKSPACE_FILTER_MAX_NODES,
  type WorkspaceTreeNode,
} from "./workspaceTree";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTIFACT = "/opt/cursor/artifacts/workspace_filter_perf.json";
const FILE_COUNT = 4_000;

function oldFilterWorkspaceTree(nodes: WorkspaceTreeNode[], query: string): WorkspaceTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  function walk(node: WorkspaceTreeNode): WorkspaceTreeNode | null {
    const selfMatch = node.name.toLowerCase().includes(q) || node.path.toLowerCase().includes(q);
    if (node.type === "file") return selfMatch ? node : null;
    if (selfMatch) return node;
    const children = node.children.flatMap((child) => {
      const next = walk(child);
      return next ? [next] : [];
    });
    return children.length > 0 ? { ...node, children } : null;
  }
  return nodes.flatMap((node) => {
    const next = walk(node);
    return next ? [next] : [];
  });
}

function TreeRows({ nodes, depth }: { nodes: WorkspaceTreeNode[]; depth: number }) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.path}>
          <button type="button" data-path={node.path} style={{ paddingLeft: 10 + depth * 12 }}>
            {node.name}
          </button>
          {node.children.length ? <TreeRows nodes={node.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe("workspace explorer filter perf", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    if (host?.isConnected) {
      act(() => root.unmount());
      host.remove();
    }
  });

  function render(node: ReactNode): number {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const start = performance.now();
    act(() => {
      root.render(node);
    });
    return performance.now() - start;
  }

  it("filters a large workspace much cheaper than expanding every path substring", () => {
    const entries = Array.from({ length: FILE_COUNT }, (_, i) => ({
      name: `file${i}.ts`,
      path: `apps/desktop/src/mod${i % 80}/file${i}.ts`,
      type: "file" as const,
    }));
    const tree = buildWorkspaceTree(entries);
    const oldTree = oldFilterWorkspaceTree(tree, "file");
    const nextTree = filterWorkspaceTree(tree, "file");
    const oldCount = countWorkspaceTreeNodes(oldTree);
    const nextCount = countWorkspaceTreeNodes(nextTree);

    const oldTimes: number[] = [];
    const newTimes: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      oldTimes.push(render(<TreeRows nodes={oldTree} depth={0} />));
      act(() => root.unmount());
      host.remove();
      newTimes.push(render(<TreeRows nodes={nextTree} depth={0} />));
      act(() => root.unmount());
      host.remove();
    }

    const payload = {
      files: FILE_COUNT,
      query: "file",
      old: { medianRenderMs: Number(median(oldTimes).toFixed(2)), nodes: oldCount },
      next: { medianRenderMs: Number(median(newTimes).toFixed(2)), nodes: nextCount },
      cap: WORKSPACE_FILTER_MAX_NODES,
    };
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    writeFileSync(ARTIFACT, `${JSON.stringify(payload, null, 2)}\n`);

    expect(nextCount).toBeLessThanOrEqual(WORKSPACE_FILTER_MAX_NODES + 8);
    expect(oldCount).toBeGreaterThan(FILE_COUNT);
    expect(median(newTimes)).toBeLessThan(median(oldTimes) / 2);
  });
});
