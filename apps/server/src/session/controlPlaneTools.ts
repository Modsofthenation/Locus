import type { ToolRequest, ToolResult } from "@locus/guest-agent";
import {
  automationAllowsMcpTool,
  automationAllowsPlugin,
  isAgentCanvasToolName,
  isAskUserToolName,
  isBoardToolName,
  isIntegrationToolName,
  isManageIntegrationPluginName,
  isMcpMetaToolName,
  isMcpToolName,
  isPluginToolName,
  isProjectToolName,
  isReadSkillToolName,
  isRuntimeToolName,
  isWorkflowToolName,
  isSwarmTeamToolName,
  isWebSearchToolName,
  sessionWebSearch,
  wrapHostileToolOutput,
  type AgentSession,
  type LocusConfig,
} from "@locus/shared";
import { runWebSearch } from "../integrations/websearch.js";
import { callPluginTool } from "../integrations/pluginRuntime.js";
import { executeIntegrationTool, type SessionIntegrationDeps } from "./sessionIntegrationTools.js";

export type ControlPlaneToolPorts = {
  fetchFn: typeof fetch;
  executeRuntimeTool: (
    sessionId: string,
    req: { name: string; args: Record<string, unknown> },
    opts?: { toolCallId?: string },
  ) => Promise<ToolResult>;
  executeSwarmTeamTool: (
    session: AgentSession,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
  executeReadSkill: (session: AgentSession, args: Record<string, unknown>) => Promise<ToolResult>;
  workflows?: {
    executeTool: (
      session: AgentSession,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<ToolResult>;
  };
  executeManagePlugin: (args: Record<string, unknown>) => Promise<ToolResult>;
  executeMcpMeta: (
    session: AgentSession,
    req: { name: string; args: Record<string, unknown> },
    fence: boolean,
  ) => Promise<ToolResult>;
  boards?: {
    executeTool: (
      boardId: string | undefined,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<ToolResult>;
  };
  executeAgentCanvas?: (
    session: AgentSession,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
  projects?: {
    executeTool: (
      session: AgentSession,
      name: string,
      args: Record<string, unknown>,
    ) => Promise<ToolResult>;
  };
  mcp: {
    call: (name: string, args: Record<string, unknown>, sessionId: string) => Promise<ToolResult>;
  };
  integrations: SessionIntegrationDeps;
};

type FenceHostile = (name: string, output: string) => string;

/** Web, Brain/runtime, Board, Project, Swarm, skills — before the access gate. */
export async function executeEarlyControlPlaneTool(
  ports: ControlPlaneToolPorts,
  session: AgentSession,
  req: ToolRequest,
  opts: { toolCallId?: string } | undefined,
  fenceHostile: FenceHostile,
): Promise<ToolResult | undefined> {
  if (isWebSearchToolName(req.name)) {
    if (!sessionWebSearch(session)) throw new Error("Web search is off for this agent");
    const query = typeof req.args.query === "string" ? req.args.query : "";
    const maxResults = typeof req.args.num_results === "number" ? req.args.num_results : undefined;
    const result = await runWebSearch(query, { fetchFn: ports.fetchFn, maxResults });
    return { ...result, output: fenceHostile(req.name, result.output) };
  }
  if (isRuntimeToolName(req.name)) {
    return ports.executeRuntimeTool(session.id, req, opts);
  }
  if (isBoardToolName(req.name)) {
    if (!ports.boards) throw new Error("Boards unavailable");
    const result = await ports.boards.executeTool(session.boardId, req.name, req.args ?? {});
    return { ...result, output: fenceHostile(req.name, result.output ?? "") };
  }
  if (isProjectToolName(req.name)) {
    if (!ports.projects) throw new Error("Projects unavailable");
    const result = await ports.projects.executeTool(session, req.name, req.args ?? {});
    return { ...result, output: fenceHostile(req.name, result.output ?? "") };
  }
  if (isSwarmTeamToolName(req.name)) {
    const result = await ports.executeSwarmTeamTool(session, req.name, req.args ?? {});
    return { ...result, output: fenceHostile(req.name, result.output ?? "") };
  }
  if (isReadSkillToolName(req.name)) {
    return ports.executeReadSkill(session, req.args);
  }
  if (isWorkflowToolName(req.name)) {
    if (!ports.workflows) throw new Error("Workflows unavailable");
    return ports.workflows.executeTool(session, req.name, req.args ?? {});
  }
  return undefined;
}

/** Plugins, MCP, integrations, Forge — after the access gate. */
export async function executeLateControlPlaneTool(
  ports: ControlPlaneToolPorts,
  session: AgentSession,
  req: ToolRequest,
  opts: { fence?: boolean } | undefined,
  fenceHostile: FenceHostile,
  config: LocusConfig,
): Promise<ToolResult | undefined> {
  if (isAgentCanvasToolName(req.name)) {
    if (!ports.executeAgentCanvas) throw new Error("Canvases unavailable");
    const result = await ports.executeAgentCanvas(session, req.name, req.args ?? {});
    return { ...result, output: fenceHostile(req.name, result.output ?? "") };
  }
  if (isAskUserToolName(req.name)) {
    return { ok: false, output: "ask_user can only run inside the agent loop" };
  }
  if (isManageIntegrationPluginName(req.name)) {
    if (!automationAllowsPlugin(session, req.name)) {
      throw new Error(`Tool ${req.name} is not allowed for this automation`);
    }
    return ports.executeManagePlugin(req.args);
  }
  if (isPluginToolName(req.name)) {
    if (!automationAllowsPlugin(session, req.name)) {
      throw new Error(`Tool ${req.name} is not allowed for this automation`);
    }
    return callPluginTool(req.name, req.args, config.integrationPlugins, ports.fetchFn).then(
      (result) => ({
        ...result,
        output: wrapHostileToolOutput(req.name, result.output),
      }),
    );
  }
  if (isMcpMetaToolName(req.name)) {
    return ports.executeMcpMeta(session, req, opts?.fence !== false);
  }
  if (isMcpToolName(req.name)) {
    if (!automationAllowsMcpTool(session, req.name)) {
      throw new Error(`Tool ${req.name} is not allowed for this automation`);
    }
    return ports.mcp.call(req.name, req.args, session.id).then((result) => ({
      ...result,
      output: fenceHostile(req.name, result.output),
    }));
  }
  if (isIntegrationToolName(req.name)) {
    return executeIntegrationTool(
      ports.integrations,
      session,
      req.name,
      req.args,
      config,
      fenceHostile,
    );
  }
  return undefined;
}
