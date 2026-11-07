import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHypervisor } from "@locus/hypervisor";
import { createApp } from "../app.js";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "./sessions.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-agent-canvas-"));
  dirs.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const config = await store.loadConfig();
  const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
  const session = await sessions.create({
    os: "ubuntu",
    templateId: config.templates[0]!.id,
    runtime: "host",
    providerId: config.providers[0]!.id,
    model: config.providers[0]!.defaultModel,
    startVm: false,
  });
  return { dir, store, sessions, session, config };
}

describe("agent canvases", () => {
  it("writes a canvas beside a coding chat and serves it", async () => {
    const { dir, store, sessions, session } = await setup();
    const wrote = await sessions.executeTool(session.id, {
      name: "canvas_write",
      args: {
        title: "Billing review",
        html: "<h1>March</h1><p>12 invoices</p>",
      },
    });
    expect(wrote.ok).toBe(true);
    expect(wrote.output).toMatch(/billing-review/);
    const live = await sessions.get(session.id);
    expect(live?.agentCanvases?.map((row) => row.title)).toEqual(["Billing review"]);
    const html = await readFile(
      join(dir, "agent-canvases", session.id, "billing-review.html"),
      "utf8",
    );
    expect(html).toContain("<h1>March</h1>");
    expect(html).not.toContain("Content-Security-Policy");

    const read = await sessions.executeTool(session.id, {
      name: "canvas_read",
      args: {},
    });
    expect(read.output).toContain("<h1>March</h1>");

    const replaced = await sessions.executeTool(session.id, {
      name: "WriteCanvas" as "canvas_write",
      args: { title: "Billing review", contents: "<p>Updated</p>", canvas_id: "billing-review" },
    });
    expect(replaced.ok).toBe(true);
    expect((await sessions.get(session.id))?.agentCanvases).toHaveLength(1);

    const app = createApp({
      store,
      sessions,
      hypervisor: new MockHypervisor(dir),
    });
    const listed = await app.request(`/api/sessions/${session.id}/agent-canvases`);
    expect(listed.status).toBe(200);
    const one = await app.request(`/api/sessions/${session.id}/agent-canvases/billing-review`);
    expect(one.status).toBe(200);
    expect(((await one.json()) as { html: string }).html).toContain("<p>Updated</p>");

    const refused = await sessions.executeTool(session.id, {
      name: "canvas_write",
      args: { title: "Net", html: "<script>fetch('/x')</script>" },
    });
    expect(refused.ok).toBe(false);
  });

  it("refuses a design session", async () => {
    const { sessions, config } = await setup();
    const design = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "design",
      runtime: "host",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    await expect(
      sessions.executeTool(design.id, {
        name: "canvas_write",
        args: { title: "Nope", html: "<p>Hi</p>" },
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("lets a review session write a canvas", async () => {
    const { sessions, config } = await setup();
    const review = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      kind: "review",
      runtime: "docker",
      dockerImage: "locus/node",
      providerId: config.providers[0]!.id,
      model: config.providers[0]!.defaultModel,
      startVm: false,
    });
    const wrote = await sessions.executeTool(review.id, {
      name: "canvas_write",
      args: { title: "Review notes", html: "<p>Risk</p>" },
    });
    expect(wrote.ok).toBe(true);
    expect((await sessions.get(review.id))?.agentCanvases?.[0]?.title).toBe("Review notes");
  });

  it("copies canvases onto a forked chat", async () => {
    const { dir, sessions, session } = await setup();
    await sessions.executeTool(session.id, {
      name: "canvas_write",
      args: { title: "Billing review", html: "<p>Keep</p>" },
    });
    const forked = await sessions.fork(session.id);
    expect(forked.agentCanvases?.map((row) => row.id)).toEqual(["billing-review"]);
    const html = await readFile(
      join(dir, "agent-canvases", forked.id, "billing-review.html"),
      "utf8",
    );
    expect(html).toContain("<p>Keep</p>");
    const read = await sessions.executeTool(forked.id, { name: "canvas_read", args: {} });
    expect(read.ok).toBe(true);
    expect(read.output).toContain("<p>Keep</p>");
  });
});
