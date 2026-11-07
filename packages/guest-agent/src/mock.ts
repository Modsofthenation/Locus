import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type { GuestOs } from "@locus/shared";
import {
  execArgCommands,
  fileReadPaths,
  isRecordScreenMode,
  isWindows,
  resolvePatchPath,
  sanitizeArtifactStem,
  sanitizeRecordingName,
  repoMapPathSkipped,
} from "@locus/shared";
import { applyGuestPatch } from "./applyPatch.js";
import type { GuestRuntime, ToolRequest, ToolResult } from "./types.js";
import { containedPath, ensureParentInside } from "./containedPath.js";
import { num, optNum, str, grepContextLines } from "./types.js";

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function mockSnapshotRef(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "@e0";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

const MOCK_CLONE_TICKS = [
  "remote: Enumerating objects: 1234, done.\n",
  "remote: Counting objects: 100% (1234/1234), done.\n",
  "Receiving objects:  12% (148/1234)\r",
  "Receiving objects:  45% (555/1234), 1.20 MiB | 800.00 KiB/s\r",
  "Receiving objects: 100% (1234/1234), 12.34 MiB | 2.00 MiB/s, done.\n",
  "Resolving deltas:  20% (80/400)\r",
  "Resolving deltas:  97% (388/400)\r",
  "Resolving deltas: 100% (400/400), done.\n",
];

async function emitMockCloneProgress(
  onOutput?: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!onOutput) return;
  const delayMs = process.env.VITEST ? 0 : 550;
  for (const tick of MOCK_CLONE_TICKS) {
    if (signal?.aborted) return;
    onOutput(tick);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export class MockGuestRuntime implements GuestRuntime {
  files = new Map<string, string>();
  log: ToolRequest[] = [];
  clipboard = "";
  cwd: string;
  branch = "main";
  private root?: string;
  recording = false;
  tracing = false;

  constructor(
    readonly os: GuestOs,
    opts?: { cwd?: string; root?: string },
  ) {
    this.cwd =
      opts?.cwd ?? (isWindows(os) ? "C:\\Users\\locus\\workspace" : "/home/locus/workspace");
    this.root = opts?.root?.trim() || undefined;
    this.files.set(this.cwd, "");
  }

  async syncHostDirToGuest(_hostDir: string, _guestDir: string): Promise<void> {}

  async prepareHostWorkspace(): Promise<void> {}

  chromium() {
    return undefined;
  }

  async execute(
    req: ToolRequest,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult> {
    this.log.push(req);
    switch (req.name) {
      case "exec":
      case "powershell": {
        const cwd = str(req.args, "cwd");
        const timeout = optNum(req.args, "timeout_ms");
        const extra = [
          cwd ? `cwd=${cwd}` : "",
          timeout != null ? `timeout_ms=${timeout}` : "",
        ].filter(Boolean);
        const cmds = execArgCommands(req.args);
        return {
          ok: true,
          output: `[${this.os}] $ ${cmds.join(" && ") || str(req.args, "command")}${extra.length ? ` (${extra.join(" ")})` : ""}\n(mock)`,
        };
      }
      case "screenshot":
        return { ok: true, output: "screenshot captured", screenshotBase64: TINY_PNG };
      case "record_screen": {
        const mode = str(req.args, "mode");
        if (!isRecordScreenMode(mode)) {
          return { ok: false, output: `unsupported record_screen mode: ${mode || "(missing)"}` };
        }
        if (mode === "START_RECORDING") {
          if (this.recording) return { ok: false, output: "already recording" };
          this.recording = true;
          return { ok: true, output: "recording started" };
        }
        if (mode === "DISCARD_RECORDING") {
          if (!this.recording) return { ok: false, output: "not recording" };
          this.recording = false;
          return { ok: true, output: "recording discarded" };
        }
        if (!this.recording) return { ok: false, output: "not recording" };
        this.recording = false;
        const recordingName = `${sanitizeRecordingName(str(req.args, "save_as_filename"))}.mp4`;
        return { ok: true, output: `recording saved: ${recordingName}`, recordingName };
      }
      case "file_write": {
        const path = this.guestPath(str(req.args, "path"));
        const content = str(req.args, "content");
        const persist = await this.persistFile(path, content);
        if (persist === "reject") return { ok: false, output: `refusing to write ${path}` };
        this.files.set(path, content);
        return { ok: true, output: `wrote ${path}` };
      }
      case "file_read": {
        const paths = fileReadPaths(req.args).map((path) => this.guestPath(path));
        if (!paths.length) return { ok: false, output: "file_read needs path or paths" };
        const parts: string[] = [];
        for (const path of paths) {
          const content = this.files.get(path) ?? (await this.readPersisted(path));
          if (content === undefined) {
            if (paths.length === 1) return { ok: false, output: `not found: ${path}` };
            parts.push(`=== ${path} ===\nnot found: ${path}`);
            continue;
          }
          if (!this.files.has(path)) this.files.set(path, content);
          const offset = optNum(req.args, "offset");
          const limit = optNum(req.args, "limit");
          let body = content;
          if (offset != null || limit != null) {
            const lines = content.split("\n");
            const start = Math.max(0, Math.round(offset ?? 1) - 1);
            const count = Math.max(1, Math.round(limit ?? lines.length));
            body = lines.slice(start, start + count).join("\n");
          }
          parts.push(paths.length > 1 ? `=== ${path} ===\n${body}` : body);
        }
        return { ok: true, output: parts.join("\n") };
      }
      case "file_list": {
        const prefix = this.guestPath(str(req.args, "path", this.cwd));
        const entries = [...this.files.keys()].filter((p) => p.startsWith(prefix));
        return { ok: true, output: entries.join("\n") };
      }
      case "grep": {
        const pattern = str(req.args, "pattern");
        const prefix = this.guestPath(str(req.args, "path", this.cwd));
        const ctx = grepContextLines(req.args);
        const re = new RegExp(pattern, "i");
        const hits: string[] = [];
        let matches = 0;
        for (const [path, content] of this.files) {
          if (!path.startsWith(prefix) || path === this.cwd || repoMapPathSkipped(path)) continue;
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i += 1) {
            if (!re.test(lines[i]!)) continue;
            if (ctx > 0 && hits.length) hits.push("--");
            const from = Math.max(0, i - ctx);
            const to = Math.min(lines.length - 1, i + ctx);
            for (let j = from; j <= to; j += 1) {
              const sep = j === i ? ":" : "-";
              hits.push(`${path}${sep}${j + 1}${sep}${lines[j]}`);
            }
            matches += 1;
            if (matches >= 40) break;
          }
          if (matches >= 40) break;
        }
        return { ok: true, output: hits.join("\n") || "(no matches)" };
      }
      case "glob": {
        const pattern = str(req.args, "pattern")
          .replace(/\*\*/g, "*")
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*");
        const re = new RegExp(pattern + "$");
        const prefix = this.guestPath(str(req.args, "path", this.cwd));
        const hits = [...this.files.keys()].filter(
          (p) => p.startsWith(prefix) && !repoMapPathSkipped(p) && re.test(p),
        );
        return { ok: true, output: hits.join("\n") || "(no matches)" };
      }
      case "apply_patch": {
        const result = await applyGuestPatch({
          patch: str(req.args, "patch"),
          requestedCwd: str(req.args, "path", this.cwd),
          workspace: this.cwd,
          isFile: (p) => this.files.has(p) && p !== this.cwd,
          read: async (path) => ({ content: this.files.get(path) }),
          write: async (path, content) => {
            if (path === this.cwd) return;
            const persist = await this.persistFile(path, content);
            if (persist === "reject") return { ok: false, output: `refusing to write ${path}` };
            this.files.set(path, content);
          },
          remove: async (path) => {
            this.files.delete(path);
          },
        });
        return result ?? { ok: false, output: "patch failed" };
      }
      case "git_clone": {
        const url = str(req.args, "url");
        const dest = str(req.args, "dest", `${this.cwd}/repo`);
        await emitMockCloneProgress(onOutput, signal);
        const readme = `${dest}/README.md`;
        const content = `cloned ${url}\n`;
        this.files.set(`${dest}/.git`, url);
        this.files.set(readme, content);
        await this.persistFile(readme, content);
        return { ok: true, output: `Cloned ${url} into ${dest}` };
      }
      case "git_fetch": {
        const path = str(req.args, "path", this.cwd);
        const ref =
          str(req.args, "ref") ||
          (typeof req.args.pull === "number" ? `pr-${req.args.pull}` : "HEAD");
        this.files.set(`${path}/.git`, this.files.get(`${path}/.git`) ?? "origin");
        return { ok: true, output: `Fetched ${ref} into ${path}` };
      }
      case "git_status":
        return { ok: true, output: `On branch ${this.branch}\nnothing to commit` };
      case "git_diff":
        return { ok: true, output: "diff --git a/README.md b/README.md\n+mock" };
      case "git_log":
        return { ok: true, output: `abc123 (HEAD -> ${this.branch}) mock commit` };
      case "git_commit":
        return { ok: true, output: `[${this.branch}] ${str(req.args, "message")}` };
      case "git_branch":
        this.branch = str(req.args, "name") || this.branch;
        return { ok: true, output: `Switched to branch ${this.branch}` };
      case "git_push":
        return { ok: true, output: "pushed" };
      case "git_stash":
        return { ok: true, output: str(req.args, "action") === "pop" ? "stash pop" : "stash push" };
      case "git_revert":
        return { ok: true, output: `reverted ${str(req.args, "commit", "HEAD")}` };
      case "browser_tabs":
        return { ok: true, output: "tab-1 about:blank" };
      case "browser_navigate":
        return { ok: true, output: `opened ${str(req.args, "url")}` };
      case "browser_snapshot":
        return { ok: true, output: '@e1 button "Submit"' };
      case "browser_click": {
        const ref = mockSnapshotRef(str(req.args, "ref"));
        if (ref !== "@e1") {
          return { ok: false, output: `Unknown ref ${ref}. Call browser_snapshot first.` };
        }
        return { ok: true, output: `clicked ${ref}` };
      }
      case "browser_type": {
        const ref = mockSnapshotRef(str(req.args, "ref"));
        if (ref !== "@e1") {
          return { ok: false, output: `Unknown ref ${ref}. Call browser_snapshot first.` };
        }
        return { ok: true, output: `typed into ${ref}` };
      }
      case "browser_console":
        return { ok: true, output: "[]" };
      case "browser_network":
        return { ok: true, output: "[]" };
      case "browser_pdf": {
        const artifactName = `${sanitizeArtifactStem(str(req.args, "save_as_filename"), "page")}.pdf`;
        return {
          ok: true,
          output: `pdf saved: ${artifactName}`,
          artifactName,
          artifactKind: "pdf",
          artifactBase64: Buffer.from("%PDF-1.4 mock\n").toString("base64"),
        };
      }
      case "browser_trace": {
        const action = str(req.args, "action") || "stop";
        if (action === "start") {
          if (this.tracing) return { ok: false, output: "already tracing" };
          this.tracing = true;
          return { ok: true, output: "DevTools trace started" };
        }
        if (action !== "stop") return { ok: false, output: "action must be start or stop" };
        if (!this.tracing) return { ok: false, output: "not tracing" };
        this.tracing = false;
        const artifactName = `${sanitizeArtifactStem(str(req.args, "save_as_filename"), "trace")}.json`;
        return {
          ok: true,
          output: `DevTools trace saved: ${artifactName}`,
          artifactName,
          artifactKind: "trace",
          artifactBase64: Buffer.from('{"traceEvents":[]}\n').toString("base64"),
        };
      }
      case "browser_download": {
        const action = str(req.args, "action") || "list";
        if (action === "enable")
          return { ok: true, output: "downloads enabled at /tmp/locus-downloads" };
        if (action === "list") return { ok: true, output: "report.csv" };
        if (action === "get" || action === "latest") {
          const name = action === "get" ? str(req.args, "filename") || "report.csv" : "report.csv";
          return {
            ok: true,
            output: `download saved: ${name}`,
            artifactName: name,
            artifactKind: "download",
            artifactBase64: Buffer.from("id,ok\n1,true\n").toString("base64"),
          };
        }
        return { ok: false, output: "action must be enable, list, latest, or get" };
      }
      case "clipboard_get":
        return { ok: true, output: this.clipboard };
      case "clipboard_set":
        this.clipboard = str(req.args, "text");
        return { ok: true, output: "ok" };
      case "mouse_move":
      case "mouse_click":
      case "mouse_drag":
      case "mouse_scroll":
      case "key":
      case "type_text":
      case "window_list":
      case "window_focus":
      case "start_process":
      case "uia_tree":
      case "a11y_tree":
        return {
          ok: true,
          output: `${req.name} ${JSON.stringify({ x: num(req.args, "x"), y: num(req.args, "y"), ...req.args })}`,
        };
      default:
        return { ok: false, output: `unknown tool ${req.name}` };
    }
  }

  private guestPath(path: string): string {
    return resolvePatchPath(this.cwd, path);
  }

  private hostRel(guestPath: string): string | undefined {
    if (!this.root) return undefined;
    const normalized = guestPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    const cwd = this.cwd.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    if (normalized !== cwd && !normalized.startsWith(`${cwd}/`)) return undefined;
    const rel = normalized === cwd ? "" : normalized.slice(cwd.length + 1);
    if (!rel || rel.split("/").some((part) => part === ".." || part === ".")) return undefined;
    const dest = resolve(this.root, rel);
    const relToRoot = relative(resolve(this.root), dest);
    if (
      relToRoot.startsWith("..") ||
      relToRoot.split(sep).includes("..") ||
      relToRoot.startsWith("/") ||
      relToRoot.includes("://")
    ) {
      return undefined;
    }
    return rel;
  }

  private underCwd(guestPath: string): boolean {
    const normalized = guestPath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    const cwd = this.cwd.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    return normalized === cwd || normalized.startsWith(`${cwd}/`);
  }

  private async persistFile(guestPath: string, content: string): Promise<"ok" | "skip" | "reject"> {
    if (!this.root) return "skip";
    const rel = this.hostRel(guestPath);
    if (!rel) return this.underCwd(guestPath) ? "reject" : "skip";
    const parent = await ensureParentInside(this.root, rel);
    if (!parent) return "reject";
    const target = join(parent, basename(rel));
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isFile()) return "reject";
    } catch {
      /* create */
    }
    try {
      await writeFile(target, content, "utf8");
    } catch {
      return "reject";
    }
    return "ok";
  }

  private async readPersisted(guestPath: string): Promise<string | undefined> {
    if (!this.root) return undefined;
    const rel = this.hostRel(guestPath);
    if (!rel) return undefined;
    const dest = resolve(this.root, rel);
    try {
      const info = await lstat(dest);
      if (info.isSymbolicLink() || !info.isFile()) return undefined;
      const real = await containedPath(this.root, dest);
      if (!real) return undefined;
      return await readFile(dest, "utf8");
    } catch {
      return undefined;
    }
  }
}
