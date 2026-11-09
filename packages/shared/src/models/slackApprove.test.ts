import { describe, expect, it } from "vitest";
import {
  formatSlackApprovalValue,
  parseSlackApprovalValue,
  slackApprovalActionId,
  slackCanApproveTool,
} from "./slackApprove.js";

describe("slack approvals", () => {
  it("allows only slack_post and slack_upload, never git writes", () => {
    expect(slackCanApproveTool("slack_post")).toBe(true);
    expect(slackCanApproveTool("slack_upload")).toBe(true);
    expect(slackCanApproveTool("git_push")).toBe(false);
    expect(slackCanApproveTool("git_pr")).toBe(false);
    expect(slackCanApproveTool("exec")).toBe(false);
    expect(slackApprovalActionId("approved")).toBe("locus_approve");
    expect(slackApprovalActionId("denied")).toBe("locus_deny");
    expect(formatSlackApprovalValue("session01", "call-id-1")).toBe("session01:call-id-1");
    expect(parseSlackApprovalValue("session01:call-id-1")).toEqual({
      sessionId: "session01",
      callId: "call-id-1",
    });
    expect(parseSlackApprovalValue("bad")).toBeUndefined();
  });
});
