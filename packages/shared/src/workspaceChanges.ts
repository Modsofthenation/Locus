import type { ChatMessage, ToolCall } from "./models/session.js";
import { canonicalToolCall } from "./models/toolChip.js";
import { fileDiffStats, patchFilesFromTool, type DiffStats } from "./patch.js";

export type WorkspaceFileChange = {
  path: string;
  additions: number;
  deletions: number;
};

const WORKSPACE_PREFIX = "/workspace/";
const WIN_DRIVE = /^[a-zA-Z]:\//;
const WIN_UNC = /^\/\/[^/]/;
const HOST_WORKSPACES_TAIL = /\/host-workspaces\/[^/]+\/(.+)$/i;

/** Host abs path (posix, Windows drive, UNC) — not the guest `/workspace/...` prefix. */
export function looksAbsoluteHostPath(raw: string): boolean {
  const path = raw.trim().replace(/\\/g, "/");
  if (!path) return false;
  if (WIN_DRIVE.test(path) || WIN_UNC.test(path)) return true;
  return path.startsWith("/") && path !== "/workspace" && !path.startsWith(WORKSPACE_PREFIX);
}

function stripWorkspaceRootPrefix(path: string, root: string): string | undefined {
  const posixRoot = root.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!posixRoot) return undefined;
  if (path === posixRoot) return "";
  const prefix = `${posixRoot}/`;
  if (path.startsWith(prefix)) return path.slice(prefix.length);
  if (WIN_DRIVE.test(posixRoot) && path.toLowerCase().startsWith(prefix.toLowerCase())) {
    return path.slice(prefix.length);
  }
  return undefined;
}

export function workspaceRelFromToolPath(raw?: string, root?: string): string {
  let path = (raw ?? "").trim().replace(/\\/g, "/");
  if (!path) return "";
  if (root) {
    const stripped = stripWorkspaceRootPrefix(path, root);
    if (stripped !== undefined) path = stripped;
  }
  if (looksAbsoluteHostPath(path)) {
    const hostWs = path.match(HOST_WORKSPACES_TAIL);
    if (hostWs?.[1]) path = hostWs[1];
    else if (root) return "";
  }
  if (path.startsWith(WORKSPACE_PREFIX)) path = path.slice(WORKSPACE_PREFIX.length);
  else if (path === "/workspace") path = "";
  path = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (WIN_DRIVE.test(path) || WIN_UNC.test(path)) return "";
  if (!path || path.includes("\0") || path.split("/").some((part) => part === "." || part === ".."))
    return "";
  return path.slice(0, 512);
}

/** Filename first so long host-workspace paths do not hide the basename. */
export function patchPathLabel(raw: string): { name: string; dir: string } {
  const path = raw.trim();
  if (!path) return { name: "", dir: "" };
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut < 0) return { name: path, dir: "" };
  const name = path.slice(cut + 1);
  const dir = path.slice(0, cut);
  if (!name) return { name: path, dir: "" };
  return { name, dir };
}

export function lineDiffStats(before: string, after: string): DiffStats {
  if (normalizeWorkspaceNewlines(before) === normalizeWorkspaceNewlines(after)) {
    return { additions: 0, deletions: 0 };
  }
  const previous = splitLines(before);
  const next = splitLines(after);
  const counts = new Map<string, number>();
  for (const line of previous) counts.set(line, (counts.get(line) ?? 0) + 1);
  let common = 0;
  for (const line of next) {
    const n = counts.get(line) ?? 0;
    if (n > 0) {
      common += 1;
      counts.set(line, n - 1);
    }
  }
  return { additions: next.length - common, deletions: previous.length - common };
}

/** Working-tree CRLF vs git LF must not look like every line changed. */
export function normalizeWorkspaceNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return normalizeWorkspaceNewlines(text).replace(/\n$/, "").split("\n");
}

const WORKSPACE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const WORKSPACE_HTML_EXTS = new Set([".html", ".htm"]);
/** Cap Myers edit distance so a total rewrite still finishes quickly. */
const LINE_DIFF_EDIT_CAP = 2_000;
const LINE_DIFF_CONTEXT = 3;

function workspaceExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot).toLowerCase();
}

export type LineDiffRow = {
  kind: "eq" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type LineDiffOmit = {
  kind: "omit";
  rows: LineDiffRow[];
};

export type LineDiffViewRow = LineDiffRow | LineDiffOmit;

/** SCM marks for the editor line-number gutter (VS Code-style). */
export type LineChangeMark = {
  kind: "add" | "mod" | "del";
  startLine: number;
  lineCount: number;
};

export function isWorkspaceImagePath(path: string): boolean {
  return WORKSPACE_IMAGE_EXTS.has(workspaceExt(path));
}

export function isWorkspacePdfPath(path: string): boolean {
  return workspaceExt(path) === ".pdf";
}

export function isWorkspaceHtmlPath(path: string): boolean {
  return WORKSPACE_HTML_EXTS.has(workspaceExt(path));
}

export function isWorkspaceMarkdownPath(path: string): boolean {
  const ext = workspaceExt(path);
  return ext === ".md" || ext === ".markdown" || ext === ".mdx";
}

export function isWorkspaceSvgPath(path: string): boolean {
  return workspaceExt(path) === ".svg";
}

const WORKSPACE_RAW_EXTRA_EXTS = new Set([
  ".glb",
  ".stl",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".wasm",
]);

/** Images and PDFs open as a binary preview in the host Files pane. */
export function isWorkspaceBinaryPreviewPath(path: string): boolean {
  return isWorkspaceImagePath(path) || isWorkspacePdfPath(path);
}

/** Bytes the host can serve as a canvas/export sibling (meshes, fonts, rasters). */
export function isWorkspaceRawBytesPath(path: string): boolean {
  return isWorkspaceBinaryPreviewPath(path) || WORKSPACE_RAW_EXTRA_EXTS.has(workspaceExt(path));
}

export function workspaceImageMime(path: string): string {
  const ext = workspaceExt(path);
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  return "image/png";
}

export function workspaceRawMime(path: string): string {
  if (isWorkspacePdfPath(path)) return "application/pdf";
  const ext = workspaceExt(path);
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".stl") return "model/stl";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".otf") return "font/otf";
  if (ext === ".wasm") return "application/wasm";
  return workspaceImageMime(path);
}

export function lineDiff(before: string, after: string): LineDiffRow[] {
  const previous = splitLines(before);
  const next = splitLines(after);
  if (previous.length === 0 && next.length === 0) return [];
  if (previous.length === 0) {
    return next.map((text, i) => ({ kind: "add", text, newLine: i + 1 }));
  }
  if (next.length === 0) {
    return previous.map((text, i) => ({ kind: "del", text, oldLine: i + 1 }));
  }
  if (normalizeWorkspaceNewlines(before) === normalizeWorkspaceNewlines(after)) {
    return next.map((text, i) => ({
      kind: "eq",
      text,
      oldLine: i + 1,
      newLine: i + 1,
    }));
  }

  let prefix = 0;
  const shared = Math.min(previous.length, next.length);
  while (prefix < shared && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const rows: LineDiffRow[] = [];
  for (let i = 0; i < prefix; i += 1) {
    rows.push({ kind: "eq", text: previous[i]!, oldLine: i + 1, newLine: i + 1 });
  }
  rows.push(
    ...myersDiff(
      previous.slice(prefix, previous.length - suffix),
      next.slice(prefix, next.length - suffix),
      prefix,
    ),
  );
  for (let i = 0; i < suffix; i += 1) {
    const oldLine = previous.length - suffix + i + 1;
    const newLine = next.length - suffix + i + 1;
    rows.push({
      kind: "eq",
      text: previous[previous.length - suffix + i]!,
      oldLine,
      newLine,
    });
  }
  return rows;
}

function replaceBlock(a: string[], b: string[], base: number): LineDiffRow[] {
  const rows: LineDiffRow[] = [];
  for (let i = 0; i < a.length; i += 1) {
    rows.push({ kind: "del", text: a[i]!, oldLine: base + i + 1 });
  }
  for (let j = 0; j < b.length; j += 1) {
    rows.push({ kind: "add", text: b[j]!, newLine: base + j + 1 });
  }
  return rows;
}

function myersDiff(a: string[], b: string[], base: number): LineDiffRow[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return b.map((text, j) => ({ kind: "add" as const, text, newLine: base + j + 1 }));
  }
  if (m === 0) {
    return a.map((text, i) => ({ kind: "del" as const, text, oldLine: base + i + 1 }));
  }
  const maxD = Math.min(n + m, LINE_DIFF_EDIT_CAP);
  const offset = maxD;
  const v = new Int32Array(2 * maxD + 1);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];

  for (let d = 0; d <= maxD; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(Int32Array.from(v));
        return backtrackMyers(a, b, trace, base);
      }
    }
    trace.push(Int32Array.from(v));
  }
  return replaceBlock(a, b, base);
}

function backtrackMyers(
  a: string[],
  b: string[],
  trace: Int32Array[],
  base: number,
): LineDiffRow[] {
  const rev: LineDiffRow[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d]!;
    const offset = (v.length - 1) >> 1;
    const k = x - y;
    const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      rev.push({
        kind: "eq",
        text: a[x]!,
        oldLine: base + x + 1,
        newLine: base + y + 1,
      });
    }
    if (d === 0) break;
    if (x > prevX) {
      x -= 1;
      rev.push({ kind: "del", text: a[x]!, oldLine: base + x + 1 });
    } else if (y > prevY) {
      y -= 1;
      rev.push({ kind: "add", text: b[y]!, newLine: base + y + 1 });
    }
  }
  rev.reverse();
  return rev;
}

/** Drop unchanged runs, keeping `context` lines around each edit. */
export function collapseLineDiff(
  rows: LineDiffRow[],
  context = LINE_DIFF_CONTEXT,
): LineDiffViewRow[] {
  if (rows.length === 0 || !rows.some((row) => row.kind !== "eq")) return rows;
  const keep = new Uint8Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i]!.kind === "eq") continue;
    keep.fill(1, Math.max(0, i - context), Math.min(rows.length, i + 1 + context));
  }
  const out: LineDiffViewRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i]!);
      i += 1;
      continue;
    }
    const start = i;
    while (i < rows.length && !keep[i]) i += 1;
    out.push({ kind: "omit", rows: rows.slice(start, i) });
  }
  return out;
}

function lastNewLine(rows: LineDiffRow[], before: number): number {
  for (let i = before - 1; i >= 0; i -= 1) {
    const n = rows[i]?.newLine;
    if (n) return n;
  }
  return 1;
}

/**
 * Gutter marks without materializing unchanged equal rows.
 * Typing only needs add/mod/del bars, not a full Myers view of the file.
 */
export function lineChangeMarksFromText(before: string, after: string): LineChangeMark[] {
  const previous = splitLines(before);
  const next = splitLines(after);
  if (previous.length === 0 && next.length === 0) return [];
  if (previous.length === 0) {
    return next.length ? [{ kind: "add", startLine: 1, lineCount: next.length }] : [];
  }
  if (next.length === 0) {
    return previous.length ? [{ kind: "del", startLine: 1, lineCount: 1 }] : [];
  }

  let prefix = 0;
  const shared = Math.min(previous.length, next.length);
  while (prefix < shared && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix + suffix === previous.length && previous.length === next.length) return [];

  const middle = myersDiff(
    previous.slice(prefix, previous.length - suffix),
    next.slice(prefix, next.length - suffix),
    prefix,
  );
  const lead: LineDiffRow[] =
    prefix > 0
      ? [
          {
            kind: "eq",
            text: previous[prefix - 1]!,
            oldLine: prefix,
            newLine: prefix,
          },
        ]
      : [];
  const tail: LineDiffRow[] =
    suffix > 0
      ? [
          {
            kind: "eq",
            text: next[next.length - suffix]!,
            oldLine: previous.length - suffix + 1,
            newLine: next.length - suffix + 1,
          },
        ]
      : [];
  return lineChangeMarks(lead.concat(middle, tail));
}

/** Collapse a line diff into gutter bars: green add, green-mod, red delete ticks. */
export function lineChangeMarks(rows: LineDiffRow[]): LineChangeMark[] {
  const marks: LineChangeMark[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind === "eq") {
      i += 1;
      continue;
    }
    let adds = 0;
    let dels = 0;
    let addStart = 0;
    const hunkAt = i;
    while (i < rows.length && rows[i]!.kind !== "eq") {
      const cur = rows[i]!;
      if (cur.kind === "add") {
        if (!adds) addStart = cur.newLine ?? 1;
        adds += 1;
      } else dels += 1;
      i += 1;
    }
    if (adds > 0) {
      marks.push({
        kind: dels > 0 ? "mod" : "add",
        startLine: addStart,
        lineCount: adds,
      });
    } else if (dels > 0) {
      const next = rows[i];
      marks.push({
        kind: "del",
        startLine: next?.newLine ?? lastNewLine(rows, hunkAt),
        lineCount: 1,
      });
    }
  }
  return marks;
}

function toolSucceeded(call: ToolCall): boolean {
  if (call.error) return false;
  if (call.approval === "denied" || call.approval === "needed") return false;
  return call.result !== undefined || Boolean(call.finishedAt);
}

export function workspaceChangesFromMessages(messages: ChatMessage[]): WorkspaceFileChange[] {
  const stats = new Map<string, DiffStats>();
  const lastContent = new Map<string, string>();

  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      if (!toolSucceeded(call)) continue;
      const canonical = canonicalToolCall(call.name, call.arguments);
      if (canonical.name === "file_write") {
        const path = workspaceRelFromToolPath(String(canonical.arguments.path ?? ""));
        if (!path) continue;
        const content =
          typeof canonical.arguments.content === "string" ? canonical.arguments.content : "";
        stats.set(path, lineDiffStats(lastContent.get(path) ?? "", content));
        lastContent.set(path, content);
        continue;
      }
      if (canonical.name !== "apply_patch") continue;
      for (const file of patchFilesFromTool("apply_patch", canonical.arguments, call.result)) {
        const path = workspaceRelFromToolPath(file.path);
        if (!path) continue;
        const next = fileDiffStats(file);
        const prev = stats.get(path) ?? { additions: 0, deletions: 0 };
        stats.set(path, {
          additions: prev.additions + next.additions,
          deletions: prev.deletions + next.deletions,
        });
      }
    }
  }

  return [...stats.entries()]
    .map(([path, row]) => ({ path, additions: row.additions, deletions: row.deletions }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function mergeWorkspaceChanges(
  fromTools: WorkspaceFileChange[],
  fromGit: WorkspaceFileChange[],
): WorkspaceFileChange[] {
  const map = new Map<string, WorkspaceFileChange>();
  for (const row of fromTools) map.set(row.path, row);
  for (const row of fromGit) map.set(row.path, row);
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function sumWorkspaceChanges(changes: WorkspaceFileChange[]): DiffStats {
  return changes.reduce(
    (acc, row) => ({
      additions: acc.additions + row.additions,
      deletions: acc.deletions + row.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

/** Consecutive non-equal runs in a line diff. */
export function changeHunkCount(rows: LineDiffRow[]): number {
  let count = 0;
  let inHunk = false;
  for (const row of rows) {
    const changing = row.kind !== "eq";
    if (changing && !inHunk) {
      count += 1;
      inHunk = true;
    }
    if (!changing) inHunk = false;
  }
  return count;
}

/** Restore the old side of one change hunk; keep every other hunk. */
export function revertNthChangeHunk(baseline: string, current: string, hunkIndex: number): string {
  if (hunkIndex < 0) return current;
  const rows = lineDiff(baseline, current);
  if (hunkIndex >= changeHunkCount(rows)) return current;
  let hunk = -1;
  let inHunk = false;
  const out: string[] = [];
  for (const row of rows) {
    const changing = row.kind !== "eq";
    if (changing && !inHunk) {
      hunk += 1;
      inHunk = true;
    }
    if (!changing) inHunk = false;
    const revert = changing && hunk === hunkIndex;
    if (row.kind === "eq" || (row.kind === "add" && !revert) || (row.kind === "del" && revert)) {
      out.push(row.text);
    }
  }
  const joined = out.join("\n");
  const keepNl = current.endsWith("\n") || (current.length === 0 && baseline.endsWith("\n"));
  return keepNl && joined.length > 0 && !joined.endsWith("\n") ? `${joined}\n` : joined;
}
