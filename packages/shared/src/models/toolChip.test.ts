import { describe, expect, it } from "vitest";
import {
  parseExitCode,
  canonicalToolCall,
  isFoldableToolActivity,
  toolActivityGroups,
  toolActivityLabel,
  toolActivityOpen,
  toolActivityStatus,
  toolActivitySummary,
  toolChipBits,
  toolChipLabel,
  toolChipStatus,
} from "./toolChip.js";

describe("tool chips", () => {
  it("surfaces exec command and exit code", () => {
    expect(parseExitCode("boom\n(exit 1)")).toBe(1);
    expect(toolChipLabel("exec", { command: "npm test" }, "\n(exit 1)")).toBe(
      "exec · npm test · exit 1",
    );
    expect(toolChipLabel("exec", { commands: ["git show a", "git grep foo"] })).toBe(
      "exec · 2 commands",
    );
    expect(toolChipLabel("file_read", { path: "/workspace/src/app.ts" })).toBe(
      "file_read · /workspace/src/app.ts",
    );
    expect(toolChipLabel("file_read", { paths: ["/workspace/a.ts", "/workspace/b.ts"] })).toBe(
      "file_read · 2 files",
    );
    expect(toolChipBits("grep", { pattern: "TODO", path: "/workspace" })).toEqual([
      "grep",
      "TODO",
      "/workspace",
    ]);
    expect(toolChipLabel("grep", { pattern: "TODO", path: "/workspace" })).toBe(
      "grep · TODO · /workspace",
    );
    expect(toolChipLabel("git_pr_get", { pull_number: 189 })).toBe("git_pr_get · #189");
    expect(toolChipLabel("preview", { port: 5173, path: "/app" })).toBe("preview · :5173 · /app");
    expect(toolChipLabel("preview", {})).toBe("preview");
    expect(toolChipLabel("playwright", { click: "#btn-deploy" })).toBe(
      "playwright · click #btn-deploy",
    );
    expect(toolChipLabel("playwright", { steps: ["click #a", "expect Ready"] })).toBe(
      "playwright · 2 steps",
    );
    expect(toolChipLabel("mcp_github_list_issues", {})).toBe("mcp github_list_issues");
    expect(toolChipLabel("ask_user", { question: "Ship it?" })).toBe("ask user · Ship it?");
    expect(
      toolChipLabel("host_sessions", { action: "read", session: "@game:arcade", path: "GAME.md" }),
    ).toBe("host sessions · read · @game:arcade · GAME.md");
    expect(
      toolChipLabel("ask_user", {
        question: "A few details",
        questions: [{ question: "Who?" }, { question: "Goal?" }],
      }),
    ).toBe("ask user · 2 questions");
    expect(
      toolActivityLabel("ask_user", {
        questions: [{ question: "Who?" }, { question: "Goal?" }],
      }),
    ).toBe("Asked 2 questions");
    expect(
      toolChipLabel("ask_user", {
        ask_user: JSON.stringify({
          question: "A few details",
          questions: [{ question: "Who?" }, { question: "Goal?" }],
        }),
      }),
    ).toBe("ask user · 2 questions");
    expect(toolChipLabel("read_skill", { name: "review" })).toBe("skill · review");
    expect(toolChipLabel("plugin_status_list", {})).toBe("plugin status_list");
    expect(toolChipLabel("manage_integration_plugin", { action: "create", slug: "pager" })).toBe(
      "plugin · create",
    );
    expect(
      toolActivityLabel("manage_integration_plugin", { action: "create", name: "Pager" }),
    ).toBe("Create plugin Pager");
    expect(toolChipLabel("browser_trace", { action: "stop" })).toBe("DevTools trace · stop");
    expect(toolChipLabel("websearch", { query: "locus agent qemu" })).toBe(
      "web search · locus agent qemu",
    );
    expect(toolChipLabel("grafana_query", { query: "logger.level:error", from: "now-1h" })).toBe(
      "grafana query · logger.level:error · now-1h",
    );
    expect(toolChipLabel("confluence_search", { cql: "space=ENG AND type=page" })).toBe(
      "confluence search · space=ENG AND type=page",
    );
    expect(toolChipLabel("confluence_get", { id: "123" })).toBe("confluence get · 123");
    expect(toolChipLabel("figma_get", { file: "AbCdEfGhIjKlMnOpQrStUv" })).toBe(
      "figma get · AbCdEfGhIjKlMnOpQrStUv",
    );
    expect(toolChipLabel("linear_search", { query: "checkout" })).toBe("linear search · checkout");
    expect(toolChipLabel("linear_get", { issue: "ENG-12" })).toBe("linear get · ENG-12");
    expect(toolChipLabel("k8s_logs", { name: "web-1", namespace: "ops" })).toBe("k8s logs · web-1");
    expect(toolChipLabel("k8s_list", { kind: "deploy" })).toBe("k8s list · deploy");
    expect(toolChipLabel("incidentio_search", { query: "database" })).toBe(
      "incident.io search · database",
    );
    expect(toolChipLabel("incidentio_get", { incident: "INC-123" })).toBe(
      "incident.io get · INC-123",
    );
    expect(
      toolChipLabel("portainer_container_action", { container: "web", action: "restart" }),
    ).toBe("portainer container action · web · restart");
    expect(toolChipLabel("docker_swarm", { action: "services" })).toBe("docker swarm · services");
    expect(toolChipLabel("docker_swarm", { action: "scale", service: "web", replicas: 3 })).toBe(
      "docker swarm · scale · web · ×3",
    );
    expect(toolChipLabel("gmail_search", { q: "from:ops subject:outage" })).toBe(
      "gmail search · from:ops subject:outage",
    );
    expect(toolChipLabel("gmail_send", { to: "ops@example.com", subject: "Status" })).toBe(
      "gmail send · ops@example.com · Status",
    );
    expect(
      toolChipLabel("calendar_create", { summary: "Standup", start: "2026-10-20T09:00:00Z" }),
    ).toBe("calendar create · Standup");
    expect(toolChipLabel("drive_upload", { name: "notes.md" })).toBe("drive upload · notes.md");
    expect(toolChipLabel("sentry_search", { query: "is:unresolved level:error" })).toBe(
      "sentry search · is:unresolved level:error",
    );
    expect(toolChipLabel("sentry_update", { issue: "WEB-12", status: "resolved" })).toBe(
      "sentry update · WEB-12 · resolved",
    );
    expect(toolChipLabel("scratchpad", { action: "write" })).toBe("scratchpad · write");
    expect(toolChipLabel("remember", { action: "add", text: "Uses Vite" })).toBe(
      "memory · add · Uses Vite",
    );
    expect(toolActivityLabel("remember", { action: "add", text: "Uses Vite" })).toBe(
      "Remembered Uses Vite",
    );
    expect(toolChipLabel("subscribe", { kind: "timer", name: "check CI" })).toBe(
      "subscribe · timer · check CI",
    );
    expect(toolActivityLabel("unsubscribe", { id: "s123abc" })).toBe("Unsubscribed s123abc");
    expect(toolChipLabel("spawn_agent", { task: "find the compact helper" })).toBe(
      "sub-agent · find the compact helper",
    );
    expect(toolChipLabel("spawn_agent", { task: "scan auth", kind: "review" })).toBe(
      "review sub-agent · scan auth",
    );
    expect(toolChipLabel("read_file", { target_file: "README.md" })).toBe("file_read · README.md");
    expect(canonicalToolCall("write_file", { target_file: "src/app.ts" })).toEqual({
      name: "file_write",
      arguments: { target_file: "src/app.ts", path: "src/app.ts" },
    });
    expect(
      canonicalToolCall("write", { path: "/workspace/_probe.mjs", contents: "export {}\n" }),
    ).toEqual({
      name: "file_write",
      arguments: {
        path: "/workspace/_probe.mjs",
        contents: "export {}\n",
        content: "export {}\n",
      },
    });
    expect(
      canonicalToolCall("Write", { file_path: "index.html", content: "<html></html>" }),
    ).toEqual({
      name: "file_write",
      arguments: {
        file_path: "index.html",
        content: "<html></html>",
        path: "index.html",
      },
    });
    expect(canonicalToolCall("read", { path: "/workspace/index.html" })).toEqual({
      name: "file_read",
      arguments: { path: "/workspace/index.html" },
    });
    expect(
      canonicalToolCall("askQuestion", {
        title: "Ubuntu scope",
        questions: [
          {
            id: "ubuntu_scope",
            prompt: "What should become Ubuntu?",
            options: [{ id: "iso_host", label: "ISO + host only" }],
          },
        ],
      }),
    ).toEqual({
      name: "ask_user",
      arguments: {
        question: "Ubuntu scope",
        questions: [
          {
            id: "ubuntu_scope",
            question: "What should become Ubuntu?",
            choices: ["ISO + host only"],
            allowFreeText: false,
          },
        ],
      },
    });
    expect(canonicalToolCall("CreatePlan", { name: "Ubuntu 26.04 ISO" })).toEqual({
      name: "createPlan",
      arguments: { name: "Ubuntu 26.04 ISO" },
    });
    expect(toolChipLabel("createPlan", { name: "Ubuntu 26.04 ISO" })).toBe(
      "plan · Ubuntu 26.04 ISO",
    );
    expect(toolActivityLabel("run_terminal_cmd", { command: "npm test" })).toBe("Ran npm test");
    expect(toolChipStatus({ result: "ok", finishedAt: "t" })).toBe("done");
    expect(toolChipStatus({ approval: "needed" })).toBe("waiting for approval");
  });
});

describe("tool activity labels", () => {
  it("uses operator-facing verbs instead of tool names and full commands", () => {
    expect(
      toolActivityLabel("file_read", { path: "/workspace/src/app.ts", offset: 210, limit: 51 }),
    ).toBe("Read app.ts L210-260");
    expect(toolActivityLabel("grep", { pattern: "startReviewSession", path: "/workspace" })).toBe(
      "Grepped startReviewSession",
    );
    expect(toolActivityLabel("glob", { pattern: "**/*repos*.test.ts" })).toBe(
      "Searched **/*repos*.test.ts",
    );
    expect(toolActivityLabel("exec", { command: "npm test" })).toBe("Ran npm test");
    expect(
      toolActivityLabel("exec", {
        command:
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command "Get-ChildItem -LiteralPath src"',
      }),
    ).toBe("Listed files");
    expect(
      toolActivityLabel("exec", {
        command:
          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -Command \"Get-Content -LiteralPath 'src files\\app.ts'\"",
      }),
    ).toBe("Read app.ts");
    expect(
      toolActivityLabel("exec", {
        command: 'cd /workspace/local-agents && grep -n "cors" apps/server/src/app.ts',
      }),
    ).toBe("Grepped cors");
    expect(
      toolActivityLabel("exec", {
        command: "cd /workspace/local-agents && sed -n '1949,1985p' apps/server/src/app.ts",
      }),
    ).toBe("Read app.ts L1949-1985");
    expect(toolActivityLabel("exec", { command: "git show develop:siq8/batch/test.py" })).toBe(
      "Read test.py",
    );
    expect(toolActivityLabel("exec", { commands: ["git show a", "git grep foo"] })).toBe(
      "Ran git show, Grepped foo",
    );
    expect(
      toolActivityLabel("exec", {
        commands: [
          "sed -n '125,244p' packages/shared/src/compact.ts",
          "sed -n '2350,2440p' apps/server/src/sessions.ts",
        ],
      }),
    ).toBe("Read compact.ts L125-244, sessions.ts L2350-2440");
    expect(toolActivityLabel("exec", { commands: ["cat a", "cat b", "cat c", "cat d"] })).toBe(
      "Read a, b, c, d",
    );
    expect(toolActivityLabel("exec", { commands: ["ls", "pwd", "git status"] })).toBe(
      "Ran ls, pwd, git status",
    );
    expect(toolActivityLabel("file_read", { paths: ["/workspace/a.ts", "/workspace/b.ts"] })).toBe(
      "Read a.ts, b.ts",
    );
    expect(toolActivityLabel("apply_patch", { path: "/workspace/src/app.ts" })).toBe(
      "Edited app.ts",
    );
    expect(toolActivityLabel("window_focus", { title: "Firefox" })).toBe("Focused Firefox");
  });

  it("summarizes a group of steps", () => {
    expect(toolActivitySummary([{ name: "file_read", arguments: { path: "ChatPane.tsx" } }])).toBe(
      "Read ChatPane.tsx",
    );
    expect(
      toolActivityGroups([
        {
          name: "exec",
          arguments: { commands: ["cat a", "cat b", "cat c", "cat d"] },
          finishedAt: "t",
        },
        {
          name: "exec",
          arguments: { commands: ["ls", "pwd", "git status"] },
          finishedAt: "t",
        },
      ]).map((group) => toolActivitySummary(group)),
    ).toEqual(["Explored 4 files, ran 3 commands"]);
    expect(
      toolActivitySummary(
        Array.from({ length: 5 }, (_, i) => ({
          name: "file_read",
          arguments: { path: `f${i}.ts` },
          finishedAt: "t",
        })),
      ),
    ).toBe("Explored 5 files");
    expect(
      toolActivitySummary([
        { name: "file_read", arguments: { path: "a.ts" }, finishedAt: "t" },
        { name: "file_read", arguments: { path: "b.ts" }, finishedAt: "t" },
        { name: "grep", arguments: { pattern: "x" }, finishedAt: "t" },
        { name: "exec", arguments: { command: "npm test" }, finishedAt: "t" },
        { name: "exec", arguments: { command: "npm lint" }, finishedAt: "t" },
      ]),
    ).toBe("Explored 2 files, 1 search, ran 2 commands");
    expect(
      toolActivitySummary([
        { name: "file_read", arguments: { path: "a.ts" } },
        { name: "grep", arguments: { pattern: "x" } },
        { name: "exec", arguments: { command: "npm test" } },
        { name: "mcp_call", arguments: { tool: "jira_get" } },
      ]),
    ).toBe("Exploring 1 file, 1 search, 1 tool, ran 1 command");
    expect(
      toolActivityGroups([
        { name: "exec", arguments: { commands: ["cat a", "cat b", "cat c", "cat d"] } },
        { name: "exec", arguments: { commands: ["ls", "pwd", "git status"] } },
      ]),
    ).toHaveLength(1);
    expect(
      toolActivityGroups([
        { name: "exec", arguments: { command: "cat package.json" } },
        { name: "git_status", arguments: {} },
      ]).map((group) => group.map((call) => call.name)),
    ).toEqual([["exec", "git_status"]]);
    expect(
      toolActivityGroups([
        { name: "file_read", arguments: { path: "ChatPane.tsx" } },
        { name: "grep", arguments: { pattern: "cors" } },
      ]).map((group) => group.map((call) => call.name)),
    ).toEqual([["file_read", "grep"]]);
    expect(
      toolActivityGroups([
        { name: "exec", arguments: { command: "npm test" } },
        { name: "exec", arguments: { command: "npm lint" } },
      ]).map((group) => toolActivitySummary(group)),
    ).toEqual(["Ran npm test, npm lint"]);
    expect(
      toolActivityGroups([
        { name: "file_read", arguments: { path: "5 files.ts" } },
        { name: "file_read", arguments: { path: "6 files.ts" } },
      ]).map((group) => toolActivitySummary(group)),
    ).toEqual(["Read 5 files.ts, 6 files.ts"]);
    expect(
      toolActivityGroups([
        { name: "file_read", arguments: { path: "a.ts" } },
        { name: "file_read", arguments: { path: "b.ts" } },
        { name: "grep", arguments: { pattern: "x" } },
        { name: "exec", arguments: { command: "npm test" } },
        { name: "exec", arguments: { command: "npm lint" } },
      ]).map((group) => group.map((call) => call.name)),
    ).toEqual([["file_read", "file_read", "grep", "exec", "exec"]]);
    expect(
      toolActivityGroups([
        { name: "file_read", arguments: { path: "a.ts" }, finishedAt: "t" },
        { name: "file_read", arguments: { path: "b.ts" }, finishedAt: "t" },
        { name: "file_read", arguments: { path: "c.ts" }, finishedAt: "t" },
        { name: "file_read", arguments: { path: "d.ts" }, finishedAt: "t" },
        { name: "grep", arguments: { pattern: "x" }, finishedAt: "t" },
        { name: "exec", arguments: { command: "npm test" }, finishedAt: "t" },
      ]).map((group) => toolActivitySummary(group)),
    ).toEqual(["Explored 4 files, 1 search, ran 1 command"]);
    expect(isFoldableToolActivity({ name: "apply_patch", arguments: { path: "a.ts" } })).toBe(
      false,
    );
    expect(isFoldableToolActivity({ name: "brain_brief", arguments: { issue: "ENG-1" } })).toBe(
      false,
    );
    expect(isFoldableToolActivity({ name: "file_read", arguments: { path: "a.ts" } })).toBe(true);
    expect(
      toolActivityGroups([
        { name: "file_read", arguments: { path: "a.ts" } },
        { name: "apply_patch", arguments: { path: "a.ts" } },
        { name: "exec", arguments: { command: "npm test" } },
      ]).map((group) => group.map((call) => call.name)),
    ).toEqual([["file_read"], ["apply_patch"], ["exec"]]);
    const longReads = Array.from({ length: 20 }, (_, i) => ({
      name: "file_read",
      arguments: { path: `f${i}.ts` },
      finishedAt: "t",
    }));
    const longGroups = toolActivityGroups(longReads);
    expect(longGroups).toHaveLength(1);
    expect(longGroups.flat()).toHaveLength(20);
    expect(toolActivitySummary(longReads)).toBe("Explored 20 files");
    const hugeReads = Array.from({ length: 150 }, (_, i) => ({
      name: "file_read",
      arguments: { path: `huge${i}.ts` },
      finishedAt: "t",
    }));
    const hugeReadGroups = toolActivityGroups(hugeReads);
    expect(hugeReadGroups).toHaveLength(1);
    expect(hugeReadGroups.flat()).toHaveLength(150);
    expect(toolActivitySummary(hugeReads)).toBe("Explored 150 files");
    const hugeMixed = Array.from({ length: 150 }, (_, i) =>
      i % 4 === 0
        ? { name: "file_read", arguments: { path: `m${i}.ts` }, finishedAt: "t" }
        : i % 4 === 1
          ? { name: "grep", arguments: { pattern: `p${i}` }, finishedAt: "t" }
          : i % 4 === 2
            ? { name: "exec", arguments: { command: `cmd${i}` }, finishedAt: "t" }
            : { name: "git_status", arguments: {}, finishedAt: "t" },
    );
    const hugeMixedGroups = toolActivityGroups(hugeMixed);
    expect(hugeMixedGroups).toHaveLength(1);
    expect(hugeMixedGroups.flat()).toHaveLength(150);
    expect(toolActivitySummary(hugeMixed)).toBe("Explored 38 files, 38 searches, ran 74 commands");
    const mixedMany = Array.from({ length: 24 }, (_, i) =>
      i % 3 === 0
        ? { name: "file_read", arguments: { path: `f${i}.ts` }, finishedAt: "t" }
        : i % 3 === 1
          ? { name: "grep", arguments: { pattern: `p${i}` }, finishedAt: "t" }
          : { name: "exec", arguments: { command: `cmd${i}` }, finishedAt: "t" },
    );
    const mixedGroups = toolActivityGroups(mixedMany);
    expect(mixedGroups).toHaveLength(1);
    expect(toolActivitySummary(mixedMany)).toBe("Explored 8 files, 8 searches, ran 8 commands");
    expect(toolActivityStatus([{ name: "exec", approval: "needed" }])).toBe("waiting for approval");
    expect(toolActivityStatus([{ name: "exec", error: "command failed" }])).toBe("failed");
    expect(toolActivityStatus([{ name: "exec", finishedAt: "t", result: "ok" }])).toBeUndefined();
    expect(
      toolActivityStatus([
        { name: "file_read", arguments: { path: "a.ts" }, finishedAt: "t", result: "ok" },
        { name: "grep", arguments: { pattern: "x" }, finishedAt: "t", error: "no matches" },
      ]),
    ).toBeUndefined();
    expect(
      toolActivityStatus([
        { name: "exec", error: "boom", finishedAt: "t" },
        { name: "exec", error: "also boom", finishedAt: "t" },
      ]),
    ).toBe("failed");
    expect(
      toolActivityStatus([
        { name: "exec", error: "boom", finishedAt: "t" },
        { name: "file_read", arguments: { path: "a.ts" } },
      ]),
    ).toBe("running");
    expect(toolActivityOpen([{ name: "exec", approval: "needed" }])).toBe(true);
    expect(toolActivityOpen([{ name: "exec", finishedAt: "t", result: "ok" }])).toBe(false);
  });
});
