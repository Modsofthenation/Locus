import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import type { AgentSession, ArchitectureAnalysis, LinkedRepo } from "@locus/shared";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import { readArchitectureSources } from "./architectureCheckout.js";
import { RepoService } from "./repos.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-arch-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const hypervisor = new MockHypervisor(dir);
  const hub = new Hub();
  const sessions = new SessionService(store, hypervisor, hub);
  // Linking looks up the default branch; keep tests offline.
  const offline: typeof fetch = async () => new Response("{}", { status: 404 });
  const repos = new RepoService(store, sessions, hub, offline);
  const app = createApp({ store, sessions, hypervisor, repos });
  return { dir, store, app };
}

describe("architecture checkout", () => {
  it("skips skipped directories and symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-arch-tree-"));
    cleanup.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = {}\n");
    await symlink(join(root, "src", "app.ts"), join(root, "src", "link.ts"));
    const read = await readArchitectureSources(root);
    expect(read.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(read.truncated).toBe(false);
  });

  it("omits an oversize source and marks the read truncated", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-arch-big-"));
    cleanup.push(root);
    await writeFile(join(root, "small.ts"), "export const n = 1;\n");
    await writeFile(join(root, "big.ts"), `export const blob = "${"x".repeat(48_000)}";\n`);
    const read = await readArchitectureSources(root);
    expect(read.files.map((file) => file.path)).toEqual(["small.ts"]);
    expect(read.truncated).toBe(true);
  });

  it("analyses a host checkout and starts an improve session", async () => {
    const ctx = await setup();
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/billing" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const missing = await ctx.app.request(`/api/repos/${repo.id}/architecture`);
    expect(missing.status).toBe(200);
    const empty = (await missing.json()) as ArchitectureAnalysis;
    expect(empty.unavailable).toMatch(/No Host or Docker checkout/);
    expect(empty.findings).toEqual([]);

    const tree = await mkdtemp(join(tmpdir(), "locus-arch-repo-"));
    cleanup.push(tree);
    await mkdir(join(tree, "src"), { recursive: true });
    await writeFile(
      join(tree, "src", "invoice.ts"),
      "export function loadInvoice(id: string) {\n  return billing.loadInvoice(id);\n}\n",
    );
    execFileSync("git", ["init"], { cwd: tree });
    execFileSync("git", ["add", "."], { cwd: tree });
    execFileSync(
      "git",
      ["-c", "user.email=locus@example.com", "-c", "user.name=Locus", "commit", "-m", "init"],
      { cwd: tree },
    );

    const config = await ctx.store.loadConfig();
    const opened = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        os: "ubuntu",
        templateId: config.templates[0]!.id,
        providerId: config.providers[0]!.id,
        model: config.providers[0]!.defaultModel,
        runtime: "host",
        hostDir: tree,
        repoId: repo.id,
        repo: repo.checkout,
        startVm: false,
        kind: "ide",
        title: "IDE billing",
      }),
    });
    expect(opened.status).toBe(201);

    const analysed = await ctx.app.request(`/api/repos/${repo.id}/architecture`);
    expect(analysed.status).toBe(200);
    const report = (await analysed.json()) as ArchitectureAnalysis;
    expect(report.checkout?.runtime).toBe("host");
    expect(report.checkout?.label).toBe("IDE billing");
    expect(report.findings.some((row) => row.flag === "passthrough")).toBe(true);
    expect(report.files.map((file) => file.path)).toContain("src/invoice.ts");

    const bad = await ctx.app.request(`/api/repos/${repo.id}/architecture/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "code" }),
    });
    expect(bad.status).toBe(400);

    const suggested = await ctx.app.request(`/api/repos/${repo.id}/architecture/suggest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "code", target: "src/invoice.ts" }),
    });
    expect(suggested.status).toBe(201);
    const session = (await suggested.json()) as AgentSession;
    expect(session.runtime).toBe("host");
    expect(session.hostDir).toBe(tree);
    expect(session.title).toBe("Architecture · invoice.ts");
    expect(session.playbook).toMatch(/heuristic brief/);
    const prompt = session.messages.find((row) => row.role === "user")?.content ?? "";
    expect(prompt).toContain("Pass-through loadInvoice");
    expect(prompt).toContain("Architecture lens");
    expect(prompt).not.toContain(tree);
  });

  it("reads java sources and skips a newer checkout that has none under the size cap", async () => {
    const root = await mkdtemp(join(tmpdir(), "locus-arch-java-"));
    cleanup.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "Widget.java"), "public class Widget {}\n");
    const read = await readArchitectureSources(root);
    expect(read.files.map((file) => file.path)).toEqual(["src/Widget.java"]);

    const ctx = await setup();
    const created = await ctx.app.request("/api/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/acme/widgets" }),
    });
    const repo = (await created.json()) as LinkedRepo;
    const small = await mkdtemp(join(tmpdir(), "locus-arch-small-"));
    const huge = await mkdtemp(join(tmpdir(), "locus-arch-huge-"));
    cleanup.push(small, huge);
    await mkdir(join(small, "src"), { recursive: true });
    await mkdir(join(huge, "src"), { recursive: true });
    await writeFile(join(small, "src", "app.ts"), "export const value = 1;\n");
    await writeFile(join(huge, "src", "Widget.java"), "x".repeat(50_000));
    const config = await ctx.store.loadConfig();
    const body = {
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      runtime: "host",
      repoId: repo.id,
      repo: repo.checkout,
      startVm: false,
      kind: "ide",
    };
    const older = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, hostDir: small, title: "Small tree" }),
    });
    expect(older.status).toBe(201);
    const newer = await ctx.app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, hostDir: huge, title: "Huge tree" }),
    });
    expect(newer.status).toBe(201);
    const analysed = await ctx.app.request(`/api/repos/${repo.id}/architecture`);
    const report = (await analysed.json()) as ArchitectureAnalysis;
    expect(report.checkout?.label).toBe("Small tree");
    expect(report.files.map((file) => file.path)).toContain("src/app.ts");
  });
});
