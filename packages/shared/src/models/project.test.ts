import { describe, expect, it } from "vitest";
import {
  BLANK_PLAYBOOK,
  FEATURE_PLAYBOOK,
  GARDENING_PLAYBOOK,
  MIGRATION_PLAYBOOK,
  clampProjectConcurrency,
  formatProjectContextPrompt,
  isProjectStarter,
  isProjectToolName,
  liveMemberCount,
  parseProjectDocument,
  playbookForStarter,
  projectContextPath,
  projectMemberColumn,
  projectMembersByColumn,
  projectRuleSlug,
  projectSummary,
  seedContextFiles,
} from "./project.js";

describe("project model", () => {
  it("recognizes starters and tools", () => {
    expect(isProjectStarter("feature")).toBe(true);
    expect(isProjectStarter("kanban")).toBe(false);
    expect(isProjectToolName("project_spawn")).toBe(true);
    expect(isProjectToolName("project_propose_merge")).toBe(true);
    expect(isProjectToolName("project_propose_rule")).toBe(true);
    expect(isProjectToolName("team_directory")).toBe(true);
    expect(isProjectToolName("team_handoff")).toBe(true);
    expect(isProjectToolName("spawn_agent")).toBe(false);
  });

  it("seeds a distinct playbook file per starter", () => {
    expect(
      seedContextFiles("feature", "Auth").some((row) => row.path === "playbooks/feature.md"),
    ).toBe(true);
    expect(
      seedContextFiles("migration", "CSS").some((row) =>
        row.content.includes("One member per cohort"),
      ),
    ).toBe(true);
    expect(
      seedContextFiles("gardening", "Lint").some((row) => row.path === "playbooks/garden.md"),
    ).toBe(true);
    expect(
      seedContextFiles("gardening", "Lint").some((row) => row.path === "rules/README.md"),
    ).toBe(true);
    expect(seedContextFiles("blank", "X").some((row) => row.path === "playbooks/notes.md")).toBe(
      true,
    );
    expect(playbookForStarter("feature")).toBe(FEATURE_PLAYBOOK);
    expect(playbookForStarter("migration")).toBe(MIGRATION_PLAYBOOK);
    expect(playbookForStarter("gardening")).toBe(GARDENING_PLAYBOOK);
    expect(playbookForStarter("blank")).toBe(BLANK_PLAYBOOK);
  });

  it("jails context paths", () => {
    expect(projectContextPath("INDEX.md")).toBe("INDEX.md");
    expect(projectContextPath("playbooks/feature.md")).toBe("playbooks/feature.md");
    expect(projectContextPath("../secrets")).toBeUndefined();
    expect(projectContextPath("/etc/passwd")).toBeUndefined();
    expect(projectContextPath("a/../../x")).toBeUndefined();
  });

  it("parses a document and summary", () => {
    const doc = parseProjectDocument({
      id: "p1",
      title: "Auth",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      recipeId: "feature",
      memberIds: ["a", "b"],
      maxConcurrentMembers: 99,
    });
    expect(doc?.maxConcurrentMembers).toBe(8);
    expect(projectSummary(doc!).memberCount).toBe(2);
    expect(
      parseProjectDocument({
        id: "p2",
        title: "Auth",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        memberIds: [],
        boardId: "board-1",
      })?.boardId,
    ).toBe("board-1");
    expect(projectRuleSlug("Never bill from the worker")).toBe("never-bill-from-the-worker");
    expect(projectSummary(doc!).needsYouCount).toBe(0);
    expect(projectSummary(doc!).teamName).toBe("Auth");
    expect(clampProjectConcurrency(0)).toBe(1);
  });

  it("preserves group chat metadata", () => {
    const doc = parseProjectDocument({
      id: "group-1",
      title: "Launch room",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      memberIds: ["a", "b"],
      groupChat: true,
    });
    expect(doc?.groupChat).toBe(true);
    expect(projectSummary(doc!).groupChat).toBe(true);
  });

  it("counts live members", () => {
    expect(
      liveMemberCount(
        [
          { id: "a", status: "running" },
          { id: "b", status: "idle" },
          { id: "c", status: "provisioning" },
        ],
        ["a", "c", "z"],
      ),
    ).toBe(2);
  });

  it("clips context prompt", () => {
    const text = formatProjectContextPrompt({
      title: "Auth",
      index: "Hello",
      files: [{ path: "INDEX.md", bytes: 12 }],
      budget: 40,
    });
    expect(text.startsWith("Project: Auth")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
  });

  it("classifies fleet columns with Needs you → Done → Ready to merge → In review → Working", () => {
    expect(projectMemberColumn({ status: "idle", needsHuman: "Approve" })).toBe("needs_you");
    expect(projectMemberColumn({ status: "error" })).toBe("needs_you");
    expect(projectMemberColumn({ status: "idle", pull: { state: "closed" } })).toBe("needs_you");
    expect(
      projectMemberColumn({
        status: "running",
        needsHuman: "Approve",
        pull: { state: "open" },
      }),
    ).toBe("needs_you");
    expect(projectMemberColumn({ status: "idle", pull: { state: "merged" } })).toBe("done");
    expect(projectMemberColumn({ status: "running", pull: { state: "open" } })).toBe("in_review");
    expect(
      projectMemberColumn({
        status: "idle",
        pull: { state: "open", checkState: "success" },
      }),
    ).toBe("ready_to_merge");
    expect(
      projectMemberColumn({
        status: "idle",
        pull: { state: "draft", checkState: "success" },
      }),
    ).toBe("in_review");
    expect(projectMemberColumn({ status: "idle", pull: { state: "draft" } })).toBe("in_review");
    expect(projectMemberColumn({ status: "running" })).toBe("working");
    expect(projectMemberColumn({ status: "idle" })).toBe("working");
  });

  it("groups members into stacked columns in order", () => {
    const groups = projectMembersByColumn(
      [
        { id: "a", status: "idle" as const },
        { id: "b", status: "idle" as const, pull: { state: "open" as const } },
        { id: "c", status: "idle" as const, pull: { state: "merged" as const } },
        { id: "d", status: "error" as const },
      ],
      projectMemberColumn,
    );
    expect(groups.map((row) => row.column)).toEqual([
      "needs_you",
      "working",
      "in_review",
      "ready_to_merge",
      "done",
    ]);
    expect(groups[0]?.members.map((row) => row.id)).toEqual(["d"]);
    expect(groups[1]?.members.map((row) => row.id)).toEqual(["a"]);
    expect(groups[2]?.members.map((row) => row.id)).toEqual(["b"]);
    expect(groups[3]?.members).toEqual([]);
    expect(groups[4]?.members.map((row) => row.id)).toEqual(["c"]);
  });
});
