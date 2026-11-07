import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolPatch } from "./PatchCard";

vi.mock("@/lib/api", () => ({
  api: {
    revealWorkspace: async () => ({ path: "/tmp" }),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PatchStackCard", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(node: ReactNode) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(node);
    });
  }

  it("renders a change-stack walkthrough for multi-file patches", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-export const a = 1",
      "+export const a = 2",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- /dev/null",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+export const b = 1",
    ].join("\n");
    render(<ToolPatch name="apply_patch" args={{ patch }} sessionId="sess-1" callId="call-1" />);
    expect(host.querySelector("[data-testid='patch-stack-card']")).toBeTruthy();
  });

  it("PatchStackCard accepts parsed files with patchText", () => {
    const patch = [
      "diff --git a/packages/shared/src/a.ts b/packages/shared/src/a.ts",
      "--- a/packages/shared/src/a.ts",
      "+++ b/packages/shared/src/a.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/apps/server/src/b.ts b/apps/server/src/b.ts",
      "--- a/apps/server/src/b.ts",
      "+++ b/apps/server/src/b.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
    ].join("\n");
    render(<ToolPatch name="apply_patch" args={{ patch }} sessionId="s1" callId="c1" />);
    expect(host.querySelector("[data-testid='patch-stack-card']")).toBeTruthy();
  });

  it("keeps a flat PatchCard when sessionId is missing", () => {
    const patch = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-export const a = 1",
      "+export const a = 2",
      "diff --git a/src/b.ts b/src/b.ts",
      "--- /dev/null",
      "+++ b/src/b.ts",
      "@@ -0,0 +1 @@",
      "+export const b = 1",
    ].join("\n");
    render(<ToolPatch name="apply_patch" args={{ patch }} />);
    expect(host.querySelector("[data-testid='patch-stack-card']")).toBeFalsy();
  });
});
