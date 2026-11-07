import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hostWorkspaceDir, MockHypervisor } from "@locus/hypervisor";
import type { ToolRequest } from "@locus/guest-agent";
import { Hub } from "../core/hub.js";
import { JsonStore } from "../core/store.js";
import { SessionService } from "../session/sessions.js";
import { WorkflowService } from "./service.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)),
  );
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "locus-workflows-"));
  cleanup.push(dir);
  const store = new JsonStore(dir);
  await store.init();
  const sessions = new SessionService(store, new MockHypervisor(dir), new Hub());
  const workflows = new WorkflowService(dir, sessions);
  sessions.plane.workflows = workflows;
  const config = await store.loadConfig();
  const session = await sessions.create({
    os: "ubuntu",
    templateId: config.templates[0]!.id,
    runtime: "host",
    providerId: config.providers[0]!.id,
    model: config.providers[0]!.defaultModel,
    startVm: false,
    title: "Workflows",
  });
  return { dir, sessions, workflows, session };
}

describe("WorkflowService", () => {
  it("adds a template and reads a workspace file through the session", async () => {
    const { dir, sessions, workflows, session } = await setup();
    const root = hostWorkspaceDir(dir, session.id);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "note.txt"), "from the guest\n");
    const stored = await workflows.addTemplate("locus-file");
    expect(stored.name).toBe("Read a workspace file");
    const listed = await sessions.executeTool(session.id, {
      name: "list_workflows",
      args: {},
    } as unknown as ToolRequest);
    expect(listed.ok).toBe(true);
    expect(listed.output).toContain(stored.id);

    const ran = await sessions.executeTool(session.id, {
      name: "run_workflow",
      args: { id: stored.name, input_json: JSON.stringify({ path: "/workspace/note.txt" }) },
    } as unknown as ToolRequest);
    expect(ran.ok).toBe(true);
    expect(ran.output).toContain("from the guest");
    expect(ran.output).toContain('"status":"success"');
  });

  it("refuses a second workflow while one is still marked running", async () => {
    const { workflows, session } = await setup();
    const stored = await workflows.addTemplate("locus-agent");
    const running = (workflows as unknown as { running: Set<string> }).running;
    running.add(session.id);
    const result = await workflows.executeAgentTool(session, "run_workflow", { id: stored.id });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/already running/);
  });
});
