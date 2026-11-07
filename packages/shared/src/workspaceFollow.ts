import { canonicalToolCall, canonicalToolName } from "./models/toolChip.js";
import { patchFilesFromTool } from "./patch.js";
import { wrapUntrusted } from "./untrusted.js";
import { workspaceRelFromToolPath } from "./workspaceChanges.js";

export type WorkspaceFollow = {
  path: string;
  line?: number;
};

const WRITE_TOOLS = new Set(["file_write", "apply_patch"]);
const READ_TOOLS = new Set(["file_read", "file_write", "apply_patch"]);

export function isWorkspaceWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(canonicalToolName(name));
}

export function workspaceRelativePath(path: string, root?: string): string {
  return workspaceRelFromToolPath(path, root);
}

export function workspaceFollowFromTool(
  name: string,
  args: Record<string, unknown> = {},
  result?: string,
  root?: string,
): WorkspaceFollow | undefined {
  const canonical = canonicalToolCall(name, args);
  if (!READ_TOOLS.has(canonical.name)) return undefined;
  if (canonical.name === "file_write" || canonical.name === "file_read") {
    const raw = typeof canonical.arguments.path === "string" ? canonical.arguments.path : "";
    const path = workspaceRelFromToolPath(raw, root);
    if (!path) return undefined;
    return { path, line: 1 };
  }
  const files = patchFilesFromTool(canonical.name, canonical.arguments, result);
  const file = files[0];
  if (!file) return undefined;
  const line = file.hunks[0]?.newStart;
  return { path: workspaceRelFromToolPath(file.path, root), line };
}

export function formatFileComment(input: {
  path: string;
  startLine?: number;
  endLine?: number;
  text: string;
}): string {
  const path = workspaceRelFromToolPath(input.path);
  const loc =
    input.startLine && input.startLine > 0
      ? input.endLine && input.endLine !== input.startLine
        ? `${path}:${input.startLine}-${input.endLine}`
        : `${path}:${input.startLine}`
      : path;
  const snippet = input.text.trim() || path;
  const fence = wrapUntrusted({
    kind: "operator-notes",
    source: loc,
    text: snippet,
  });
  return `On ${loc}: \n\n${fence}`;
}

export function offsetsToLines(
  content: string,
  start: number,
  end: number,
): { startLine: number; endLine: number; text: string } {
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(0, Math.max(start, end));
  const startLine = content.slice(0, from).split("\n").length;
  const endLine = content.slice(0, to).split("\n").length;
  return { startLine, endLine, text: content.slice(from, to) };
}
