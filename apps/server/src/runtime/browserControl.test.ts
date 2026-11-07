import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockDockerEngine, MockHypervisor } from "@locus/hypervisor";
import { OPERATOR_HAS_BROWSER } from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function setupDocker() {
  const dir = await mkdtemp(join(tmpdir(), "locus-browser-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const docker = new MockDockerEngine(dir);
  const sessions = new SessionService(store, hypervisor, new Hub(), undefined, undefined, docker);
  const config = await store.loadConfig();
  const app = createApp({ store, sessions, hypervisor });
  const created = await sessions.create({
    os: "ubuntu",
    templateId: config.templates[0]!.id,
    runtime: "docker",
    dockerImage: "node:22-bookworm",
    providerId: config.providers[0]!.id,
    model: config.providers[0]!.defaultModel,
    startVm: true,
  });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const vm = created.vmId ? sessions.getMachine(created.vmId) : undefined;
    if (vm && (vm.status === "ready" || vm.status === "running")) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { dir, store, sessions, app, created };
}

describe("browser takeover", () => {
  it("locks CDP Input without aborting chat or guest takeover", async () => {
    const { sessions, created, app } = await setupDocker();
    const click = await sessions.executeTool(created.id, {
      name: "mouse_click",
      args: { x: 10, y: 10 },
    });
    expect(click.ok).toBe(true);

    const taken = await app.request(`/api/sessions/${created.id}/browser/takeover`, {
      method: "POST",
    });
    expect(taken.status).toBe(200);
    const human = (await taken.json()) as {
      browserControl?: string;
      control?: string;
      status: string;
    };
    expect(human.browserControl).toBe("human");
    expect(human.control).toBeUndefined();
    expect(human.status).not.toBe("running");

    const parked = await sessions.executeTool(created.id, {
      name: "mouse_click",
      args: { x: 10, y: 10 },
    });
    expect(parked.ok).toBe(false);
    expect(parked.output).toBe(OPERATOR_HAS_BROWSER);

    const shot = await sessions.executeTool(created.id, { name: "screenshot", args: {} });
    expect(shot.ok).toBe(true);
    const snap = await sessions.executeTool(created.id, { name: "browser_snapshot", args: {} });
    expect(snap.ok).toBe(true);
    expect(snap.output).toContain("@e1");
    const parkedClick = await sessions.executeTool(created.id, {
      name: "browser_click",
      args: { ref: "@e1" },
    });
    expect(parkedClick.ok).toBe(false);
    expect(parkedClick.output).toBe(OPERATOR_HAS_BROWSER);

    const wrote = await sessions.executeTool(created.id, {
      name: "file_write",
      args: { path: "note.txt", content: "ok" },
    });
    expect(wrote.ok).toBe(true);

    const back = await app.request(`/api/sessions/${created.id}/browser/handback`, {
      method: "POST",
    });
    expect(((await back.json()) as { browserControl?: string }).browserControl).toBeUndefined();
    const again = await sessions.executeTool(created.id, {
      name: "mouse_click",
      args: { x: 10, y: 10 },
    });
    expect(again.ok).toBe(true);
  });

  it("does not change guest control when taking over the browser", async () => {
    const { sessions, created } = await setupDocker();
    await sessions.takeoverBrowser(created.id);
    const session = await sessions.get(created.id);
    expect(session?.browserControl).toBe("human");
    expect(session?.control).toBeUndefined();
    await sessions.takeover(created.id);
    const guest = await sessions.get(created.id);
    expect(guest?.control).toBe("human");
    expect(guest?.browserControl).toBe("human");
  });

  it("wipes the Chromium profile directory when the session is deleted", async () => {
    const { dir, sessions, created } = await setupDocker();
    const profile = join(dir, "docker-workspaces", created.id, ".locus-chrome", "Default");
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "Cookies"), "secret");
    await sessions.remove(created.id);
    await expect(readFile(join(profile, "Cookies"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
