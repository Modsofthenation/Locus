import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  controlPlaneMcpUrl,
  controlPlaneMcpSessionUrl,
  mergeClaudeMcpJson,
  mergeLocusMcpJson,
  mergeKiroMcpJson,
  writeLocusClaudeMcpConfig,
  writeLocusKiroMcpConfig,
  writeLocusCursorMcpConfig,
} from "./cursorCliMcp.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cursor cli mcp config", () => {
  it("writes a loopback locus server without secrets and keeps other MCP servers", async () => {
    expect(controlPlaneMcpUrl(7420)).toBe("http://127.0.0.1:7420/mcp");
    expect(controlPlaneMcpSessionUrl("sess-1", 7420)).toBe(
      "http://127.0.0.1:7420/mcp/sessions/sess-1",
    );
    const merged = mergeLocusMcpJson(
      { mcpServers: { playwright: { command: "npx" } } },
      "http://127.0.0.1:7420/mcp",
    );
    expect(merged.mcpServers.playwright).toEqual({ command: "npx" });
    expect(merged.mcpServers.locus).toEqual({ url: "http://127.0.0.1:7420/mcp" });

    const dir = await mkdtemp(join(tmpdir(), "locus-cli-mcp-"));
    cleanup.push(dir);
    const workspace = join(dir, "host-workspaces", "sess-1");
    await mkdir(join(workspace, ".git"), { recursive: true });
    await mkdir(join(workspace, ".cursor"), { recursive: true });
    await writeFile(
      join(workspace, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "echo" } } }),
    );
    const written = await writeLocusCursorMcpConfig({
      dataDir: dir,
      workspace,
      url: "http://127.0.0.1:7420/mcp",
      workspaceUrl: "http://127.0.0.1:7420/mcp/sessions/sess-1",
    });
    expect(written).toContain(join(dir, ".cursor", "mcp.json"));
    expect(written).toContain(join(workspace, ".cursor", "mcp.json"));
    const project = JSON.parse(await readFile(join(workspace, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, { url?: string; command?: string }>;
    };
    expect(project.mcpServers.other).toEqual({ command: "echo" });
    expect(project.mcpServers.locus).toEqual({
      url: "http://127.0.0.1:7420/mcp/sessions/sess-1",
    });
    expect(JSON.stringify(project)).not.toMatch(/glsa_|token|secret/i);
    const exclude = await readFile(join(workspace, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".cursor/mcp.json");
    expect(exclude).toContain(".cursor/rules/locus.mdc");
    expect(exclude).toContain(".mcp.json");
  });

  it("writes Claude Code project MCP as HTTP without secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-claude-mcp-"));
    cleanup.push(dir);
    const workspace = join(dir, "host-workspaces", "sess-1");
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeFile(
      join(workspace, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "echo" } } }),
    );
    const url = "http://127.0.0.1:7420/mcp/sessions/sess-1";
    const written = await writeLocusClaudeMcpConfig({ workspace, url });
    expect(written).toBe(join(workspace, ".mcp.json"));
    const project = JSON.parse(await readFile(join(workspace, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { type?: string; url?: string; command?: string }>;
    };
    expect(project.mcpServers.other).toEqual({ command: "echo" });
    expect(project.mcpServers.locus).toEqual({ type: "http", url });
    expect(JSON.stringify(project)).not.toMatch(/glsa_|token|secret/i);
    const exclude = await readFile(join(workspace, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".mcp.json");
    expect(mergeClaudeMcpJson({}, url).mcpServers.locus).toEqual({ type: "http", url });
  });

  it("writes Kiro CLI workspace MCP without secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-kiro-mcp-"));
    cleanup.push(dir);
    const workspace = join(dir, "host-workspaces", "sess-1");
    await mkdir(join(workspace, ".git"), { recursive: true });
    await mkdir(join(workspace, ".kiro", "settings"), { recursive: true });
    await writeFile(
      join(workspace, ".kiro", "settings", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "echo" } } }),
    );
    const url = "http://127.0.0.1:7420/mcp/sessions/sess-1";
    const written = await writeLocusKiroMcpConfig({ workspace, url });
    expect(written).toBe(join(workspace, ".kiro", "settings", "mcp.json"));
    const project = JSON.parse(
      await readFile(join(workspace, ".kiro", "settings", "mcp.json"), "utf8"),
    ) as {
      mcpServers: Record<string, { url?: string; autoApprove?: string[]; command?: string }>;
    };
    expect(project.mcpServers.other).toEqual({ command: "echo" });
    expect(project.mcpServers.locus).toEqual({ url, autoApprove: ["*"] });
    expect(JSON.stringify(project)).not.toMatch(/glsa_|token|secret/i);
    const exclude = await readFile(join(workspace, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".kiro/settings/mcp.json");
    expect(mergeKiroMcpJson({}, url).mcpServers.locus).toEqual({ url, autoApprove: ["*"] });
  });

  it("does not rewrite mcp.json when the contents are unchanged", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-cli-mcp-stable-"));
    cleanup.push(dir);
    const workspace = join(dir, "ws");
    await mkdir(workspace, { recursive: true });
    const url = "http://127.0.0.1:7420/mcp";
    await writeLocusCursorMcpConfig({ dataDir: dir, workspace, url });
    const file = join(workspace, ".cursor", "mcp.json");
    const before = await stat(file);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeLocusCursorMcpConfig({ dataDir: dir, workspace, url });
    const after = await stat(file);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
