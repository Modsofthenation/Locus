import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@locus/shared";
import { DesignCanvas } from "./designCanvas.js";
import { unzipTextFiles } from "../media/unzip.js";

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
  designSystemId: "pixel-pack",
  messages: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
};

describe("exportGameZip", () => {
  it("packs index.html, GAME.md, and kit vendor files", async () => {
    const workspace = {
      readWorkspace: vi.fn(async (_id: string, rel: string) => {
        if (rel === "index.html") {
          return { path: rel, content: "<html><body>Score 0</body></html>", mtime: "t" };
        }
        if (rel === "GAME.md") {
          return { path: rel, content: "# Arcade\n", mtime: "t" };
        }
        throw new Error("missing");
      }),
      readWorkspaceRaw: vi.fn(),
      listWorkspace: vi.fn(async () => ({
        entries: [{ name: "sfx.js", path: "vendor/sfx.js", type: "file" as const }],
        changes: [],
      })),
      writeWorkspace: vi.fn(),
    };
    const canvas = new DesignCanvas({
      require: async () => game,
      get: async () => game,
      patch: async () => game,
      appendMessage: async () => game,
      sendChat: async () => undefined,
      workspace: workspace as never,
      hub: { broadcast: () => undefined } as never,
      store: {} as never,
      isWorker: () => false,
      hostRoot: () => "/tmp",
      dataDir: "/tmp",
      create: async () => game,
      captureImage: async () => ({}) as never,
    });
    const pack = await canvas.exportGameZip("g1");
    expect(pack.filename).toBe("Arcade.zip");
    const zip = Buffer.from(pack.zipBase64, "base64");
    const files = unzipTextFiles(zip);
    expect(files.map((file) => file.name).sort()).toEqual([
      "GAME.md",
      "RELEASE.md",
      "index.html",
      "vendor/tokens.css",
    ]);
    expect(files.find((file) => file.name === "index.html")?.text).toContain("Score 0");
    expect(files.find((file) => file.name === "index.html")?.text).toContain(
      "data-locus-game-feel",
    );
    expect(files.find((file) => file.name === "index.html")?.text).toContain("data-locus-game-pwa");
    expect(zip.toString("binary")).toContain("manifest.webmanifest");
    expect(zip.toString("binary")).toContain("sw.js");
    expect(zip.toString("binary")).toContain(".itch.toml");
    expect(zip.toString("utf8")).toContain("Arcade");
    expect(files.find((file) => file.name === "GAME.md")?.text).toContain("# Arcade");
  });

  it("rejects Design sessions", async () => {
    const canvas = new DesignCanvas({
      require: async () => ({ ...game, kind: "design" }),
      get: async () => ({ ...game, kind: "design" }),
      patch: async () => game,
      appendMessage: async () => game,
      sendChat: async () => undefined,
      workspace: {} as never,
      hub: { broadcast: () => undefined } as never,
      store: {} as never,
      isWorker: () => false,
      hostRoot: () => "/tmp",
      dataDir: "/tmp",
      create: async () => game,
      captureImage: async () => ({}) as never,
    });
    await expect(canvas.exportGameZip("g1")).rejects.toThrow(/Games and Assets sessions/);
  });

  it("packs source photos and mesh exports for Assets", async () => {
    const asset: AgentSession = { ...game, id: "as1", title: "Hero mesh", kind: "assets" };
    const png = Buffer.from("png");
    const glb = Buffer.from("glb");
    const workspace = {
      readWorkspace: vi.fn(async (_id: string, rel: string) => {
        if (rel === "index.html") {
          return { path: rel, content: "<html><body>mesh</body></html>", mtime: "t" };
        }
        if (rel === "ASSET.md") {
          return { path: rel, content: "# Hero\n", mtime: "t" };
        }
        throw new Error("missing");
      }),
      readWorkspaceRaw: vi.fn(async (_id: string, rel: string) => {
        if (rel === "source.png") return { path: rel, bytes: png };
        if (rel === "export.glb") return { path: rel, bytes: glb };
        throw new Error("missing");
      }),
      listWorkspace: vi.fn(async (_id: string, rel: string) => {
        if (rel === ".") {
          return {
            entries: [
              { name: "source.png", path: "source.png", type: "file" as const },
              { name: "export.glb", path: "export.glb", type: "file" as const },
            ],
            changes: [],
          };
        }
        return { entries: [], changes: [] };
      }),
      writeWorkspace: vi.fn(),
    };
    const canvas = new DesignCanvas({
      require: async () => asset,
      get: async () => asset,
      patch: async () => asset,
      appendMessage: async () => asset,
      sendChat: async () => undefined,
      workspace: workspace as never,
      hub: { broadcast: () => undefined } as never,
      store: {} as never,
      isWorker: () => false,
      hostRoot: () => "/tmp",
      dataDir: "/tmp",
      create: async () => asset,
      captureImage: async () => ({}) as never,
    });
    const pack = await canvas.exportGameZip("as1");
    const zip = Buffer.from(pack.zipBase64, "base64");
    expect(zip.toString("binary")).toContain("source.png");
    expect(zip.toString("binary")).toContain("export.glb");
    const files = unzipTextFiles(zip);
    expect(files.map((file) => file.name).sort()).toEqual(["ASSET.md", "index.html"]);
    expect(workspace.readWorkspaceRaw).toHaveBeenCalledWith("as1", "source.png");
    expect(workspace.readWorkspaceRaw).toHaveBeenCalledWith("as1", "export.glb");
  });
});

describe("landGameKit", () => {
  it("does not overwrite an existing GAME.md or vendor file", async () => {
    const writes: string[] = [];
    const workspace = {
      readWorkspace: vi.fn(async (_id: string, rel: string) => {
        if (rel === "GAME.md")
          return { path: rel, content: "# Living\n\n## Loop\n\nPlay.\n", mtime: "t" };
        if (rel === "vendor/sfx.js")
          return { path: rel, content: "export function beep() {}", mtime: "t" };
        throw new Error("missing");
      }),
      readWorkspaceRaw: vi.fn(async () => {
        throw new Error("missing");
      }),
      listWorkspace: vi.fn(),
      writeWorkspace: vi.fn(async (_id: string, rel: string) => {
        writes.push(rel);
      }),
    };
    const canvas = new DesignCanvas({
      require: async () => game,
      get: async () => game,
      patch: async () => game,
      appendMessage: async () => game,
      sendChat: async () => undefined,
      workspace: workspace as never,
      hub: { broadcast: () => undefined } as never,
      store: {} as never,
      isWorker: () => false,
      hostRoot: () => "/tmp",
      dataDir: "/tmp",
      create: async () => game,
      captureImage: async () => ({}) as never,
    });
    await canvas.landGameKit("g1", "pixel-pack");
    expect(writes).toContain("vendor/tokens.css");
    expect(writes).not.toContain("GAME.md");
    expect(writes).not.toContain("vendor/sfx.js");
  });

  it("retries a failed kit write then lands", async () => {
    const attempts = new Map<string, number>();
    const writes: string[] = [];
    const workspace = {
      readWorkspace: vi.fn(async () => {
        throw new Error("missing");
      }),
      readWorkspaceRaw: vi.fn(async () => {
        throw new Error("missing");
      }),
      listWorkspace: vi.fn(),
      writeWorkspace: vi.fn(async (_id: string, rel: string) => {
        const n = (attempts.get(rel) ?? 0) + 1;
        attempts.set(rel, n);
        if (n === 1) throw new Error("guest not ready");
        writes.push(rel);
      }),
    };
    const canvas = new DesignCanvas({
      require: async () => game,
      get: async () => game,
      patch: async () => game,
      appendMessage: async () => game,
      sendChat: async () => undefined,
      workspace: workspace as never,
      hub: { broadcast: () => undefined } as never,
      store: {} as never,
      isWorker: () => false,
      hostRoot: () => "/tmp",
      dataDir: "/tmp",
      create: async () => game,
      captureImage: async () => ({}) as never,
    });
    await canvas.landGameKit("g1", "pixel-pack");
    expect(writes).toContain("vendor/tokens.css");
    expect(writes).toContain("GAME.md");
  });

  it("throws after a kit write fails twice", async () => {
    const workspace = {
      readWorkspace: vi.fn(async () => {
        throw new Error("missing");
      }),
      readWorkspaceRaw: vi.fn(async () => {
        throw new Error("missing");
      }),
      listWorkspace: vi.fn(),
      writeWorkspace: vi.fn(async () => {
        throw new Error("EIO");
      }),
    };
    const canvas = new DesignCanvas({
      require: async () => game,
      get: async () => game,
      patch: async () => game,
      appendMessage: async () => game,
      sendChat: async () => undefined,
      workspace: workspace as never,
      hub: { broadcast: () => undefined } as never,
      store: {} as never,
      isWorker: () => false,
      hostRoot: () => "/tmp",
      dataDir: "/tmp",
      create: async () => game,
      captureImage: async () => ({}) as never,
    });
    await expect(canvas.landGameKit("g1", "pixel-pack")).rejects.toThrow(/EIO/);
  });
});
