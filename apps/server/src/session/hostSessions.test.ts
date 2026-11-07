import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dockerWorkspaceDir, hostWorkspaceDir, MockHypervisor } from "@locus/hypervisor";
import type { ToolRequest } from "@locus/guest-agent";
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

describe("host_sessions", () => {
  it("lists, reads, greps, and copies peer host workspaces", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-peers-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const hub = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      title: "Hub",
    });
    const game = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "game",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      title: "Arcade",
    });
    const asset = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "assets",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      title: "Knight",
    });
    const gameRoot = hostWorkspaceDir(dir, game.id);
    const assetRoot = hostWorkspaceDir(dir, asset.id);
    await mkdir(join(gameRoot, "vendor", "assets", "knight"), { recursive: true });
    await writeFile(join(gameRoot, "GAME.md"), "# Arcade\n\nDodge rocks.\n");
    await writeFile(join(gameRoot, "index.html"), "<html><body>play</body></html>\n");
    await writeFile(join(gameRoot, "vendor", "assets", "knight", "sprite.png"), "png");
    await writeFile(join(assetRoot, "ASSET.md"), "# Knight\n\nA sprite.\n");
    await writeFile(join(assetRoot, ".env"), "SECRET=1\n");

    const listed = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "list" },
    } as unknown as ToolRequest);
    expect(listed.ok).toBe(true);
    expect(listed.output).toMatch(/@game:arcade/);
    expect(listed.output).toMatch(/GAME.md/);
    expect(listed.output).toMatch(/@asset:knight/);
    expect(listed.output).toMatch(/Dodge rocks/);

    const games = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "list", query: "game" },
    } as unknown as ToolRequest);
    expect(games.output).toMatch(/@game:arcade/);
    expect(games.output).not.toMatch(/@asset:knight/);

    const read = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "read", session: "@game:arcade", path: "GAME.md" },
    } as unknown as ToolRequest);
    expect(read.ok).toBe(true);
    expect(read.output).toContain("Dodge rocks");

    const grepped = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "grep", session: "arcade", pattern: "Dodge" },
    } as unknown as ToolRequest);
    expect(grepped.ok).toBe(true);
    expect(grepped.output).toMatch(/GAME.md/);

    await writeFile(join(assetRoot, "credentials.json"), '{"token":"secret-token-value"}\n');
    const envGrep = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "grep", session: asset.id, path: ".env", pattern: "SECRET" },
    } as unknown as ToolRequest);
    expect(envGrep.ok).toBe(false);
    expect(envGrep.output).toMatch(/credential/i);
    const secretGrep = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "grep", session: asset.id, pattern: "secret-token-value" },
    } as unknown as ToolRequest);
    expect(secretGrep.ok).toBe(true);
    expect(secretGrep.output).not.toMatch(/secret-token-value/);
    expect(secretGrep.output).not.toMatch(/credentials\.json/);

    const copied = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "copy", session: game.id, path: "index.html" },
    } as unknown as ToolRequest);
    expect(copied.ok).toBe(true);
    expect(copied.output).toMatch(/peers\/arcade\/index.html/);
    const hubFile = await sessions.executeTool(hub.id, {
      name: "file_read",
      args: { path: "/workspace/peers/arcade/index.html" },
    } as unknown as ToolRequest);
    expect(hubFile.ok).toBe(true);
    expect(hubFile.output).toContain("play");

    const secret = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "read", session: asset.id, path: ".env" },
    } as unknown as ToolRequest);
    expect(secret.ok).toBe(false);
    expect(secret.output).toMatch(/credential/i);

    hypervisor.shutdown();
  });

  it("refuses host_sessions on docker agents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-peers-docker-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const docker = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const result = await sessions.executeTool(docker.id, {
      name: "host_sessions",
      args: { action: "list" },
    } as unknown as ToolRequest);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/only available on host agents/i);
    hypervisor.shutdown();
  });

  it("lets a host agent read a docker game workspace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-peers-docker-game-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const hub = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      title: "Hub",
    });
    const game = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "game",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      title: "Arcade",
    });
    const gameRoot = dockerWorkspaceDir(dir, game.id);
    await mkdir(gameRoot, { recursive: true });
    await writeFile(join(gameRoot, "GAME.md"), "# Arcade\n\nDocker game.\n");
    const listed = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "list", query: "game" },
    } as unknown as ToolRequest);
    expect(listed.ok).toBe(true);
    expect(listed.output).toMatch(/@game:arcade/);
    expect(listed.output).toMatch(/Docker game/);
    const read = await sessions.executeTool(hub.id, {
      name: "host_sessions",
      args: { action: "read", session: "@game:arcade", path: "GAME.md" },
    } as unknown as ToolRequest);
    expect(read.ok).toBe(true);
    expect(read.output).toContain("Docker game");
    hypervisor.shutdown();
  });
});
