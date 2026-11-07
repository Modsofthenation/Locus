import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "@locus/shared";
import { ToolActivity } from "./ChatToolActivity";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    resolveApproval: vi.fn(async () => ({ id: "s1" })),
    revealWorkspace: vi.fn(async () => ({ path: "/tmp" })),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ToolActivity slack_post draft", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.clearAllMocks();
  });

  it("lets the operator edit a slack_post draft and Send from chat", async () => {
    const call: ToolCall = {
      id: "t-post",
      name: "slack_post",
      arguments: { text: "looking now", channel: "C_ENG" },
      approval: "needed",
      startedAt: "2020-01-01T00:00:00.000Z",
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ToolActivity sessionId="s1" calls={[call]} tools={[]} />);
    });

    const field = host.querySelector("[data-testid='slack-draft-text']") as HTMLTextAreaElement;
    expect(field?.value).toBe("looking now");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, "ship the patch");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host!
        .querySelector("[data-testid='slack-draft-send']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledWith("s1", "t-post", "approved", "ship the patch");
  });

  it("lets the operator edit a brain briefing and Approve before it posts", async () => {
    const call: ToolCall = {
      id: "t-brief",
      name: "brain_brief",
      arguments: {
        issue: "ENG-12",
        target: "jira",
        body: "Brain briefing for ENG-12\n\nOwning service\nbilling",
      },
      approval: "needed",
      startedAt: "2020-01-01T00:00:00.000Z",
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ToolActivity sessionId="s1" calls={[call]} tools={[]} />);
    });
    const field = host.querySelector("[data-testid='brain-brief-text']") as HTMLTextAreaElement;
    expect(field?.value).toMatch(/billing/);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(field, "billing owns charges");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host!
        .querySelector("[data-testid='brain-brief-approve']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.resolveApproval).toHaveBeenCalledWith(
      "s1",
      "t-brief",
      "approved",
      "billing owns charges",
    );
  });

  it("renders ADD/edit cards next to the matching activity row", async () => {
    const patchA = [
      "--- /dev/null",
      "+++ /workspace/src/a.ts",
      "@@ -0,0 +1 @@",
      "+export const a = 1;",
    ].join("\n");
    const patchB = [
      "--- /dev/null",
      "+++ /workspace/src/b.ts",
      "@@ -0,0 +1 @@",
      "+export const b = 2;",
    ].join("\n");
    const calls: ToolCall[] = [
      {
        id: "c-read",
        name: "file_read",
        arguments: { path: "/workspace/src/a.ts" },
        result: "ok",
        startedAt: "2020-01-01T00:00:00.000Z",
        finishedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "c-edit-a",
        name: "apply_patch",
        arguments: { patch: patchA },
        result: "updated src/a.ts",
        startedAt: "2020-01-01T00:00:01.000Z",
        finishedAt: "2020-01-01T00:00:01.000Z",
      },
      {
        id: "c-run",
        name: "exec",
        arguments: { command: "node probe.mjs" },
        result: "ok\n(exit 0)",
        startedAt: "2020-01-01T00:00:02.000Z",
        finishedAt: "2020-01-01T00:00:02.000Z",
      },
      {
        id: "c-edit-b",
        name: "apply_patch",
        arguments: { patch: patchB },
        result: "updated src/b.ts",
        startedAt: "2020-01-01T00:00:03.000Z",
        finishedAt: "2020-01-01T00:00:03.000Z",
      },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ToolActivity sessionId="s1" calls={calls} tools={[]} />);
    });

    const rows = [
      ...host.querySelectorAll("[data-testid='tool-activity'], [data-testid='patch-card']"),
    ];
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual([
      "tool-activity",
      "tool-activity",
      "patch-card",
      "tool-activity",
      "tool-activity",
      "patch-card",
    ]);
    expect(rows[1]?.textContent).toMatch(/Edited/);
    expect(rows[2]?.querySelector(".patch-path-name")?.textContent).toBe("a.ts");
    expect(rows[4]?.textContent).toMatch(/Edited/);
    expect(rows[5]?.querySelector(".patch-path-name")?.textContent).toBe("b.ts");
  });

  it("groups mixed inspect tools into one summary that expands to each call", async () => {
    const calls: ToolCall[] = [
      {
        id: "c-read",
        name: "file_read",
        arguments: { path: "/workspace/src/a.ts" },
        result: "ok",
        startedAt: "2020-01-01T00:00:00.000Z",
        finishedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "c-grep",
        name: "grep",
        arguments: { pattern: "TODO" },
        result: "hit",
        startedAt: "2020-01-01T00:00:01.000Z",
        finishedAt: "2020-01-01T00:00:01.000Z",
      },
      {
        id: "c-mcp",
        name: "mcp_call",
        arguments: { tool: "jira_get" },
        result: "{}",
        startedAt: "2020-01-01T00:00:02.000Z",
        finishedAt: "2020-01-01T00:00:02.000Z",
      },
      {
        id: "c-run",
        name: "exec",
        arguments: { command: "npm test" },
        result: "ok\n(exit 0)",
        startedAt: "2020-01-01T00:00:03.000Z",
        finishedAt: "2020-01-01T00:00:03.000Z",
      },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ToolActivity sessionId="s1" calls={calls} tools={[]} />);
    });

    const activity = host.querySelector("[data-testid='tool-activity']") as HTMLDetailsElement;
    expect(activity).toBeTruthy();
    expect(host.querySelectorAll("[data-testid='tool-activity']").length).toBe(1);
    expect(activity.querySelector(".tool-activity-label")?.textContent).toBe(
      "Explored 1 file, 1 search, 1 tool, ran 1 command",
    );
    expect(activity.hasAttribute("open")).toBe(false);
    expect(host.querySelectorAll(".tool-chip").length).toBe(4);

    await act(async () => {
      activity.querySelector("summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(activity.open).toBe(true);
    const chips = [...host.querySelectorAll(".tool-chip summary")].map((el) => el.textContent);
    expect(chips[0]).toMatch(/file_read/);
    expect(chips[1]).toMatch(/grep/);
    expect(chips[2]).toMatch(/mcp/);
    expect(chips[3]).toMatch(/exec · npm test/);
  });

  it("does not mark a collapsed exploration Failed when only one call failed", async () => {
    const calls: ToolCall[] = [
      {
        id: "c-read",
        name: "file_read",
        arguments: { path: "/workspace/src/a.ts" },
        result: "ok",
        startedAt: "2020-01-01T00:00:00.000Z",
        finishedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "c-grep",
        name: "grep",
        arguments: { pattern: "TODO" },
        result: "hit",
        startedAt: "2020-01-01T00:00:01.000Z",
        finishedAt: "2020-01-01T00:00:01.000Z",
      },
      {
        id: "c-mcp",
        name: "mcp_call",
        arguments: { tool: "jira_get" },
        error: "Jira unreachable",
        startedAt: "2020-01-01T00:00:02.000Z",
        finishedAt: "2020-01-01T00:00:02.000Z",
      },
      {
        id: "c-run",
        name: "exec",
        arguments: { command: "npm test" },
        result: "ok\n(exit 0)",
        startedAt: "2020-01-01T00:00:03.000Z",
        finishedAt: "2020-01-01T00:00:03.000Z",
      },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ToolActivity sessionId="s1" calls={calls} tools={[]} />);
    });

    const activity = host.querySelector("[data-testid='tool-activity']") as HTMLDetailsElement;
    expect(activity.querySelector(".tool-activity-label")?.textContent).toBe(
      "Explored 1 file, 1 search, 1 tool, ran 1 command",
    );
    expect(activity.querySelector(".tool-activity-status")).toBeNull();
    expect(activity.querySelector("summary")?.textContent).not.toMatch(/failed/i);

    const failedChip = [...host.querySelectorAll(".tool-chip summary")].find((el) =>
      el.textContent?.includes("mcp"),
    );
    expect(failedChip?.textContent).toMatch(/failed/);
  });

  it("still shows Failed when every folded call failed", async () => {
    const calls: ToolCall[] = [
      {
        id: "c-read-a",
        name: "file_read",
        arguments: { path: "/workspace/src/a.ts" },
        error: "missing",
        startedAt: "2020-01-01T00:00:00.000Z",
        finishedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "c-read-b",
        name: "file_read",
        arguments: { path: "/workspace/src/b.ts" },
        error: "missing",
        startedAt: "2020-01-01T00:00:01.000Z",
        finishedAt: "2020-01-01T00:00:01.000Z",
      },
    ];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ToolActivity sessionId="s1" calls={calls} tools={[]} />);
    });

    const activity = host.querySelector("[data-testid='tool-activity']") as HTMLDetailsElement;
    expect(activity.querySelector(".tool-activity-label")?.textContent).toBe("Read a.ts, b.ts");
    expect(activity.querySelector(".tool-activity-status")?.textContent).toBe("failed");
  });
});
