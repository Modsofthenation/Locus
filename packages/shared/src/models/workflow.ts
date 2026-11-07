import type { ExtraToolDef } from "./mcp.js";

export const LIST_WORKFLOWS_NAME = "list_workflows";
export const RUN_WORKFLOW_NAME = "run_workflow";
export const RESUME_WORKFLOW_NAME = "resume_workflow";

const WORKFLOW_TOOL_NAMES = new Set([LIST_WORKFLOWS_NAME, RUN_WORKFLOW_NAME, RESUME_WORKFLOW_NAME]);

export function isWorkflowToolName(name: string): boolean {
  return WORKFLOW_TOOL_NAMES.has(name);
}

export const LIST_WORKFLOWS_TOOL: ExtraToolDef = {
  name: LIST_WORKFLOWS_NAME,
  description: "List Agent Loop Builder workflows saved in Locus. Use this before run_workflow.",
  parameters: { type: "object", properties: {} },
};

export const RUN_WORKFLOW_TOOL: ExtraToolDef = {
  name: RUN_WORKFLOW_NAME,
  description:
    "Run a saved Agent Loop Builder workflow in this session. Tool nodes and agent nodes call the same Locus tools this chat can use (files, shell, git, browser, integrations, MCP), still subject to approval and the session allowlist. Pass id (workflow id or name) and optional input_json.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Workflow id, name, or unique prefix" },
      input_json: {
        type: "string",
        description: "JSON object passed to the workflow input node",
      },
    },
    required: ["id"],
  },
};

export const RESUME_WORKFLOW_TOOL: ExtraToolDef = {
  name: RESUME_WORKFLOW_NAME,
  description:
    "Resume a workflow run that paused on human approval. Pass the workflow id, run_id, and resume_token from the pause, plus approved true or false.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Workflow id or name" },
      run_id: { type: "string", description: "Paused run id" },
      resume_token: { type: "string", description: "Token from the waiting_approval result" },
      approved: { type: "boolean", description: "Whether the operator approved the pause" },
    },
    required: ["id", "run_id", "approved"],
  },
};

export const WORKFLOW_TOOLS: ExtraToolDef[] = [
  LIST_WORKFLOWS_TOOL,
  RUN_WORKFLOW_TOOL,
  RESUME_WORKFLOW_TOOL,
];

export interface LocusWorkflowSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  nodeCount: number;
}

export interface LocusWorkflowTemplate {
  id: string;
  name: string;
  description: string;
  origin: "locus" | "alb";
}
