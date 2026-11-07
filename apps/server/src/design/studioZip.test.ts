import { describe, expect, it } from "vitest";
import type { AgentSession } from "@locus/shared";
import { collectStudioZipFiles, packStudioZip, studioZipKind } from "./studioZip.js";

const game = {
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
} as AgentSession;

describe("studioZip", () => {
  it("classifies Games vs Assets vs Design", () => {
    expect(studioZipKind(game)).toBe("game");
    expect(studioZipKind({ ...game, kind: "assets" })).toBe("asset");
    expect(studioZipKind({ ...game, kind: "design" })).toBeUndefined();
  });

  it("packs a Game brief, PWA shell, and RELEASE notes", async () => {
    const files = await collectStudioZipFiles({
      sessionId: "g1",
      session: game,
      html: "<html><body>Score 0</body></html>",
      promoteBrief: () => "# Arcade\n",
      workspace: {
        readWorkspace: async (_id, rel) => {
          if (rel === "GAME.md") return { content: "# Arcade\n" };
          throw new Error("missing");
        },
        readWorkspaceRaw: async () => {
          throw new Error("missing");
        },
        listWorkspace: async () => ({ entries: [] }),
      },
    });
    expect(String(files["index.html"])).toContain("Score 0");
    expect(String(files["index.html"])).toContain("data-locus-game-feel");
    expect(String(files["index.html"])).toContain("data-locus-game-pwa");
    expect(files["GAME.md"]).toBe("# Arcade");
    expect(String(files["RELEASE.md"])).toContain("Release check");
    const pack = packStudioZip(files, game.title, "game");
    expect(pack.filename).toBe("Arcade.zip");
    expect(pack.zipBase64.length).toBeGreaterThan(20);
  });

  it("rejects oversized packs", () => {
    expect(() =>
      packStudioZip({ huge: Buffer.alloc(65 * 1024 * 1024) }, "too-big", "game"),
    ).toThrow(/too large/);
  });
});
