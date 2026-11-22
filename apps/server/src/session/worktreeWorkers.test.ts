import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { AgentSession, GuestOs } from "@locus/shared";
import type { GuestRuntime, ToolRequest, ToolResult } from "@locus/guest-agent";
import { GuestHub } from "../core/guests.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "./sessions.js";

const exec = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  exec("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);

class StubHostHub extends GuestHub {
  override forHost(_sessionId: string, os: GuestOs): GuestRuntime {
    return {
      liveGuest: true,
      os,
      execute: async (_req: ToolRequest): Promise<ToolResult> => ({ ok: true, output: "" }),
      syncHostDirToGuest: async () => undefined,
      prepareHostWorkspace: async () => undefined,
      chromium: () => undefined,
    };
  }
}

async function waitIdle(sessions: SessionService, ids: string[]): Promise<void> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const rows = await Promise.all(ids.map((id) => sessions.get(id)));
    if (rows.every((row) => row && row.status !== "running")) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("worktree parallel agents", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function setup() {
    const dir = await mkdtemp(join(tmpdir(), "locus-wt-sessions-"));
    cleanup.push(dir);
    const source = join(dir, "repo");
    await mkdir(source, { recursive: true });
    await git(source, "init", "-q", "-b", "main");
    await writeFile(join(source, "app.ts"), "export const x = 1;\n");
    await writeFile(join(source, ".gitignore"), ".env\n");
    await writeFile(join(source, ".env"), "TOKEN=abc\n");
    await git(source, "add", "-A");
    await git(source, "commit", "-qm", "init");
    const store = new JsonStore(join(dir, "data"));
    await store.init();
    const config = await store.loadConfig();
    const sessions = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "done" };
      },
      new StubHostHub(),
    );
    const base = {
      os: "ubuntu" as const,
      templateId: config.templates[0]!.id,
      runtime: "host" as const,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    };
    const alt = config.providers[1]!;
    return { dir, source, store, sessions, base, alt };
  }

  it("creates a single agent in its own worktree and cleans up an empty branch", async () => {
    const { source, sessions, base } = await setup();
    const s = await sessions.create({
      ...base,
      title: "Solo task",
      hostDir: source,
      worktree: true,
    });
    expect(s.worktree?.branch).toMatch(/^locus\/solo-task-/);
    expect(s.hostDir).toBe(s.worktree?.path);
    expect(s.hostDir).not.toBe(source);
    expect(await readFile(join(s.hostDir!, "app.ts"), "utf8")).toContain("x = 1");
    expect(await readFile(join(s.hostDir!, ".env"), "utf8")).toBe("TOKEN=abc\n");
    expect(s.messages.some((m) => m.content.includes(s.worktree!.branch))).toBe(true);
    await sessions.remove(s.id);
    expect(existsSync(s.worktree!.path)).toBe(false);
    const branches = (await git(source, "branch", "--format=%(refname:short)")).stdout;
    expect(branches).not.toContain("locus/solo-task");
  });

  it("refuses worktrees on a folder that is not a git checkout", async () => {
    const { dir, sessions, base } = await setup();
    const plain = join(dir, "plain");
    await mkdir(plain);
    await expect(sessions.create({ ...base, hostDir: plain, worktree: true })).rejects.toThrow(
      /not a git checkout/,
    );
  });

  it("uses the shared checkout verification plan to run checks inside each idle attempt", async () => {
    const { source, sessions, base, alt } = await setup();
    await mkdir(join(source, ".locus"), { recursive: true });
    await writeFile(
      join(source, ".locus", "environment.json"),
      JSON.stringify({
        verify: {
          test: "node -e \"const value = require('fs').readFileSync('app.ts', 'utf8'); console.log(value); if (value.includes('x = 2')) process.exit(1)\"",
        },
      }),
    );
    await git(source, "add", "-A");
    await git(source, "commit", "-qm", "verify");
    const { parent, workers } = await sessions.fanout({
      create: { ...base, hostDir: source },
      agents: [
        { providerId: base.providerId, model: base.model },
        { providerId: alt.id, model: alt.defaultModel },
      ],
      prompt: "make a change",
    });
    await waitIdle(
      sessions,
      workers.map((member) => member.id),
    );
    const changed = workers[1]!.worktree!.path;
    await writeFile(join(changed, "app.ts"), "export const x = 2;\n");
    await writeFile(join(changed, ".locus", "environment.json"), '{"verify":{"test":"node -e 0"}}');
    const result = await sessions.verifyWorkers(parent.id);
    expect(result.map((row) => row.checks.map((check) => check.status))).toEqual([
      ["passed", "skipped", "skipped"],
      ["failed", "skipped", "skipped"],
    ]);
    expect(result[1]?.checks[0]?.output).toContain("x = 2");
  });

  it("fans one prompt out to mixed providers, then merges one and discards the other", async () => {
    const { source, sessions, base, alt } = await setup();
    const { parent, workers } = await sessions.fanout({
      create: { ...base, title: "Speed up build", hostDir: source },
      agents: [
        { providerId: base.providerId, model: base.model },
        { providerId: alt.id, model: alt.defaultModel },
      ],
      prompt: "make it faster",
    });
    expect(parent.worktree).toBeUndefined();
    expect(parent.hostDir).toBe(source);
    expect(parent.compare).toMatchObject({ kind: "workers", role: "parent" });
    expect(workers).toHaveLength(2);
    const [one, two] = workers as [AgentSession, AgentSession];
    expect(one.providerId).toBe(base.providerId);
    expect(two.providerId).toBe(alt.id);
    expect(one.worktree?.path).not.toBe(two.worktree?.path);
    expect(one.worktree?.branch).not.toBe(two.worktree?.branch);
    expect(one.compare).toMatchObject({ kind: "workers", role: "1", parentId: parent.id });
    expect(one.playbook).toContain(one.worktree!.branch);
    expect(one.messages.some((m) => m.role === "user" && m.content === "make it faster")).toBe(
      true,
    );
    await waitIdle(sessions, [one.id, two.id]);

    await writeFile(join(one.worktree!.path, "app.ts"), "export const x = 2;\n");
    await writeFile(join(two.worktree!.path, "other.ts"), "export const y = 1;\n");
    const board = await sessions.workerBoard(parent.id);
    expect(board.map((row) => row.role)).toEqual(["1", "2"]);
    expect(board[0]).toMatchObject({ dirty: 1, stat: { files: 1, insertions: 1, deletions: 1 } });
    expect(board[1]?.stat.files).toBe(1);
    expect(board[0]?.files).toEqual(["app.ts"]);
    expect(board[1]?.files).toEqual(["other.ts"]);
    expect(board[0]?.tests).toBe("none");
    const ranking = await sessions.rankWorkers(parent.id);
    expect(ranking.entries.map((row) => row.id).sort()).toEqual([one.id, two.id].sort());
    expect(ranking.entries.map((row) => row.rank)).toEqual([1, 2]);
    const diffs = await sessions.workerDiffs(parent.id);
    expect(diffs[0]?.diff).toContain("+export const x = 2;");

    const merged = await sessions.mergeWorker(parent.id, one.id);
    expect(merged.messages.at(-1)?.content).toContain(`Merged ${one.worktree!.branch}`);
    expect(await readFile(join(source, "app.ts"), "utf8")).toBe("export const x = 2;\n");

    await sessions.discardWorker(two.id);
    expect(await sessions.get(two.id)).toBeUndefined();
    expect(existsSync(two.worktree!.path)).toBe(false);
    const branches = (await git(source, "branch", "--format=%(refname:short)")).stdout;
    expect(branches).not.toContain(two.worktree!.branch);
    expect(branches).toContain(one.worktree!.branch);
  });

  it("forks a worktree agent into a fresh worktree carrying its uncommitted files", async () => {
    const { source, sessions, base } = await setup();
    const s = await sessions.create({
      ...base,
      title: "Forkable",
      hostDir: source,
      worktree: true,
    });
    await writeFile(join(s.worktree!.path, "wip.ts"), "wip\n");
    const forked = await sessions.fork(s.id);
    expect(forked.worktree?.path).toBeDefined();
    expect(forked.worktree?.path).not.toBe(s.worktree?.path);
    expect(await readFile(join(forked.worktree!.path, "wip.ts"), "utf8")).toBe("wip\n");
    const top = (
      await git(forked.worktree!.path, "rev-parse", "--abbrev-ref", "HEAD")
    ).stdout.trim();
    expect(top).toBe(forked.worktree!.branch);
  });

  it("rejects host fan-out without a git checkout", async () => {
    const { dir, sessions, base } = await setup();
    const plain = join(dir, "plain");
    await mkdir(plain);
    await expect(
      sessions.fanout({
        create: { ...base, hostDir: plain },
        agents: [
          { providerId: base.providerId, model: base.model },
          { providerId: base.providerId, model: base.model },
        ],
        prompt: "go",
      }),
    ).rejects.toThrow(/need a git checkout/);
  });
});
