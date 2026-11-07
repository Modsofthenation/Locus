import { describe, expect, it } from "vitest";
import { DEFAULT_APPROVAL_POLICY, SENSITIVE_PATH_REFUSAL } from "@locus/shared";
import { gateToolRequest } from "./toolGates.js";

const ctx = { policy: DEFAULT_APPROVAL_POLICY };

describe("gateToolRequest", () => {
  it("fails schema, blocks force-push / exec / protected head, and refuses credential reads", () => {
    expect(gateToolRequest("file_write", { path: "/workspace/a.ts" }, ctx)).toEqual({
      kind: "fail",
      output: 'file_write is missing required argument "content".',
    });
    const htmlWrite: Record<string, unknown> = {
      content: "<!doctype html><html><body>Hi</body></html>",
    };
    expect(gateToolRequest("file_write", htmlWrite, ctx)).toEqual({
      kind: "fail",
      output: 'file_write is missing required argument "path".',
    });
    expect(htmlWrite.path).toBeUndefined();
    expect(gateToolRequest("file_write", htmlWrite, { ...ctx, isDesign: true })).toEqual({
      kind: "allow",
    });
    expect(htmlWrite.path).toBe("/workspace/index.html");
    expect(
      gateToolRequest("file_write", { content: "<div>fragment</div>" }, { ...ctx, isDesign: true }),
    ).toEqual({
      kind: "fail",
      output: 'file_write is missing required argument "path".',
    });
    expect(gateToolRequest("file_write", { content: "console.log(1)" }, ctx)).toEqual({
      kind: "fail",
      output: 'file_write is missing required argument "path".',
    });

    expect(gateToolRequest("git_push", { force: true }, ctx)).toEqual({
      kind: "block",
      output:
        "Refusing git push --force. Force-push is denied by the harness; push a new branch instead.",
    });
    expect(gateToolRequest("exec", { command: "git push --force origin feat" }, ctx).kind).toBe(
      "block",
    );

    expect(gateToolRequest("file_read", { path: "/workspace/.env" }, ctx)).toEqual({
      kind: "fail",
      output: SENSITIVE_PATH_REFUSAL,
    });
    expect(gateToolRequest("grep", { path: "/workspace/.env", pattern: "KEY" }, ctx)).toEqual({
      kind: "fail",
      output: SENSITIVE_PATH_REFUSAL,
    });
    expect(gateToolRequest("glob", { path: "/workspace/.ssh/id_rsa", pattern: "*" }, ctx)).toEqual({
      kind: "fail",
      output: SENSITIVE_PATH_REFUSAL,
    });
    expect(gateToolRequest("file_list", { path: "/home/locus/.aws/credentials" }, ctx)).toEqual({
      kind: "fail",
      output: SENSITIVE_PATH_REFUSAL,
    });
    expect(gateToolRequest("exec", { command: "printenv" }, ctx).kind).toBe("block");

    expect(gateToolRequest("git_push", { branch: "main" }, ctx)).toEqual({
      kind: "block",
      output: "Refusing git_push to protected branch main",
    });
    expect(gateToolRequest("git_pr", { title: "fix css", base: "main" }, ctx)).toEqual({
      kind: "allow",
    });
  });

  it("blocks deny-list tools and rejects tools outside the allowlist", () => {
    expect(
      gateToolRequest("file_read", { path: "src/a.ts" }, { policy: { deny: ["file_read"] } }),
    ).toEqual({
      kind: "block",
      output: "Tool file_read is denied by policy",
    });
    expect(
      gateToolRequest("exec", { command: "ls" }, { ...ctx, allowedTools: ["file_read"] }),
    ).toEqual({
      kind: "reject",
      message: "Tool exec is not allowed for this agent",
    });
    expect(
      gateToolRequest(
        "exec",
        { command: "ls" },
        { ...ctx, allowedTools: ["file_read"], ignoreAllowlist: true },
      ),
    ).toEqual({ kind: "allow" });
  });

  it("splits policy and access so dispatch tools skip the allowlist", () => {
    const allowed = { ...ctx, allowedTools: ["file_read"] };
    expect(gateToolRequest("websearch", { query: "x" }, { ...allowed, stage: "policy" })).toEqual({
      kind: "allow",
    });
    expect(gateToolRequest("websearch", { query: "x" }, { ...allowed, stage: "access" })).toEqual({
      kind: "reject",
      message: "Tool websearch is not allowed for this agent",
    });
    expect(gateToolRequest("git_push", { force: true }, { ...ctx, stage: "access" })).toEqual({
      kind: "allow",
    });
  });

  it("turns off the protected-branch wall when the policy says so", () => {
    expect(
      gateToolRequest("git_push", { branch: "main" }, { policy: { protectDefaultBranch: false } }),
    ).toEqual({ kind: "allow" });
  });

  it("blocks git_branch away from the locked create ref", () => {
    expect(
      gateToolRequest(
        "git_branch",
        { name: "feat" },
        { ...ctx, branchLock: true, repoRef: "main" },
      ),
    ).toEqual({
      kind: "block",
      output: "Branch is locked to main for this session",
    });
    expect(
      gateToolRequest(
        "git_branch",
        { name: "main" },
        { ...ctx, branchLock: true, repoRef: "main" },
      ),
    ).toEqual({ kind: "allow" });
    expect(gateToolRequest("git_branch", { name: "feat" }, { ...ctx, branchLock: true })).toEqual({
      kind: "allow",
    });
  });
});
