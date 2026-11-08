import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadRepoSkills,
  loadWorkspaceEnvironment,
  loadWorkspaceMemories,
  loadWorkspaceMemoryRows,
  loadWorkspaceRules,
  saveWorkspaceMemories,
} from "./workspaceMeta.js";

describe("workspace metadata", () => {
  it("loads a Dev Container file when Locus and Cursor environment.json are missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-devcontainer-"));
    await mkdir(join(dir, ".devcontainer"), { recursive: true });
    await writeFile(
      join(dir, ".devcontainer", "devcontainer.json"),
      `{
        // JSONC
        "image": "node:22-bookworm",
        "postCreateCommand": "npm ci",
        "forwardPorts": [5173,],
        "containerEnv": { "NODE_ENV": "development" },
      }`,
    );
    const env = await loadWorkspaceEnvironment(dir);
    expect(env?.image).toBe("node:22-bookworm");
    expect(env?.install).toBe("npm ci");
    expect(env?.ports).toEqual([5173]);
    expect(env?.env).toEqual({ NODE_ENV: "development" });
  });

  it("prefers .locus/environment.json over a Dev Container", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-pref-"));
    await mkdir(join(dir, ".locus"), { recursive: true });
    await mkdir(join(dir, ".devcontainer"), { recursive: true });
    await writeFile(
      join(dir, ".locus", "environment.json"),
      JSON.stringify({ install: "from-locus" }),
    );
    await writeFile(
      join(dir, ".devcontainer", "devcontainer.json"),
      JSON.stringify({ postCreateCommand: "from-devcontainer" }),
    );
    expect((await loadWorkspaceEnvironment(dir))?.install).toBe("from-locus");
  });

  it("loads a Cursor environment.json when .locus is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-cursor-"));
    await mkdir(join(dir, ".cursor"), { recursive: true });
    await writeFile(
      join(dir, ".cursor", "environment.json"),
      JSON.stringify({
        install: "npm ci",
        terminals: [{ name: "web", command: "npm run dev -- --host 0.0.0.0" }],
      }),
    );
    const env = await loadWorkspaceEnvironment(dir);
    expect(env?.install).toBe("npm ci");
    expect(env?.start).toBe("npm run dev -- --host 0.0.0.0");
  });

  it("loads repo skills, environment.json, and memory.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-"));
    await mkdir(join(dir, ".locus", "skills"), { recursive: true });
    await writeFile(
      join(dir, ".locus", "skills", "review.md"),
      "---\ntitle: Review\n---\nRead the diff.\n",
    );
    await writeFile(
      join(dir, ".locus", "environment.json"),
      JSON.stringify({ packages: ["git"], ports: [5173], start: "npm run dev" }),
    );
    await writeFile(join(dir, ".locus", "memory.md"), "The app uses Vite.");
    const skills = await loadRepoSkills(dir);
    expect(skills[0]?.name).toBe("review");
    expect(skills[0]?.title).toBe("Review");
    const env = await loadWorkspaceEnvironment(dir);
    expect(env?.packages).toEqual(["git"]);
    expect(env?.ports).toEqual([5173]);
    expect(await loadWorkspaceMemories(dir)).toMatch(/Vite/);
  });

  it("loads Locus.md as guiding context before AGENTS.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-rules-"));
    await writeFile(join(dir, "Locus.md"), "Prefer Host runtime for trusted local work.\n");
    await writeFile(join(dir, "AGENTS.md"), "Never commit secrets.\n");
    const rules = await loadWorkspaceRules(dir);
    expect(rules).toMatch(/Locus\.md:\nPrefer Host runtime/);
    expect(rules).toMatch(/AGENTS\.md:\nNever commit secrets/);
    expect(rules.indexOf("Locus.md")).toBeLessThan(rules.indexOf("AGENTS.md"));
  });

  it("skips a missing Locus.md and still loads other rule files", async () => {
    expect(await loadWorkspaceRules()).toBe("");
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-agents-"));
    await writeFile(join(dir, "CLAUDE.md"), "Use bun for scripts.\n");
    expect(await loadWorkspaceRules(dir)).toBe("CLAUDE.md:\nUse bun for scripts.");
  });

  it("caps combined rule files at the char budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-budget-"));
    await writeFile(join(dir, "Locus.md"), `${"A".repeat(3_500)}\n`);
    await writeFile(join(dir, "AGENTS.md"), `${"B".repeat(2_000)}\n`);
    const rules = await loadWorkspaceRules(dir);
    expect(rules).toMatch(/^Locus\.md:\nA{3500}/);
    expect(rules).toMatch(/AGENTS\.md:\nB{500}$/);
    expect(rules).not.toMatch(/B{501}/);
  });

  it("saves JSON facts and merges them with memory.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-meta-mem-"));
    await mkdir(join(dir, ".locus"), { recursive: true });
    await writeFile(join(dir, ".locus", "memory.md"), "The app uses Vite.");
    await saveWorkspaceMemories(dir, [
      { id: "m1", text: "Default branch is main", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(await loadWorkspaceMemoryRows(dir)).toEqual([
      expect.objectContaining({ id: "m1", text: "Default branch is main" }),
    ]);
    const prompt = await loadWorkspaceMemories(dir);
    expect(prompt).toMatch(/Vite/);
    expect(prompt).toMatch(/Default branch is main/);
  });
});
