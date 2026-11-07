import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const LOCUS_MCP_SERVER_NAME = "locus";
export const LOCUS_CLAUDE_MCP_REL = ".mcp.json";
export const LOCUS_KIRO_MCP_REL = ".kiro/settings/mcp.json";
export const LOCUS_CURSOR_GIT_EXCLUDES = [
  ".cursor/mcp.json",
  ".cursor/rules/locus.mdc",
  ".mcp.json",
  ".kiro/settings/mcp.json",
] as const;

/** Loopback URL for Cursor CLI on this machine. Worker `agent` must not use this — 127.0.0.1 there is the worker host. */
export function controlPlaneMcpUrl(bindPort?: number): string {
  const raw = Number(process.env.PORT ?? bindPort ?? 7420);
  const port = Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : 7420;
  return `http://127.0.0.1:${port}/mcp`;
}

export function controlPlaneMcpSessionUrl(sessionId: string, bindPort?: number): string {
  return `${controlPlaneMcpUrl(bindPort)}/sessions/${encodeURIComponent(sessionId)}`;
}

function mcpServersOf(existing: unknown): Record<string, unknown> {
  if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    (existing as { mcpServers?: unknown }).mcpServers &&
    typeof (existing as { mcpServers?: unknown }).mcpServers === "object" &&
    !Array.isArray((existing as { mcpServers: unknown }).mcpServers)
  ) {
    return { ...(existing as { mcpServers: Record<string, unknown> }).mcpServers };
  }
  return {};
}

export function mergeLocusMcpJson(
  existing: unknown,
  url: string,
): { mcpServers: Record<string, unknown> } {
  const servers = mcpServersOf(existing);
  servers[LOCUS_MCP_SERVER_NAME] = { url };
  return { mcpServers: servers };
}

/** Claude Code project MCP (`type: http`). Cursor keeps `{ url }` in `.cursor/mcp.json`. */
export function mergeClaudeMcpJson(
  existing: unknown,
  url: string,
): { mcpServers: Record<string, unknown> } {
  const servers = mcpServersOf(existing);
  servers[LOCUS_MCP_SERVER_NAME] = { type: "http", url };
  return { mcpServers: servers };
}

export async function writeLocusCursorMcpConfig(input: {
  dataDir: string;
  workspace?: string;
  url: string;
  workspaceUrl?: string;
}): Promise<string[]> {
  const written: string[] = [];
  const dataFile = join(input.dataDir, ".cursor", "mcp.json");
  await writeMcpJson(dataFile, input.url, true);
  written.push(dataFile);
  if (input.workspace) {
    const workspaceFile = join(input.workspace, ".cursor", "mcp.json");
    const wroteWorkspace = await writeMcpJson(
      workspaceFile,
      input.workspaceUrl ?? input.url,
      false,
    );
    if (wroteWorkspace) {
      written.push(workspaceFile);
      await excludeLocusCursorWorkspaceFiles(input.workspace);
    }
  }
  return written;
}

export async function writeLocusClaudeMcpConfig(input: {
  workspace: string;
  url: string;
}): Promise<string | undefined> {
  const workspaceFile = join(input.workspace, LOCUS_CLAUDE_MCP_REL);
  const wroteWorkspace = await writeMcpJson(workspaceFile, input.url, true, mergeClaudeMcpJson);
  if (wroteWorkspace) {
    await excludeLocusCursorWorkspaceFiles(input.workspace);
    return workspaceFile;
  }
  return undefined;
}

export function mergeKiroMcpJson(
  existing: unknown,
  url: string,
): { mcpServers: Record<string, unknown> } {
  const servers = mcpServersOf(existing);
  servers[LOCUS_MCP_SERVER_NAME] = { url, autoApprove: ["*"] };
  return { mcpServers: servers };
}

export async function writeLocusKiroMcpConfig(input: {
  workspace: string;
  url: string;
}): Promise<string | undefined> {
  const workspaceFile = join(input.workspace, LOCUS_KIRO_MCP_REL);
  const wroteWorkspace = await writeMcpJson(workspaceFile, input.url, true, mergeKiroMcpJson);
  if (wroteWorkspace) {
    await excludeLocusCursorWorkspaceFiles(input.workspace);
    return workspaceFile;
  }
  return undefined;
}

async function writeMcpJson(
  file: string,
  url: string,
  overwriteInvalid: boolean,
  merge: (
    existing: unknown,
    url: string,
  ) => { mcpServers: Record<string, unknown> } = mergeLocusMcpJson,
): Promise<boolean> {
  await mkdir(dirname(file), { recursive: true });
  let existing: unknown;
  try {
    existing = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (err) {
    const missing = isMissingFile(err);
    if (!missing && !overwriteInvalid) return false;
    existing = undefined;
  }
  const next = merge(existing, url);
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  try {
    if ((await readFile(file, "utf8")) === nextText) return true;
  } catch {
    /* missing or unreadable */
  }
  await writeFile(file, nextText);
  return true;
}

export async function excludeLocusCursorWorkspaceFiles(workspace: string): Promise<void> {
  const gitDir = join(workspace, ".git");
  try {
    await stat(gitDir);
  } catch {
    return;
  }
  const exclude = join(gitDir, "info", "exclude");
  try {
    await mkdir(dirname(exclude), { recursive: true });
    let text = "";
    try {
      text = await readFile(exclude, "utf8");
    } catch {
      /* new exclude file */
    }
    let next = text;
    for (const rel of LOCUS_CURSOR_GIT_EXCLUDES) {
      const pattern = new RegExp(`(^|\\n)${rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\n|$)`);
      if (pattern.test(next)) continue;
      const prefix = next && !next.endsWith("\n") ? "\n" : "";
      next = `${next}${prefix}${rel}\n`;
    }
    if (next !== text) await writeFile(exclude, next);
  } catch {
    /* ignore */
  }
}

function isMissingFile(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "ENOENT");
}
