import { describe, expect, it, vi } from "vitest";
import type { AgentSession, ChatMessage, LocusConfig } from "@locus/shared";
import { runHostCliTurn, type HostCliTurnPorts } from "./hostCliTurn.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Agent",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    status: "running",
    os: "ubuntu",
    templateId: "host",
    runtime: "host",
    providerId: "claude",
    model: "opus",
    messages: [],
    ...partial,
  } as AgentSession;
}

function ports(overrides: Partial<HostCliTurnPorts> = {}): HostCliTurnPorts {
  const messages: ChatMessage[] = [];
  const row = session();
  return {
    require: async () => ({ ...row, messages }),
    loadConfig: async () =>
      ({
        providers: [],
        integrations: [],
        advanced: { bindPort: 7420 },
      }) as unknown as LocusConfig,
    dataDir: "/tmp/locus-test",
    appendMessage: async (_id, message) => {
      messages.push(message);
    },
    patch: async () => undefined,
    patchMeta: async () => row,
    isWorkerSession: () => false,
    workspaceRoot: () => "/tmp/ws",
    writeWorkspace: async () => undefined,
    cursorCliSpawner: () => {
      throw new Error("unused");
    },
    claudeCodeSpawner: () => {
      throw new Error("unused");
    },
    codexCliSpawner: () => {
      throw new Error("unused");
    },
    kiroCliSpawner: () => {
      throw new Error("unused");
    },
    requireWorker: async () => {
      throw new Error("no worker");
    },
    spawnOnWorker: () => {
      throw new Error("unused");
    },
    primeGameTurn: async () => "",
    snapshotStudioBaseline: async () => undefined,
    primeAssetTurn: async () => "",
    primeDesignTurn: async () => "",
    cursorCliAttachmentNote: async () => "",
    recordCursorCliContext: async () => undefined,
    spawnAborts: new Map(),
    cliGitTurns: new Map(),
    traces: { write: async () => undefined },
    appendThinking: async () => undefined,
    clearThinking: () => undefined,
    appendDelta: async () => undefined,
    applyCursorCliUsage: async () => undefined,
    upsertCursorToolCall: async () => undefined,
    applyCursorRunResult: async () => undefined,
    hasSteerAfter: async () => false,
    continueAfterCliRound: async () => ({ stop: true }),
    now: () => "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runHostCliTurn", () => {
  it("appends a missing-provider note and stops", async () => {
    const append = vi.fn();
    const result = await runHostCliTurn(
      ports({
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "claude",
      },
    );
    expect(result).toBe("");
    expect(append.mock.calls[0]?.[0]).toMatch(/Claude Code provider is not configured/);
  });

  it("refuses a VM workspace", async () => {
    const append = vi.fn();
    const result = await runHostCliTurn(
      ports({
        require: async () => session({ runtime: "vm", providerId: "claude" }),
        loadConfig: async () =>
          ({
            providers: [{ id: "claude", kind: "claude-code", enabled: true }],
            integrations: [],
            advanced: { bindPort: 7420 },
          }) as unknown as LocusConfig,
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "claude",
      },
    );
    expect(result).toBe("");
    expect(append.mock.calls[0]?.[0]).toMatch(/Docker or Host workspace/);
  });

  it("appends a missing Kiro CLI provider note and stops", async () => {
    const append = vi.fn();
    const result = await runHostCliTurn(
      ports({
        appendMessage: async (_id, message) => {
          append(message.content);
        },
      }),
      {
        sessionId: "s1",
        userText: "hi",
        abort: new AbortController(),
        turnId: "t1",
        planTurn: false,
        stop: () => false,
        kind: "kiro",
      },
    );
    expect(result).toBe("");
    expect(append.mock.calls[0]?.[0]).toMatch(/Kiro CLI provider is not configured/);
  });
});
