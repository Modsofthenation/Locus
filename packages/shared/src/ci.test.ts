import { describe, expect, it } from "vitest";
import {
  CI_EXIT_CODES,
  ciAllowRuleFor,
  ciExitCode,
  ciOutcome,
  ciTestsFromSession,
  formatCiComment,
  parsePullUrl,
  type CiResult,
} from "./ci.js";
import type { ChatMessage } from "./models/session.js";

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return {
    id: Math.random().toString(36),
    role: "assistant",
    content: "",
    createdAt: "",
    ...partial,
  } as ChatMessage;
}

describe("ci exit codes", () => {
  it("maps outcomes to 0/1/2/3", () => {
    expect(CI_EXIT_CODES).toEqual({ pass: 0, fail: 1, approval: 2, error: 3 });
    expect(ciExitCode("approval")).toBe(2);
  });

  it("error beats approval beats verdict", () => {
    const session = {
      kind: "review" as const,
      status: "idle" as const,
      messages: [msg({ content: '{"verdict":"PASS","reasons":[],"risk":"low"}' })],
    };
    expect(ciOutcome({ session, error: "boom" }).outcome).toBe("error");
    expect(ciOutcome({ session, pending: true }).outcome).toBe("approval");
    expect(ciOutcome({ session }).outcome).toBe("pass");
    expect(ciOutcome({ session: { ...session, status: "error", error: "x" } }).outcome).toBe(
      "error",
    );
  });

  it("review FAIL or high risk fails; missing verdict fails", () => {
    const fail = {
      kind: "review" as const,
      status: "idle" as const,
      messages: [msg({ content: '{"verdict":"FAIL","reasons":["no tests"],"risk":"low"}' })],
    };
    expect(ciOutcome({ session: fail })).toMatchObject({
      outcome: "fail",
      verdict: "FAIL",
      reasons: ["no tests"],
    });
    const risky = {
      ...fail,
      messages: [msg({ content: '{"verdict":"PASS","reasons":["auth"],"risk":"high"}' })],
    };
    expect(ciOutcome({ session: risky }).outcome).toBe("fail");
    expect(ciOutcome({ session: { ...fail, messages: [msg({ content: "lgtm" })] } })).toMatchObject(
      { outcome: "fail", verdict: "NONE" },
    );
  });

  it("non-review runs fail on Needs you (budget) or red tests", () => {
    const base = { kind: "agent" as const, status: "idle" as const, messages: [] as ChatMessage[] };
    expect(ciOutcome({ session: base }).outcome).toBe("pass");
    expect(
      ciOutcome({ session: { ...base, needsHuman: "Budget reached: daily spend cap" } }),
    ).toMatchObject({ outcome: "fail", reasons: ["Budget reached: daily spend cap"] });
    const red = {
      ...base,
      messages: [
        msg({
          toolCalls: [
            {
              id: "1",
              name: "exec",
              arguments: { command: "npm test" },
              error: "1 failing",
              startedAt: "",
            },
          ],
        }),
      ],
    };
    expect(ciTestsFromSession(red)).toEqual({ ran: 1, passed: false, last: "npm test" });
    expect(ciOutcome({ session: red }).outcome).toBe("fail");
  });
});

describe("ci helpers", () => {
  it("matches --allow rules with param-permission syntax", () => {
    const rules = ["git_push(branch:locus/*)", "git_pr"];
    expect(ciAllowRuleFor(rules, { name: "git_push", arguments: { branch: "locus/fix" } })).toBe(
      "git_push(branch:locus/*)",
    );
    expect(
      ciAllowRuleFor(rules, { name: "git_push", arguments: { branch: "main" } }),
    ).toBeUndefined();
    expect(ciAllowRuleFor(rules, { name: "git_pr", arguments: {} })).toBe("git_pr");
    expect(ciAllowRuleFor(rules, { name: "mcp_x", arguments: {} })).toBeUndefined();
  });

  it("parses PR URLs", () => {
    expect(parsePullUrl("https://github.com/acme/web/pull/42")).toEqual({
      host: "github.com",
      owner: "acme",
      repo: "web",
      number: 42,
      repoUrl: "https://github.com/acme/web",
    });
    expect(parsePullUrl("https://gitlab.com/g/sub/proj/-/merge_requests/7")).toMatchObject({
      owner: "g/sub",
      repo: "proj",
      number: 7,
    });
    expect(parsePullUrl("https://bitbucket.org/ws/r/pull-requests/3")?.number).toBe(3);
    expect(parsePullUrl("https://github.com/acme/web")).toBeUndefined();
    expect(parsePullUrl("not a url")).toBeUndefined();
  });

  it("formats a PR comment", () => {
    const result: CiResult = {
      outcome: "fail",
      exitCode: 1,
      verdict: "FAIL",
      reasons: ["missing test"],
      risk: "low",
      tests: { ran: 0 },
      deniedApprovals: [],
      allowedApprovals: [],
      costUsd: 0.1234,
      startedAt: "",
      finishedAt: "",
    };
    const text = formatCiComment(result);
    expect(text).toContain("**Locus review:** FAIL (risk low)");
    expect(text).toContain("- missing test");
    expect(text).toContain("$0.12");
  });
});
