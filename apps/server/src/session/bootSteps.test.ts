import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockDockerEngine, MockHypervisor } from "@locus/hypervisor";
import type { BootHistory, BootProgress, ClientEvent } from "@locus/shared";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { BootTracker } from "./bootSteps.js";
import { SessionService } from "./sessions.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  exec("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

function progressFor(events: ClientEvent[], sessionId: string): BootProgress[] {
  return events.flatMap((event) =>
    event.type === "boot.progress" && event.sessionId === sessionId && event.progress
      ? [event.progress]
      : [],
  );
}

describe("BootTracker", () => {
  it("broadcasts steps, records history on finish, and uses it for estimates", async () => {
    const events: ClientEvent[] = [];
    let saved: BootHistory = { "docker:img": { pull: [30_000, 50_000, 40_000] } };
    let t = 0;
    const tracker = new BootTracker({
      broadcast: (event) => events.push(event),
      loadHistory: async () => saved,
      saveHistory: async (history) => {
        saved = history;
      },
      now: () => t,
    });
    await tracker.begin("s1", { kind: "docker", key: "docker:img" });
    expect(tracker.get("s1")?.steps[0]).toMatchObject({
      id: "pull",
      state: "active",
      estimateMs: 40_000,
    });
    t = 1_000;
    tracker.step("s1", "start");
    t = 3_000;
    await tracker.finish("s1");
    expect(tracker.get("s1")?.done).toBe(true);
    expect(tracker.isRunning("s1")).toBe(false);
    expect(saved["docker:img"]).toEqual({ pull: [30_000, 50_000, 40_000, 1_000], start: [2_000] });
    expect(progressFor(events, "s1").length).toBe(3);
    tracker.clear("s1");
    expect(events.at(-1)).toEqual({ type: "boot.progress", sessionId: "s1", progress: null });
  });

  it("keeps a running list on repeated begin and ignores steps without one", async () => {
    const events: ClientEvent[] = [];
    const tracker = new BootTracker({
      broadcast: (event) => events.push(event),
      loadHistory: async () => ({}),
      saveHistory: async () => undefined,
    });
    tracker.step("none", "start");
    expect(events).toEqual([]);
    await tracker.begin("s1", { kind: "vm", key: "vm" });
    tracker.step("s1", "boot");
    await tracker.begin("s1", { kind: "vm", key: "vm" });
    expect(tracker.get("s1")?.steps.find((s) => s.id === "boot")?.state).toBe("active");
    tracker.fail("s1", "boom");
    expect(tracker.get("s1")?.error).toBe("boom");
    await tracker.begin("s1", { kind: "vm", key: "vm" });
    expect(tracker.get("s1")?.error).toBeUndefined();
  });
});

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), "locus-boot-steps-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hub = new Hub();
  const events: ClientEvent[] = [];
  const send = hub.broadcast.bind(hub);
  hub.broadcast = (event) => {
    events.push(event);
    send(event);
  };
  const sessions = new SessionService(
    store,
    new MockHypervisor(dir),
    hub,
    undefined,
    undefined,
    new MockDockerEngine(dir),
  );
  const config = await store.loadConfig();
  return { store, events, sessions, config };
}

async function waitDone(events: ClientEvent[], sessionId: string): Promise<BootProgress> {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const last = progressFor(events, sessionId).at(-1);
    if (last?.done || last?.error) return last;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("boot steps did not finish");
}

describe("guest boot steps (mock adapters)", () => {
  it("walks Docker through Pull → Start → Install → Ready and stores durations", async () => {
    const { store, events, sessions, config } = await harness();
    const session = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "docker",
      dockerImage: "ubuntu:24.04",
      startVm: true,
    });
    const done = await waitDone(events, session.id);
    expect(done.kind).toBe("docker");
    expect(done.key).toBe("docker:ubuntu:24.04");
    expect(done.error).toBeUndefined();
    expect(done.steps.map((s) => s.id)).toEqual(["pull", "start", "setup", "ready"]);
    expect(done.steps.find((s) => s.id === "pull")?.state).toBe("done");
    expect(done.steps.find((s) => s.id === "start")?.state).toBe("done");
    const seen = new Set(
      progressFor(events, session.id).flatMap((p) =>
        p.steps.filter((s) => s.state === "active").map((s) => s.id),
      ),
    );
    expect(seen.has("pull")).toBe(true);
    expect(seen.has("start")).toBe(true);
    // Durations are saved just after the final step is broadcast.
    await vi.waitFor(async () => {
      const history = await store.loadBootHistory();
      expect(history["docker:ubuntu:24.04"]?.start?.length).toBe(1);
    });
  });

  it("walks a VM through Prepare disk → Boot → Connect agent → Ready", async () => {
    const { events, sessions, config } = await harness();
    const template = config.templates.find((t) => t.os === "ubuntu") ?? config.templates[0]!;
    const session = await sessions.create({
      os: template.os,
      templateId: template.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "vm",
      startVm: true,
    });
    const done = await waitDone(events, session.id);
    expect(done.kind).toBe("vm");
    expect(done.steps.map((s) => s.id)).toEqual(["disk", "boot", "connect", "ready"]);
    expect(done.steps.every((s) => s.state === "done" || s.state === "skipped")).toBe(true);
    expect(done.steps.find((s) => s.id === "connect")?.state).toBe("done");
  });

  it("walks a Host worktree through Create worktree → Install → Ready", async () => {
    const { events, sessions, config } = await harness();
    const source = await mkdtemp(join(tmpdir(), "locus-boot-wt-"));
    cleanup.push(source);
    await git(source, "init", "-q", "-b", "main");
    await writeFile(join(source, "app.ts"), "export const x = 1;\n");
    await mkdir(join(source, ".locus"));
    await writeFile(
      join(source, ".locus", "worktree.json"),
      JSON.stringify({ setup: "echo ok > setup.txt" }),
    );
    await git(source, "add", "-A");
    await git(source, "commit", "-qm", "init");
    const session = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "host",
      startVm: false,
      hostDir: source,
      worktree: true,
    });
    const done = await waitDone(events, session.id);
    expect(done.kind).toBe("host");
    expect(done.error).toBeUndefined();
    expect(done.steps.map((s) => [s.id, s.state])).toEqual([
      ["worktree", "done"],
      ["setup", "done"],
      ["ready", "done"],
    ]);
    await sessions.remove(session.id);
  });
});
