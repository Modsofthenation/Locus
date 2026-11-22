import { describe, expect, it } from "vitest";
import { applyMcpServerManageAction, type McpServerConfig } from "./mcp.js";
import { applySkillManageAction, type AgentSkill } from "./skill.js";
import { policyToolNeedsApproval } from "./approval.js";
import { toolOutputIsHostile } from "../untrusted.js";

let n = 0;
const newId = () => `id-${++n}`;

const builtin: AgentSkill = {
  id: "builtin:review-pr",
  name: "review-pr",
  title: "PR review",
  hint: "Review",
  body: "Review the PR",
  enabled: true,
};

describe("applySkillManageAction", () => {
  it("creates a skill from chat", () => {
    const result = applySkillManageAction(
      [builtin],
      { action: "create", name: "release-notes", body: "Write release notes from git log." },
      newId,
      ["plan"],
    );
    expect(result.ok).toBe(true);
    const skill = result.skills.find((row) => row.name === "release-notes");
    expect(skill?.body).toContain("release notes");
    expect(skill?.enabled).toBe(true);
    expect(result.output).toContain("/release-notes");
  });

  it("rejects reserved, duplicate, and empty skills", () => {
    expect(
      applySkillManageAction([], { action: "create", name: "plan", body: "x" }, newId, ["plan"]).ok,
    ).toBe(false);
    expect(
      applySkillManageAction([builtin], { action: "create", name: "review-pr", body: "x" }, newId)
        .output,
    ).toContain("already used");
    expect(applySkillManageAction([], { action: "create", name: "empty" }, newId).ok).toBe(false);
    expect(
      applySkillManageAction([], { action: "create", name: "Bad Name", body: "x" }, newId).ok,
    ).toBe(false);
  });

  it("updates, renames, disables, and deletes by name", () => {
    const created = applySkillManageAction(
      [builtin],
      { action: "create", name: "triage", body: "Triage the bug." },
      newId,
    );
    const updated = applySkillManageAction(
      created.skills,
      { action: "update", name: "triage", rename: "bug-triage", enabled: "false" },
      newId,
    );
    expect(updated.ok).toBe(true);
    const row = updated.skills.find((s) => s.name === "bug-triage");
    expect(row?.body).toBe("Triage the bug.");
    expect(row?.enabled).toBe(false);
    const removed = applySkillManageAction(
      updated.skills,
      { action: "delete", name: "bug-triage" },
      newId,
    );
    expect(removed.skills.map((s) => s.name)).toEqual(["review-pr"]);
  });

  it("does not delete built-in skills", () => {
    const result = applySkillManageAction(
      [builtin],
      { action: "delete", name: "review-pr" },
      newId,
    );
    expect(result.ok).toBe(false);
    expect(result.skills).toHaveLength(1);
  });
});

describe("applyMcpServerManageAction", () => {
  it("adds a stdio server and keeps secrets out", () => {
    const result = applyMcpServerManageAction(
      [],
      {
        action: "create",
        name: "GitHub",
        command: "npx",
        args: '["-y","@modelcontextprotocol/server-github"]',
        env: '{"GITHUB_TOKEN":"ghp_leak","LOG_LEVEL":"info"}',
      },
      newId,
    );
    expect(result.ok).toBe(true);
    const server = result.servers[0]!;
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(server.env).toEqual({ GITHUB_TOKEN: "", LOG_LEVEL: "info" });
    // Blank secret → starts off until the operator pastes it.
    expect(server.enabled).toBe(false);
    expect(result.output).toContain("Settings → MCP");
    expect(JSON.stringify(result)).not.toContain("ghp_leak");
  });

  it("adds an HTTP server enabled", () => {
    const result = applyMcpServerManageAction(
      [],
      { action: "create", name: "Docs", url: "https://mcp.example.com/sse" },
      newId,
    );
    expect(result.ok).toBe(true);
    expect(result.servers[0]).toMatchObject({ url: "https://mcp.example.com/sse", enabled: true });
  });

  it("rejects shell syntax, bad args, and duplicates", () => {
    expect(
      applyMcpServerManageAction(
        [],
        { action: "create", name: "x", command: "sh -c 'a; b'" },
        newId,
      ).ok,
    ).toBe(false);
    expect(
      applyMcpServerManageAction(
        [],
        { action: "create", name: "x", command: "npx", args: "-y" },
        newId,
      ).output,
    ).toContain("JSON array");
    const first = applyMcpServerManageAction(
      [],
      { action: "create", name: "A", command: "npx" },
      newId,
    );
    expect(
      applyMcpServerManageAction(
        first.servers,
        { action: "create", name: "a", command: "uvx" },
        newId,
      ).ok,
    ).toBe(false);
  });

  it("updates without dropping stored secrets, and refuses managed servers", () => {
    const stored: McpServerConfig = {
      id: "gh",
      name: "GitHub",
      enabled: true,
      command: "npx",
      args: [],
      env: { GITHUB_TOKEN: "real-secret" },
    };
    const updated = applyMcpServerManageAction(
      [stored],
      { action: "update", name: "github", env: '{"GITHUB_TOKEN":"other"}', runtime: "guest" },
      newId,
    );
    expect(updated.ok).toBe(true);
    expect(updated.servers[0]).toMatchObject({ runtime: "guest", enabled: true });
    expect(updated.servers[0]!.env.GITHUB_TOKEN).toBe("real-secret");

    const managed = { ...stored, managed: true };
    expect(applyMcpServerManageAction([managed], { action: "delete", id: "gh" }, newId).ok).toBe(
      false,
    );
    expect(
      applyMcpServerManageAction([stored], { action: "delete", id: "gh" }, newId).servers,
    ).toEqual([]);
  });
});

describe("config tool approval", () => {
  it("asks before saving, not before listing", () => {
    for (const name of ["manage_skill", "manage_mcp_server"]) {
      expect(policyToolNeedsApproval(name, undefined, { action: "list" })).toBe(false);
      expect(policyToolNeedsApproval(name, undefined, { action: "create" })).toBe(true);
      expect(
        policyToolNeedsApproval(name, { autoAllow: ["mcp", "plugin"] }, { action: "create" }),
      ).toBe(true);
      expect(policyToolNeedsApproval(name, { autoAllow: [name] }, { action: "create" })).toBe(
        false,
      );
      expect(toolOutputIsHostile(name)).toBe(false);
    }
  });
});
