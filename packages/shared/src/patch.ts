export type DiffLine = {
  kind: "ctx" | "add" | "del";
  text: string;
};

export type PatchHunk = {
  oldStart: number;
  newStart: number;
  oldLines: string[];
  newLines: string[];
  rows: DiffLine[];
};

export type NumberedDiffLine = DiffLine & {
  oldLine?: number;
  newLine?: number;
};

export type DiffStats = {
  additions: number;
  deletions: number;
};

export type PatchFile = {
  path: string;
  kind: "add" | "update" | "delete";
  hunks: PatchHunk[];
};

export function applyUnifiedDiff(
  files: Map<string, string>,
  patch: string,
  cwd: string,
): { files: Map<string, string>; output: string } {
  const parsed = parseUnifiedDiff(patch);
  if (!parsed.length) {
    throw new Error(
      "patch did not contain any file hunks (need --- a/ +++ b/ or *** Update File, plus @@ hunks; line numbers on @@ are optional)",
    );
  }
  const next = new Map(files);
  const changed: string[] = [];
  for (const file of parsed) {
    const dest = resolvePatchPath(cwd, file.path);
    if (file.kind === "delete") {
      if (!next.has(dest)) throw new Error(`patch delete missed ${dest}`);
      next.delete(dest);
      changed.push(`deleted ${dest}`);
      continue;
    }
    const existing = next.get(dest);
    if (file.kind === "add") {
      if (existing !== undefined) throw new Error(`patch add overwrites ${dest}`);
      next.set(dest, applyHunks("", file.hunks, dest));
      changed.push(`added ${dest}`);
      continue;
    }
    if (existing === undefined) throw new Error(`patch update missed ${dest}`);
    next.set(dest, applyHunks(existing, file.hunks, dest));
    changed.push(`updated ${dest}`);
  }
  return { files: next, output: changed.join("\n") || "patch applied" };
}

export function parseUnifiedDiff(patch: string): PatchFile[] {
  const lines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  let hunk: PatchHunk | undefined;
  let gitPath: string | undefined;
  let minusPath: string | undefined;

  const flushHunk = () => {
    if (!current || !hunk) return;
    current.hunks.push(hunk);
    hunk = undefined;
  };
  const startFile = (path: string, kind: PatchFile["kind"]) => {
    flushHunk();
    current = { path, kind, hunks: [] };
    files.push(current);
    minusPath = undefined;
  };

  for (const raw of lines) {
    if (raw === "*** Begin Patch" || raw === "*** End Patch") continue;
    const star = raw.match(/^\*\*\* (Update|Add|Delete) File:\s+(.+)$/);
    if (star) {
      const kind = star[1] === "Add" ? "add" : star[1] === "Delete" ? "delete" : "update";
      startFile(star[2]!.trim(), kind);
      continue;
    }
    const git = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (git) {
      flushHunk();
      gitPath = git[2]!;
      current = undefined;
      hunk = undefined;
      minusPath = undefined;
      continue;
    }
    const minus = raw.match(/^---\s+(\S+)/);
    if (minus && !hunk) {
      flushHunk();
      minusPath = stripGitPrefix(minus[1]!);
      continue;
    }
    const plus = raw.match(/^\+\+\+\s+(\S+)/);
    if (plus && !hunk) {
      const plusPath = stripGitPrefix(plus[1]!);
      const kind =
        minusPath === "/dev/null" ? "add" : plusPath === "/dev/null" ? "delete" : "update";
      const path =
        kind === "delete"
          ? minusPath || gitPath || ""
          : plusPath === "/dev/null"
            ? gitPath || ""
            : plusPath;
      startFile(path, kind);
      continue;
    }
    const header = raw.match(/^@@(?:\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@)?(.*)$/);
    if (header && raw.startsWith("@@")) {
      flushHunk();
      if (!current) startFile(gitPath || "", "update");
      hunk = {
        oldStart: header[1] ? Number(header[1]) : 1,
        newStart: header[2] ? Number(header[2]) : 1,
        oldLines: [],
        newLines: [],
        rows: [],
      };
      continue;
    }
    if (raw.startsWith("\\") || raw.startsWith("*** ")) continue;
    if (!current) continue;
    if (!hunk) {
      if (current.kind === "add" && (raw.startsWith("+") || raw.startsWith(" "))) {
        hunk = { oldStart: 1, newStart: 1, oldLines: [], newLines: [], rows: [] };
      } else {
        continue;
      }
    }
    const prefix = raw[0];
    const body = raw.slice(1);
    if (prefix === "+") {
      hunk.newLines.push(body);
      hunk.rows.push({ kind: "add", text: body });
    } else if (prefix === "-") {
      hunk.oldLines.push(body);
      hunk.rows.push({ kind: "del", text: body });
    } else if (prefix === " ") {
      hunk.oldLines.push(body);
      hunk.newLines.push(body);
      hunk.rows.push({ kind: "ctx", text: body });
    }
  }
  flushHunk();
  return files.filter((file) => file.path && (file.kind === "delete" || file.hunks.length));
}

function applyHunks(content: string, hunks: PatchHunk[], path: string): string {
  if (!hunks.length) return content;
  const endedWithNl = content.endsWith("\n");
  let lines = content.length ? content.replace(/\n$/, "").split("\n") : [];
  for (const hunk of hunks) {
    const idx = findHunk(lines, hunk);
    if (idx >= 0) {
      lines = [
        ...lines.slice(0, idx),
        ...hunk.newLines,
        ...lines.slice(idx + hunk.oldLines.length),
      ];
      continue;
    }
    const appended = eofAppendHunk(lines, hunk);
    if (appended) {
      lines = appended;
      continue;
    }
    throw hunkMissError(path, hunk);
  }
  if (!lines.length) return "";
  return endedWithNl || content === "" ? `${lines.join("\n")}\n` : lines.join("\n");
}

function hunkMissError(path: string, hunk: PatchHunk): Error {
  const snippet = hunk.oldLines.slice(0, 3).join("\\n").slice(0, 120);
  const extra = snippet ? `: ${snippet}` : "";
  return new Error(`hunk did not apply in ${path} (old line ${hunk.oldStart})${extra}`);
}

/**
 * Models often emit apply_patch hunks whose leading context matches EOF, then
 * more indented JS with a space prefix (treated as context) that is actually new.
 * If that prefix matches the file end and leftover rows have no deletions, append.
 */
function eofAppendHunk(lines: string[], hunk: PatchHunk): string[] | undefined {
  if (!hunk.oldLines.length || !lines.length) return undefined;
  const max = Math.min(hunk.oldLines.length, lines.length);
  for (let n = max; n >= 1; n -= 1) {
    const start = lines.length - n;
    if (!matchesAt(lines, start, hunk.oldLines.slice(0, n))) continue;
    let oldConsumed = 0;
    const next: string[] = [];
    let leftoverDel = false;
    for (const row of hunk.rows) {
      if (oldConsumed < n && row.kind !== "add") {
        oldConsumed += 1;
        if (row.kind === "ctx") next.push(row.text);
        continue;
      }
      if (row.kind === "del") {
        leftoverDel = true;
        break;
      }
      next.push(row.text);
    }
    if (leftoverDel) continue;
    return [...lines.slice(0, start), ...next];
  }
  return undefined;
}

function findHunk(lines: string[], hunk: PatchHunk): number {
  if (!hunk.oldLines.length) return Math.max(0, Math.min(lines.length, hunk.oldStart - 1));
  const hinted = hunk.oldStart - 1;
  if (matchesAt(lines, hinted, hunk.oldLines)) return hinted;
  for (let i = 0; i <= lines.length - hunk.oldLines.length; i += 1) {
    if (matchesAt(lines, i, hunk.oldLines)) return i;
  }
  return -1;
}

function matchesAt(lines: string[], index: number, block: string[]): boolean {
  if (index < 0 || index + block.length > lines.length) return false;
  return block.every((line, i) => lines[index + i] === line);
}

export function resolvePatchPath(cwd: string, rel: string): string {
  const path = rel.trim();
  if (!path) return cwd;
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  const sep = cwd.includes("\\") && !cwd.includes("/") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
}

/** Models often pass the file being patched as `path`; git apply / patch -d need a directory. */
export function normalizePatchCwd(
  path: string,
  fallback: string,
  isFile?: (p: string) => boolean,
): string {
  const trimmed = path.trim() || fallback;
  if (isFile?.(trimmed) || looksLikeFilePath(trimmed)) {
    return parentDir(trimmed) || fallback;
  }
  return trimmed;
}

function looksLikeFilePath(path: string): boolean {
  const base =
    path
      .replace(/[\\/]+$/, "")
      .split(/[/\\]/)
      .pop() ?? "";
  return /.\.[A-Za-z0-9]{1,10}$/.test(base);
}

function parentDir(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx < 0) return "";
  if (idx === 0) return "/";
  return trimmed.slice(0, idx);
}

function stripGitPrefix(path: string): string {
  const trimmed = path.replace(/\t.*$/, "");
  if (trimmed === "/dev/null") return trimmed;
  return trimmed.replace(/^[ab]\//, "");
}

const WRITE_BODY_KEYS = ["content", "contents", "fileText", "streamContent"] as const;
const PATH_KEYS = ["path", "target_file", "file_path", "relative_workspace_path"] as const;

export function patchTextFromTool(
  name: string,
  args: Record<string, unknown> = {},
  result?: string,
): string | undefined {
  const includeWriteBody = name === "apply_patch" || name === "search_replace";
  const recovered = recoverPatchText(args, includeWriteBody);
  if (recovered) return recovered;
  if (name === "git_diff" || name === "git_push" || name === "git_pr") {
    const text = result?.trim();
    if (!text) return undefined;
    if (
      text.includes("diff --git") ||
      text.includes("*** Begin Patch") ||
      text.includes("*** Update File") ||
      /^---\s/m.test(text)
    ) {
      return result;
    }
  }
  return undefined;
}

export function patchFilesFromTool(
  name: string,
  args: Record<string, unknown> = {},
  result?: string,
): PatchFile[] {
  const text = patchTextFromTool(name, args, result);
  return text ? parseUnifiedDiff(text) : [];
}

/** Cursor CLI edit/write args, including nested applyPatch / strReplace. */
export function recoverPatchText(
  args: Record<string, unknown>,
  includeWriteBody = false,
): string | undefined {
  const path = toolPath(args);
  const direct = stringArg(args.patch);
  if (direct) return ensurePatchHasPath(direct, path);
  const nested = nestedPatchContent(args);
  if (nested) return ensurePatchHasPath(nested, path);
  const replaces = collectReplaces(args);
  if (replaces.length && path) return replacesToPatch(path, replaces);
  if (includeWriteBody && path) {
    const body = writeBody(args);
    if (body) return addFilePatch(path, body);
  }
  return undefined;
}

function toolPath(args: Record<string, unknown>): string {
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function writeBody(args: Record<string, unknown>): string {
  for (const key of WRITE_BODY_KEYS) {
    const value = stringArg(args[key]);
    if (value) return value;
  }
  return "";
}

function nestedPatchContent(args: Record<string, unknown>): string {
  const top = stringArg(args.patchContent);
  if (top) return top;
  const applyPatch = asRecord(args.applyPatch);
  if (!applyPatch) return "";
  return stringArg(applyPatch.patchContent) || stringArg(applyPatch.patch) || "";
}

function collectReplaces(args: Record<string, unknown>): { oldText: string; newText: string }[] {
  const out: { oldText: string; newText: string }[] = [];
  const push = (oldVal: unknown, newVal: unknown) => {
    const pair = replacePair(oldVal, newVal);
    if (pair) out.push(pair);
  };
  const strReplace = asRecord(args.strReplace);
  if (strReplace) {
    push(strReplace.oldText ?? strReplace.old_string, strReplace.newText ?? strReplace.new_string);
  }
  const multi = asRecord(args.multiStrReplace);
  if (multi && Array.isArray(multi.edits)) {
    for (const item of multi.edits) {
      const rec = asRecord(item);
      if (!rec) continue;
      push(rec.oldText ?? rec.old_string, rec.newText ?? rec.new_string);
    }
  }
  push(
    args.oldText ?? args.old_string ?? args.old_str,
    args.newText ?? args.new_string ?? args.new_str,
  );
  return out;
}

function replacePair(
  oldVal: unknown,
  newVal: unknown,
): { oldText: string; newText: string } | undefined {
  const hasOld = typeof oldVal === "string";
  const hasNew = typeof newVal === "string";
  if (!hasOld && !hasNew) return undefined;
  const oldText = hasOld ? oldVal : "";
  const newText = hasNew ? newVal : "";
  if (isStubbedToolArg(oldText) || isStubbedToolArg(newText)) return undefined;
  if (!oldText && !newText) return undefined;
  return { oldText, newText };
}

function replacesToPatch(path: string, edits: { oldText: string; newText: string }[]): string {
  const hunks = edits.map((edit) => {
    const oldLines = patchLines(edit.oldText);
    const newLines = patchLines(edit.newText);
    return [
      "@@",
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ].join("\n");
  });
  return `*** Update File: ${path}\n${hunks.join("\n")}`;
}

function addFilePatch(path: string, body: string): string {
  return `*** Add File: ${path}\n${patchLines(body)
    .map((line) => `+${line}`)
    .join("\n")}`;
}

function ensurePatchHasPath(text: string, path: string): string {
  if (parseUnifiedDiff(text).length) return text;
  if (!path) return text;
  const wrapped = `--- a/${path}\n+++ b/${path}\n${text}`;
  return parseUnifiedDiff(wrapped).length ? wrapped : text;
}

function patchLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function stringArg(value: unknown): string {
  return typeof value === "string" && value.trim() && !isStubbedToolArg(value) ? value : "";
}

function isStubbedToolArg(text: string): boolean {
  return text.startsWith("…[already ");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function fileDiffStats(file: PatchFile): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const row of hunk.rows) {
      if (row.kind === "add") additions += 1;
      else if (row.kind === "del") deletions += 1;
    }
  }
  return { additions, deletions };
}

export function diffStats(files: PatchFile[]): DiffStats {
  return files.reduce(
    (acc, file) => {
      const next = fileDiffStats(file);
      acc.additions += next.additions;
      acc.deletions += next.deletions;
      return acc;
    },
    { additions: 0, deletions: 0 },
  );
}

export function enumerateDiffRows(hunk: PatchHunk): NumberedDiffLine[] {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return hunk.rows.map((row) => {
    if (row.kind === "ctx") {
      const numbered: NumberedDiffLine = { ...row, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return numbered;
    }
    if (row.kind === "del") {
      const numbered: NumberedDiffLine = { ...row, oldLine };
      oldLine += 1;
      return numbered;
    }
    const numbered: NumberedDiffLine = { ...row, newLine };
    newLine += 1;
    return numbered;
  });
}

export function hunkHeader(hunk: PatchHunk): string {
  const oldCount = hunk.oldLines.length;
  const newCount = hunk.newLines.length;
  const old = oldCount === 1 ? `-${hunk.oldStart}` : `-${hunk.oldStart},${oldCount}`;
  const next = newCount === 1 ? `+${hunk.newStart}` : `+${hunk.newStart},${newCount}`;
  return `@@ ${old} ${next} @@`;
}

export function parseFilePatch(
  path: string,
  patch?: string,
  kind: PatchFile["kind"] = "update",
): PatchFile {
  if (!patch?.trim()) return { path, kind, hunks: [] };
  let parsed = parseUnifiedDiff(patch);
  if (!parsed.length) {
    parsed = parseUnifiedDiff(`--- a/${path}\n+++ b/${path}\n${patch}`);
  }
  const match = parsed.find((row) => row.path === path) ?? parsed[0];
  if (!match) return { path, kind, hunks: [] };
  return { ...match, path: match.path || path, kind: match.kind !== "update" ? match.kind : kind };
}
