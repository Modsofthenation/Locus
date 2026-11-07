import { describe, expect, it } from "vitest";
import { createEdge, createEmptyWorkflow, createNode, templateAt } from "@locus/alb";
import { runLocusWorkflow } from "./run.js";

describe("runLocusWorkflow", () => {
  it("sends a gated file read through the Locus tool invoker", async () => {
    const workflow = createEmptyWorkflow("Read");
    const input = createNode("input", templateAt(0), "Input");
    const gate = createNode("policy_gate", templateAt(1), "Allow");
    gate.data.config.expression = "true";
    const file = createNode("file_operation", templateAt(2), "Read");
    file.data.config.operation = "read";
    file.data.config.pathAllowlist = "/workspace";
    const output = createNode("output", templateAt(3), "Output");
    workflow.nodes = [input, gate, file, output];
    workflow.edges = [
      createEdge(input.id, gate.id),
      createEdge(gate.id, file.id, { sourceHandle: "pass", kind: "conditional" }),
      createEdge(file.id, output.id),
    ];
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const run = await runLocusWorkflow(workflow, {
      input: { path: "/workspace/note.txt" },
      toolCatalog: ["file_read"],
      invokeTool: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, output: "hello from locus" };
      },
    });
    expect(run.status).toBe("success");
    expect(calls).toEqual([{ name: "file_read", args: { path: "/workspace/note.txt" } }]);
    expect(JSON.stringify(run.output)).toContain("hello from locus");
  });

  it("blocks an ungated tool node", async () => {
    const workflow = createEmptyWorkflow("Ungated");
    const input = createNode("input", templateAt(0), "Input");
    const tool = createNode("tool_call", templateAt(1), "Exec");
    tool.data.config.toolId = "exec";
    const output = createNode("output", templateAt(2), "Output");
    workflow.nodes = [input, tool, output];
    workflow.edges = [createEdge(input.id, tool.id), createEdge(tool.id, output.id)];
    let called = false;
    const run = await runLocusWorkflow(workflow, {
      input: { command: "pwd" },
      toolCatalog: ["exec"],
      invokeTool: async () => {
        called = true;
        return { ok: true, output: "nope" };
      },
    });
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/side effect/);
    expect(called).toBe(false);
  });

  it("lets an agent node call a session tool and then finish", async () => {
    const workflow = createEmptyWorkflow("Agent");
    const input = createNode("input", templateAt(0), "Task");
    const agent = createNode("agent", templateAt(1), "Agent");
    agent.data.config.tools = ["grep"];
    agent.data.config.maxIterations = 4;
    const output = createNode("output", templateAt(2), "Output");
    workflow.nodes = [input, agent, output];
    workflow.edges = [createEdge(input.id, agent.id), createEdge(agent.id, output.id)];
    const calls: string[] = [];
    let step = 0;
    const run = await runLocusWorkflow(workflow, {
      input: { message: "find the port" },
      toolCatalog: ["grep", "file_read", "exec", "run_workflow"],
      invokeTool: async (name) => {
        calls.push(name);
        return { ok: true, output: "7420" };
      },
      complete: async () => {
        step += 1;
        if (step === 1) {
          return { text: "", toolCalls: [{ name: "grep", arguments: { pattern: "7420" } }] };
        }
        return { text: '{"action":"finish","result":"port 7420"}', toolCalls: [] };
      },
    });
    expect(run.status).toBe("success");
    expect(calls).toEqual(["grep"]);
    expect(JSON.stringify(run.output)).toContain("port 7420");
  });

  it("refuses workflow tools and tools outside the node allowlist", async () => {
    const workflow = createEmptyWorkflow("Denied");
    const input = createNode("input", templateAt(0), "Task");
    const agent = createNode("agent", templateAt(1), "Agent");
    agent.data.config.tools = ["file_read"];
    const output = createNode("output", templateAt(2), "Output");
    workflow.nodes = [input, agent, output];
    workflow.edges = [createEdge(input.id, agent.id), createEdge(agent.id, output.id)];
    const run = await runLocusWorkflow(workflow, {
      input: { message: "go" },
      toolCatalog: ["file_read", "exec"],
      invokeTool: async () => ({ ok: true, output: "no" }),
      complete: async () => ({
        text: "",
        toolCalls: [{ name: "run_workflow", arguments: { id: "other" } }],
      }),
    });
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/cannot start or resume/);
  });

  it("uses the session catalog when the agent node allowlist is empty", async () => {
    const workflow = createEmptyWorkflow("Open");
    const input = createNode("input", templateAt(0), "Task");
    const agent = createNode("agent", templateAt(1), "Agent");
    agent.data.config.tools = [];
    const output = createNode("output", templateAt(2), "Output");
    workflow.nodes = [input, agent, output];
    workflow.edges = [createEdge(input.id, agent.id), createEdge(agent.id, output.id)];
    const calls: string[] = [];
    let step = 0;
    const run = await runLocusWorkflow(workflow, {
      input: { message: "list" },
      toolCatalog: ["file_list", "exec"],
      invokeTool: async (name) => {
        calls.push(name);
        return { ok: true, output: "note.txt" };
      },
      complete: async () => {
        step += 1;
        if (step === 1) {
          return {
            text: "",
            toolCalls: [{ name: "file_list", arguments: { path: "/workspace" } }],
          };
        }
        return { text: "listed", toolCalls: [] };
      },
    });
    expect(run.status).toBe("success");
    expect(calls).toEqual(["file_list"]);
  });
});
