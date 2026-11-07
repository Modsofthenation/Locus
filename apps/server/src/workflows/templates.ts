import {
  WORKFLOW_TEMPLATES,
  createEdge,
  createEmptyWorkflow,
  createNode,
  templateAt,
  type Workflow,
} from "@locus/alb";
import type { LocusWorkflowTemplate } from "@locus/shared";

export function listWorkflowTemplates(): LocusWorkflowTemplate[] {
  return [
    {
      id: "locus-file",
      name: "Read a workspace file",
      description:
        "Policy gate, then file_read through the Locus session. Input is { path } under /workspace.",
      origin: "locus",
    },
    {
      id: "locus-agent",
      name: "Locus tool agent",
      description:
        "One agent node. With a provider key it calls this session's tools. An empty tool list means every tool the session can use.",
      origin: "locus",
    },
    ...WORKFLOW_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      origin: "alb" as const,
    })),
  ];
}

export function createWorkflowTemplate(templateId: string): Workflow {
  if (templateId === "locus-file") return locusFileWorkflow();
  if (templateId === "locus-agent") return locusAgentWorkflow();
  const found = WORKFLOW_TEMPLATES.find((template) => template.id === templateId);
  if (!found) throw new Error(`Template not found: ${templateId}`);
  return found.create();
}

function locusFileWorkflow(): Workflow {
  const workflow = createEmptyWorkflow("Read a workspace file");
  workflow.description =
    "Reads a path under /workspace with the session file_read tool, after a policy gate.";
  const input = createNode("input", templateAt(0), "Input");
  const gate = createNode("policy_gate", templateAt(1), "Allow read");
  gate.data.config.expression = "true";
  const file = createNode("file_operation", templateAt(2), "Read file");
  file.data.config.operation = "read";
  file.data.config.pathAllowlist = "/workspace";
  const output = createNode("output", templateAt(3), "Output");
  workflow.nodes = [input, gate, file, output];
  workflow.edges = [
    createEdge(input.id, gate.id),
    createEdge(gate.id, file.id, { sourceHandle: "pass", kind: "conditional" }),
    createEdge(file.id, output.id),
  ];
  return workflow;
}

function locusAgentWorkflow(): Workflow {
  const workflow = createEmptyWorkflow("Locus tool agent");
  workflow.description =
    "Hands the input to an agent node that can call this Locus session's tools.";
  const input = createNode("input", templateAt(0), "Task");
  const agent = createNode("agent", templateAt(1), "Locus agent");
  agent.data.config.systemPrompt =
    "You are a Locus agent inside a workflow. Use the session tools to finish the task, then finish with the result.";
  agent.data.config.tools = [];
  agent.data.config.maxIterations = 8;
  const output = createNode("output", templateAt(2), "Output");
  workflow.nodes = [input, agent, output];
  workflow.edges = [createEdge(input.id, agent.id), createEdge(agent.id, output.id)];
  return workflow;
}
