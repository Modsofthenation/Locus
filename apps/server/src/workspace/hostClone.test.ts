import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { hostWorkspaceDir, MockHypervisor } from "@locus/hypervisor";
import type { GuestOs } from "@locus/shared";
import type { GuestRuntime, ToolRequest, ToolResult } from "@locus/guest-agent";
import { GuestHub } from "../core/guests.js";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

const execFileAsync = promisify(execFile);

async function waitUntilIdle(sessions: SessionService, sessionId: string) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const fresh = await sessions.get(sessionId);
    if (fresh?.status === "idle" && fresh.messages.some((m) => m.role === "assistant"))
      return fresh;
    await new Promise((r) => setTimeout(r, 20));
  }
  return sessions.get(sessionId);
}

class CaptureHostHub extends GuestHub {
  clones: ToolRequest[] = [];
  cloneResult?: (req: ToolRequest, hostRoot: string) => Promise<ToolResult> | ToolResult;
  override forHost(_sessionId: string, os: GuestOs, hostRoot: string): GuestRuntime {
    return {
      liveGuest: true,
      os,
      execute: async (req: ToolRequest): Promise<ToolResult> => {
        if (req.name === "git_clone") {
          this.clones.push(req);
          if (this.cloneResult) return await this.cloneResult(req, hostRoot);
        }
        return { ok: true, output: "cloned" };
      },
      syncHostDirToGuest: async () => undefined,
      prepareHostWorkspace: async () => undefined,
      chromium: () => undefined,
    };
  }
}

describe("host IDE clone", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("passes the GitHub token to git_clone for Open in IDE", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-clone-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    github.token = "gho_test_token";
    await store.saveConfig(config);
    const guests = new CaptureHostHub();
    const sessions = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "ok" };
      },
      guests,
    );
    await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "ide",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      repo: { forge: "github", url: "https://github.com/acme/app.git", accountId: github.id },
    });
    expect(guests.clones).toHaveLength(1);
    expect(guests.clones[0]?.args.token).toBe("gho_test_token");
    expect(String(guests.clones[0]?.args.url)).toMatch(/acme\/app/);
  });

  it("uses another GitHub token when the linked account id is signed out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-clone-fallback-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const empty = config.forges.find((row) => row.kind === "github")!;
    config.forges.push({
      id: "gh-live",
      kind: "github",
      name: "Work GitHub",
      apiBaseUrl: "https://api.github.com",
      token: "gho_live_token",
    });
    await store.saveConfig(config);
    const guests = new CaptureHostHub();
    const sessions = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "ok" };
      },
      guests,
    );
    await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "ide",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      repo: { forge: "github", url: "https://github.com/acme/app.git", accountId: empty.id },
    });
    expect(guests.clones[0]?.args.token).toBe("gho_live_token");
  });

  it("does not clone again when an old host chat already has the repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-clone-resume-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const github = config.forges.find((row) => row.kind === "github")!;
    github.token = "gho_test_token";
    await store.saveConfig(config);
    const created = new CaptureHostHub();
    const first = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "ok" };
      },
      created,
    );
    const session = await first.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "ide",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      repo: { forge: "github", url: "https://github.com/acme/app.git", accountId: github.id },
    });
    expect(created.clones).toHaveLength(1);
    const workspace = hostWorkspaceDir(dir, session.id);
    const gitEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    await execFileAsync("git", ["init", "-b", "main"], { cwd: workspace, env: gitEnv });
    await execFileAsync("git", ["config", "user.email", "locus@test"], {
      cwd: workspace,
      env: gitEnv,
    });
    await execFileAsync("git", ["config", "user.name", "Locus"], { cwd: workspace, env: gitEnv });
    await writeFile(join(workspace, "README.md"), "app\n");
    await execFileAsync("git", ["add", "."], { cwd: workspace, env: gitEnv });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: workspace, env: gitEnv });

    const resume = new CaptureHostHub();
    resume.cloneResult = async (_req, hostRoot) => ({
      ok: false,
      output: `fatal: destination path '${hostRoot}' already exists and is not an empty directory.`,
    });
    const second = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "ok" };
      },
      resume,
    );
    const before = (await second.get(session.id))?.messages.filter(
      (m) => m.role === "system" && /Cloning |Cloned |Clone failed:/.test(m.content),
    ).length;
    await second.sendChat(session.id, "continue from yesterday");
    const fresh = await waitUntilIdle(second, session.id);
    const cloneNotes =
      fresh?.messages.filter(
        (m) => m.role === "system" && /Cloning |Cloned |Clone failed:/.test(m.content),
      ) ?? [];
    expect(resume.clones).toHaveLength(0);
    expect(cloneNotes).toHaveLength(before ?? 0);
    expect(fresh?.messages.some((m) => /Clone failed:/.test(m.content))).toBe(false);
  });

  it("clones again after a restart when the host workspace has no checkout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-host-clone-empty-resume-"));
    cleanup.push(dir);
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const created = new CaptureHostHub();
    const first = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "ok" };
      },
      created,
    );
    const session = await first.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "ide",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
      repo: { forge: "github", url: "https://github.com/acme/app.git" },
    });
    expect(created.clones).toHaveLength(1);
    const resume = new CaptureHostHub();
    const second = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "ok" };
      },
      resume,
    );
    await second.sendChat(session.id, "try again");
    await waitUntilIdle(second, session.id);
    expect(resume.clones).toHaveLength(1);
  });
});
