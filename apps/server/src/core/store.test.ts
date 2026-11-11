import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  AgentSession,
  AssetStyle,
  Automation,
  AutomationRun,
  DesignSystem,
  GameStyle,
} from "@locus/shared";
import { DEFAULT_DESIGN_PALETTE } from "@locus/shared";
import { assertWipeableDataDir } from "../defaults.js";
import { JsonStore, SESSION_FLUSH_MS } from "./store.js";

function session(partial: Partial<AgentSession> = {}): AgentSession {
  const t = "2026-08-19T12:00:00.000Z";
  return {
    id: "s1",
    title: "Ubuntu agent",
    os: "ubuntu",
    templateId: "ubuntu",
    providerId: "openai",
    model: "gpt-4.1",
    status: "draft",
    messages: [],
    createdAt: t,
    updatedAt: t,
    ...partial,
  };
}

describe("JsonStore sessions", () => {
  it("writes compact session JSON and skips an identical rewrite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-compact-"));
    const store = new JsonStore(dir);
    await store.init();
    const row = session({
      messages: [
        { id: "m1", role: "assistant", content: "hello", createdAt: "2026-08-19T12:00:00.000Z" },
      ],
    });
    await store.replaceSession(row);
    const path = join(dir, "sessions", "s1.json");
    const first = await readFile(path, "utf8");
    expect(JSON.parse(first)).toEqual(row);
    expect(first.includes("\n  ")).toBe(false);
    await store.replaceSession(row);
    expect(await readFile(path, "utf8")).toBe(first);
  });

  it("replaces sessions.json across boot status updates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session());
    const provisioning = await store.mutateSession("s1", (current) => {
      current.status = "provisioning";
    });
    expect(provisioning?.status).toBe("provisioning");
    const idle = await store.mutateSession("s1", (current) => {
      current.status = "idle";
      current.error = undefined;
    });
    expect(idle?.status).toBe("idle");
    const loaded = await store.loadSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.status).toBe("idle");
    expect(JSON.parse(await readFile(join(dir, "sessions", "s1.json"), "utf8"))).toEqual(loaded[0]);
    expect(await readFile(join(dir, "sessions.json"), "utf8").catch(() => "missing")).toBe(
      "missing",
    );
  });

  it("reads one session from cache without scanning the folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-get-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session());
    await store.replaceSession(session({ id: "s2", title: "Other" }));
    const row = await store.getSession("s1");
    expect(row?.title).toBe("Ubuntu agent");
    expect(await store.getSession("missing")).toBeUndefined();
  });

  it("coalesces persist-later session writes until flush", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-later-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session({ messages: [] }));
    const path = join(dir, "sessions", "s1.json");
    const before = await readFile(path, "utf8");
    await store.mutateSession(
      "s1",
      (current) => {
        current.messages.push({
          id: "m1",
          role: "assistant",
          content: "x",
          createdAt: new Date().toISOString(),
        });
      },
      { persist: "later" },
    );
    expect((await store.getSession("s1"))?.messages).toHaveLength(1);
    expect(await readFile(path, "utf8")).toBe(before);
    await store.flushSession("s1");
    expect(JSON.parse(await readFile(path, "utf8")).messages).toHaveLength(1);
  });

  it("does not resurrect a persist-later session after wipe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-wipe-later-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session({ messages: [] }));
    await store.mutateSession(
      "s1",
      (current) => {
        current.messages.push({
          id: "m1",
          role: "assistant",
          content: "x",
          createdAt: new Date().toISOString(),
        });
      },
      { persist: "later" },
    );
    await store.wipe();
    await new Promise((resolve) => setTimeout(resolve, SESSION_FLUSH_MS + 50));
    expect(await store.loadSessions()).toEqual([]);
    expect(await readFile(join(dir, "sessions", "s1.json"), "utf8").catch(() => "missing")).toBe(
      "missing",
    );
  });

  it("migrates a legacy sessions.json blob into per-session files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-migrate-"));
    const first = session();
    const second = session({ id: "s2", title: "Other" });
    await mkdir(join(dir, "sessions"), { recursive: true });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "sessions.json"), JSON.stringify([first, second]));
    const store = new JsonStore(dir);
    await store.init();
    const loaded = await store.loadSessions();
    expect(loaded.map((row) => row.id).sort()).toEqual(["s1", "s2"]);
    expect(JSON.parse(await readFile(join(dir, "sessions", "s2.json"), "utf8")).title).toBe(
      "Other",
    );
    expect(await readFile(join(dir, "sessions.json.bak"), "utf8")).toContain("s1");
  });

  it("serializes overlapping session writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-race-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session({ messages: [] }));
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.mutateSession("s1", (current) => {
          current.messages.push({
            id: `m${i}`,
            role: "system",
            content: `boot ${i}`,
            createdAt: new Date().toISOString(),
          });
        }),
      ),
    );
    const loaded = await store.loadSessions();
    expect(loaded[0]?.messages).toHaveLength(20);
  });

  it("keeps overlapping writes to different sessions on separate files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-split-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session({ id: "a" }));
    await store.replaceSession(session({ id: "b", title: "B" }));
    await Promise.all([
      store.mutateSession("a", (current) => {
        current.title = "A-done";
      }),
      store.mutateSession("b", (current) => {
        current.title = "B-done";
      }),
    ]);
    const loaded = await store.loadSessions();
    expect(loaded.find((row) => row.id === "a")?.title).toBe("A-done");
    expect(loaded.find((row) => row.id === "b")?.title).toBe("B-done");
  });

  it("deletes a session file and ignores path-like ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-del-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session());
    await store.deleteSession("../etc/passwd");
    await store.deleteSession("s1");
    expect(await store.loadSessions()).toEqual([]);
    expect(await readFile(join(dir, "sessions", "s1.json"), "utf8").catch(() => "missing")).toBe(
      "missing",
    );
  });

  it("wipes the data directory and recreates defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-wipe-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceSession(session());
    await writeFile(join(dir, "marker.txt"), "keep-me-not");
    await store.wipe();
    expect(await store.loadSessions()).toEqual([]);
    expect(await readFile(join(dir, "marker.txt"), "utf8").catch(() => "missing")).toBe("missing");
    const config = await store.loadConfig();
    expect(config.setupCompleted).toBeFalsy();
    expect(config.providers.length).toBeGreaterThan(0);
    expect(config.advanced.dataDir).toBe(dir);
  });

  it("refuses to wipe home or system directories", () => {
    expect(() => assertWipeableDataDir("")).toThrow(/empty/);
    expect(() => assertWipeableDataDir("/")).toThrow(/Refusing/);
    expect(() => assertWipeableDataDir(homedir())).toThrow(/Refusing/);
    expect(() => assertWipeableDataDir("/tmp")).toThrow(/Refusing/);
  });

  it("rejects unsafe load-path notes repo ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-loadpath-"));
    const store = new JsonStore(dir);
    await store.init();
    expect(() => store.loadPathNotesPath("../etc", 1)).toThrow(/Invalid load path notes path/);
    expect(() => store.loadPathNotesPath("not-a-uuid", 1)).toThrow(/Invalid load path notes path/);
    expect(() => store.loadPathNotesPath("11111111-1111-1111-1111-111111111111", 0)).toThrow(
      /Invalid load path notes path/,
    );
    const path = store.loadPathNotesPath("11111111-1111-1111-1111-111111111111", 12);
    expect(path.startsWith(dir)).toBe(true);
    expect(path.endsWith("12.loadpath.json")).toBe(true);
  });

  it("rejects unsafe change-stack repo ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-changestack-"));
    const store = new JsonStore(dir);
    await store.init();
    expect(() => store.changeStackPath("../etc", 1)).toThrow(/Invalid change stack path/);
    expect(() => store.changeStackPath("not-a-uuid", 1)).toThrow(/Invalid change stack path/);
    const path = store.changeStackPath("11111111-1111-1111-1111-111111111111", 12);
    expect(path.startsWith(dir)).toBe(true);
    expect(path.endsWith("12.changestack.json")).toBe(true);
  });

  it("archives the previous change-stack snapshot when the head SHA moves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-changestack-rev-"));
    const store = new JsonStore(dir);
    await store.init();
    const repoId = "11111111-1111-1111-1111-111111111111";
    const first = {
      repoId,
      number: 12,
      headSha: "aaaaaaaaaaaa",
      generatedAt: "2026-09-04T00:00:00.000Z",
      source: "heuristic" as const,
      cohorts: [],
      files: [],
      markdown: "## Change stack",
    };
    const second = { ...first, headSha: "bbbbbbbbbbbb", generatedAt: "2026-09-04T01:00:00.000Z" };
    await store.saveChangeStack(repoId, 12, first);
    await store.saveChangeStack(repoId, 12, second);
    expect((await store.loadChangeStack(repoId, 12))?.headSha).toBe("bbbbbbbbbbbb");
    expect((await store.loadChangeStackRevision(repoId, 12, "aaaaaaaaaaaa"))?.headSha).toBe(
      "aaaaaaaaaaaa",
    );
    const revisions = await store.listChangeStackRevisions(repoId, 12);
    expect(revisions.map((row) => row.headSha)).toEqual(["bbbbbbbbbbbb", "aaaaaaaaaaaa"]);
    expect(revisions[0]!.current).toBe(true);
    expect(() => store.changeStackRevisionPath(repoId, 12, "../etc")).toThrow(
      /Invalid change stack revision path/,
    );
  });

  it("round-trips a PR list cache envelope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-pulls-"));
    const store = new JsonStore(dir);
    await store.init();
    const repoId = "11111111-1111-1111-1111-111111111111";
    const pulls = [
      {
        repoId,
        forge: "github" as const,
        number: 3,
        title: "Fix",
        state: "open" as const,
        headRef: "feat",
        baseRef: "main",
        headSha: "abc",
        url: "https://github.com/acme/app/pull/3",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    ];
    await store.savePullListCache(repoId, "open", pulls, "2026-08-22T11:59:00.000Z");
    const loaded = await store.loadPullListCache(repoId, "open");
    expect(loaded?.fetchedAt).toBe("2026-08-22T11:59:00.000Z");
    expect(loaded?.pulls[0]?.title).toBe("Fix");
    await store.savePullCache(
      repoId,
      3,
      { ...pulls[0]!, files: [], comments: [], commits: [], checks: [] },
      "2026-08-22T11:59:00.000Z",
    );
    const detail = await store.loadPullCache(repoId, 3);
    expect(detail?.pull.number).toBe(3);
    await store.deleteRepo(repoId);
    expect(await store.loadPullListCache(repoId, "open")).toBeUndefined();
    expect(await store.loadPullCache(repoId, 3)).toBeUndefined();
  });

  it("round-trips issue list and detail caches", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-issues-"));
    const store = new JsonStore(dir);
    await store.init();
    const repoId = "11111111-1111-1111-1111-111111111111";
    const issues = [
      {
        repoId,
        forge: "github" as const,
        number: 7,
        title: "Login 500",
        state: "open" as const,
        url: "https://github.com/acme/app/issues/7",
        updatedAt: "2026-08-22T00:00:00.000Z",
      },
    ];
    await store.saveIssueListCache(repoId, "open", issues, "2026-08-22T11:59:00.000Z");
    const loaded = await store.loadIssueListCache(repoId, "open");
    expect(loaded?.issues[0]?.title).toBe("Login 500");
    await store.saveIssueCache(
      repoId,
      7,
      { ...issues[0]!, body: "stack overflow", comments: [] },
      "2026-08-22T11:59:00.000Z",
    );
    const detail = await store.loadIssueCache(repoId, 7);
    expect(detail?.issue.body).toBe("stack overflow");
    await store.deleteRepo(repoId);
    expect(await store.loadIssueListCache(repoId, "open")).toBeUndefined();
  });
});

describe("JsonStore config", () => {
  it("keeps a named environment when a load overlaps a save", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-config-"));
    const store = new JsonStore(dir);
    await store.init();
    const base = await store.loadConfig();
    const env = {
      id: "ebc53596-bd69-40f5-afb9-b3d3f16a3374",
      name: "acme-prod",
      runtime: "docker" as const,
      os: "ubuntu" as const,
      dockerImage: "locus/agent",
      imageId: "img-1",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    await Promise.all([
      store.saveConfig({ ...base, namedEnvironments: [env] }),
      store.loadConfig(),
    ]);
    const loaded = await store.loadConfig();
    expect(loaded.namedEnvironments?.[0]?.id).toBe(env.id);
    expect(loaded.namedEnvironments?.[0]?.imageId).toBe("img-1");
  });

  it("still merges builtin templates after a save seeds the cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-config-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    config.templates = config.templates.filter((t) => t.os === "ubuntu" || t.os === "windows-11");
    await store.saveConfig(config);
    const loaded = await store.loadConfig();
    expect(loaded.templates.map((t) => t.os)).toEqual([
      "ubuntu",
      "windows-11",
      "debian",
      "omarchy",
      "windows-10",
    ]);
    expect(loaded.setupCompleted).toBe(false);
  });

  it("defaults desktop notify prefs to on and keeps an explicit mute", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-notify-"));
    const store = new JsonStore(dir);
    await store.init();
    const loaded = await store.loadConfig();
    expect(loaded.notifyAgents).toBe(true);
    expect(loaded.notifyNeedsYou).toBe(true);
    expect(loaded.notifySlack).toBe(true);
    expect(loaded.notifyAutomations).toBe(true);
    loaded.notifyAgents = false;
    loaded.notifySlack = false;
    await store.saveConfig(loaded);
    const muted = await store.loadConfig();
    expect(muted.notifyAgents).toBe(false);
    expect(muted.notifyNeedsYou).toBe(true);
    expect(muted.notifySlack).toBe(false);
    expect(muted.notifyAutomations).toBe(true);
  });
});

function automation(partial: Partial<Automation> = {}): Automation {
  const t = "2026-08-19T12:00:00.000Z";
  return {
    id: "a1",
    name: "Nightly",
    enabled: true,
    prompt: "ping",
    os: "ubuntu",
    templateId: "ubuntu",
    providerId: "openai",
    model: "gpt-4.1",
    startVm: false,
    schedule: { kind: "interval", everyMinutes: 10 },
    createdAt: t,
    updatedAt: t,
    ...partial,
  };
}

function run(partial: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "r1",
    automationId: "a1",
    status: "succeeded",
    trigger: "schedule",
    startedAt: "2026-08-19T12:00:00.000Z",
    finishedAt: "2026-08-19T12:01:00.000Z",
    ...partial,
  };
}

describe("JsonStore automations", () => {
  it("serializes deleteAutomation with replaceRun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-auto-"));
    const store = new JsonStore(dir);
    await store.init();
    await store.replaceAutomation(automation());
    await store.replaceAutomation(automation({ id: "other", name: "Other" }));
    await store.replaceRun(run({ id: "keep", automationId: "other" }));
    await Promise.all([
      store.replaceRun(run({ id: "drop", automationId: "a1" })),
      store.deleteAutomation("a1"),
    ]);
    const runs = await store.loadRuns();
    expect(runs.some((row) => row.automationId === "other")).toBe(true);
    expect(await store.loadAutomations()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "other" })]),
    );
  });

  it("keeps a per-job cap instead of a global 200-run slice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-runs-"));
    const store = new JsonStore(dir);
    await store.init();
    for (let i = 0; i < 201; i++) {
      await store.replaceRun(
        run({
          id: `a-${i}`,
          automationId: "a1",
          startedAt: `2026-08-20T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
        }),
      );
    }
    await store.replaceRun(
      run({
        id: "b-1",
        automationId: "b1",
        startedAt: "2026-08-19T13:00:00.000Z",
      }),
    );
    const runs = await store.loadRuns();
    expect(runs.filter((row) => row.automationId === "a1")).toHaveLength(201);
    expect(runs.some((row) => row.automationId === "b1")).toBe(true);
  });
});

describe("JsonStore style catalogs", () => {
  const t = "2026-08-21T00:00:00.000Z";

  it("replaces and deletes Design, Asset, and Game style rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-store-styles-"));
    const store = new JsonStore(dir);
    await store.init();
    const system: DesignSystem = {
      id: "sys1",
      name: "Brand",
      summary: "",
      palette: DEFAULT_DESIGN_PALETTE,
      typography: { sans: "Inter", mono: "Mono", display: "Inter", basePx: 16 },
      radiusPx: 8,
      spacePx: 8,
      createdAt: t,
      updatedAt: t,
    };
    const asset: AssetStyle = {
      id: "as1",
      name: "Clay",
      summary: "",
      guidelines: "",
      createdAt: t,
      updatedAt: t,
    };
    const game: GameStyle = {
      id: "gs1",
      name: "Arcade",
      summary: "",
      guidelines: "",
      tilePx: 16,
      hud: "normal",
      juice: "crunchy",
      createdAt: t,
      updatedAt: t,
    };
    await store.replaceDesignSystem(system);
    await store.replaceAssetStyle(asset);
    await store.replaceGameStyle(game);
    expect(await store.loadDesignSystems()).toEqual([system]);
    expect(await store.loadAssetStyles()).toEqual([asset]);
    expect(await store.loadGameStyles()).toEqual([game]);
    await store.replaceDesignSystem({ ...system, name: "Brand 2" });
    expect((await store.loadDesignSystems())[0]?.name).toBe("Brand 2");
    await store.deleteDesignSystem("sys1");
    await store.deleteAssetStyle("as1");
    await store.deleteGameStyle("gs1");
    expect(await store.loadDesignSystems()).toEqual([]);
    expect(await store.loadAssetStyles()).toEqual([]);
    expect(await store.loadGameStyles()).toEqual([]);
  });
});
