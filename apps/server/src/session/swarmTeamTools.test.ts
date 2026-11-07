import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { executeSwarmTeamTool, type SwarmTeamPorts } from "./swarmTeamTools.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "s1",
    title: "Coord",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    status: "idle",
    os: "ubuntu",
    templateId: "host",
    runtime: "host",
    surface: "swarm",
    persona: { displayName: "Ada", hubRole: "coordinator" },
    ...partial,
  } as AgentSession;
}

function ports(overrides: Partial<SwarmTeamPorts> = {}): SwarmTeamPorts {
  return {
    list: async () => [session()],
    create: async () => session({ id: "s2", title: "Peer" }),
    sendChat: async () => undefined,
    store: {
      loadConfig: async () => ({ providers: [{ id: "p1", enabled: true, defaultModel: "m" }] }),
    } as unknown as SwarmTeamPorts["store"],
    ...overrides,
  };
}

describe("executeSwarmTeamTool", () => {
  it("refuses outside Swarm", async () => {
    const result = await executeSwarmTeamTool(
      ports(),
      session({ surface: "developer" }),
      "team_roster",
      {},
    );
    expect(result).toEqual({ ok: false, output: "Team tools are only available in Locus Swarm." });
  });

  it("lists the roster", async () => {
    const peer = session({ id: "s2", title: "Peer", persona: { displayName: "Bo" } });
    const result = await executeSwarmTeamTool(
      ports({ list: async () => [session(), peer] }),
      session(),
      "team_roster",
      {},
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(result.output ?? "{}") as { teammates: Array<{ id: string }> };
    expect(body.teammates.map((row) => row.id)).toContain("s2");
  });

  it("adds a teammate when Coordinator", async () => {
    const create = vi.fn(async () => session({ id: "s9", title: "New" }));
    const result = await executeSwarmTeamTool(ports({ create }), session(), "team_add_teammate", {
      name: "Bo",
      role: "engineer",
    });
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalled();
  });
});
