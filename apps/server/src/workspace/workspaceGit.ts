import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sanitizeWorkspaceRel } from "./workspaceFiles.js";

const execFileAsync = promisify(execFile);

export type WorkspaceGitFile = {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  conflicted?: boolean;
};

export type WorkspaceGitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  files: WorkspaceGitFile[];
  rebasing?: boolean;
  merging?: boolean;
  upstream?: string;
  dest?: string;
  dests?: Array<{ dest: string; name: string; url?: string; primary?: boolean }>;
};

export type WorkspaceBlameLine = {
  sha: string;
  author: string;
  date: string;
  line: number;
  text: string;
};

export type WorkspaceGitHunkLine = {
  kind: "ctx" | "add" | "del";
  text: string;
};

export type WorkspaceGitHunk = {
  path: string;
  staged: boolean;
  header: string;
  patch: string;
  oldStart: number;
  newStart: number;
  lines: WorkspaceGitHunkLine[];
};

export type WorkspaceGitStash = {
  index: number;
  ref: string;
  message: string;
};

export type WorkspaceGitRebaseTodo = {
  action: "pick" | "reword" | "squash" | "fixup" | "drop";
  sha: string;
  message: string;
};

export type WorkspaceGitRebaseStatus = {
  onto: string;
  todos: WorkspaceGitRebaseTodo[];
  rebasing: boolean;
  conflicted: string[];
};

function gitEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "1",
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "commit.gpgsign",
    GIT_CONFIG_VALUE_0: "false",
    ...extra,
  };
}

async function git(cwd: string, args: string[], timeout = 8_000, extraEnv?: NodeJS.ProcessEnv) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout,
      maxBuffer: 8_000_000,
      env: gitEnv(extraEnv),
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: string }).stderr).trim()
        : "";
    if (stderr) throw new Error(stderr.split("\n").slice(-8).join("\n"));
    throw err instanceof Error ? err : new Error("git failed");
  }
}

async function gitOk(cwd: string, args: string[], timeout = 8_000): Promise<boolean> {
  try {
    await git(cwd, args, timeout);
    return true;
  } catch {
    return false;
  }
}

/** True when `root` is a git work tree with at least one commit (safe to skip clone). */
export function gitCheckoutReady(root: string): boolean {
  if (!root || !existsSync(root)) return false;
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      stdio: "pipe",
      timeout: 5_000,
      env: gitEnv(),
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function workspaceGitStatus(root: string): Promise<WorkspaceGitStatus> {
  const empty = (): WorkspaceGitStatus => ({ branch: "", ahead: 0, behind: 0, files: [] });
  try {
    const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.trim() !== "true") return empty();
  } catch {
    return empty();
  }
  try {
    const porcelain = await git(root, ["status", "--porcelain=v1", "-b", "-uall"]);
    let branch = "";
    let ahead = 0;
    let behind = 0;
    const files: WorkspaceGitFile[] = [];
    for (const line of porcelain.split("\n")) {
      if (!line) continue;
      if (line.startsWith("## ")) {
        const head = line.slice(3);
        const aheadMatch = head.match(/ahead (\d+)/);
        const behindMatch = head.match(/behind (\d+)/);
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
        behind = behindMatch ? Number(behindMatch[1]) : 0;
        branch = head.split("...")[0]?.trim() || "";
        const noCommits = branch.match(/^No commits yet on (.+)$/);
        if (noCommits?.[1]) branch = noCommits[1];
        if (branch === "HEAD (no branch)") branch = "detached";
        continue;
      }
      const index = line[0] ?? " ";
      const worktree = line[1] ?? " ";
      let path = line.slice(3).replace(/\\/g, "/");
      const renamed = path.match(/^.+ -> (.+)$/);
      if (renamed?.[1]) path = renamed[1];
      path = path.replace(/^"+|"+$/g, "");
      const clean = sanitizeWorkspaceRel(path);
      if (!clean) continue;
      files.push({
        path: clean,
        index,
        worktree,
        staged: index !== " " && index !== "?" && index !== "U",
        ...(isUnmerged(index, worktree) ? { conflicted: true } : {}),
      });
    }
    if (!branch) {
      try {
        branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      } catch {
        branch = "";
      }
    }
    let upstream: string | undefined;
    try {
      const tracked = (await git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"])).trim();
      if (tracked) upstream = tracked;
    } catch {
      /* no upstream */
    }
    const rebasing = rebaseInProgress(root);
    const merging = mergeInProgress(root);
    return {
      branch,
      ahead,
      behind,
      files,
      ...(upstream ? { upstream } : {}),
      ...(rebasing ? { rebasing } : {}),
      ...(merging ? { merging } : {}),
    };
  } catch {
    return empty();
  }
}

export async function workspaceGitStage(
  root: string,
  paths: string[],
): Promise<WorkspaceGitStatus> {
  if (paths.length === 1 && paths[0] === ".") {
    await git(root, ["add", "-A"]);
    return workspaceGitStatus(root);
  }
  const rels = paths.map((path) => sanitizeWorkspaceRel(path)).filter(Boolean);
  if (!rels.length) throw new Error("Pick a file to stage");
  await git(root, ["add", "--", ...rels]);
  return workspaceGitStatus(root);
}

export async function workspaceGitUnstage(
  root: string,
  paths: string[],
): Promise<WorkspaceGitStatus> {
  if (paths.length === 1 && paths[0] === ".") {
    if (await gitOk(root, ["rev-parse", "--verify", "HEAD"])) {
      await git(root, ["restore", "--staged", "."]);
    } else {
      const staged = (await git(root, ["diff", "--cached", "--name-only"]).catch(() => ""))
        .split("\n")
        .map((row) => row.trim())
        .filter(Boolean);
      if (staged.length) await git(root, ["rm", "--cached", "-f", "--", ...staged]);
    }
    return workspaceGitStatus(root);
  }
  const rels = paths.map((path) => sanitizeWorkspaceRel(path)).filter(Boolean);
  if (!rels.length) throw new Error("Pick a file to unstage");
  await git(root, ["restore", "--staged", "--", ...rels]);
  return workspaceGitStatus(root);
}

export async function workspaceGitDiscard(
  root: string,
  paths: string[],
): Promise<WorkspaceGitStatus> {
  const rels = paths.map((path) => sanitizeWorkspaceRel(path)).filter(Boolean);
  if (!rels.length) throw new Error("Pick a file to discard");
  const status = await workspaceGitStatus(root);
  const tracked: string[] = [];
  const untracked: string[] = [];
  for (const rel of rels) {
    const row = status.files.find((file) => file.path === rel);
    if (!row || row.worktree === "?") untracked.push(rel);
    else tracked.push(rel);
  }
  if (tracked.length) {
    await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
  }
  if (untracked.length) await git(root, ["clean", "-f", "--", ...untracked]);
  return workspaceGitStatus(root);
}

export async function workspaceGitCommit(
  root: string,
  message: string,
): Promise<WorkspaceGitStatus> {
  const body = message.trim();
  if (!body) throw new Error("Commit message is required");
  await git(root, ["-c", "commit.gpgsign=false", "commit", "-m", body]);
  return workspaceGitStatus(root);
}

export async function workspaceGitBlame(
  root: string,
  rel: string,
  line: number,
): Promise<WorkspaceBlameLine | null> {
  const path = sanitizeWorkspaceRel(rel);
  const at = Math.max(1, Math.floor(line) || 1);
  if (!path) return null;
  try {
    const out = await git(root, ["blame", "-p", "-L", `${at},${at}`, "--", path]);
    const sha = out.match(/^([0-9a-f]{7,40}) /m)?.[1] ?? "";
    const author = out.match(/^author (.+)$/m)?.[1] ?? "";
    const date = out.match(/^author-time (\d+)$/m)?.[1]
      ? new Date(Number(out.match(/^author-time (\d+)$/m)?.[1]) * 1000).toISOString().slice(0, 10)
      : "";
    const text = out.match(/^\t(.*)$/m)?.[1] ?? "";
    if (!sha) return null;
    return { sha: sha.slice(0, 8), author, date, line: at, text };
  } catch {
    return null;
  }
}

export async function workspaceGitBlameFile(
  root: string,
  rel: string,
): Promise<WorkspaceBlameLine[]> {
  const path = sanitizeWorkspaceRel(rel);
  if (!path) return [];
  try {
    const out = await git(root, ["blame", "--line-porcelain", "--", path], 12_000);
    const rows: WorkspaceBlameLine[] = [];
    let sha = "";
    let author = "";
    let date = "";
    let line = 0;
    for (const raw of out.split("\n")) {
      const header = raw.match(/^([0-9a-f]{7,40}) \d+ (\d+)/);
      if (header) {
        sha = header[1] ?? "";
        line = Number(header[2] ?? 0);
        continue;
      }
      if (raw.startsWith("author ")) author = raw.slice(7);
      else if (raw.startsWith("author-time ")) {
        const ts = Number(raw.slice(12));
        date = Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
      } else if (raw.startsWith("\t")) {
        if (sha && line) {
          rows.push({ sha: sha.slice(0, 8), author, date, line, text: raw.slice(1) });
        }
        if (rows.length >= 8_000) break;
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export async function workspaceGitMerge(root: string, branch: string): Promise<WorkspaceGitStatus> {
  const name = branch.trim();
  if (!isGitBranchName(name)) throw new Error("Invalid branch");
  if (mergeInProgress(root)) throw new Error("A merge is already in progress");
  try {
    await git(root, ["merge", "--no-edit", name], 60_000, {
      GIT_EDITOR: "true",
      GIT_MERGE_AUTOEDIT: "no",
    });
  } catch (err) {
    const status = await workspaceGitStatus(root);
    if (status.merging) return status;
    throw err instanceof Error ? err : new Error("Merge failed");
  }
  return workspaceGitStatus(root);
}

export async function workspaceGitMergeContinue(
  root: string,
  action: "continue" | "abort",
): Promise<WorkspaceGitStatus> {
  if (action === "abort") await git(root, ["merge", "--abort"]);
  else {
    await git(root, ["-c", "core.editor=true", "merge", "--continue"], 60_000, {
      GIT_EDITOR: "true",
    });
  }
  return workspaceGitStatus(root);
}

export async function workspaceGitCheckoutConflict(
  root: string,
  rel: string,
  side: "ours" | "theirs",
): Promise<WorkspaceGitStatus> {
  const path = sanitizeWorkspaceRel(rel);
  if (!path) throw new Error("Invalid path");
  await git(root, ["checkout", `--${side}`, "--", path]);
  await git(root, ["add", "--", path]);
  return workspaceGitStatus(root);
}

export function isGitBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length < 200 &&
    !name.includes("..") &&
    /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name)
  );
}

function shortBranch(name: string): string {
  return name.replace(/^remotes\//, "").replace(/^origin\//, "");
}

export async function workspaceGitBranches(
  root: string,
): Promise<{ current: string; branches: string[]; remotes: string[] }> {
  const empty = { current: "", branches: [] as string[], remotes: [] as string[] };
  try {
    const inside = await git(root, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.trim() !== "true") return empty;
  } catch {
    return empty;
  }
  try {
    const out = await git(root, ["branch", "-a", "--format=%(refname:short)"]);
    const local: string[] = [];
    const remotes: string[] = [];
    for (const row of out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)) {
      if (row.endsWith("/HEAD") || row === "origin/HEAD") continue;
      if (row.startsWith("origin/") || row.startsWith("remotes/")) remotes.push(shortBranch(row));
      else local.push(row);
    }
    const status = await workspaceGitStatus(root);
    return {
      current: status.branch,
      branches: [...new Set(local)],
      remotes: [...new Set(remotes.filter((name) => !local.includes(name)))],
    };
  } catch {
    return empty;
  }
}

export async function workspaceGitCheckout(
  root: string,
  branch: string,
  create = false,
): Promise<WorkspaceGitStatus> {
  const name = branch.trim();
  if (!isGitBranchName(name)) throw new Error("Invalid branch");
  const listed = await workspaceGitBranches(root);
  const localName = shortBranch(name);
  if (listed.branches.includes(localName) && !create) {
    await git(root, ["checkout", localName]);
    return workspaceGitStatus(root);
  }
  if (listed.remotes.includes(localName) || listed.remotes.includes(name)) {
    await git(root, [
      "checkout",
      "-B",
      localName,
      name.startsWith("origin/") ? name : `origin/${localName}`,
    ]);
    return workspaceGitStatus(root);
  }
  if (create) {
    await git(root, ["checkout", "-b", localName]);
    return workspaceGitStatus(root);
  }
  await git(root, ["checkout", name]);
  return workspaceGitStatus(root);
}

export async function workspaceGitFetch(root: string): Promise<WorkspaceGitStatus> {
  await git(root, ["fetch", "--all", "--prune"], 45_000);
  return workspaceGitStatus(root);
}

export async function workspaceGitPull(root: string): Promise<WorkspaceGitStatus> {
  await git(root, ["-c", "pull.ff=only", "pull"], 45_000);
  return workspaceGitStatus(root);
}

export async function workspaceGitStashList(root: string): Promise<WorkspaceGitStash[]> {
  try {
    const out = await git(root, ["stash", "list"]);
    const rows: WorkspaceGitStash[] = [];
    for (const line of out.split("\n")) {
      const match = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
      if (!match) continue;
      rows.push({ index: Number(match[1]), ref: `stash@{${match[1]}}`, message: match[2] ?? "" });
    }
    return rows;
  } catch {
    return [];
  }
}

export async function workspaceGitStash(
  root: string,
  action: "push" | "pop" | "apply" | "drop",
  message?: string,
  index?: number,
): Promise<WorkspaceGitStatus> {
  if (action === "push") {
    const args = ["stash", "push", "-u"];
    const body = message?.trim();
    if (body) args.push("-m", body);
    await git(root, args);
    return workspaceGitStatus(root);
  }
  const ref =
    typeof index === "number" && Number.isFinite(index) ? `stash@{${index}}` : "stash@{0}";
  if (action === "drop") await git(root, ["stash", "drop", ref]);
  else await git(root, ["stash", action, ref]);
  return workspaceGitStatus(root);
}

function isUnmerged(index: string, worktree: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(`${index}${worktree}`);
}

function mergeInProgress(root: string): boolean {
  return existsSync(join(root, ".git", "MERGE_HEAD"));
}

function rebaseInProgress(root: string): boolean {
  return (
    existsSync(join(root, ".git", "rebase-merge")) || existsSync(join(root, ".git", "rebase-apply"))
  );
}

export function parseUnifiedHunks(diff: string, staged: boolean): WorkspaceGitHunk[] {
  const hunks: WorkspaceGitHunk[] = [];
  const files = diff.split(/(?=^diff --git )/m);
  for (const file of files) {
    if (!file.startsWith("diff --git ")) continue;
    const names = file.match(/^diff --git a\/(.+) b\/(.+)$/m);
    const path = sanitizeWorkspaceRel((names?.[2] ?? names?.[1] ?? "").replace(/\\/g, "/"));
    if (!path) continue;
    const headerMatch = file.match(/^(diff --git .+\n(?:.*\n)*?)(?=@@|$)/);
    const fileHeader = headerMatch?.[1] ?? "";
    if (/^Binary files /m.test(file) || /^GIT binary patch/m.test(file)) continue;
    const parts = file.split(/(?=^@@ )/m);
    for (const part of parts) {
      if (!part.startsWith("@@ ")) continue;
      const header = part.split("\n")[0] ?? "";
      const nums = header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
      const lines: WorkspaceGitHunkLine[] = [];
      for (const line of part.split("\n").slice(1)) {
        if (line.startsWith("\\")) continue;
        if (line.startsWith("+")) lines.push({ kind: "add", text: line.slice(1) });
        else if (line.startsWith("-")) lines.push({ kind: "del", text: line.slice(1) });
        else if (line.startsWith(" ") || line === "")
          lines.push({ kind: "ctx", text: line.slice(1) });
      }
      const body = part.endsWith("\n") ? part : `${part}\n`;
      hunks.push({
        path,
        staged,
        header,
        patch: `${fileHeader}${body}`,
        oldStart: Number(nums?.[1] ?? 1),
        newStart: Number(nums?.[2] ?? 1),
        lines,
      });
    }
  }
  return hunks;
}

export async function workspaceGitHunks(root: string, rel?: string): Promise<WorkspaceGitHunk[]> {
  const path = rel ? sanitizeWorkspaceRel(rel) : "";
  const scoped = path ? ["--", path] : [];
  const unstaged = await git(root, ["diff", "-U3", ...scoped]).catch(() => "");
  const staged = await git(root, ["diff", "--cached", "-U3", ...scoped]).catch(() => "");
  return [...parseUnifiedHunks(staged, true), ...parseUnifiedHunks(unstaged, false)];
}

export async function workspaceGitStageHunk(
  root: string,
  patch: string,
  unstage = false,
): Promise<WorkspaceGitStatus> {
  const body = patch.trim();
  if (!body.startsWith("diff --git ")) throw new Error("Invalid hunk patch");
  const file = join(tmpdir(), `locus-hunk-${process.pid}-${Date.now()}.patch`);
  await writeFile(file, body.endsWith("\n") ? body : `${body}\n`);
  try {
    await git(
      root,
      unstage ? ["apply", "--cached", "--reverse", "--", file] : ["apply", "--cached", "--", file],
    );
  } finally {
    await unlink(file).catch(() => undefined);
  }
  return workspaceGitStatus(root);
}

export async function workspaceGitRebasePreview(root: string): Promise<WorkspaceGitRebaseStatus> {
  const conflicted = (await git(root, ["diff", "--name-only", "--diff-filter=U"]).catch(() => ""))
    .split("\n")
    .map((row) => sanitizeWorkspaceRel(row.trim()))
    .filter(Boolean);
  let onto = "";
  try {
    onto = (await git(root, ["rev-parse", "--abbrev-ref", "@{upstream}"])).trim();
  } catch {
    onto = "";
  }
  if (!onto || !(await gitOk(root, ["rev-parse", "--verify", onto]))) {
    const head = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
    const count =
      Number((await git(root, ["rev-list", "--count", "HEAD"]).catch(() => "1")).trim()) || 1;
    const depth = Math.min(10, Math.max(1, count - 1));
    if (head !== "main" && (await gitOk(root, ["rev-parse", "--verify", "main"]))) onto = "main";
    else onto = count > 1 ? `HEAD~${depth}` : "HEAD";
  }
  const range = rebaseInProgress(root) ? "REBASE" : `${onto}..HEAD`;
  const log =
    range === "REBASE"
      ? ""
      : await git(root, ["log", "--reverse", "--format=%H\t%s", range]).catch(() => "");
  const todos: WorkspaceGitRebaseTodo[] = [];
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const tab = line.indexOf("\t");
    const sha = tab >= 0 ? line.slice(0, tab) : line.trim();
    const message = tab >= 0 ? line.slice(tab + 1) : "";
    if (sha) todos.push({ action: "pick", sha, message });
  }
  return { onto, todos, rebasing: rebaseInProgress(root), conflicted };
}

function rebaseEditorScript(todoPath: string, messagesPath: string): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const target = process.argv[2] || process.argv[1];
if (!target) process.exit(0);
if (String(target).includes("git-rebase-todo")) {
  fs.copyFileSync(${JSON.stringify(todoPath)}, target);
  process.exit(0);
}
let queue = [];
try { queue = JSON.parse(fs.readFileSync(${JSON.stringify(messagesPath)}, "utf8")); } catch {}
const next = Array.isArray(queue) ? queue.shift() : null;
fs.writeFileSync(${JSON.stringify(messagesPath)}, JSON.stringify(queue ?? []));
if (typeof next === "string" && next.trim()) fs.writeFileSync(target, next.trim() + "\\n");
`;
}

export async function workspaceGitRebase(
  root: string,
  input: { onto?: string; todos: WorkspaceGitRebaseTodo[] },
): Promise<WorkspaceGitStatus> {
  if (rebaseInProgress(root)) throw new Error("A rebase is already in progress");
  if (!input.todos.length) throw new Error("Pick commits to rebase");
  const onto = (input.onto ?? "").trim() || (await workspaceGitRebasePreview(root)).onto;
  const dir = await mkdtemp(join(tmpdir(), "locus-rebase-"));
  const todoPath = join(dir, "todo");
  const messagesPath = join(dir, "messages.json");
  const editorPath = join(dir, "editor.cjs");
  const todo = input.todos
    .map((row) => {
      if (!/^[0-9a-f]{7,40}$/i.test(row.sha)) throw new Error("Invalid rebase sha");
      if (!["pick", "reword", "squash", "fixup", "drop"].includes(row.action)) {
        throw new Error("Invalid rebase action");
      }
      return `${row.action} ${row.sha} ${row.message}`.trimEnd();
    })
    .join("\n");
  const messages = input.todos
    .filter((row) => row.action === "reword")
    .map((row) => row.message.trim())
    .filter(Boolean);
  await writeFile(todoPath, `${todo}\n`);
  await writeFile(messagesPath, JSON.stringify(messages));
  await writeFile(editorPath, rebaseEditorScript(todoPath, messagesPath));
  const editorCmd = `"${process.execPath}" "${editorPath}"`;
  const args = onto === "--root" ? ["rebase", "-i", "--root"] : ["rebase", "-i", onto];
  try {
    await git(root, args, 60_000, {
      GIT_SEQUENCE_EDITOR: editorCmd,
      GIT_EDITOR: editorCmd,
    });
  } finally {
    await unlink(todoPath).catch(() => undefined);
    await unlink(messagesPath).catch(() => undefined);
    await unlink(editorPath).catch(() => undefined);
  }
  return workspaceGitStatus(root);
}

export async function workspaceGitRebaseContinue(
  root: string,
  action: "continue" | "abort" | "skip",
): Promise<WorkspaceGitStatus> {
  if (action === "abort") await git(root, ["rebase", "--abort"]);
  else if (action === "skip") await git(root, ["rebase", "--skip"]);
  else {
    await git(root, ["-c", "core.editor=true", "rebase", "--continue"], 60_000, {
      GIT_EDITOR: "true",
    });
  }
  return workspaceGitStatus(root);
}

/** Used by tests that need a synchronous git binary check. */
export function gitAvailable(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
