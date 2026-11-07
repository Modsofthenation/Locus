import { describe, expect, it } from "vitest";
import {
  CODING_LOOP_HABIT,
  CODING_SEARCH_WANDER_ROUNDS,
  isCodingMutateTool,
  isCodingVerifyCall,
  foldCodingVerifyFlags,
  wroteAgentCanvas,
  looksLikeVerifyCommand,
  SEARCH_WANDER_NUDGE,
  shouldNudgeSearchWander,
  shouldNudgeVerify,
  VERIFY_NUDGE,
  codingVerifyNeedsHuman,
  codingFailedVerifyNeedsHuman,
  codingTurnNeedsHuman,
  CODING_VERIFY_NEEDS_HUMAN,
  CODING_FAILED_VERIFY_NEEDS_HUMAN,
} from "./codingLoop.js";
import { isWorkspaceSearchTool } from "./opsRouting.js";

describe("coding loop walls", () => {
  it("classifies mutate, verify, and search tools", () => {
    expect(isCodingMutateTool("apply_patch")).toBe(true);
    expect(isCodingMutateTool("Write")).toBe(true);
    expect(isCodingMutateTool("StrReplace")).toBe(true);
    expect(isCodingMutateTool("searchReplace")).toBe(true);
    expect(isCodingMutateTool("file_read")).toBe(false);
    expect(looksLikeVerifyCommand("npm test")).toBe(true);
    expect(looksLikeVerifyCommand("pnpm test -- src/add.test.ts")).toBe(true);
    expect(looksLikeVerifyCommand("pytest -q")).toBe(true);
    expect(looksLikeVerifyCommand("rg FAIL src")).toBe(false);
    expect(isCodingVerifyCall("exec", { command: "npm test" })).toBe(true);
    expect(isCodingVerifyCall("Shell", { command: "npm test" })).toBe(true);
    expect(isCodingVerifyCall("git_push")).toBe(true);
    expect(isCodingVerifyCall("exec", { command: "rg boom" })).toBe(false);
    expect(
      foldCodingVerifyFlags([
        { name: "apply_patch", arguments: { patch: "diff" } },
        { name: "exec", arguments: { command: "npm test" } },
      ]),
    ).toEqual({ mutated: true, verified: true });
    expect(
      foldCodingVerifyFlags([{ name: "apply_patch", arguments: { patch: "more" } }], {
        mutated: true,
        verified: true,
      }),
    ).toEqual({ mutated: true, verified: false });
    expect(isWorkspaceSearchTool("grep")).toBe(true);
    expect(isWorkspaceSearchTool("Grep")).toBe(true);
    expect(isWorkspaceSearchTool("exec")).toBe(true);
    expect(isWorkspaceSearchTool("exec", { command: "cat src/a.ts" })).toBe(true);
    expect(isWorkspaceSearchTool("exec", { command: "npm test" })).toBe(false);
  });

  it("nudges a search streak and unverified edits", () => {
    const wander = {
      isCoding: true,
      mutated: false,
      searchRounds: CODING_SEARCH_WANDER_ROUNDS,
      nudges: 0,
    };
    expect(shouldNudgeSearchWander(wander)).toBe(true);
    expect(shouldNudgeSearchWander({ ...wander, searchRounds: 2 })).toBe(false);
    expect(shouldNudgeSearchWander({ ...wander, mutated: true })).toBe(false);
    expect(shouldNudgeSearchWander({ ...wander, namedOps: true })).toBe(false);
    expect(shouldNudgeSearchWander({ ...wander, isReview: true })).toBe(false);
    expect(shouldNudgeSearchWander({ ...wander, searchRounds: 0, nudges: 1 })).toBe(true);
    expect(shouldNudgeSearchWander({ ...wander, searchRounds: 0, nudges: 2 })).toBe(false);
    expect(shouldNudgeVerify({ isCoding: true, mutated: true, verified: false, nudges: 1 })).toBe(
      true,
    );
    expect(shouldNudgeVerify({ isCoding: true, mutated: true, verified: false, nudges: 2 })).toBe(
      false,
    );
    expect(shouldNudgeVerify({ isCoding: true, mutated: true, verified: false, nudges: 0 })).toBe(
      true,
    );
    expect(shouldNudgeVerify({ isCoding: true, mutated: true, verified: true, nudges: 0 })).toBe(
      false,
    );
    expect(shouldNudgeVerify({ isCoding: true, mutated: false, verified: false, nudges: 0 })).toBe(
      false,
    );
    expect(wroteAgentCanvas([{ name: "canvas_write" }])).toBe(true);
    expect(wroteAgentCanvas([{ name: "canvas_write", error: "too big" }])).toBe(false);
    expect(foldCodingVerifyFlags([{ name: "canvas_write" }]).mutated).toBe(false);
    expect(SEARCH_WANDER_NUDGE).toMatch(/apply_patch/);
    expect(VERIFY_NUDGE).toMatch(/did not run tests/);
    expect(CODING_LOOP_HABIT).toMatch(/before claiming done/);
  });

  it("does not ship a coding turn that mutated without tests", () => {
    expect(CODING_VERIFY_NEEDS_HUMAN).toMatch(/tests/);
    expect(
      codingVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [{ name: "apply_patch", arguments: { patch: "diff" } }],
        },
      ]),
    ).toBe(true);
    expect(
      codingVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            { name: "file_write", arguments: { path: "src/a.ts" } },
            { name: "exec", arguments: { command: "npm test" } },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      codingVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        { role: "assistant", toolCalls: [{ name: "grep", arguments: { pattern: "TODO" } }] },
      ]),
    ).toBe(false);
    expect(
      codingVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [{ name: "apply_patch", arguments: { patch: "diff" } }],
        },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "anytime" },
      ]),
    ).toBe(false);
    expect(
      codingVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            { name: "apply_patch", arguments: { patch: "diff" } },
            { name: "exec", arguments: { command: "npm test" } },
            { name: "apply_patch", arguments: { patch: "more" } },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("does not ship a coding turn whose last tests failed", () => {
    expect(CODING_FAILED_VERIFY_NEEDS_HUMAN).toMatch(/never passed/);
    const failed = [
      { role: "user", content: "fix add" },
      {
        role: "assistant",
        toolCalls: [
          { name: "apply_patch", arguments: { patch: "diff" } },
          {
            name: "exec",
            arguments: { command: "npm test" },
            error: "FAIL src/add.test.js\ntests failed\n(exit 1)",
          },
        ],
      },
    ];
    expect(codingFailedVerifyNeedsHuman(failed)).toBe(true);
    expect(codingTurnNeedsHuman(failed)).toBe(CODING_FAILED_VERIFY_NEEDS_HUMAN);
    expect(
      codingFailedVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            { name: "file_write", arguments: { path: "src/a.ts" } },
            { name: "exec", arguments: { command: "npm test" } },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      codingFailedVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            {
              name: "exec",
              arguments: { command: "npm test" },
              error: "FAIL src/add.test.js\ntests failed",
            },
            { name: "exec", arguments: { command: "npm test" } },
          ],
        },
      ]),
    ).toBe(false);
    expect(
      codingFailedVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            {
              name: "git_push",
              error: "Harness blocked git_push: tests failed.\nFAIL src/a.test.ts",
            },
          ],
        },
      ]),
    ).toBe(true);
    expect(
      codingFailedVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            { name: "apply_patch", arguments: { patch: "diff" } },
            {
              name: "exec",
              arguments: { command: "npm test" },
              error: "FAIL src/add.test.js",
            },
            { name: "apply_patch", arguments: { patch: "retry" } },
          ],
        },
      ]),
    ).toBe(true);
    expect(
      codingFailedVerifyNeedsHuman([
        { role: "user", content: "fix add" },
        {
          role: "assistant",
          toolCalls: [
            {
              name: "exec",
              arguments: { command: "npm test" },
              error: "FAIL src/add.test.js",
            },
          ],
        },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "anytime" },
      ]),
    ).toBe(false);
    expect(
      codingTurnNeedsHuman([
        { role: "user", content: "fix add" },
        { role: "assistant", toolCalls: [{ name: "apply_patch", arguments: { patch: "diff" } }] },
      ]),
    ).toBe(CODING_VERIFY_NEEDS_HUMAN);
  });
});
