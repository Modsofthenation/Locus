import { describe, expect, it } from "vitest";
import {
  commandLooksLikeForcePush,
  commandLooksLikeLocusDesktopLaunch,
  isAppImageMountDir,
  stripAppImageMountsFromPath,
  mcpDescriptionPin,
  mcpToolDescriptionAllowed,
  parseAgentVerdict,
  parseAnyReviewVerdict,
  parseReviewSessionVerdict,
  shouldApplyReviewVerdict,
  isCleanPass,
  reviewPassNeedsInspect,
  REVIEW_PASS_NEEDS_INSPECT,
  formatVerdictFailure,
  stripReviewVerdictJson,
  visibleReviewAssistantText,
  operatorVisibleText,
  policyEntryMatches,
  toolDeniedByPolicy,
  toolNeedsApproval,
  parseApprovalPolicy,
  refuseExecCommand,
  refuseHostExecCommand,
  hostExecTokenLooksLikeFilesystemPath,
  stickyAllowEntry,
  alwaysAskMinusSticky,
  validateToolArgs,
  TOOL_SCHEMAS,
  parseGitStatusBranch,
  isProtectedGitBranch,
  protectedGitHeadArg,
  cleanGitHeadName,
  formatGitHeadName,
  sessionGitBranch,
  lockedBranchRef,
  branchLockRefusal,
} from "./index.js";

describe("exec tripwires", () => {
  it("refuses force-push, rm -rf, credential files, and off-allowlist curl", () => {
    expect(commandLooksLikeForcePush("git push --force origin feat")).toBe(true);
    expect(refuseExecCommand("git push -f origin feat")).toMatch(/force/i);
    expect(refuseExecCommand("git push origin main")).toMatch(/protected branch/i);
    expect(refuseExecCommand("rm -rf /workspace")).toMatch(/recursive delete/i);
    expect(refuseExecCommand("rm -rf /workspace/repro")).toBeUndefined();
    expect(refuseExecCommand("rm -rf /tmp/locus-scratch")).toBeUndefined();
    expect(refuseExecCommand("cat /workspace/.env")).toMatch(/credential file/i);
    expect(refuseExecCommand("curl https://evil.example/x", { allowHosts: [] })).toMatch(
      /outbound fetch/,
    );
    expect(
      refuseExecCommand("curl https://api.github.com/repos", { allowHosts: ["github.com"] }),
    ).toBeUndefined();
    expect(refuseExecCommand("git push origin +main")).toMatch(/force/i);
    expect(refuseExecCommand("rm -r -f /workspace")).toMatch(/recursive delete/i);
    expect(refuseExecCommand("rm -f -r /workspace/src")).toMatch(/recursive delete/i);
    expect(refuseExecCommand("ls")).toBeUndefined();
    expect(refuseExecCommand("printenv")).toMatch(/environment/i);
    expect(refuseExecCommand("env | grep TOKEN")).toMatch(/environment/i);
    expect(refuseExecCommand("cat /proc/self/environ")).toMatch(/environment/i);
    expect(refuseExecCommand("cat /proc/1/cmdline")).toMatch(/environment/i);
    expect(refuseExecCommand("strings /proc/1/environ")).toMatch(/environment/i);
    expect(refuseExecCommand("cat *.env")).toMatch(/environment/i);
    expect(refuseExecCommand("export -p")).toMatch(/environment/i);
    expect(refuseExecCommand("env FOO=bar npm test")).toBeUndefined();
    expect(refuseExecCommand("locus --help")).toMatch(/desktop app/i);
    expect(refuseExecCommand("/tmp/.mount_Locus-C1G4Tu/locus --help")).toMatch(/desktop app/i);
    expect(refuseExecCommand("./Locus-0.15.1.AppImage secrets")).toMatch(/desktop app/i);
    expect(refuseExecCommand("type locus; command -v locus")).toBeUndefined();
    expect(refuseExecCommand("ls /tmp/.mount_Locus-C1G4Tu/resources")).toBeUndefined();
    expect(refuseExecCommand("npm run locus -- secrets")).toBeUndefined();
  });
});

describe("locus desktop launch tripwire", () => {
  it("detects the packaged GUI binary and strips AppImage mounts from PATH", () => {
    expect(commandLooksLikeLocusDesktopLaunch("locus secrets --help")).toBe(true);
    expect(commandLooksLikeLocusDesktopLaunch("which locus")).toBe(false);
    expect(isAppImageMountDir("/tmp/.mount_Locus-C1G4Tu")).toBe(true);
    expect(isAppImageMountDir("/usr/bin")).toBe(false);
    expect(
      stripAppImageMountsFromPath(
        "/tmp/.mount_Locus-C1G4Tu:/usr/bin:/bin",
        ":",
        "/tmp/.mount_Locus-C1G4Tu",
      ),
    ).toBe("/usr/bin:/bin");
  });
});

describe("host exec jail", () => {
  it("refuses paths outside the session workspace", () => {
    const root = "/tmp/locus-host-ws";
    expect(refuseHostExecCommand("pwd", root)).toBeUndefined();
    expect(refuseHostExecCommand("cat /workspace/src/a.ts", root)).toBeUndefined();
    expect(refuseHostExecCommand("node /usr/bin/npm test", root)).toBeUndefined();
    expect(refuseHostExecCommand("kill -0 12 2>/dev/null", root)).toBeUndefined();
    expect(refuseHostExecCommand("cat /etc/passwd", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("cat ../../etc/passwd", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("echo hi >/usr/local/bin/x", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("cat /tmp/secret", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("cat ~/.ssh/id_rsa", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("cat ~root/.ssh/id_rsa", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("echo hi | bash", root)).toMatch(/pipes into a shell/);
    expect(refuseHostExecCommand("locus --help", root)).toMatch(/desktop app/i);
    expect(refuseHostExecCommand("/tmp/.mount_Locus-C1G4Tu/locus --help", root)).toMatch(
      /desktop app/i,
    );
  });

  it("does not treat HTML tags or sed regex leftovers as filesystem paths", () => {
    const root = "/tmp/locus-host-ws";
    expect(
      refuseHostExecCommand("grep -n '</body>\\|</html>' /workspace/index.html", root),
    ).toBeUndefined();
    expect(refuseHostExecCommand("grep -c '</script>' /workspace/_tail.txt", root)).toBeUndefined();
    expect(
      refuseHostExecCommand("sed -n '/^const MAT/,/^};/p' /workspace/index.html", root),
    ).toBeUndefined();
    expect(refuseHostExecCommand("tr ' ' '\\n' | sort -u", root)).toBeUndefined();
    expect(refuseHostExecCommand("cat /etc/passwd", root)).toMatch(/outside \/workspace/);
    expect(refuseHostExecCommand("cat /tmp/secret", root)).toMatch(/outside \/workspace/);
    expect(hostExecTokenLooksLikeFilesystemPath("/body")).toBe(false);
    expect(hostExecTokenLooksLikeFilesystemPath("//")).toBe(false);
    expect(hostExecTokenLooksLikeFilesystemPath("/^const")).toBe(false);
    expect(hostExecTokenLooksLikeFilesystemPath("/workspace/index.html")).toBe(true);
    expect(hostExecTokenLooksLikeFilesystemPath("/etc/passwd")).toBe(true);
  });
});

describe("tool arg validation", () => {
  it("requires schema fields and allows extras", () => {
    expect(
      validateToolArgs("file_write", { path: "/workspace/a.ts" }, TOOL_SCHEMAS.file_write),
    ).toBe('file_write is missing required argument "content".');
    expect(
      validateToolArgs(
        "file_write",
        { path: "/workspace/a.ts", content: "x", extra: true },
        TOOL_SCHEMAS.file_write,
      ),
    ).toBeUndefined();
    expect(validateToolArgs("preview", {}, TOOL_SCHEMAS.preview)).toBeUndefined();
    expect(validateToolArgs("preview", { path: "/" }, TOOL_SCHEMAS.preview)).toBeUndefined();
    expect(validateToolArgs("playwright", {}, TOOL_SCHEMAS.playwright)).toBeUndefined();
    expect(
      validateToolArgs(
        "playwright",
        { click: "#go", steps: ["expect Ready"] },
        TOOL_SCHEMAS.playwright,
      ),
    ).toBeUndefined();
  });
});

describe("param permissions", () => {
  it("matches git_push(branch:locus/*) and file_read(path:.env)", () => {
    expect(
      policyEntryMatches("git_push(branch:locus/*)", "git_push", { branch: "locus/fix" }),
    ).toBe(true);
    expect(policyEntryMatches("git_push(branch:locus/*)", "git_push", { branch: "main" })).toBe(
      false,
    );
    expect(
      policyEntryMatches("file_read(path:.env)", "file_read", { path: "/workspace/.env" }),
    ).toBe(true);
    const policy = parseApprovalPolicy({ deny: ["file_read(path:.env)", "git_push"] });
    expect(toolDeniedByPolicy("file_read", policy, { path: "/workspace/.env" })).toBe(true);
    expect(toolDeniedByPolicy("file_read", policy, { path: "/workspace/src/a.ts" })).toBe(false);
    expect(toolDeniedByPolicy("git_push", policy, { branch: "feat" })).toBe(true);
    expect(stickyAllowEntry("git_push", { branch: "locus/fix-css" })).toBe(
      "git_push(branch:locus/*)",
    );
    expect(stickyAllowEntry("git_push", { branch: "origin/locus/fix-css" })).toBe(
      "git_push(branch:locus/*)",
    );
    expect(stickyAllowEntry("git_pr", { title: "fix" })).toBe("git_pr");
    const supervised = parseApprovalPolicy({ alwaysAsk: ["exec", "file_write"] });
    expect(alwaysAskMinusSticky(supervised.alwaysAsk, ["exec"])).toEqual(["file_write"]);
    expect(
      toolNeedsApproval("exec", {
        ...supervised,
        autoAllow: ["exec"],
        alwaysAsk: alwaysAskMinusSticky(supervised.alwaysAsk, ["exec"]),
      }),
    ).toBe(false);
  });
});

describe("verdicts", () => {
  it("parses PASS/FAIL JSON and rejects prose", () => {
    const pass = parseAgentVerdict('{"verdict":"PASS","reasons":[],"risk":"low"}');
    expect(isCleanPass(pass)).toBe(true);
    const fail = parseAgentVerdict(
      '```json\n{"verdict":"FAIL","reasons":["missing tests"],"risk":"high"}\n```',
    );
    expect(isCleanPass(fail)).toBe(false);
    expect(formatVerdictFailure(fail)).toMatch(/FAIL/);
    expect(parseAgentVerdict("Looks fine")).toBeUndefined();
    expect(formatVerdictFailure(undefined)).toMatch(/Needs a human/);
  });

  it("accepts REQUEST_CHANGES/APPROVE aliases, HIGH risk, and mixed prose", () => {
    const mixed = parseAgentVerdict(
      'Posted comments.{"verdict":"REQUEST_CHANGES","reasons":["stale rows"],"risk":"HIGH"}',
    );
    expect(mixed).toEqual({
      verdict: "FAIL",
      reasons: ["stale rows"],
      risk: "high",
    });
    expect(parseAgentVerdict('{"verdict":"APPROVE","reasons":[],"risk":"Low"}')).toEqual({
      verdict: "PASS",
      reasons: [],
      risk: "low",
    });
  });

  it("hides harness verdict JSON from operator-facing assistant text", () => {
    const mixed =
      'Prior Mediums look addressed. I’ll post that on the hunk and submit the review.{"verdict":"FAIL","reasons":["Failed Dramatiq duplicate jobs still take TaskProgress onComplete"],"risk":"low"}';
    expect(stripReviewVerdictJson(mixed)).toBe(
      "Prior Mediums look addressed. I’ll post that on the hunk and submit the review.",
    );
    expect(visibleReviewAssistantText(mixed)).not.toContain('"verdict"');
    expect(visibleReviewAssistantText(mixed)).toContain("Prior Mediums look addressed");
    expect(visibleReviewAssistantText('{"verdict":"PASS","reasons":[],"risk":"low"}')).toBe(
      "Reviewer PASS (risk low).",
    );
    expect(
      visibleReviewAssistantText(
        '```json\n{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}\n```',
      ),
    ).toBe("Reviewer FAIL (risk high): stale rows");
    expect(operatorVisibleText("user", mixed)).toBe(mixed);
    expect(operatorVisibleText("assistant", mixed)).not.toContain('"verdict"');
  });

  it("hides a dumped HTML document from operator-facing assistant text", () => {
    const page = `<!DOCTYPE html>\n<html lang="en"><head><title>Harbor</title></head><body>${"x".repeat(400)}</body></html>`;
    expect(operatorVisibleText("assistant", page)).toBe("");
    expect(operatorVisibleText("assistant", `Here is the page.\n\n${page}`)).toBe(
      "Here is the page.",
    );
    expect(operatorVisibleText("user", page)).toBe(page);
    expect(operatorVisibleText("assistant", 'Add `<html lang="en">` to the root.')).toContain(
      '<html lang="en">',
    );
  });

  it("falls back to git_pr_review when assistant JSON is missing", () => {
    expect(
      parseReviewSessionVerdict([
        {
          role: "assistant",
          content: "Posted notes.",
          toolCalls: [
            {
              name: "git_pr_review",
              arguments: { event: "REQUEST_CHANGES", body: "Need tests" },
            },
          ],
        },
      ]),
    ).toMatchObject({ verdict: "FAIL", risk: "high" });
    expect(
      parseReviewSessionVerdict([
        {
          role: "assistant",
          content: "Posted notes.",
          toolCalls: [
            {
              name: "mcp",
              arguments: { name: "git_pr_review", arguments: { event: "approve" } },
            },
          ],
        },
      ]),
    ).toMatchObject({ verdict: "PASS", risk: "low" });
    expect(
      parseReviewSessionVerdict([
        {
          role: "assistant",
          content: "Posted notes.",
          toolCalls: [
            {
              name: "locus-git_pr_review",
              arguments: { event: "REQUEST_CHANGES", body: "Need tests" },
            },
          ],
        },
      ]),
    ).toMatchObject({ verdict: "FAIL", risk: "high" });
  });

  it("does not ship a guessed PASS without git_pr_get this turn", () => {
    const guessed = [
      { role: "user", content: "review this" },
      { role: "assistant", content: '{"verdict":"PASS","reasons":[],"risk":"low"}' },
    ];
    expect(reviewPassNeedsInspect(guessed)).toBe(true);
    expect(REVIEW_PASS_NEEDS_INSPECT).toMatch(/git_pr_get/);
    expect(
      reviewPassNeedsInspect([
        { role: "user", content: "review this" },
        {
          role: "assistant",
          content: '{"verdict":"PASS","reasons":[],"risk":"low"}',
          toolCalls: [{ name: "git_pr_get", arguments: { include: ["files"] } }],
        },
      ]),
    ).toBe(false);
    expect(
      reviewPassNeedsInspect([
        { role: "user", content: "review this" },
        {
          role: "assistant",
          content: "Posted notes.",
          toolCalls: [
            {
              name: "mcp",
              arguments: { name: "git_pr_review", arguments: { event: "approve" } },
            },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      reviewPassNeedsInspect([
        { role: "user", content: "review this" },
        { role: "assistant", content: '{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}' },
      ]),
    ).toBe(false);
    const followUp = [
      ...guessed,
      { role: "user", content: "Can you continue on?" },
      { role: "assistant", content: "Still looking at the hop." },
    ];
    expect(shouldApplyReviewVerdict(followUp)).toBe(false);
    expect(reviewPassNeedsInspect(followUp)).toBe(false);
  });

  it("does not re-gate follow-up chatter after a completed review", () => {
    const prior = [
      { role: "user", content: "review this" },
      { role: "assistant", content: '{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}' },
      { role: "user", content: "Can you continue on?" },
      { role: "assistant", content: "Still looking at the hop." },
    ];
    expect(shouldApplyReviewVerdict(prior)).toBe(false);
    expect(
      shouldApplyReviewVerdict([
        { role: "user", content: "review this" },
        { role: "assistant", content: "Looks fine" },
      ]),
    ).toBe(true);
    expect(
      shouldApplyReviewVerdict([
        ...prior.slice(0, 2),
        { role: "user", content: "review again" },
        {
          role: "assistant",
          content: "Checking.",
          toolCalls: [{ name: "git_pr_get", arguments: { pull_number: 1 } }],
        },
      ]),
    ).toBe(true);
    expect(parseReviewSessionVerdict(prior)).toBeUndefined();
    expect(parseAnyReviewVerdict(prior)).toEqual({
      verdict: "FAIL",
      reasons: ["stale rows"],
      risk: "high",
    });
  });

  it("uses this turn only and prefers FAIL over a contract PASS example", () => {
    expect(
      parseReviewSessionVerdict([
        { role: "assistant", content: '{"verdict":"PASS","reasons":[],"risk":"low"}' },
        { role: "user", content: "review again" },
        { role: "assistant", content: "Still looking." },
      ]),
    ).toBeUndefined();
    expect(
      parseAgentVerdict(
        'A passing review looks exactly like this: {"verdict":"PASS","reasons":[],"risk":"low"}\n{"verdict":"FAIL","reasons":["stale rows"],"risk":"high"}',
      ),
    ).toEqual({
      verdict: "FAIL",
      reasons: ["stale rows"],
      risk: "high",
    });
  });
});

describe("MCP description pin", () => {
  it("allows all tools until hashes are set, then drops mismatches", () => {
    const pin = mcpDescriptionPin("Echo text");
    expect(mcpToolDescriptionAllowed("Echo text", undefined, "echo")).toBe(true);
    expect(mcpToolDescriptionAllowed("Echo text", {}, "echo")).toBe(true);
    expect(mcpToolDescriptionAllowed("Echo text", { echo: pin }, "echo")).toBe(true);
    expect(mcpToolDescriptionAllowed("Echo text", { echo: "deadbeef" }, "echo")).toBe(false);
    expect(mcpToolDescriptionAllowed("Echo text", { other: pin }, "echo")).toBe(false);
  });
});

describe("git status branch", () => {
  it("reads the current branch and flags protected names", () => {
    expect(parseGitStatusBranch("On branch main\nnothing to commit")).toBe("main");
    expect(parseGitStatusBranch("On branch locus/fix\nChanges not staged")).toBe("locus/fix");
    expect(isProtectedGitBranch("main")).toBe(true);
    expect(isProtectedGitBranch("locus/fix")).toBe(false);
  });

  it("treats git_pr base as the target, not a protected head", () => {
    expect(protectedGitHeadArg("git_pr", { title: "fix css", base: "main" })).toBeUndefined();
    expect(protectedGitHeadArg("git_pr", { branch: "main" })).toBe("main");
    expect(protectedGitHeadArg("git_push", { branch: "main" })).toBe("main");
    expect(protectedGitHeadArg("git_push", { branch: "feat" })).toBeUndefined();
  });

  it("prefers the live workspace branch for sidebar rows", () => {
    expect(cleanGitHeadName("refs/heads/feat/login")).toBe("feat/login");
    expect(formatGitHeadName("abcdef1234567890")).toBe("abcdef1");
    expect(formatGitHeadName("HEAD")).toBeUndefined();
    expect(
      sessionGitBranch({
        gitBranch: "feat/live",
        pull: { headRef: "feat/pr" },
        repo: { ref: "main" },
      }),
    ).toBe("feat/live");
    expect(sessionGitBranch({ pull: { headRef: "refs/heads/fix" }, repo: { ref: "main" } })).toBe(
      "fix",
    );
    expect(sessionGitBranch({ compare: { branch: "locus/worker-1" }, repo: { ref: "main" } })).toBe(
      "locus/worker-1",
    );
    expect(sessionGitBranch({ repo: { ref: "main" } })).toBe("main");
  });

  it("locks branch to create ref or first observed head", () => {
    expect(lockedBranchRef({ branchLock: true, repo: { ref: "main" } })).toBe("main");
    expect(lockedBranchRef({ branchLock: true, gitBranch: "feat" })).toBe("feat");
    expect(lockedBranchRef({ branchLock: false, repo: { ref: "main" } })).toBeUndefined();
    expect(branchLockRefusal({ branchLock: true, repo: { ref: "main" } }, "feat")).toMatch(
      /locked to main/,
    );
    expect(branchLockRefusal({ branchLock: true, repo: { ref: "main" } }, "main")).toBeUndefined();
    expect(branchLockRefusal({ branchLock: true }, "feat")).toBeUndefined();
  });
});
