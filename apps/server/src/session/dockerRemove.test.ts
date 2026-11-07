import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DockerCliEngine, MockHypervisor, type CommandRunner } from "@locus/hypervisor";
import type { VmInstance } from "@locus/shared";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "./sessions.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

function dockerRunner(calls: string[][], onRun?: () => Promise<void>): CommandRunner {
  return {
    which: async () => "/usr/bin/docker",
    exists: async () => true,
    exec: async (_cmd, args) => {
      calls.push(args);
      if (args[0] === "run") {
        if (onRun) await onRun();
        return { stdout: "ciddelete\n", stderr: "", code: 0 };
      }
      if (args[0] === "inspect") return { stdout: "true\n", stderr: "", code: 0 };
      return { stdout: "", stderr: "", code: 0 };
    },
    spawn: () => {
      throw new Error("unused");
    },
  };
}

async function setup(calls: string[][], onRun?: () => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "locus-docker-remove-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const docker = new DockerCliEngine(dir, dockerRunner(calls, onRun), "/usr/bin/docker");
  const hypervisor = new MockHypervisor(dir);
  const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
  const config = await store.loadConfig();
  return { sessions, docker, hypervisor, config };
}

function removed(calls: string[][], ref: string): boolean {
  return calls.some((args) => args[0] === "rm" && args.includes("-f") && args.includes(ref));
}

describe("delete docker agent", () => {
  it("stops a running container when the session is deleted", async () => {
    const calls: string[][] = [];
    const { sessions, config, hypervisor } = await setup(calls);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "python:3.12-bookworm",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
    });
    expect(created.vmId).toBeTruthy();
    await sessions.remove(created.id);
    expect(removed(calls, "ciddelete")).toBe(true);
    expect(removed(calls, `locus-${created.vmId}`)).toBe(true);
    expect(await sessions.get(created.id)).toBeUndefined();
    hypervisor.shutdown();
  });

  it("stops a container that starts after the session is deleted", async () => {
    const calls: string[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class TrackedDocker extends DockerCliEngine {
      started?: Promise<VmInstance>;
      override start(id: string) {
        this.started = super.start(id);
        return this.started;
      }
    }
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-remove-race-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const docker = new TrackedDocker(
      dir,
      dockerRunner(calls, () => gate),
      "/usr/bin/docker",
    );
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
    const config = await store.loadConfig();
    const created = await sessions.create(
      {
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        runtime: "docker",
        dockerImage: "python:3.12-bookworm",
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        startVm: true,
      },
      { waitUntilStarted: false },
    );
    const deadline = Date.now() + 2000;
    while (!calls.some((args) => args[0] === "run") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(calls.some((args) => args[0] === "run")).toBe(true);
    await sessions.remove(created.id);
    release();
    await docker.started?.catch(() => undefined);
    expect(removed(calls, "ciddelete")).toBe(true);
    expect(await sessions.get(created.id)).toBeUndefined();
    hypervisor.shutdown();
  });

  it("does not docker run when creating a host agent with a start prompt", async () => {
    const calls: string[][] = [];
    const { sessions, config, hypervisor } = await setup(calls);
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: true,
      prompt: "What is Locus?",
    });
    expect(created.runtime).toBe("host");
    expect(created.vmId).toBeFalsy();
    const deadline = Date.now() + 4000;
    let fresh = await sessions.get(created.id);
    while (Date.now() < deadline) {
      fresh = await sessions.get(created.id);
      if (
        fresh?.status !== "running" &&
        fresh?.messages.some((m) => m.role === "assistant" && m.content.trim())
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(calls.some((args) => args[0] === "run")).toBe(false);
    expect(calls.some((args) => args[0] === "create")).toBe(false);
    expect(sessions.listMachines()).toEqual([]);
    hypervisor.shutdown();
  });
});
