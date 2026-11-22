import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { SAMPLE_TASK_PROMPT, type GuestOs } from "@locus/shared";
import type { GuestRuntime, ToolRequest, ToolResult } from "@locus/guest-agent";
import { GuestHub } from "../core/guests.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SAMPLE_REPO_FILES, sampleRepoDir, startSampleTask } from "./sampleTask.js";
import { SessionService } from "./sessions.js";

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

describe("startSampleTask with SessionService", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("branches a Host worktree from the sample repo under the data dir and sends the prompt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-sample-svc-"));
    cleanup.push(dir);
    const store = new JsonStore(join(dir, "data"));
    await store.init();
    const config = await store.loadConfig();
    config.providers = config.providers.map((row, index) => ({
      ...row,
      enabled: index === 0,
      apiKey: index === 0 ? "sk-test" : "",
    }));
    await store.saveConfig(config);
    const sessions = new SessionService(
      store,
      new MockHypervisor(dir),
      new Hub(),
      async function* () {
        yield { type: "text" as const, text: "done" };
      },
      new StubHostHub(),
    );

    const session = await startSampleTask({
      dataDir: store.dataDir,
      loadConfig: () => store.loadConfig(),
      create: (input, worktreeSource) =>
        sessions.create(input, { waitUntilStarted: false, worktreeSource }),
    });

    expect(session.runtime).toBe("host");
    expect(session.worktree?.source).toBe(sampleRepoDir(store.dataDir));
    expect(session.worktree?.baseBranch).toBe("main");
    expect(session.hostDir).toBe(session.worktree?.path);
    expect(await readFile(join(session.hostDir!, "sum.test.js"), "utf8")).toBe(
      SAMPLE_REPO_FILES["sum.test.js"],
    );
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && (await sessions.get(session.id))?.status === "running") {
      await new Promise((r) => setTimeout(r, 25));
    }
    const stored = await sessions.get(session.id);
    expect(
      stored?.messages.some((row) => row.role === "user" && row.content === SAMPLE_TASK_PROMPT),
    ).toBe(true);
  });
});
