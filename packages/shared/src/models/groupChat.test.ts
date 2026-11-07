import { describe, expect, it } from "vitest";
import { GROUP_CHAT_TOOLS, PROJECT_CHAT_TOOLS } from "./tools.js";
import {
  formatGroupChatThread,
  groupChatMentionPrompt,
  shouldWakeGroupChatRequester,
} from "./groupChat.js";
import type { ChatMessage } from "./session.js";

function msg(
  role: "user" | "assistant",
  content: string,
  extra?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: extra?.id ?? content.slice(0, 12),
    role,
    content,
    createdAt: extra?.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

describe("group chat token packing", () => {
  it("keeps the group-chat catalog a lean subset of project coordinator tools", () => {
    expect(GROUP_CHAT_TOOLS).toEqual([
      "project_get",
      "project_context_list",
      "project_context_read",
      "project_context_write",
      "project_context_delete",
      "team_roster",
      "team_peer_status",
      "team_add_teammate",
      "team_message",
    ]);
    const project = new Set(PROJECT_CHAT_TOOLS);
    for (const name of GROUP_CHAT_TOOLS) {
      expect(project.has(name)).toBe(true);
    }
    expect(GROUP_CHAT_TOOLS).not.toContain("project_spawn");
    expect(GROUP_CHAT_TOOLS).not.toContain("git_pr_list");
    expect(GROUP_CHAT_TOOLS).not.toContain("slack_history");
  });

  it("packs recent speakers and drops oldest lines to fit the budget", () => {
    const thread = formatGroupChatThread(
      [
        msg("user", "let's plan the launch"),
        msg("assistant", "I'll pick owners as we go."),
        msg("user", "@Alice gather sources", { speaker: { sessionId: "op", displayName: "Sam" } }),
        msg("assistant", "Alice: three links in INDEX.md", {
          speaker: { sessionId: "alice", displayName: "Alice" },
          teamEvent: "done",
        }),
        msg("assistant", "", { id: "blank" }),
        msg("assistant", "hidden scratch", { hidden: true }),
      ],
      { budget: 400, maxTurns: 10, lineChars: 80 },
    );
    expect(thread).toContain("Operator: let's plan the launch");
    expect(thread).toContain("Locus: I'll pick owners as we go.");
    expect(thread).toContain("Alice: three links in INDEX.md");
    expect(thread).not.toContain("hidden scratch");
    expect(thread).not.toMatch(/^:/m);

    const tight = formatGroupChatThread(
      Array.from({ length: 8 }, (_, i) => msg("user", `turn ${i} ${"word ".repeat(20)}`)),
      { budget: 280, maxTurns: 8, lineChars: 60 },
    );
    expect(tight.length).toBeLessThanOrEqual(280);
    expect(tight).toContain("turn 7");
    expect(tight).not.toContain("turn 0");
  });

  it("builds a short mention prompt with optional thread context", () => {
    const prompt = groupChatMentionPrompt({
      title: "Launch room",
      request: "@Alice gather the sources",
      thread: "Operator: let's ship Friday\nLocus: Alice owns research.",
    });
    expect(prompt).toContain('Group chat "Launch room"');
    expect(prompt).toContain("Recent thread:\nOperator: let's ship Friday");
    expect(prompt).toContain("Request: @Alice gather the sources");
    expect(prompt).not.toMatch(/The operator addressed you directly/);
    expect(groupChatMentionPrompt({ title: "  ", request: "hello" })).toContain(
      'Group chat "group"',
    );
  });

  it("skips coordinator wakes for silent mention completions, not blockers", () => {
    expect(shouldWakeGroupChatRequester("done")).toBe(true);
    expect(shouldWakeGroupChatRequester("done", false)).toBe(false);
    expect(shouldWakeGroupChatRequester("needs_you", false)).toBe(true);
    expect(shouldWakeGroupChatRequester("blocked", false)).toBe(true);
  });
});
