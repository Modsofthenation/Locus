import type { ApprovalPolicy, ComputerUseToolName } from "@locus/shared";
import {
  SENSITIVE_PATH_REFUSAL,
  TOOL_SCHEMAS,
  branchLockRefusal,
  execCommandsFromArgs,
  fileReadPaths,
  fillCanvasFileWritePath,
  isSensitivePath,
  protectedGitHeadArg,
  refuseExecCommand,
  toolDeniedByPolicy,
  validateToolArgs,
} from "@locus/shared";

export type ToolGateDecision =
  | { kind: "allow" }
  | { kind: "fail"; output: string }
  | { kind: "block"; output: string }
  | { kind: "reject"; message: string };

export type ToolGateStage = "policy" | "access" | "all";

export type ToolGateContext = {
  policy: ApprovalPolicy;
  allowHosts?: string[];
  allowedTools?: string[];
  ignoreAllowlist?: boolean;
  isDesign?: boolean;
  /** When set with branchLock, reject git_branch away from the frozen ref. */
  branchLock?: boolean;
  repoRef?: string;
  gitBranch?: string;
  /**
   * `policy` runs before websearch/runtime dispatch.
   * `access` runs after, so allowlist does not block those tools.
   * Tests use `all` (the default).
   */
  stage?: ToolGateStage;
};

const FORCE_PUSH_REFUSAL =
  "Refusing git push --force. Force-push is denied by the harness; push a new branch instead.";

function gatePolicy(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolGateContext,
): ToolGateDecision {
  if (name === "file_write")
    Object.assign(args, fillCanvasFileWritePath(args, { design: ctx.isDesign }));
  const schema = TOOL_SCHEMAS[name as ComputerUseToolName];
  if (schema) {
    const invalid = validateToolArgs(name, args, schema);
    if (invalid) return { kind: "fail", output: invalid };
  }
  if (name === "exec" || name === "powershell") {
    const allowHosts = ctx.allowHosts !== undefined ? { allowHosts: ctx.allowHosts } : undefined;
    for (const command of execCommandsFromArgs(args)) {
      const refused = refuseExecCommand(command, allowHosts);
      if (refused) return { kind: "block", output: refused };
    }
  }
  if (
    name === "git_push" &&
    (args.force === true || args.force === "-f" || args.force === "--force")
  ) {
    return { kind: "block", output: FORCE_PUSH_REFUSAL };
  }
  if (toolDeniedByPolicy(name, ctx.policy, args)) {
    return { kind: "block", output: `Tool ${name} is denied by policy` };
  }
  return { kind: "allow" };
}

function gateAccess(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolGateContext,
): ToolGateDecision {
  if (!ctx.ignoreAllowlist && ctx.allowedTools?.length && !ctx.allowedTools.includes(name)) {
    return { kind: "reject", message: `Tool ${name} is not allowed for this agent` };
  }
  if (name === "file_read") {
    const paths = fileReadPaths(args);
    if (paths.some((path) => isSensitivePath(path))) {
      return { kind: "fail", output: SENSITIVE_PATH_REFUSAL };
    }
  }
  if (name === "grep" || name === "glob" || name === "file_list") {
    const paths = fileReadPaths(args);
    if (paths.some((path) => isSensitivePath(path))) {
      return { kind: "fail", output: SENSITIVE_PATH_REFUSAL };
    }
  }
  if (ctx.policy.protectDefaultBranch !== false) {
    const blocked = protectedGitHeadArg(name, args);
    if (blocked) {
      return { kind: "block", output: `Refusing ${name} to protected branch ${blocked}` };
    }
  }
  if (name === "git_branch" && ctx.branchLock) {
    const target = typeof args.name === "string" ? args.name : "";
    const refused = branchLockRefusal(
      {
        branchLock: true,
        repo: ctx.repoRef ? { ref: ctx.repoRef } : undefined,
        gitBranch: ctx.gitBranch,
      },
      target,
    );
    if (refused) return { kind: "block", output: refused };
  }
  return { kind: "allow" };
}

/** Sync harness gates. The session adapter applies `block` (trace + needsHuman) and `reject` (throw). */
export function gateToolRequest(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolGateContext,
): ToolGateDecision {
  const stage = ctx.stage ?? "all";
  if (stage !== "access") {
    const policy = gatePolicy(name, args, ctx);
    if (policy.kind !== "allow") return policy;
  }
  if (stage !== "policy") return gateAccess(name, args, ctx);
  return { kind: "allow" };
}
