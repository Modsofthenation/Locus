import { describe, expect, it } from "vitest";
import { hooksForTool, parseRepoHooks } from "./repoHooks.js";

describe("repo hooks", () => {
  it("parses PreToolUse / PostToolUse / Stop and matches tool names", () => {
    const hooks = parseRepoHooks({
      PreToolUse: [{ matcher: "git_push|git_pr", command: "npm test" }],
      PostToolUse: [{ matcher: "file_write|apply_patch", command: "npm run lint" }],
      Stop: [{ command: "./scripts/on-stop.sh" }],
    });
    expect(hooksForTool(hooks, "PreToolUse", "git_push").map((h) => h.command)).toEqual([
      "npm test",
    ]);
    expect(hooksForTool(hooks, "PreToolUse", "file_write")).toEqual([]);
    expect(hooksForTool(hooks, "PostToolUse", "apply_patch")[0]?.command).toBe("npm run lint");
    expect(hooks.Stop[0]?.command).toBe("./scripts/on-stop.sh");
  });

  it("ignores junk and empty commands", () => {
    expect(parseRepoHooks(null).PreToolUse).toEqual([]);
    expect(parseRepoHooks({ PreToolUse: [{ command: "  " }] }).PreToolUse).toEqual([]);
    expect(parseRepoHooks({ preToolUse: [{ command: "echo hi" }] }).PreToolUse[0]?.command).toBe(
      "echo hi",
    );
  });
});
