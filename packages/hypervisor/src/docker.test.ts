import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DockerCliEngine,
  MockDockerEngine,
  createDockerEngine,
  dockerWorkspaceDir,
  hostWorkspaceDir,
  parseDockerPsJson,
  sessionHostWorkspace,
} from "./docker.js";
import type { CommandRunner, ExecResult } from "./runner.js";

describe("MockDockerEngine", () => {
  it("creates and boots a container without a QEMU disk", async () => {
    const engine = new MockDockerEngine(join(tmpdir(), "locus-docker-test"));
    const vm = await engine.create({
      sessionId: "s1",
      name: "node agent",
      image: "node:22-bookworm",
    });
    expect(vm.runtime).toBe("docker");
    expect(vm.dockerImage).toBe("node:22-bookworm");
    expect(vm.diskPath).toContain(join("docker-workspaces", "s1"));
    expect(vm.display).toBeUndefined();
    await engine.start(vm.id);
    await new Promise((r) => setTimeout(r, 250));
    expect(engine.get(vm.id)?.status).toBe("running");
    expect(engine.get(vm.id)?.containerId).toMatch(/^mock-/);
    expect(engine.logs(vm.id)).toMatch(/booting/);
    engine.noteListeningPorts?.(vm.id, [5173, 22]);
    expect(await engine.listListeningPorts?.(vm.id)).toEqual([5173]);
    expect(await engine.inspectAddress?.(vm.id)).toBeUndefined();
    const stats = await engine.hostStats(vm.id);
    expect(stats.running).toBe(true);
    expect(stats.cpuPercent).toBe(1.2);
    expect(stats.memoryUsage).toBe("12.0MiB");
    expect(stats.name).toBe("node agent");
    engine.shutdown();
  });

  it("rejects session ids that escape the workspace directory", () => {
    expect(() => dockerWorkspaceDir("/data", "../etc")).toThrow(/Invalid session id/);
    expect(() => hostWorkspaceDir("/data", "ok")).not.toThrow();
  });

  it("refuses to create a Docker container for host runtime", async () => {
    const engine = new MockDockerEngine(join(tmpdir(), "locus-docker-host"));
    await expect(
      engine.create({
        sessionId: "s1",
        name: "host",
        image: "host",
        runtime: "host",
      }),
    ).rejects.toThrow(/Host agents do not have a VM or container/);
    expect(engine.list()).toEqual([]);
    engine.shutdown();
  });

  it("restarts a mock container and keeps logs", async () => {
    const engine = new MockDockerEngine(join(tmpdir(), "locus-docker-restart"));
    const vm = await engine.create({ sessionId: "s1", name: "node", image: "node:22-bookworm" });
    await engine.start(vm.id);
    engine.forceRunning(vm.id);
    const restarted = await engine.restart(vm.id);
    expect(restarted.status).toBe("booting");
    await new Promise((r) => setTimeout(r, 250));
    expect(engine.get(vm.id)?.status).toBe("running");
    expect(engine.logs(vm.id)).toMatch(/stopped/);
    expect(engine.logs(vm.id)).toMatch(/running/);
    engine.shutdown();
  });

  it("snapshots and restores the workspace directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-snap-"));
    const engine = new MockDockerEngine(dir);
    const vm = await engine.create({ sessionId: "s1", name: "node", image: "node:22-bookworm" });
    const { writeFile, readFile } = await import("node:fs/promises");
    await writeFile(join(vm.diskPath, "note.txt"), "hello");
    await engine.start(vm.id);
    engine.forceRunning(vm.id);
    const dest = join(dir, "snap");
    await engine.snapshotWorkspace(vm.id, dest);
    await writeFile(join(vm.diskPath, "note.txt"), "changed");
    await engine.restoreWorkspace(vm.id, dest);
    expect(await readFile(join(vm.diskPath, "note.txt"), "utf8")).toBe("hello");
    engine.shutdown();
  });

  it("rejects unsafe image names", async () => {
    const engine = new MockDockerEngine(join(tmpdir(), "locus-docker-test"));
    await expect(
      engine.create({ sessionId: "s1", name: "x", image: "ubuntu:24.04;rm" }),
    ).rejects.toThrow(/Docker image/);
  });

  it("defaults to inactive Docker Swarm and can seed a cluster", async () => {
    const engine = new MockDockerEngine(join(tmpdir(), "locus-docker-swarm"));
    expect(await engine.swarmInfo()).toEqual({ state: "inactive", controlAvailable: false });
    expect(await engine.listSwarmServices()).toEqual([]);
    engine.seedSwarm({
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
      stacks: [{ name: "app", services: 1, orchestrator: "Swarm" }],
      logs: { web: "hello\nworld" },
      tasks: {
        svc123456789: [
          {
            id: "task12345678",
            name: "web.1",
            image: "nginx:latest",
            node: "manager",
            desiredState: "Running",
            currentState: "Running",
          },
        ],
      },
    });
    expect((await engine.swarmInfo()).state).toBe("active");
    expect((await engine.listSwarmServices())[0]?.name).toBe("web");
    expect(await engine.swarmServiceLogs("web", 1)).toBe("world");
    const scaled = await engine.scaleSwarmService("web", 3);
    expect(scaled.replicas).toBe("3/3");
    expect((await engine.listSwarmTasks("web"))[0]?.name).toBe("web.1");
    engine.shutdown();
  });
});

describe("DockerCliEngine", () => {
  it("refuses to docker run a host-runtime guest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-cli-host-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        return { stdout: "cid123\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    await expect(
      engine.create({
        sessionId: "sess",
        name: "host",
        image: "host",
        runtime: "host",
      }),
    ).rejects.toThrow(/Host agents do not have a VM or container/);
    expect(calls).toEqual([]);
    expect(engine.list()).toEqual([]);
  });

  it("keeps the container alive with a BusyBox-safe entrypoint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-cli-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "inspect") {
          const template = args[args.indexOf("-f") + 1] ?? "";
          if (template.includes("IPAddress")) {
            return { stdout: "172.17.0.2\n", stderr: "", code: 0 } satisfies ExecResult;
          }
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        }
        if (args[0] === "exec") {
          return {
            stdout:
              "  sl  local_address rem_address   st tx_queue\n   0: 00000000:0050 00000000:0000 0A 00000000:00000000\n",
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        return { stdout: "cid123\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({
      sessionId: "sess",
      name: "py",
      image: "python:3.12-bookworm",
      hostSharePath: join(dir, "share"),
    });
    const started = await engine.start(vm.id);
    expect(started.containerId).toBe("cid123");
    expect(started.status).toBe("running");
    const run = calls.find((args) => args[0] === "run");
    expect(run).toEqual(
      expect.arrayContaining([
        "run",
        "-d",
        "-w",
        "/workspace",
        `${join(dir, "docker-workspaces", "sess")}:/workspace`,
        `${join(dir, "share")}:/mnt/host:ro`,
        "--env-file",
        "--entrypoint",
        "tail",
        "python:3.12-bookworm",
        "-f",
        "/dev/null",
      ]),
    );
    expect(run?.includes("-e")).toBe(false);
    expect(
      calls.some(
        (args) => args[0] === "exec" && args.some((item) => item.includes("git-credential-locus")),
      ),
    ).toBe(true);
    engine.noteListeningPorts?.(vm.id, [3000]);
    expect(await engine.listListeningPorts?.(vm.id)).toEqual([80, 3000]);
    expect(await engine.inspectAddress?.(vm.id)).toBe("172.17.0.2");
  });

  it("jails restricted containers behind the host proxy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-jail-"));
    const calls: string[][] = [];
    let envFile = "";
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "run") {
          const idx = args.indexOf("--env-file");
          if (idx >= 0) {
            const { readFile } = await import("node:fs/promises");
            envFile = await readFile(args[idx + 1]!, "utf8");
          }
        }
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "cid456\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({
      sessionId: "sess",
      name: "py",
      image: "python:3.12-bookworm",
      network: "restricted",
      proxyPort: 18080,
    });
    await engine.start(vm.id);
    const run = calls.find((args) => args[0] === "run");
    expect(run).toEqual(
      expect.arrayContaining(["--add-host", "host.docker.internal:host-gateway"]),
    );
    expect(run).toEqual(expect.arrayContaining(["--network", "locus-restricted"]));
    expect(run).not.toEqual(expect.arrayContaining(["--cap-add", "NET_ADMIN"]));
    expect(run).toEqual(expect.arrayContaining(["--env-file"]));
    expect(envFile).toContain("HTTP_PROXY=http://host.docker.internal:18080");
    const firewall = calls.find(
      (args) =>
        args[0] === "exec" &&
        args.includes("--privileged") &&
        args.some((item) => item.includes("OUTPUT DROP")),
    );
    expect(firewall).toBeTruthy();
    const script = firewall?.find((item) => item.includes("OUTPUT DROP")) ?? "";
    expect(script).toContain("$HOSTIP");
    expect(script).toContain("dport 18080");
    expect(script).toContain("127.0.0.11");
    expect(script).not.toMatch(/\$IPT -A OUTPUT -p udp --dport 53/);
    expect(
      script
        .split("\n")
        .filter((line) => line.includes("dport 18080"))
        .every((line) => line.includes("$HOSTIP")),
    ).toBe(true);
    engine.configureNetwork?.(vm.id, "none");
    await engine.destroy(vm.id);
    const closed = await engine.create({
      sessionId: "sess2",
      name: "py",
      image: "python:3.12-bookworm",
      network: "none",
    });
    await engine.start(closed.id);
    const none = calls.filter((args) => args[0] === "run").at(-1);
    expect(none).toEqual(expect.arrayContaining(["--network", "none"]));
  });

  it("destroys the container when restricted iptables is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-no-iptables-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        if (args[0] === "exec" && args.includes("--privileged")) {
          return { stdout: "LOCUS_NO_IPTABLES\n", stderr: "", code: 1 } satisfies ExecResult;
        }
        if (args[0] === "run")
          return { stdout: "cid789\n", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({
      sessionId: "sess",
      name: "py",
      image: "python:3.12-bookworm",
      network: "restricted",
      proxyPort: 18080,
    });
    await expect(engine.start(vm.id)).rejects.toThrow(/iptables/);
    expect(
      calls.some((args) => args[0] === "rm" && args.includes("-f") && args.includes("cid789")),
    ).toBe(true);
    expect(engine.get(vm.id)?.containerId).toBeUndefined();
    expect(engine.get(vm.id)?.status).toBe("error");
  });

  it("falls back to mock when docker is missing", async () => {
    const runner: CommandRunner = {
      which: async () => null,
      exists: async () => false,
      exec: async () => ({ stdout: "", stderr: "", code: 1 }),
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = await createDockerEngine("/tmp/x", runner);
    expect(engine.kind).toBe("mock");
  });

  it("builds a missing locus/agent tag and starts in-guest code-server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-agent-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "image")
          return { stdout: "", stderr: "missing", code: 1 } satisfies ExecResult;
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        if (args[0] === "exec" || args[0] === "build")
          return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "cidagent\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({ sessionId: "sess", name: "agent", image: "locus/agent" });
    const started = await engine.start(vm.id);
    expect(started.containerId).toBe("cidagent");
    expect(started.dockerImage).toBe("locus/agent:0.1");
    expect(calls.some((args) => args[0] === "image" && args.includes("locus/agent:0.1"))).toBe(
      true,
    );
    expect(calls.some((args) => args[0] === "build" && args.includes("locus/agent:0.1"))).toBe(
      true,
    );
    const exec = calls.filter((args) => args[0] === "exec");
    expect(exec.some((args) => args.join(" ").includes("locus-code-server"))).toBe(true);
    expect(exec.some((args) => args.some((item) => item.includes("git-credential-locus")))).toBe(
      true,
    );
  });

  it("emits image build progress while locus/agent is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-build-progress-"));
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args, opts) => {
        if (args[0] === "image")
          return { stdout: "", stderr: "missing", code: 1 } satisfies ExecResult;
        if (args[0] === "build") {
          opts?.onOutput?.("#4 [2/6] RUN apt-get update && apt-get install -y git\n");
          return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
        }
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "cidbuild\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const seen: Array<{ percent: number; phase: string; done?: boolean }> = [];
    engine.onBuild((_id, progress) => seen.push(progress));
    const vm = await engine.create({ sessionId: "sess", name: "agent", image: "locus/agent" });
    await engine.start(vm.id);
    expect(engine.logs(vm.id)).toMatch(/Building locus\/agent:0\.1/);
    expect(engine.logs(vm.id)).toMatch(/RUN apt-get update/);
    expect(seen[0]).toEqual({ percent: 0, phase: "Starting" });
    expect(seen.some((row) => row.phase === "RUN apt-get update")).toBe(true);
    expect(seen.at(-1)).toEqual({ percent: 100, phase: "Done", done: true });
  });

  it("errors when the container exits immediately after docker run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-dead-"));
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        if (args[0] === "inspect")
          return { stdout: "false\n", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "ciddead\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({ sessionId: "sess", name: "py", image: "alpine:3.21" });
    await expect(engine.start(vm.id)).rejects.toThrow(/exited immediately/);
    expect(engine.get(vm.id)?.status).toBe("error");
  });

  it("lists host containers, restarts, and pulls logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-ps-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        if (args[0] === "ps") {
          return {
            stdout: `${JSON.stringify({
              ID: "abc123def4567890",
              Names: "web",
              Image: "nginx:alpine",
              State: "running",
              Status: "Up 2 hours",
              CreatedAt: "2020-01-01 00:00:00 +0000 UTC",
            })}\n`,
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        if (args[0] === "logs")
          return { stdout: "hello from nginx\n", stderr: "", code: 0 } satisfies ExecResult;
        if (args[0] === "stats") {
          return {
            stdout: `${JSON.stringify({
              BlockIO: "0B / 8B",
              CPUPerc: "2.15%",
              Container: "abc123def4567890",
              ID: "abc123def4567890",
              MemPerc: "0.19%",
              MemUsage: "6.148MiB / 7.653GiB",
              Name: "web",
              NetIO: "1.37kB / 0B",
              PIDs: "5",
            })}\n`,
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        return { stdout: "cid123\n", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({
      sessionId: "sess",
      name: "py",
      image: "python:3.12-bookworm",
    });
    await engine.start(vm.id);
    await engine.restart(vm.id);
    expect(calls.some((args) => args[0] === "stop")).toBe(true);
    expect(calls.filter((args) => args[0] === "start" || args[0] === "run").length).toBeGreaterThan(
      0,
    );
    const host = await engine.listHostContainers();
    expect(host).toEqual([
      {
        id: "abc123def4567890",
        name: "web",
        image: "nginx:alpine",
        state: "running",
        status: "Up 2 hours",
        createdAt: "2020-01-01 00:00:00 +0000 UTC",
      },
    ]);
    await engine.hostControl("web", "stop");
    expect(calls.some((args) => args[0] === "stop" && args[1] === "web")).toBe(true);
    expect(await engine.hostLogs("web", 80)).toBe("hello from nginx\n");
    expect(
      calls.some(
        (args) => args[0] === "logs" && args.includes("--timestamps") && args.includes("80"),
      ),
    ).toBe(true);
    const stats = await engine.hostStats("web");
    expect(stats.cpuPercent).toBeCloseTo(2.15);
    expect(stats.memoryUsage).toBe("6.148MiB");
    expect(stats.memoryLimit).toBe("7.653GiB");
    expect(stats.networkRx).toBe("1.37kB");
    expect(stats.pids).toBe(5);
    expect(stats.running).toBe(true);
    expect(calls.some((args) => args[0] === "stats" && args.includes("web"))).toBe(true);
    await expect(engine.hostControl("bad;id", "stop")).rejects.toThrow(/Invalid container/);
  });

  it("force-removes a running container on destroy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-destroy-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        if (args[0] === "run")
          return { stdout: "cidalive\n", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({
      sessionId: "sess",
      name: "py",
      image: "python:3.12-bookworm",
    });
    await engine.start(vm.id);
    await engine.destroy(vm.id);
    expect(
      calls.some((args) => args[0] === "rm" && args.includes("-f") && args.includes("cidalive")),
    ).toBe(true);
    expect(
      calls.some(
        (args) => args[0] === "rm" && args.includes("-f") && args.includes(`locus-${vm.id}`),
      ),
    ).toBe(true);
    expect(engine.get(vm.id)).toBeUndefined();
  });

  it("force-removes the named container even when the id is unknown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-destroy-name-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const id = "11111111-2222-4333-8444-555555555555";
    await engine.destroy(id);
    expect(
      calls.some((args) => args[0] === "rm" && args.includes("-f") && args.includes(`locus-${id}`)),
    ).toBe(true);
  });

  it("force-removes a container created after destroy starts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-destroy-race-"));
    const calls: string[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "run") {
          await gate;
          return { stdout: "cidrace\n", stderr: "", code: 0 } satisfies ExecResult;
        }
        if (args[0] === "inspect")
          return { stdout: "true\n", stderr: "", code: 0 } satisfies ExecResult;
        return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    const vm = await engine.create({
      sessionId: "sess",
      name: "py",
      image: "python:3.12-bookworm",
    });
    const starting = engine.start(vm.id);
    const deadline = Date.now() + 2000;
    while (!calls.some((args) => args[0] === "run") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(calls.some((args) => args[0] === "run")).toBe(true);
    await engine.destroy(vm.id);
    release();
    await expect(starting).rejects.toThrow(/Container not found/);
    expect(
      calls.some((args) => args[0] === "rm" && args.includes("-f") && args.includes("cidrace")),
    ).toBe(true);
    expect(engine.get(vm.id)).toBeUndefined();
  });
});

describe("DockerCliEngine swarm", () => {
  it("parses swarm info, lists, logs, and scale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-cli-swarm-"));
    const calls: string[][] = [];
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        calls.push(args);
        if (args[0] === "info") {
          return {
            stdout: JSON.stringify({
              NodeID: "abc123def456",
              NodeAddr: "10.0.0.2",
              LocalNodeState: "active",
              ControlAvailable: true,
            }),
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        if (args[0] === "node") {
          return {
            stdout: JSON.stringify({
              ID: "abc123def456",
              Hostname: "manager",
              Status: "Ready",
              Availability: "Active",
              ManagerStatus: "Leader",
            }),
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        if (args[0] === "service" && args[1] === "ls") {
          return {
            stdout: JSON.stringify({
              ID: "svc123456789",
              Name: "web",
              Mode: "replicated",
              Replicas: "1/1",
              Image: "nginx:latest",
            }),
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        if (args[0] === "service" && args[1] === "ps") {
          return {
            stdout: JSON.stringify({
              ID: "task12345678",
              Name: "web.1",
              Image: "nginx:latest",
              Node: "manager",
              DesiredState: "Running",
              CurrentState: "Running",
            }),
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        if (args[0] === "service" && args[1] === "logs") {
          return { stdout: "hello\n", stderr: "", code: 0 } satisfies ExecResult;
        }
        if (args[0] === "service" && args[1] === "scale") {
          return { stdout: "web scaled to 3\n", stderr: "", code: 0 } satisfies ExecResult;
        }
        if (args[0] === "stack") {
          return {
            stdout: JSON.stringify({ Name: "app", Services: "1", Orchestrator: "Swarm" }),
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        return { stdout: "", stderr: "", code: 0 } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    expect(await engine.swarmInfo()).toMatchObject({
      state: "active",
      controlAvailable: true,
      nodeId: "abc123def456",
    });
    expect((await engine.listSwarmNodes())[0]?.hostname).toBe("manager");
    expect((await engine.listSwarmServices())[0]?.name).toBe("web");
    expect((await engine.listSwarmStacks())[0]?.name).toBe("app");
    expect((await engine.listSwarmTasks("web"))[0]?.name).toBe("web.1");
    expect(await engine.swarmServiceLogs("web")).toContain("hello");
    const scaled = await engine.scaleSwarmService("web", 3);
    expect(scaled.name).toBe("web");
    expect(calls.some((args) => args[0] === "service" && args[1] === "scale")).toBe(true);
  });

  it("treats worker-node swarm list failures as empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-docker-cli-worker-"));
    const runner: CommandRunner = {
      which: async () => "/usr/bin/docker",
      exists: async () => true,
      exec: async (_cmd, args) => {
        if (args[0] === "info") {
          return {
            stdout: JSON.stringify({ LocalNodeState: "active", ControlAvailable: false }),
            stderr: "",
            code: 0,
          } satisfies ExecResult;
        }
        return {
          stdout: "",
          stderr: "Error: This node is not a swarm manager.",
          code: 1,
        } satisfies ExecResult;
      },
      spawn: () => {
        throw new Error("unused");
      },
    };
    const engine = new DockerCliEngine(dir, runner, "/usr/bin/docker");
    expect(await engine.listSwarmServices()).toEqual([]);
    expect(await engine.listSwarmNodes()).toEqual([]);
  });
});

describe("parseDockerPsJson", () => {
  it("skips junk lines and unsafe ids", () => {
    const stdout = [
      "not json",
      JSON.stringify({
        ID: "abc123def456",
        Names: "/compose_web_1",
        Image: "nginx",
        State: "running",
        Status: "Up 1 second",
        CreatedAt: "now",
      }),
      JSON.stringify({ ID: "id;rm", Names: "x", Image: "x", State: "running" }),
    ].join("\n");
    expect(parseDockerPsJson(stdout)).toEqual([
      {
        id: "abc123def456",
        name: "compose_web_1",
        image: "nginx",
        state: "running",
        status: "Up 1 second",
        createdAt: "now",
      },
    ]);
  });
});

describe("sessionHostWorkspace", () => {
  it("uses a chosen folder when set, otherwise the per-session directory", () => {
    expect(sessionHostWorkspace("/data", { id: "s1" })).toBe(hostWorkspaceDir("/data", "s1"));
    expect(sessionHostWorkspace("/data", { id: "s1", hostDir: " /tmp/proj " })).toBe("/tmp/proj");
  });
});
