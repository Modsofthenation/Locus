import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DockerHostContainer } from "@locus/shared";
import { MockDockerEngine, type DockerEngine } from "@locus/hypervisor";
import { DockerInventory } from "./dockerInventory.js";

class HostAwareDocker extends MockDockerEngine {
  host = new Map<string, DockerHostContainer>();
  controls: Array<{ ref: string; action: string }> = [];

  async listHostContainers(): Promise<DockerHostContainer[]> {
    return [...this.host.values()];
  }

  async hostControl(ref: string, action: "start" | "stop" | "restart"): Promise<void> {
    this.controls.push({ ref, action });
    const row = this.host.get(ref) ?? [...this.host.values()].find((item) => item.name === ref);
    if (!row) throw new Error("Container not found");
    if (action === "stop") row.state = "exited";
    if (action === "start") row.state = "running";
  }
}

describe("DockerInventory", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function setup(engine?: DockerEngine) {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-inv-"));
    cleanup.push(dir);
    const docker = engine ?? new MockDockerEngine(dir);
    const sessions: Array<{ id: string; title: string; vmId?: string }> = [];
    const starts: string[] = [];
    const stops: string[] = [];
    const inventory = new DockerInventory({
      docker,
      listSessions: async () => sessions,
      startAgentMachine: async (id) => {
        starts.push(id);
      },
      stopAgentMachine: async (id) => {
        stops.push(id);
      },
    });
    return { docker, sessions, starts, stops, inventory };
  }

  it("lists host daemon rows without going through Session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-inv-"));
    cleanup.push(dir);
    const docker = new HostAwareDocker(dir);
    docker.host.set("abc123def456", {
      id: "abc123def456",
      name: "web",
      image: "nginx",
      state: "running",
      status: "Up",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const inventory = new DockerInventory({
      docker,
      listSessions: async () => [],
      startAgentMachine: async () => undefined,
      stopAgentMachine: async () => undefined,
    });
    const listed = await inventory.list();
    expect(listed.some((row) => row.name === "web" && row.locus === false)).toBe(true);
    const stopped = await inventory.action("web", "stop");
    expect(stopped.state).toBe("exited");
    expect(docker.controls).toEqual([{ ref: "abc123def456", action: "stop" }]);
  });

  it("lists a seeded Docker Swarm and scales a replicated service", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-inv-swarm-"));
    cleanup.push(dir);
    const docker = new MockDockerEngine(dir);
    docker.seedSwarm({
      info: { state: "active", controlAvailable: true, nodeId: "n1n1n1n1n1n1" },
      nodes: [
        {
          id: "n1n1n1n1n1n1",
          hostname: "manager",
          status: "Ready",
          availability: "Active",
          managerStatus: "Leader",
        },
      ],
      services: [
        {
          id: "svc123456789",
          name: "web",
          image: "nginx:latest",
          mode: "replicated",
          replicas: "1/1",
        },
      ],
      stacks: [{ name: "app", services: 1 }],
      logs: { web: "ready" },
    });
    const inventory = new DockerInventory({
      docker,
      listSessions: async () => [],
      startAgentMachine: async () => undefined,
      stopAgentMachine: async () => undefined,
    });
    const snapshot = await inventory.swarm();
    expect(snapshot.info.state).toBe("active");
    expect(snapshot.services).toHaveLength(1);
    const scaled = await inventory.scaleSwarm("web", 2);
    expect(scaled.replicas).toBe("2/2");
    const logs = await inventory.swarmLogs("web");
    expect(logs).toContain("ready");
    const tool = await inventory.executeSwarmTool({ action: "status" });
    expect(tool.ok).toBe(true);
    expect(tool.output).toMatch(/"state":"active"/);
  });

  it("rejects invalid refs before touching Machine lifecycle", async () => {
    const ctx = await setup();
    await expect(ctx.inventory.action("bad;id", "stop")).rejects.toThrow(/Invalid container/);
    await expect(ctx.inventory.logs("missing")).rejects.toThrow(/Container not found/);
    expect(ctx.starts).toEqual([]);
    expect(ctx.stops).toEqual([]);
  });
});
