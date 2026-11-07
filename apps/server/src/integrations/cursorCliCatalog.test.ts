import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CURSOR_CLI_BASE_URL, type AiProvider } from "@locus/shared";
import { applyCursorCliModels, persistCursorCliModels } from "./cursorCliCatalog.js";
import { JsonStore } from "../core/store.js";

const cursor: AiProvider = {
  id: "cursor-cli",
  name: "Cursor CLI",
  kind: "cursor-cli",
  baseUrl: CURSOR_CLI_BASE_URL,
  models: ["composer-2", "auto"],
  defaultModel: "composer-2",
  enabled: true,
  extraHeaders: {},
};

describe("applyCursorCliModels", () => {
  it("keeps the default when it is still in the catalog", () => {
    const next = applyCursorCliModels(cursor, ["composer-2", "gpt-5", "auto"]);
    expect(next).toMatchObject({
      models: ["composer-2", "gpt-5", "auto"],
      defaultModel: "composer-2",
    });
  });

  it("falls back to the first listed model when the default disappeared", () => {
    const next = applyCursorCliModels(cursor, ["gpt-5", "auto"]);
    expect(next).toMatchObject({ models: ["gpt-5", "auto"], defaultModel: "gpt-5" });
  });

  it("returns nothing when the catalog is unchanged", () => {
    expect(applyCursorCliModels(cursor, ["auto", "composer-2"])).toBeUndefined();
    expect(applyCursorCliModels(cursor, [])).toBeUndefined();
  });
});

describe("persistCursorCliModels", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("writes a new Cursor CLI catalog into config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cli-models-"));
    dirs.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const row = config.providers.find((p) => p.kind === "cursor-cli")!;
    row.models = ["composer-2"];
    row.defaultModel = "composer-2";
    await store.saveConfig(config);
    const listed = ["composer-2", "gpt-5", "cursor-grok-4.6"];
    const result = await persistCursorCliModels(store, {
      listModels: async () => listed,
    });
    expect(result.changed).toBe(true);
    expect(result.models).toEqual(listed);
    const saved = await store.loadConfig();
    expect(saved.providers.find((p) => p.kind === "cursor-cli")?.models).toEqual(listed);
  });

  it("keeps a named environment saved while models are listing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cli-models-"));
    dirs.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const env = {
      id: "ebc53596-bd69-40f5-afb9-b3d3f16a3374",
      name: "acme-prod",
      runtime: "docker" as const,
      os: "ubuntu" as const,
      dockerImage: "locus/agent",
      imageId: "img-1",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const persist = persistCursorCliModels(store, {
      listModels: async () => {
        await gate;
        return ["composer-2", "gpt-5", "cursor-grok-4.6"];
      },
    });
    const config = await store.loadConfig();
    await store.saveConfig({ ...config, namedEnvironments: [env] });
    release();
    const result = await persist;
    expect(result.changed).toBe(true);
    const saved = await store.loadConfig();
    expect(saved.namedEnvironments?.[0]?.imageId).toBe("img-1");
    expect(saved.providers.find((p) => p.kind === "cursor-cli")?.models).toEqual([
      "composer-2",
      "gpt-5",
      "cursor-grok-4.6",
    ]);
  });

  it("swallows a missing agent CLI and leaves config alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cli-models-"));
    dirs.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const before = await store.loadConfig();
    const result = await persistCursorCliModels(store, {
      listModels: async () => {
        throw new Error("agent: not found");
      },
    });
    expect(result.changed).toBe(false);
    expect(await store.loadConfig()).toEqual(before);
  });
});
