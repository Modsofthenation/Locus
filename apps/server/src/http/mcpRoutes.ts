import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isLocalOperator } from "../core/localguard.js";
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
  isLoopbackOrigin,
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
  isManageSkillName,
} from "@locus/shared";
import type { BrainService } from "../brain/brain.js";
import { CLI_GIT_INSTRUCTIONS, isCliGitTool } from "../integrations/cliGitMcp.js";
import { persistIntegrationAccount } from "../integrations/googleOauth.js";
import { IntegrationsClient } from "../integrations/integrations.js";
import { dispatchLocusMcp } from "../integrations/locusMcp.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import {
  executeUnityMcp,
  isUnityMcpTool,
  UNITY_MCP_INSTRUCTIONS,
  unityMcpTools,
} from "../unity/unityMcp.js";
import {
  executeGodotMcp,
  isGodotMcpTool,
  GODOT_MCP_INSTRUCTIONS,
  godotMcpTools,
} from "../godot/godotMcp.js";
import {
  executeUnrealMcp,
  isUnrealMcpTool,
  UNREAL_MCP_INSTRUCTIONS,
  unrealMcpTools,
} from "../unreal/unrealMcp.js";
import {
  executeBlenderMcp,
  isBlenderMcpTool,
  BLENDER_MCP_INSTRUCTIONS,
  blenderMcpTools,
} from "../blender/blenderMcp.js";

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

/**
 * Answers an MCP request a worker relayed from a CLI turn's loopback proxy. The worker
 * is not trusted to scope it: only `/mcp/sessions/<id>` for the turn's own session is
 * served. The unscoped `/mcp` (integration, brain and Docker Swarm tools) and any other
 * session's path get a 404, matching the sandboxed CLI gateway on this machine.
 */
export async function dispatchWorkerCliMcp(opts: {
  store: JsonStore;
  sessions: SessionService;
  brain?: BrainService;
  fetchFn?: typeof fetch;
  /** The session whose worker CLI turn relayed this request. */
  sessionId: string;
  /** Path the CLI requested on the worker's loopback proxy. */
  path: string;
  raw: unknown;
}): Promise<{ status: number; body: unknown }> {
  if (!workerCliMcpPathMatchesSession(opts.path, opts.sessionId)) {
    return {
      status: 404,
      body: {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32004, message: "Unknown session" },
      },
    };
  }
  return dispatchControlPlaneMcp({
    store: opts.store,
    sessions: opts.sessions,
    brain: opts.brain,
    fetchFn: opts.fetchFn,
    sessionId: opts.sessionId,
    raw: opts.raw,
  });
}

export function workerCliMcpPathMatchesSession(path: string, sessionId: string): boolean {
  const prefix = "/mcp/sessions/";
  const trimmed = path.replace(/\/+$/, "");
  if (!sessionId || !trimmed.startsWith(prefix)) return false;
  try {
    return decodeURIComponent(trimmed.slice(prefix.length)) === sessionId;
  } catch {
    return false;
  }
}

export async function dispatchControlPlaneMcp(opts: {
  store: JsonStore;
  sessions: SessionService;
  brain?: BrainService;
  fetchFn?: typeof fetch;
  sessionId?: string;
  raw: unknown;
  /** Aborts when the HTTP caller disconnects. */
  signal?: AbortSignal;
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
  const cliSkillTools = opts.sessions.cliSkillTools(session);
  const assets = isAssetSession(session);
  const designing = isDesignSession(session);
  const hostPeers = sessionOffersHostSessions(session) ? hostSessionsMcpTools() : [];
  const unityTools =
    session.playbook?.includes("LOCUS_UNITY_WORKFLOW") &&
    session.runtime === "host" &&
    !session.backendId
      ? unityMcpTools()
      : [];
  const godotTools =
    session.playbook?.includes("LOCUS_GODOT_WORKFLOW") &&
    session.runtime === "host" &&
    !session.backendId
      ? godotMcpTools()
      : [];
  const unrealTools =
    session.playbook?.includes("LOCUS_UNREAL_WORKFLOW") &&
    session.runtime === "host" &&
    !session.backendId
      ? unrealMcpTools()
      : [];
  const blenderTools =
    session.playbook?.includes("LOCUS_BLENDER_WORKFLOW") &&
    session.runtime === "host" &&
    !session.backendId
      ? blenderMcpTools()
      : [];
  const agentCanvas = sessionAdvertisesAgentCanvas(session) ? agentCanvasMcpTools() : [];
  const swarmTools = assets ? [] : dockerSwarmMcpTools();
  const gitInstructions = cliGitTools.length ? CLI_GIT_INSTRUCTIONS : "";
  const assetInstructions = [ASSET_MCP_INSTRUCTIONS, gitInstructions].filter(Boolean).join("\n\n");
  const designInstructions = [DESIGN_MCP_INSTRUCTIONS, gitInstructions]
    .filter(Boolean)
    .join("\n\n");
  const codingInstructions = [
    gitInstructions,
    agentCanvas.length ? AGENT_CANVAS_PROMPT : "",
    unityTools.length ? UNITY_MCP_INSTRUCTIONS : "",
    godotTools.length ? GODOT_MCP_INSTRUCTIONS : "",
    unrealTools.length ? UNREAL_MCP_INSTRUCTIONS : "",
    blenderTools.length ? BLENDER_MCP_INSTRUCTIONS : "",
  ]
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
          ...cliSkillTools,
          ...hostPeers,
          ...unityTools,
          ...godotTools,
          ...unrealTools,
          ...blenderTools,
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
      if (isBlenderMcpTool(name)) {
        if (!blenderTools.length)
          return { ok: false, output: "Blender tools require a local Host Blender session" };
        return executeBlenderMcp(opts.sessions, sessionId, name, args);
      }
      if (isGodotMcpTool(name)) {
        if (!godotTools.length)
          return { ok: false, output: "Godot tools require a local Host Godot session" };
        return executeGodotMcp(opts.sessions, sessionId, name, args);
      }
      if (isUnrealMcpTool(name)) {
        if (!unrealTools.length)
          return { ok: false, output: "Unreal tools require a local Host Unreal session" };
        return executeUnrealMcp(opts.sessions, sessionId, name, args);
      }
      if (isUnityMcpTool(name)) {
        if (!unityTools.length)
          return {
            ok: false,
            output: "Unity tools are only available to local Host Unity sessions",
          };
        return executeUnityMcp(opts.sessions, sessionId, name, args);
      }
      if (isBrainMcpToolName(name)) {
        if (assets) return { ok: false, output: "Brain tools are not available in this session." };
        return callBrainMcp(opts.brain, name, args);
      }
      if (isManageSkillName(name)) {
        if (!cliSkillTools.length) {
          return { ok: false, output: "manage_skill is not available in this session." };
        }
        try {
          return await opts.sessions.executeCliSkillTool(sessionId, args);
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : "Skill tool failed" };
        }
      }
      if (isCliGitTool(name)) {
        try {
          return await opts.sessions.executeCliGitTool(sessionId, name, args, opts.signal);
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

export type McpRouteOptions = {
  store: JsonStore;
  sessions: SessionService;
  brain?: BrainService;
  fetchFn?: typeof fetch;
  peerAddress?: (c: Context) => string | undefined;
  /** Tests: how long a call may take before the reply switches to SSE. */
  sseAfterMs?: number;
  /** Tests: keepalive interval on an SSE reply. */
  ssePingMs?: number;
};

export function registerMcpRoutes(app: Hono, opts: McpRouteOptions): void {
  app.get("/mcp", (c) => c.json({ error: "Method not allowed" }, 405));
  app.post("/mcp", async (c) => {
    const raw = await c.req.json().catch(() => undefined);
    const reply = await dispatchControlPlaneMcp({ ...opts, raw });
    if (reply.body === undefined) return c.body("", 202);
    return c.json(reply.body);
  });
  const handle = sessionMcpHandler(opts);
  app.post("/mcp/sessions/:sessionId", (c) => handle(c, c.req.param("sessionId")));
}

/**
 * One session's MCP endpoint (JSON-RPC over streamable HTTP). Served on the control plane at
 * `/mcp/sessions/:id` and, for sandboxed CLIs, by the token-gated `CliMcpGateway`.
 */
export function sessionMcpHandler(
  opts: McpRouteOptions,
): (c: Context, sessionId: string) => Promise<Response> {
  return async (c, sessionId) => {
    const raw = await c.req.json().catch(() => undefined);
    // Unity, Godot, Unreal and Blender run native host processes. Never expose their MCP tools through phone
    // or other remote access, including requests sent in a JSON-RPC batch.
    const calls = Array.isArray(raw) ? raw : [raw];
    const requestsUnity = calls.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const rpc = entry as { method?: unknown; params?: { name?: unknown } };
      return (
        rpc.method === "tools/call" &&
        (rpc.params?.name === "blender_editor" ||
          rpc.params?.name === "blender_result" ||
          rpc.params?.name === "unity_editor" ||
          rpc.params?.name === "unity_result" ||
          rpc.params?.name === "godot_editor" ||
          rpc.params?.name === "godot_result" ||
          rpc.params?.name === "unreal_editor" ||
          rpc.params?.name === "unreal_result")
      );
    });
    const origin = c.req.header("origin");
    if (
      requestsUnity &&
      (!isLocalOperator(c, opts.peerAddress) || (origin && !isLoopbackOrigin(origin)))
    ) {
      return c.json({ error: "Native engine tools are local-operator only" }, 403);
    }
    const pending = dispatchControlPlaneMcp({
      ...opts,
      sessionId,
      raw,
      signal: c.req.raw.signal,
    });
    const respond = (reply: { status: number; body: unknown }) => {
      if (reply.status === 404) return c.json(reply.body, 404);
      if (reply.body === undefined) return c.body("", 202);
      return c.json(reply.body);
    };
    if (!acceptsEventStream(c.req.header("accept"))) return respond(await pending);
    const quick = await settleWithin(pending, opts.sseAfterMs ?? MCP_SSE_AFTER_MS);
    if (quick) return respond(quick.reply);
    // Slow call (usually waiting on operator approval). Send headers now and keep the
    // stream alive, so a client's default fetch timeouts (undici: 300 s for headers and
    // between body chunks) do not drop a call the operator is about to approve.
    return streamSSE(
      c,
      async (stream) => {
        const ping = setInterval(() => {
          void stream.write(": keepalive\n\n").catch(() => undefined);
        }, opts.ssePingMs ?? MCP_SSE_PING_MS);
        try {
          const reply = await pending;
          if (reply.body !== undefined) {
            await stream.writeSSE({ event: "message", data: JSON.stringify(reply.body) });
          }
        } finally {
          clearInterval(ping);
        }
      },
      async (err, stream) => {
        const id =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? ((raw as { id?: unknown }).id ?? null)
            : null;
        await stream.writeSSE({
          event: "message",
          data: JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: err.message || "Locus MCP call failed" },
          }),
        });
      },
    );
  };
}

/** Reply as JSON when the call settles this fast; slower calls switch to an SSE stream. */
const MCP_SSE_AFTER_MS = 10_000;
/** Comment frames on a slow SSE reply, well under undici's 300 s body timeout. */
const MCP_SSE_PING_MS = 15_000;

/** MCP streamable HTTP: a client that accepts `text/event-stream` takes an SSE reply. */
function acceptsEventStream(accept: string | undefined): boolean {
  return Boolean(accept && /(?:^|,)\s*text\/event-stream\b/i.test(accept));
}

async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<{ reply: T } | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([promise.then((reply) => ({ reply })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
