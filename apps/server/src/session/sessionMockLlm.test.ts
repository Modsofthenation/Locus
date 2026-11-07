import { describe, expect, it } from "vitest";
import { EMPTY_MODEL_REPLY, mockAssistantReply, mockChunks } from "./sessionMockLlm.js";
import type { AgentSession } from "@locus/shared";

const session: AgentSession = {
  id: "s1",
  title: "Agent",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("sessionMockLlm", () => {
  it("chunks demo text", async () => {
    const parts: string[] = [];
    for await (const event of mockChunks("abcdefghijklmnop")) {
      if (event.type === "text") parts.push(event.text);
    }
    expect(parts.join("")).toBe("abcdefghijklmnop");
    expect(parts.length).toBeGreaterThan(1);
  });

  it("mentions the guest and the user prompt", () => {
    const reply = mockAssistantReply("fix the login", session, "ready");
    expect(reply).toMatch(/Ubuntu/);
    expect(reply).toMatch(/fix the login/);
    expect(EMPTY_MODEL_REPLY.length).toBeGreaterThan(0);
  });
});
