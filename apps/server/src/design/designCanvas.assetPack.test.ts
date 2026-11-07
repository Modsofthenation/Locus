import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { DesignCanvas } from "./designCanvas.js";

const game: AgentSession = {
  id: "g1",
  title: "Arcade",
  kind: "game",
  os: "ubuntu",
  templateId: "ubuntu-24.04",
  runtime: "docker",
  dockerImage: "ubuntu:24.04",
  providerId: "p",
  model: "grok-4",
  status: "idle",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

const asset: AgentSession = {
  ...game,
  id: "a1",
  title: "Knight",
  kind: "assets",
};

function canvasFor(sessions: Map<string, AgentSession>, files: Map<string, Buffer | string>) {
  const writes: string[] = [];
  const workspace = {
    readWorkspace: vi.fn(async (_id: string, rel: string) => {
      const hit = files.get(`${_id}:${rel}`);
      if (typeof hit === "string") return { path: rel, content: hit, mtime: "t" };
      throw new Error("missing");
    }),
    readWorkspaceRaw: vi.fn(async (_id: string, rel: string) => {
      const hit = files.get(`${_id}:${rel}`);
      if (Buffer.isBuffer(hit)) return { path: rel, bytes: hit };
      if (typeof hit === "string") return { path: rel, bytes: Buffer.from(hit) };
      throw new Error("missing");
    }),
    listWorkspace: vi.fn(async (id: string, rel: string) => {
      const prefix = rel && rel !== "." ? `${rel}/` : "";
      const entries = [...files.keys()]
        .filter((key) => key.startsWith(`${id}:`) && key.slice(id.length + 1).startsWith(prefix))
        .map((key) => {
          const path = key.slice(id.length + 1);
          return { name: path.split("/").pop() ?? path, path, type: "file" as const };
        });
      return { entries, changes: [] };
    }),
    writeWorkspace: vi.fn(async (id: string, rel: string, content: string) => {
      writes.push(rel);
      files.set(`${id}:${rel}`, content);
    }),
    writeWorkspaceBytes: vi.fn(async (id: string, rel: string, bytes: Buffer) => {
      writes.push(rel);
      files.set(`${id}:${rel}`, bytes);
    }),
  };
  const canvas = new DesignCanvas({
    require: async (id) => sessions.get(id) ?? game,
    get: async (id) => sessions.get(id),
    patch: async (id, body) => {
      const current = sessions.get(id) ?? game;
      const next = { ...current, ...body };
      sessions.set(id, next);
      return next;
    },
    appendMessage: async () => game,
    sendChat: async () => undefined,
    workspace: workspace as never,
    hub: { broadcast: () => undefined } as never,
    store: { loadAssetStyles: async () => [] } as never,
    isWorker: () => false,
    hostRoot: () => "/tmp",
    dataDir: "/tmp",
    create: async () => game,
    captureImage: async () => ({}) as never,
  });
  return { canvas, workspace, writes, files };
}

describe("asset packs", () => {
  it("copies source photos into .locus-asset and summarizes the pack", async () => {
    const sessions = new Map<string, AgentSession>([["a1", asset]]);
    const files = new Map<string, Buffer | string>([
      ["a1:index.html", "<html><body><img src='source.png'></body></html>"],
      ["a1:source.png", Buffer.from("png")],
    ]);
    const { canvas } = canvasFor(sessions, files);
    const pack = await canvas.buildAssetPack("a1");
    expect(pack?.slug).toBe("knight");
    expect(pack?.kind).toBe("sprite");
    expect(pack?.files.some((file) => file.name === "source.png")).toBe(true);
    expect(sessions.get("a1")?.assetPack?.slug).toBe("knight");
    expect(files.get("a1:.locus-asset/manifest.json")).toEqual(expect.stringContaining("knight"));
  });

  it("links an asset pack into a game workspace", async () => {
    const sessions = new Map<string, AgentSession>([
      ["g1", game],
      ["a1", asset],
    ]);
    const files = new Map<string, Buffer | string>([
      ["a1:index.html", "<html><body></body></html>"],
      ["a1:source.png", Buffer.from("png")],
      ["g1:GAME.md", "# Arcade\n\n## Loop\n\nPlay.\n\n## Persistence\n\nSave.\n"],
    ]);
    const { canvas } = canvasFor(sessions, files);
    await canvas.buildAssetPack("a1");
    const linked = await canvas.linkAssetPacks("g1", [{ sessionId: "a1" }]);
    expect(linked.refs).toEqual([expect.objectContaining({ sessionId: "a1", slug: "knight" })]);
    expect(files.get("g1:vendor/assets/knight/source.png")).toEqual(Buffer.from("png"));
    expect(String(files.get("g1:vendor/assets/index.json"))).toContain("knight");
    expect(String(files.get("g1:GAME.md"))).toMatch(/## Linked assets/);
    expect(linked.prompts[0]?.dir).toBe("vendor/assets/knight");
  });

  it("keeps existing linked slugs when the source asset session is gone", async () => {
    const sessions = new Map<string, AgentSession>([
      [
        "g1",
        {
          ...game,
          assetRefs: [{ sessionId: "missing", slug: "knight", title: "Knight" }],
        },
      ],
    ]);
    const { canvas } = canvasFor(sessions, new Map());
    const linked = await canvas.linkAssetPacks("g1", [{ sessionId: "missing", slug: "knight" }]);
    expect(linked.refs).toEqual([
      expect.objectContaining({ sessionId: "missing", slug: "knight", title: "Knight" }),
    ]);
    expect(sessions.get("g1")?.assetRefs).toEqual([expect.objectContaining({ slug: "knight" })]);
  });

  it("stores exported GLB bytes in the pack", async () => {
    const sessions = new Map<string, AgentSession>([["a1", asset]]);
    const files = new Map<string, Buffer | string>([
      ["a1:index.html", "<html><canvas></canvas></html>"],
    ]);
    const { canvas } = canvasFor(sessions, files);
    const pack = await canvas.ingestAssetExport("a1", {
      format: "glb",
      contentBase64: Buffer.from("glb").toString("base64"),
    });
    expect(pack.kind).toBe("mesh");
    expect(files.get("a1:.locus-asset/model.glb")).toEqual(Buffer.from("glb"));
  });
});
