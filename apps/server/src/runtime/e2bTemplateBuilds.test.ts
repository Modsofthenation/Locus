import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { E2BTemplateBuilder } from "@locus/compute";
import type { E2BTemplateBuildView } from "@locus/shared";
import { JsonStore } from "../core/store.js";
import { registerWorkerRoutes } from "../http/workerRoutes.js";
import type { SessionService } from "../session/sessions.js";
import { existsSync } from "node:fs";
import {
  E2BTemplateBuilds,
  packagedWorkerBundle,
  resolveCredentialHelper,
  resolveWorkerBundle,
} from "./e2bTemplateBuilds.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "locus-e2b-builds-"));
  dirs.push(dir);
  return dir;
}

function builds(builder: E2BTemplateBuilder["build"]) {
  return new E2BTemplateBuilds({
    builder: { build: vi.fn(builder) },
    workerBundle: async () => "/bundle/locus-worker.mjs",
    credentialHelper: () => "/images/agent/git-credential-locus",
  });
}

describe("E2BTemplateBuilds", () => {
  it("runs one build per worker and records the template ID and logs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const build = vi.fn<E2BTemplateBuilder["build"]>(async (input) => {
      input.onLog?.("apt-get install\n");
      await gate;
      return { templateId: "tpl-1", buildId: "b-1", name: "locus-worker" };
    });
    const jobs = new E2BTemplateBuilds({
      builder: { build },
      workerBundle: async () => "/bundle/locus-worker.mjs",
      credentialHelper: () => "/images/agent/git-credential-locus",
    });
    const { view, done } = jobs.start({
      workerId: "w1",
      apiKey: "key",
      size: "2-2",
      agentClis: true,
    });
    expect(view.state).toBe("running");
    expect(() =>
      jobs.start({ workerId: "w1", apiKey: "key", size: "2-2", agentClis: true }),
    ).toThrow(/already running/);
    release();
    await done;
    expect(jobs.get(view.id)).toMatchObject({
      state: "succeeded",
      templateId: "tpl-1",
      logs: expect.arrayContaining(["apt-get install", "Template locus-worker ready (tpl-1)"]),
    });
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "key",
        workerBundle: "/bundle/locus-worker.mjs",
        credentialHelper: "/images/agent/git-credential-locus",
        size: "2-2",
        agentClis: true,
      }),
    );
  });

  it("reports a failed build and lets the worker try again", async () => {
    const jobs = builds(async () => {
      throw new Error("401: invalid API key");
    });
    const first = jobs.start({ workerId: "w1", apiKey: "bad", size: "2-2", agentClis: false });
    await first.done;
    expect(jobs.get(first.view.id)).toMatchObject({
      state: "failed",
      error: "401: invalid API key",
    });
    expect(() =>
      jobs.start({ workerId: "w1", apiKey: "bad", size: "2-2", agentClis: false }),
    ).not.toThrow();
  });

  it("refuses to start without an API key", () => {
    const jobs = builds(async () => ({ templateId: "x", buildId: "y", name: "z" }));
    expect(() => jobs.start({ workerId: "w1", apiKey: " ", size: "2-2", agentClis: true })).toThrow(
      /API key/,
    );
  });
});

describe("packagedWorkerBundle", () => {
  it("prefers LOCUS_WORKER_BUNDLE, then resources, then cwd", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "res", "worker"), { recursive: true });
    await mkdir(join(dir, "cwd", "worker"), { recursive: true });
    await writeFile(join(dir, "env.mjs"), "");
    await writeFile(join(dir, "res", "worker", "locus-worker.mjs"), "");
    await writeFile(join(dir, "cwd", "worker", "locus-worker.mjs"), "");
    const opts = { resourcesPath: join(dir, "res"), cwd: join(dir, "cwd") };
    expect(
      packagedWorkerBundle({ ...opts, env: { LOCUS_WORKER_BUNDLE: join(dir, "env.mjs") } }),
    ).toBe(join(dir, "env.mjs"));
    expect(packagedWorkerBundle({ ...opts, env: {} })).toBe(
      join(dir, "res", "worker", "locus-worker.mjs"),
    );
    expect(packagedWorkerBundle({ cwd: join(dir, "cwd"), env: {} })).toBe(
      join(dir, "cwd", "worker", "locus-worker.mjs"),
    );
    expect(packagedWorkerBundle({ cwd: dir, env: {} })).toBeUndefined();
  });
});

describe("resolveWorkerBundle", () => {
  it("bundles the worker from a repo checkout when no packaged bundle exists", async () => {
    const dir = await tempDir();
    vi.stubEnv("LOCUS_WORKER_BUNDLE", "");
    try {
      const bundle = await resolveWorkerBundle({ dataDir: dir, cwd: dir });
      expect(bundle).toBe(join(dir, "cache", "locus-worker.mjs"));
      expect(existsSync(bundle)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(existsSync(resolveCredentialHelper())).toBe(true);
  }, 60_000);
});

describe("E2B template routes", () => {
  async function routes() {
    const store = new JsonStore(await tempDir());
    await store.init();
    const config = await store.loadConfig();
    config.workers = [{ id: "w1", name: "E2B", kind: "e2b", url: "", token: "saved-key" }];
    await store.saveConfig(config);
    const build = vi.fn<E2BTemplateBuilder["build"]>(async () => ({
      templateId: "tpl-9",
      buildId: "b-9",
      name: "locus-worker",
    }));
    const templateBuilds = new E2BTemplateBuilds({
      builder: { build },
      workerBundle: async () => "/bundle.mjs",
      credentialHelper: () => "/helper",
    });
    const app = new Hono();
    registerWorkerRoutes(app, {
      store,
      sessions: {} as SessionService,
      templateBuilds,
    });
    return { app, build };
  }

  it("starts a build with the vaulted key when the desktop sends a masked one", async () => {
    const { app, build } = await routes();
    const started = await app.request("/api/workers/compute/e2b/template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worker: { id: "w1", name: "E2B", kind: "e2b", token: "••••••••" },
        size: "8-8",
        agentClis: false,
      }),
    });
    expect(started.status).toBe(200);
    const { build: view } = (await started.json()) as { build: E2BTemplateBuildView };
    await vi.waitFor(async () => {
      const polled = await app.request(`/api/workers/compute/e2b/template/${view.id}`);
      expect(((await polled.json()) as { build: E2BTemplateBuildView }).build).toMatchObject({
        state: "succeeded",
        templateId: "tpl-9",
      });
    });
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "saved-key", size: "8-8", agentClis: false }),
    );
    const latest = await app.request("/api/workers/compute/e2b/template?workerId=w1");
    expect(((await latest.json()) as { build: E2BTemplateBuildView }).build).toMatchObject({
      id: view.id,
      templateId: "tpl-9",
    });
    const none = await app.request("/api/workers/compute/e2b/template?workerId=other");
    expect(await none.json()).toEqual({ build: null });
  });

  it("uses a key typed into the draft and rejects other worker kinds", async () => {
    const { app, build } = await routes();
    const typed = await app.request("/api/workers/compute/e2b/template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker: { id: "w2", name: "New", kind: "e2b", token: "typed-key" } }),
    });
    expect(typed.status).toBe(200);
    await vi.waitFor(() =>
      expect(build).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "typed-key", size: "2-2", agentClis: true }),
      ),
    );
    const wrong = await app.request("/api/workers/compute/e2b/template", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ worker: { id: "w3", name: "Modal", kind: "modal", token: "k" } }),
    });
    expect(wrong.status).toBe(400);
    const missing = await app.request("/api/workers/compute/e2b/template/nope");
    expect(missing.status).toBe(404);
  });
});
