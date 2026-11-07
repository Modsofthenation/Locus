import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { importBundle, type Workflow, type WorkflowRun } from "@locus/alb";
import {
  isWorkflowToolName,
  LIST_WORKFLOWS_NAME,
  RESUME_WORKFLOW_NAME,
  RUN_WORKFLOW_NAME,
  type AgentSession,
  type LocusWorkflowSummary,
  type LocusWorkflowTemplate,
} from "@locus/shared";
import type { ToolResult } from "@locus/guest-agent";
import type { SessionService } from "../session/sessions.js";
import { resumeLocusWorkflow, runLocusWorkflow, type WorkflowCompletion } from "./run.js";
import { createWorkflowTemplate, listWorkflowTemplates } from "./templates.js";

const WORKFLOW_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface StoredWorkflow {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  document: Workflow;
}

interface StoredRun {
  workflowId: string;
  run: WorkflowRun;
}

export class WorkflowService {
  private readonly running = new Set<string>();

  constructor(
    private readonly dataDir: string,
    private readonly sessions: SessionService,
  ) {}

  private dir(): string {
    return join(this.dataDir, "workflows");
  }

  private runDir(): string {
    return join(this.dataDir, "workflow-runs");
  }

  async list(): Promise<LocusWorkflowSummary[]> {
    const rows = await this.readAll();
    return rows
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
  }

  listTemplates(): LocusWorkflowTemplate[] {
    return listWorkflowTemplates();
  }

  async get(id: string): Promise<StoredWorkflow | undefined> {
    if (!WORKFLOW_ID.test(id)) return undefined;
    return this.read(id);
  }

  async resolve(token: string): Promise<StoredWorkflow | undefined> {
    const needle = token.trim();
    if (!needle) return undefined;
    const rows = await this.readAll();
    const exact = rows.find(
      (row) => row.id === needle || row.name.toLowerCase() === needle.toLowerCase(),
    );
    if (exact) return exact;
    const prefix = rows.filter(
      (row) => row.id.startsWith(needle) || row.name.toLowerCase().startsWith(needle.toLowerCase()),
    );
    return prefix.length === 1 ? prefix[0] : undefined;
  }

  async importDocument(raw: unknown): Promise<StoredWorkflow> {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const result = importBundle(text);
    if (!result.ok || !result.workflow) {
      throw new Error(result.errors.join("; ") || "Not an Agent Loop Builder workflow");
    }
    return this.save(result.workflow);
  }

  async addTemplate(templateId: string): Promise<StoredWorkflow> {
    return this.save(createWorkflowTemplate(templateId));
  }

  async remove(id: string): Promise<void> {
    if (!WORKFLOW_ID.test(id)) return;
    await rm(join(this.dir(), `${id}.json`), { force: true });
  }

  async listRuns(workflowId: string): Promise<WorkflowRun[]> {
    const runs = await this.readRuns();
    return runs
      .filter((row) => row.workflowId === workflowId)
      .map((row) => row.run)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  async getRun(runId: string): Promise<StoredRun | undefined> {
    if (!WORKFLOW_ID.test(runId)) return undefined;
    try {
      const raw = await readFile(join(this.runDir(), `${runId}.json`), "utf8");
      const parsed = JSON.parse(raw) as StoredRun;
      if (!parsed?.run || parsed.run.id !== runId) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  async run(
    sessionId: string,
    workflowId: string,
    input: Record<string, unknown> = {},
  ): Promise<WorkflowRun> {
    const stored = await this.resolve(workflowId);
    if (!stored) throw new Error("Workflow not found");
    const session = await this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    return this.execute(session, stored.document, (options) =>
      runLocusWorkflow(stored.document, { ...options, input }),
    );
  }

  async resume(
    sessionId: string,
    workflowId: string,
    runId: string,
    decision: { approved: boolean; resumeToken?: string },
  ): Promise<WorkflowRun> {
    const stored = await this.resolve(workflowId);
    if (!stored) throw new Error("Workflow not found");
    const paused = await this.getRun(runId);
    if (!paused || paused.workflowId !== stored.id) throw new Error("Run not found");
    const session = await this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    return this.execute(session, stored.document, (options) =>
      resumeLocusWorkflow(stored.document, paused.run, decision, options),
    );
  }

  async executeAgentTool(
    session: AgentSession,
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!isWorkflowToolName(name)) return { ok: false, output: `Unknown workflow tool ${name}` };
    try {
      if (name === LIST_WORKFLOWS_NAME) {
        const rows = await this.list();
        return { ok: true, output: JSON.stringify(rows) };
      }
      if (name === RUN_WORKFLOW_NAME) {
        const id = typeof args.id === "string" ? args.id : "";
        if (!id.trim()) return { ok: false, output: "run_workflow needs id" };
        const run = await this.run(session.id, id, parseWorkflowInput(args));
        return {
          ok: run.status === "success" || run.status === "waiting_approval",
          output: summarizeRun(run),
        };
      }
      if (name === RESUME_WORKFLOW_NAME) {
        const id = typeof args.id === "string" ? args.id : "";
        const runId = typeof args.run_id === "string" ? args.run_id : "";
        if (!id.trim() || !runId.trim()) {
          return { ok: false, output: "resume_workflow needs id and run_id" };
        }
        const approved = args.approved === true || args.approved === "true";
        const resumeToken = typeof args.resume_token === "string" ? args.resume_token : undefined;
        const run = await this.resume(session.id, id, runId, {
          approved,
          ...(resumeToken ? { resumeToken } : {}),
        });
        return {
          ok: run.status === "success" || run.status === "waiting_approval",
          output: summarizeRun(run),
        };
      }
      return { ok: false, output: `Unknown workflow tool ${name}` };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) };
    }
  }

  private async execute(
    session: AgentSession,
    workflow: Workflow,
    start: (options: {
      toolCatalog: string[];
      invokeTool: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ ok: boolean; output: string }>;
      complete: (input: {
        system: string;
        user: string;
        tools: string[];
      }) => Promise<WorkflowCompletion | undefined>;
    }) => Promise<WorkflowRun>,
  ): Promise<WorkflowRun> {
    if (this.running.has(session.id)) {
      throw new Error("A workflow is already running in this session");
    }
    this.running.add(session.id);
    try {
      const run = await start({
        toolCatalog: this.sessions.workflowCatalog(session),
        invokeTool: async (name, args) => {
          const result = await this.sessions.executeTool(session.id, {
            name: name as never,
            args,
          });
          return { ok: result.ok, output: result.output ?? "" };
        },
        complete: (input) => this.sessions.completeForWorkflow(session.id, input),
      });
      await this.writeRun(workflow.id, run);
      return run;
    } finally {
      this.running.delete(session.id);
    }
  }

  private async save(workflow: Workflow): Promise<StoredWorkflow> {
    if (!WORKFLOW_ID.test(workflow.id)) {
      throw new Error("Workflow id is not a safe file name");
    }
    const stored: StoredWorkflow = {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description ?? "",
      updatedAt: new Date().toISOString(),
      document: workflow,
    };
    await mkdir(this.dir(), { recursive: true });
    await writeFile(join(this.dir(), `${workflow.id}.json`), JSON.stringify(stored), "utf8");
    return stored;
  }

  private async read(id: string): Promise<StoredWorkflow | undefined> {
    try {
      const raw = await readFile(join(this.dir(), `${id}.json`), "utf8");
      const parsed = JSON.parse(raw) as StoredWorkflow;
      if (!parsed?.document || parsed.id !== id) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async readAll(): Promise<StoredWorkflow[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.dir());
    } catch {
      return [];
    }
    const rows: StoredWorkflow[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const row = await this.read(name.slice(0, -".json".length));
      if (row) rows.push(row);
    }
    return rows;
  }

  private async readRuns(): Promise<StoredRun[]> {
    let names: string[] = [];
    try {
      names = await readdir(this.runDir());
    } catch {
      return [];
    }
    const rows: StoredRun[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const row = await this.getRun(name.slice(0, -".json".length));
      if (row) rows.push(row);
    }
    return rows;
  }

  private async writeRun(workflowId: string, run: WorkflowRun): Promise<void> {
    if (!WORKFLOW_ID.test(run.id)) return;
    await mkdir(this.runDir(), { recursive: true });
    const stored: StoredRun = { workflowId, run };
    await writeFile(join(this.runDir(), `${run.id}.json`), JSON.stringify(stored), "utf8");
  }
}

function summarize(row: StoredWorkflow): LocusWorkflowSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    updatedAt: row.updatedAt,
    nodeCount: row.document.nodes.length,
  };
}

function parseWorkflowInput(args: Record<string, unknown>): Record<string, unknown> {
  const direct = args.input;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }
  if (typeof args.input_json === "string" && args.input_json.trim()) {
    const parsed = JSON.parse(args.input_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("input_json must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  }
  return {};
}

function summarizeRun(run: WorkflowRun): string {
  return JSON.stringify({
    runId: run.id,
    workflowId: run.workflowId,
    status: run.status,
    output: run.output ?? null,
    error: run.error ?? null,
    pendingApproval: run.pendingApproval
      ? {
          nodeId: run.pendingApproval.nodeId,
          resumeToken: run.pendingApproval.resumeToken,
          message: run.pendingApproval.message,
        }
      : null,
  });
}
