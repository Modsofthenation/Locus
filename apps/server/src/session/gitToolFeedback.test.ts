import { describe, expect, it } from "vitest";
import { annotateGitToolResult } from "./gitToolFeedback.js";

describe("annotateGitToolResult", () => {
  it("points shell git auth failures at git_fetch (trace: shell git pull on a host clone)", () => {
    const out = annotateGitToolResult("exec", {
      ok: true,
      output:
        "Output:\nfatal: could not read Username for 'https://bitbucket.org': No such device or address\n\nExit Code: 0",
    });
    expect(out.output).toContain("Use the git_fetch tool");
  });

  it("classifies failed git tools", () => {
    const out = annotateGitToolResult("git_push", {
      ok: false,
      output: " ! [rejected]        feat -> feat (fetch first)\nerror: failed to push some refs",
    });
    expect(out.category).toBe("git-non-fast-forward");
    expect(out.retryable).toBe(true);
    expect(out.output).toContain("Run git_fetch");
  });

  it("leaves successes and unrelated output alone", () => {
    const ok = { ok: true, output: "Everything up-to-date" };
    expect(annotateGitToolResult("git_push", ok)).toBe(ok);
    const exec = { ok: true, output: "hello" };
    expect(annotateGitToolResult("exec", exec)).toBe(exec);
  });
});
