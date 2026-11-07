import { describe, expect, it } from "vitest";
import {
  advancePlanOnTool,
  acceptPlan,
  formatPlanRunPrompt,
  formatPlanStepPrompt,
  isPlanReadTool,
  MAX_PLAN_ITEMS,
  parsePlanCommand,
  parsePlanItems,
  parsePlanFilesAndRisks,
  planFromAssistant,
  planFromTurnTasks,
  planPhase,
  tasksTrackedThisTurn,
  startPlanRun,
} from "./models/plan.js";

describe("plan parsing", () => {
  it("reads numbered and bulleted steps", () => {
    expect(parsePlanItems("Sure.\n1. Clone the repo\n2) Run tests\n- Open a PR")).toEqual([
      "Clone the repo",
      "Run tests",
      "Open a PR",
    ]);
    expect(parsePlanItems("```\n1. not a step\n```\n1. Real step")).toEqual(["Real step"]);
    expect(planFromAssistant("Sure.")).toBeUndefined();
    expect(formatPlanRunPrompt({ items: [{ id: "p1", text: "Run tests" }] })).toMatch(
      /1\. Run tests/,
    );
  });

  it("treats /plan with optional task text", () => {
    expect(parsePlanCommand("hello")).toBeUndefined();
    expect(parsePlanCommand("/plan")).toBeNull();
    expect(parsePlanCommand("/plan fix the login")).toBe("fix the login");
  });

  it("marks /plan output as proposed and lists read-only tools", () => {
    const plan = planFromAssistant("1. Inspect\n2. Patch");
    expect(plan?.phase).toBe("proposed");
    expect(isPlanReadTool("grep")).toBe(true);
    expect(isPlanReadTool("git_diff")).toBe(true);
    expect(isPlanReadTool("task_list")).toBe(true);
    expect(isPlanReadTool("orient")).toBe(true);
    expect(isPlanReadTool("find_entity")).toBe(true);
    expect(isPlanReadTool("grafana_query")).toBe(true);
    expect(isPlanReadTool("sentry_search")).toBe(true);
    expect(isPlanReadTool("sentry_get")).toBe(true);
    expect(isPlanReadTool("jira_search")).toBe(true);
    expect(isPlanReadTool("confluence_search")).toBe(true);
    expect(isPlanReadTool("confluence_get")).toBe(true);
    expect(isPlanReadTool("linear_search")).toBe(true);
    expect(isPlanReadTool("linear_get")).toBe(true);
    expect(isPlanReadTool("linear_create")).toBe(false);
    expect(isPlanReadTool("incidentio_search")).toBe(true);
    expect(isPlanReadTool("incidentio_get")).toBe(true);
    expect(isPlanReadTool("incidentio_create")).toBe(false);
    expect(isPlanReadTool("k8s_list")).toBe(true);
    expect(isPlanReadTool("k8s_logs")).toBe(true);
    expect(isPlanReadTool("k8s_apply")).toBe(false);
    expect(isPlanReadTool("board_list")).toBe(true);
    expect(isPlanReadTool("board_get")).toBe(true);
    expect(isPlanReadTool("host_sessions")).toBe(true);
    expect(isPlanReadTool("scratchpad")).toBe(false);
    expect(isPlanReadTool("apply_patch")).toBe(false);
    expect(planPhase(plan)).toBe("proposed");
    expect(planPhase(acceptPlan(plan!))).toBe("accepted");
    expect(planPhase({})).toBe("accepted");
  });

  it("parses files and risks onto the proposed plan", () => {
    const plan = planFromAssistant(
      [
        "1. Inspect auth",
        "2. Patch the gate",
        "Files:",
        "- src/auth.ts",
        "- src/auth.test.ts",
        "Risks:",
        "- session cookies stay valid",
      ].join("\n"),
    );
    expect(plan?.items.map((item) => item.text)).toEqual(["Inspect auth", "Patch the gate"]);
    expect(plan?.files).toEqual(["src/auth.ts", "src/auth.test.ts"]);
    expect(plan?.risks).toEqual(["session cookies stay valid"]);
    expect(parsePlanFilesAndRisks("Files:\n- a.ts\nRisks:\n- auth").files).toEqual(["a.ts"]);
  });

  it("starts a run from a later step and ticks tools", () => {
    const plan = {
      items: [
        { id: "p1", text: "Inspect", status: "pending" as const },
        { id: "p2", text: "Patch", status: "pending" as const },
        { id: "p3", text: "Test", status: "pending" as const },
      ],
    };
    const started = startPlanRun(plan, 1);
    expect(started.items.map((item) => item.status)).toEqual(["skipped", "running", "pending"]);
    expect(formatPlanRunPrompt(started, 1)).toMatch(/starting at step 2/);
    expect(advancePlanOnTool(started, "grep").items.map((item) => item.status)).toEqual([
      "skipped",
      "running",
      "pending",
    ]);
    expect(advancePlanOnTool(started, "apply_patch").items.map((item) => item.status)).toEqual([
      "skipped",
      "done",
      "running",
    ]);
    expect(
      advancePlanOnTool(
        { items: [{ id: "p1", text: "Approve", status: "running", owner: "operator" }] },
        "apply_patch",
      ).items[0]?.status,
    ).toBe("running");
    expect(formatPlanStepPrompt(started, 1)).toMatch(/only step 2/);
  });
});

describe("plan from turn tasks", () => {
  it("falls back to the parsed prose list when the turn made no task_list calls", () => {
    const plan = planFromAssistant("Sure.\n1. Clone the repo\n2. Run tests");
    expect(planFromTurnTasks(plan, undefined)).toEqual(plan);
    expect(planFromTurnTasks(plan, [])).toEqual(plan);
  });

  it("returns no card only when the turn produced neither prose steps nor tasks", () => {
    expect(planFromTurnTasks(undefined, undefined).items).toEqual([]);
    // Prose skipped but task_list drove the turn: those rows are the artifact.
    expect(
      planFromTurnTasks(planFromAssistant("No checklist here, just prose."), [
        { text: "ignored", status: "pending" },
      ]).items.map((item) => item.text),
    ).toEqual(["ignored"]);
    expect(planFromTurnTasks(planFromAssistant("Still no checklist."), []).items).toEqual([]);
  });

  it("appends task rows the prose missed and refines matching step statuses", () => {
    const plan = planFromAssistant("1. Clone the repo\n2. Run the test suite");
    const merged = planFromTurnTasks(plan, [
      { text: "Run the test suite", status: "done" },
      { text: "Open the PR", status: "in_progress" },
    ]);
    expect(merged.items.map((item) => [item.text, item.status])).toEqual([
      ["Clone the repo", "pending"],
      ["Run the test suite", "done"],
      ["Open the PR", "pending"],
    ]);
    expect(merged.messageId).toBe(plan?.messageId);
  });

  it("keeps leftover session rows out of the turn-local task set", () => {
    const before = [{ id: "t1", text: "old leftover work", status: "in_progress" as const }];
    const after = [
      { id: "t1", text: "old leftover work", status: "done" as const },
      { id: "t2", text: "Open the PR", status: "pending" as const },
    ];
    expect(tasksTrackedThisTurn(before, after).map((row) => row.text)).toEqual(["Open the PR"]);
    const rewritten = [{ id: "t1", text: "Rewrite the login flow", status: "pending" as const }];
    expect(tasksTrackedThisTurn(before, rewritten).map((row) => row.text)).toEqual([
      "Rewrite the login flow",
    ]);
  });

  it("caps merged checklists at 20 rows", () => {
    const prose = planFromAssistant(
      Array.from({ length: 14 }, (_, i) => `${i + 1}. step ${i + 1}`).join("\n"),
    );
    const tasks = Array.from({ length: 14 }, (_, i) => ({
      id: `t${i + 1}`,
      text: `task ${i + 1}`,
      status: "pending" as const,
    }));
    expect(MAX_PLAN_ITEMS).toBe(20);
    expect(planFromTurnTasks(prose, tasks).items.length).toBe(20);
  });
});
