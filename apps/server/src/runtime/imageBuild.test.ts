import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockDockerEngine, MockHypervisor } from "@locus/hypervisor";
import type { ClientEvent, ImageBuildProgress, VmInstance } from "@locus/shared";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

let cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(
    cleanup.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)),
  );
  cleanup = [];
});

class BuildDocker extends MockDockerEngine {
  override async start(id: string): Promise<VmInstance> {
    this.emit("build", id, { percent: 0, phase: "Starting" } satisfies ImageBuildProgress);
    this.emit("build", id, {
      percent: 30,
      phase: "RUN apt-get update",
      step: 2,
      total: 6,
    } satisfies ImageBuildProgress);
    this.emit("build", id, {
      percent: 100,
      phase: "Done",
      done: true,
    } satisfies ImageBuildProgress);
    return super.start(id);
  }
}

describe("image build chat card", () => {
  it("posts Building, streams progress, then Built", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-image-build-"));
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
    const docker = new BuildDocker(dir);
    const sessions = new SessionService(
      store,
      new MockHypervisor(dir),
      hub,
      undefined,
      undefined,
      docker,
    );
    const config = await store.loadConfig();
    const session = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "docker",
      dockerImage: "locus/agent",
      startVm: true,
      kind: "design",
    });

    const deadline = Date.now() + 2000;
    let fresh = await sessions.get(session.id);
    while (Date.now() < deadline) {
      const notes = fresh?.messages.filter((m) => m.role === "system").map((m) => m.content) ?? [];
      if (
        notes.some((row) => row.startsWith("Building ")) &&
        notes.some((row) => row.startsWith("Built "))
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
      fresh = await sessions.get(session.id);
    }
    const notes = fresh?.messages.filter((m) => m.role === "system").map((m) => m.content) ?? [];
    expect(notes.some((row) => /Building locus\/agent/.test(row))).toBe(true);
    expect(notes.some((row) => /Built locus\/agent/.test(row))).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "image.progress" &&
          event.phase === "RUN apt-get update" &&
          event.percent === 30,
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === "image.progress" && event.clear === true)).toBe(
      true,
    );
  });
});
