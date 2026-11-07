import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOARD_CHAT_TOOLS,
  BOARD_PLAYBOOK,
  DESIGN_PLAYBOOK,
  DESIGN_TOOLS,
  GAME_PLAYBOOK,
  GAME_TOOLS,
  ASSET_PLAYBOOK,
  ASSET_TOOLS,
  ASSET_BUILD_DEFAULTS,
  PROJECT_CHAT_TOOLS,
  PROJECT_PLAYBOOK,
} from "@locus/shared";
import type { CreateSessionInput } from "@locus/shared";
import { JsonStore } from "../core/store.js";
import { persistSessionKind, prepareCreateInput, sessionCreateBase } from "./sessionCreate.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function ctx() {
  const dir = await mkdtemp(join(tmpdir(), "locus-create-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  return {
    config,
    repos: await store.loadRepos(),
    designSystems: await store.loadDesignSystems(),
    input: {
      os: "ubuntu" as const,
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel ?? "mock",
      startVm: false,
    } satisfies CreateSessionInput,
  };
}

describe("prepareCreateInput", () => {
  it("defaults Design to Docker with the design playbook and tools", async () => {
    const { input, ...rest } = await ctx();
    const prep = prepareCreateInput({ ...input, kind: "design" }, rest);
    expect(prep.runtime).toBe("docker");
    expect(prep.input.playbook).toBe(DESIGN_PLAYBOOK);
    expect(prep.input.allowedTools).toEqual(DESIGN_TOOLS);
    expect(prep.input.vision).toBe("off");
  });

  it("allows Design on Host and rejects Design on a VM", async () => {
    const { input, ...rest } = await ctx();
    const host = prepareCreateInput({ ...input, kind: "design", runtime: "host" }, rest);
    expect(host.runtime).toBe("host");
    expect(host.input.dockerImage).toBeUndefined();
    expect(host.input.playbook).toBe(DESIGN_PLAYBOOK);
    expect(host.input.allowedTools).toEqual(DESIGN_TOOLS);
    expect(() => prepareCreateInput({ ...input, kind: "design", runtime: "vm" }, rest)).toThrow(
      /Design sessions run on Host or Docker/,
    );
  });

  it("defaults Games to Docker with the game playbook and tools", async () => {
    const { input, ...rest } = await ctx();
    const prep = prepareCreateInput({ ...input, kind: "game" }, rest);
    expect(prep.runtime).toBe("docker");
    expect(prep.input.kind).toBe("game");
    expect(prep.input.playbook).toBe(GAME_PLAYBOOK);
    expect(prep.input.allowedTools).toEqual(GAME_TOOLS);
    expect(prep.input.vision).toBe("off");
    expect(() => prepareCreateInput({ ...input, kind: "game", runtime: "vm" }, rest)).toThrow(
      /Game sessions run on Host or Docker/,
    );
    const host = prepareCreateInput({ ...input, kind: "game", runtime: "host" }, rest);
    expect(host.runtime).toBe("host");
    expect(host.input.allowedTools).toEqual(GAME_TOOLS.filter((name) => name !== "record_screen"));
    const withAssets = prepareCreateInput(
      { ...input, kind: "game", assetIds: ["as1", "as1", " as2 "] },
      rest,
    );
    expect(withAssets.input.assetIds).toEqual(["as1", "as2"]);
    expect(
      prepareCreateInput({ ...input, kind: "design", assetIds: ["as1"] }, rest).input.assetIds,
    ).toBeUndefined();
  });

  it("defaults Assets to Docker with build settings", async () => {
    const { input, ...rest } = await ctx();
    const prep = prepareCreateInput({ ...input, kind: "assets" }, rest);
    expect(prep.runtime).toBe("docker");
    expect(prep.input.playbook).toBe(ASSET_PLAYBOOK);
    expect(prep.input.allowedTools).toEqual(ASSET_TOOLS);
    expect(prep.input.assetBuild).toEqual(ASSET_BUILD_DEFAULTS);
    const custom = prepareCreateInput(
      {
        ...input,
        kind: "assets",
        assetBuild: {
          topology: "high-detail",
          quality: "flagship",
          resolution: "4x",
          restPose: "t-pose",
          polyBudget: "20k",
          texture: false,
          split: true,
          multiView: true,
          enhance: false,
          printable: true,
        },
      },
      rest,
    );
    expect(custom.input.assetBuild).toMatchObject({
      topology: "high-detail",
      quality: "flagship",
      printable: true,
      restPose: "t-pose",
    });
  });

  it("rejects Review on Host and forces IDE onto Host", async () => {
    const { input, ...rest } = await ctx();
    expect(() => prepareCreateInput({ ...input, kind: "review", runtime: "host" }, rest)).toThrow(
      /PR reviews run in a VM or Docker container/,
    );
    const ide = prepareCreateInput({ ...input, kind: "ide" }, rest);
    expect(ide.runtime).toBe("host");
    expect(ide.input.startVm).toBe(false);
  });

  it("gives Board and Project host chat their playbooks and tools", async () => {
    const { input, ...rest } = await ctx();
    const board = prepareCreateInput({ ...input, kind: "board" }, rest);
    expect(board.runtime).toBe("host");
    expect(board.input.playbook).toBe(BOARD_PLAYBOOK);
    expect(board.input.allowedTools).toEqual(BOARD_CHAT_TOOLS);
    const project = prepareCreateInput({ ...input, kind: "project" }, rest);
    expect(project.runtime).toBe("host");
    expect(project.input.playbook).toBe(PROJECT_PLAYBOOK);
    expect(project.input.allowedTools).toEqual(PROJECT_CHAT_TOOLS);
  });

  it("rejects a worker placement without a token", async () => {
    const { input, config, repos, designSystems } = await ctx();
    config.workers = [{ id: "w1", name: "Box", url: "https://worker.example", token: "" }];
    expect(() =>
      prepareCreateInput(
        {
          ...input,
          runtime: "docker",
          dockerImage: "locus/agent",
          placement: "worker",
          backendId: "w1",
        },
        { config, repos, designSystems },
      ),
    ).toThrow(/Add a worker token/);
  });
});

describe("persistSessionKind / sessionCreateBase", () => {
  it("omits agent kind, fills shared fields, and keeps persona", () => {
    expect(persistSessionKind("agent")).toBeUndefined();
    expect(persistSessionKind("design")).toBe("design");
    const row = sessionCreateBase(
      {
        os: "ubuntu",
        templateId: "t1",
        providerId: "p1",
        model: "m1",
        startVm: false,
        webSearch: true,
        persona: { displayName: "Nova", hubRole: "Builder" },
      },
      {
        id: "s1",
        now: "2026-09-21T00:00:00.000Z",
        os: "ubuntu",
        templateId: "t1",
        kind: "design",
        runtime: "docker",
        vision: "off",
        status: "draft",
        titleRuntime: "docker",
        dockerImage: "locus/agent",
        surface: "swarm",
      },
    );
    expect(row).toMatchObject({
      id: "s1",
      kind: "design",
      runtime: "docker",
      providerId: "p1",
      webSearch: true,
      status: "draft",
      messages: [],
      surface: "swarm",
      persona: { displayName: "Nova", hubRole: "Builder" },
    });
  });

  it("seeds assetAppliedBuild from the create-time build so Generate starts clean", () => {
    const row = sessionCreateBase(
      {
        os: "ubuntu",
        templateId: "t1",
        providerId: "p1",
        model: "m1",
        startVm: false,
      },
      {
        id: "a1",
        now: "2026-09-21T00:00:00.000Z",
        os: "ubuntu",
        templateId: "t1",
        kind: "assets",
        runtime: "docker",
        vision: "off",
        status: "draft",
        assetBuild: { ...ASSET_BUILD_DEFAULTS, printable: true },
      },
    );
    expect(row.assetBuild).toMatchObject({ printable: true });
    expect(row.assetAppliedBuild).toEqual(row.assetBuild);
  });

  it("persists branchLock when create requests it", () => {
    const row = sessionCreateBase(
      {
        os: "ubuntu",
        templateId: "t1",
        providerId: "p1",
        model: "m1",
        startVm: false,
        branchLock: true,
      },
      {
        id: "s2",
        now: "2026-09-21T00:00:00.000Z",
        os: "ubuntu",
        templateId: "t1",
        kind: "agent",
        status: "draft",
      },
    );
    expect(row.branchLock).toBe(true);
  });
});
