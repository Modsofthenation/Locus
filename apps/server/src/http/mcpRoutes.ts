import type { Hono } from "hono";
import {
  AGENT_CANVAS_PROMPT,
  ASSET_MCP_INSTRUCTIONS,
  DESIGN_MCP_INSTRUCTIONS,
  agentCanvasMcpTools,
  brainMcpTools,
  canvasMcpTools,
  forgeIssueMcpTools,
  forgeMcpTools,
  integrationMcpTools,
  isAgentCanvasToolName,
  isBrainMcpToolName,
  isCanvasMcpToolName,
  isForgeIssueMcpToolName,
  isForgeMcpToolName,
  isGameSession,
  isAssetSession,
  isDesignSession,
  isDockerSwarmToolName,
  isHostSessionsToolName,
  isIntegrationToolName,
  dockerSwarmMcpTools,
  isReviewSession,
  hostSessionsMcpTools,
  sessionAdvertisesAgentCanvas,
  sessionOffersAgentCanvas,
  sessionOffersHostSessions,
} from "@locus/shared";
import type { BrainService } from "../brain/brain.js";
import { CLI_GIT_INSTRUCTIONS, isCliGitTool } from "../integrations/cliGitMcp.js";
import { persistIntegrationAccount } from "../integrations/googleOauth.js";
import { IntegrationsClient } from "../integrations/integrations.js";
import { dispatchLocusMcp } from "../integrations/locusMcp.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";

async function callBrainMcp(
  brain: BrainService | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  if (!brain) return { ok: false, output: "Brain is not available." };
  if (name === "orient") return { ok: true, output: await brain.orient() };
  if (name === "search_knowledge") {
    const q =
      typeof args.q === "string" ? args.q : typeof args.query === "string" ? args.query : "";
    return { ok: true, output: await brain.search(q) };
  }
  const text = typeof args.text === "string" ? args.text : "";
  return brain.remember({ text });
}

export async function dispatchControlPlaneMcp(opts: {
  store: JsonStore;
  sessions: SessionService;
  brain?: BrainService;
  fetchFn?: typeof fetch;
  sessionId?: string;
  raw: unknown;
}): Promise<{ status: number; body: unknown }> {
  const config = await opts.store.loadConfig();
  const client = new IntegrationsClient(
    opts.fetchFn ?? fetch,
    persistIntegrationAccount(opts.store),
  );
  if (!opts.sessionId) {
    const reply = await dispatchLocusMcp(opts.raw, {
      tools: [
        ...integrationMcpTools(config.integrations),
        ...brainMcpTools(),
        ...dockerSwarmMcpTools(),
      ],
      call: async (name, args) => {
        if (isBrainMcpToolName(name)) return callBrainMcp(opts.brain, name, args);
        if (isDockerSwarmToolName(name)) {
          return opts.sessions.dockerInventory.executeSwarmTool(args);
        }
        if (!isIntegrationToolName(name)) {
          return { ok: false, output: `Unknown Locus tool: ${name}` };
        }
        return client.call(name, args, config.integrations);
      },
    });
    if (reply === undefined) return { status: 202, body: undefined };
    return { status: 200, body: reply };
  }
  const sessionId = opts.sessionId;
  const session = await opts.sessions.get(sessionId);
  if (!session) {
    return {
      status: 404,
      body: { jsonrpc: "2.0", id: null, error: { code: -32004, message: "Unknown session" } },
    };
  }
  const cliGitTools = opts.sessions.cliGitTools(sessionId);
  const assets = isAssetSession(session);
  const designing = isDesignSession(session);
  const hostPeers = sessionOffersHostSessions(session) ? hostSessionsMcpTools() : [];
  const agentCanvas = sessionAdvertisesAgentCanvas(session) ? agentCanvasMcpTools() : [];
  const swarmTools = assets ? [] : dockerSwarmMcpTools();
  const gitInstructions = cliGitTools.length ? CLI_GIT_INSTRUCTIONS : "";
  const assetInstructions = [ASSET_MCP_INSTRUCTIONS, gitInstructions].filter(Boolean).join("\n\n");
  const designInstructions = [DESIGN_MCP_INSTRUCTIONS, gitInstructions]
    .filter(Boolean)
    .join("\n\n");
  const codingInstructions = [gitInstructions, agentCanvas.length ? AGENT_CANVAS_PROMPT : ""]
    .filter(Boolean)
    .join("\n\n");
  const reply = await dispatchLocusMcp(opts.raw, {
    tools: assets
      ? [...canvasMcpTools("assets"), ...cliGitTools, ...hostPeers]
      : [
          ...integrationMcpTools(config.integrations),
          ...brainMcpTools(),
          ...(isReviewSession(session) ? forgeMcpTools() : forgeIssueMcpTools()),
          ...(isGameSession(session) ? canvasMcpTools() : []),
          ...(designing ? canvasMcpTools("design") : []),
          ...cliGitTools,
          ...hostPeers,
          ...swarmTools,
          ...agentCanvas,
        ],
    ...(assets
      ? { instructions: assetInstructions }
      : designing
        ? { instructions: designInstructions }
        : codingInstructions
          ? { instructions: codingInstructions }
          : {}),
    call: async (name, args) => {
      if (isBrainMcpToolName(name)) {
        if (assets) return { ok: false, output: "Brain tools are not available in this session." };
        return callBrainMcp(opts.brain, name, args);
      }
      if (isCliGitTool(name)) {
        try {
          return await opts.sessions.executeCliGitTool(sessionId, name, args);
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : "Git tool failed" };
        }
      }
      if (isForgeMcpToolName(name)) {
        if (!isReviewSession(session) && !isForgeIssueMcpToolName(name)) {
          return { ok: false, output: "Forge PR tools are only available on review sessions" };
        }
        try {
          return await opts.sessions.executeTool(sessionId, { name, args });
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : "tool failed" };
        }
      }
      if (isAgentCanvasToolName(name)) {
        if (!sessionOffersAgentCanvas(session)) {
          return {
            ok: false,
            output: "canvas_write is for coding and review agents.",
          };
        }
        try {
          return await opts.sessions.executeTool(sessionId, { name: name as "canvas_write", args });
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : "tool failed" };
        }
      }
      if (isCanvasMcpToolName(name)) {
        if (!isGameSession(session) && !designing && !assets) {
          return {
            ok: false,
            output: "playwright is only available on design, game, and assets sessions",
          };
        }
        try {
          return await opts.sessions.executeTool(sessionId, { name, args });
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : "tool failed" };
        }
      }
      if (isHostSessionsToolName(name)) {
        if (!sessionOffersHostSessions(session)) {
          return {
            ok: false,
            output: "host_sessions is only available on host agents.",
          };
        }
        try {
          return await opts.sessions.executeTool(sessionId, {
            name: name as "file_read",
            args,
          });
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : "tool failed" };
        }
      }
      if (isDockerSwarmToolName(name)) {
        if (assets) {
          return { ok: false, output: "docker_swarm is not available on assets sessions" };
        }
        return opts.sessions.dockerInventory.executeSwarmTool(args);
      }
      if (!isIntegrationToolName(name)) {
        return { ok: false, output: `Unknown Locus tool: ${name}` };
      }
      if (assets) {
        return { ok: false, output: "Integrations are not available on assets sessions" };
      }
      return client.call(name, args, config.integrations);
    },
  });
  if (reply === undefined) return { status: 202, body: undefined };
  return { status: 200, body: reply };
}

export function registerMcpRoutes(
  app: Hono,
  opts: {
    store: JsonStore;
    sessions: SessionService;
    brain: BrainService;
    fetchFn?: typeof fetch;
  },
): void {
  app.get("/mcp", (c) => c.json({ error: "Method not allowed" }, 405));
  app.post("/mcp", async (c) => {
    const raw = await c.req.json().catch(() => undefined);
    const reply = await dispatchControlPlaneMcp({ ...opts, raw });
    if (reply.body === undefined) return c.body("", 202);
    return c.json(reply.body);
  });
  app.post("/mcp/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    const raw = await c.req.json().catch(() => undefined);
    const reply = await dispatchControlPlaneMcp({ ...opts, sessionId, raw });
    if (reply.status === 404) return c.json(reply.body, 404);
    if (reply.body === undefined) return c.body("", 202);
    return c.json(reply.body);
  });
}
