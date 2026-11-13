import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoMapPathSkipped } from "@locus/shared";

const execFileAsync = promisify(execFile);

/**
 * Parser for `git status --porcelain=v2 --branch -z`. One git process gives the branch,
 * upstream, ahead/behind, HEAD sha, and every changed path.
 */

export type PorcelainEntry = {
  path: string;
  /** Index (staged) status; `" "` when unchanged. */
  index: string;
  /** Worktree status; `" "` when unchanged. */
  worktree: string;
  /** Source path of a rename or copy. */
  from?: string;
  untracked?: boolean;
  unmerged?: boolean;
};

export type PorcelainStatus = {
  /** HEAD commit, or undefined before the first commit. */
  head?: string;
  /** Branch name, `"detached"`, or `""` when git did not say. */
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  entries: PorcelainEntry[];
};

export const PORCELAIN_V2_ARGS = [
  "-c",
  "core.quotepath=false",
  "status",
  "--porcelain=v2",
  "--branch",
  "-z",
];

function xy(code: string): { index: string; worktree: string } {
  const at = (i: number) => {
    const ch = code[i] ?? ".";
    return ch === "." ? " " : ch;
  };
  return { index: at(0), worktree: at(1) };
}

/** Path after the first `n` space-separated fields (paths may contain spaces). */
function afterFields(row: string, n: number): string {
  let at = 0;
  for (let i = 0; i < n; i += 1) {
    at = row.indexOf(" ", at);
    if (at < 0) return "";
    at += 1;
  }
  return row.slice(at);
}

function cleanPath(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function parsePorcelainV2(stdout: string): PorcelainStatus {
  const out: PorcelainStatus = { branch: "", ahead: 0, behind: 0, entries: [] };
  const parts = stdout.split("\0");
  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i];
    if (!row) continue;
    if (row.startsWith("# ")) {
      const [, key, ...rest] = row.split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") out.head = /^[0-9a-f]{7,64}$/i.test(value) ? value : undefined;
      else if (key === "branch.head") out.branch = value === "(detached)" ? "detached" : value;
      else if (key === "branch.upstream") out.upstream = value || undefined;
      else if (key === "branch.ab") {
        const m = value.match(/^\+(\d+) -(\d+)$/);
        if (m) {
          out.ahead = Number(m[1]);
          out.behind = Number(m[2]);
        }
      }
      continue;
    }
    const kind = row[0];
    if (kind === "1") {
      const path = cleanPath(afterFields(row, 8));
      if (path) out.entries.push({ path, ...xy(row.slice(2, 4)) });
    } else if (kind === "2") {
      const path = cleanPath(afterFields(row, 9));
      const from = cleanPath(parts[i + 1] ?? "");
      i += 1;
      if (path) out.entries.push({ path, ...xy(row.slice(2, 4)), ...(from ? { from } : {}) });
    } else if (kind === "u") {
      const path = cleanPath(afterFields(row, 10));
      if (path) out.entries.push({ path, ...xy(row.slice(2, 4)), unmerged: true });
    } else if (kind === "?") {
      const path = cleanPath(row.slice(2));
      if (path) out.entries.push({ path, index: "?", worktree: "?", untracked: true });
    }
  }
  return out;
}

/** Paths that exist in the worktree vs paths git reports as gone (deleted, rename sources). */
export function porcelainPathSets(status: PorcelainStatus): {
  present: string[];
  gone: string[];
} {
  const present: string[] = [];
  const gone: string[] = [];
  for (const entry of status.entries) {
    if (entry.from) gone.push(entry.from);
    if (entry.worktree === "D" || (entry.index === "D" && entry.worktree === " ")) {
      gone.push(entry.path);
    } else {
      present.push(entry.path);
    }
  }
  return { present, gone };
}

export type WorkspaceGitSnapshot = {
  head?: string;
  /** Changed or untracked paths that exist on disk (untracked dirs end with `/`). */
  dirty: string[];
  /** Paths git reports as deleted, plus rename/copy sources. */
  gone: string[];
};

/** HEAD plus every path that differs from it, from a single `git status`. */
export async function workspaceGitSnapshot(
  root: string,
  timeout = 4000,
): Promise<WorkspaceGitSnapshot | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", root, ...PORCELAIN_V2_ARGS], {
      timeout,
      maxBuffer: 8_000_000,
      windowsHide: true,
    });
    const status = parsePorcelainV2(stdout);
    const { present, gone } = porcelainPathSets(status);
    return {
      head: status.head,
      dirty: present.filter((path) => !repoMapPathSkipped(path)),
      gone,
    };
  } catch {
    return undefined;
  }
}
