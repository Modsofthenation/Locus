import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import {
  dispatchWorkerCliMcp,
  registerMcpRoutes,
  workerCliMcpPathMatchesSession,
} from "./mcpRoutes.js";

type GitCall = (
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<{ ok: boolean; output: string }>;

function mcpApp(executeCliGitTool: GitCall, timing = { sseAfterMs: 30, ssePingMs: 10 }) {
  const store = {
    loadConfig: async () => ({ integrations: [] }),
  } as unknown as JsonStore;
  const sessions = {
    get: async (id: string) => ({ id, runtime: "host", messages: [] }),
    cliGitTools: () => [{ name: "git_push", description: "push", inputSchema: { type: "object" } }],
    cliSkillTools: () => [
      { name: "manage_skill", description: "skills", inputSchema: { type: "object" } },
    ],
    executeCliGitTool,
    executeCliSkillTool: async (_id: string, args: Record<string, unknown>) => ({
      ok: true,
      output: `saved ${String(args.name)}`,
    }),
  } as unknown as SessionService;
  const app = new Hono();
  registerMcpRoutes(app, { store, sessions, brain: undefined as never, ...timing });
  return app;
}

function pushRequest(accept?: string, signal?: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(accept ? { accept } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "git_push", arguments: {} },
    }),
    signal,
  };
}

const STREAMABLE = "application/json, text/event-stream";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("session MCP route", () => {
  it("answers fast calls with JSON even when the client accepts SSE", async () => {
    const app = mcpApp(async () => ({ ok: true, output: "pushed" }));
    const res = await app.request("/mcp/sessions/s1", pushRequest(STREAMABLE));
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { id: number; result: { content: Array<{ text: string }> } };
    expect(body.id).toBe(7);
    expect(body.result.content[0]!.text).toContain("pushed");
  });

  it("streams a slow call (an approval wait) as SSE with keepalives", async () => {
    const app = mcpApp(async () => {
      await delay(80);
      return { ok: true, output: "pushed after approval" };
    });
    const res = await app.request("/mcp/sessions/s1", pushRequest(STREAMABLE));
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain(": keepalive");
    const data = text
      .split("\n")
      .find((line) => line.startsWith("data: "))!
      .slice("data: ".length);
    const message = JSON.parse(data) as {
      id: number;
      result: { content: Array<{ text: string }> };
    };
    expect(message.id).toBe(7);
    expect(message.result.content[0]!.text).toContain("pushed after approval");
  });

  it("keeps plain JSON for callers that do not accept SSE (curl fallback)", async () => {
    const app = mcpApp(async () => {
      await delay(80);
      return { ok: true, output: "slow but json" };
    });
    const res = await app.request("/mcp/sessions/s1", pushRequest());
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(JSON.stringify(await res.json())).toContain("slow but json");
  });

  it("hands the Git tool a signal that aborts when the caller disconnects", async () => {
    let seen: AbortSignal | undefined;
    const app = mcpApp(async (_id, _name, _args, signal) => {
      seen = signal;
      await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
      return { ok: false, output: "Git operation cancelled." };
    });
    const caller = new AbortController();
    const res = Promise.resolve(
      app.request("/mcp/sessions/s1", pushRequest(undefined, caller.signal)),
    );
    for (let i = 0; i < 50 && !seen; i++) await delay(5);
    expect(seen?.aborted).toBe(false);
    caller.abort();
    await res.catch(() => undefined);
    expect(seen?.aborted).toBe(true);
  });
});

describe("session MCP manage_skill", () => {
  it("lists manage_skill and routes calls to the session service", async () => {
    const app = mcpApp(async () => ({ ok: true, output: "pushed" }));
    const post = (body: unknown) =>
      app.request("/mcp/sessions/s1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const list = (await (await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(list.result.tools.map((tool) => tool.name)).toContain("manage_skill");
    const call = (await (
      await post({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "manage_skill", arguments: { action: "create", name: "review-pr" } },
      })
    ).json()) as { result: { content: Array<{ text: string }> } };
    expect(call.result.content[0]!.text).toContain("saved review-pr");
  });
});

describe("worker CLI MCP relay", () => {
  function deps() {
    const store = {
      loadConfig: async () => ({ integrations: [] }),
    } as unknown as JsonStore;
    const gitCalls: string[] = [];
    const sessions = {
      get: async (id: string) => ({ id, runtime: "host", messages: [] }),
      cliGitTools: () => [
        { name: "git_push", description: "push", inputSchema: { type: "object" } },
      ],
      cliSkillTools: () => [],
      executeCliGitTool: async (sessionId: string) => {
        gitCalls.push(sessionId);
        return { ok: true, output: "pushed" };
      },
      dockerInventory: {
        executeSwarmTool: async () => {
          throw new Error("unscoped Swarm tool reached");
        },
      },
    } as unknown as SessionService;
    return { store, sessions, gitCalls };
  }

  const toolsList = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  it("matches only the turn's own session path", () => {
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/s1", "s1")).toBe(true);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/s1/", "s1")).toBe(true);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/a%2Fb", "a/b")).toBe(true);
    expect(workerCliMcpPathMatchesSession("/mcp", "s1")).toBe(false);
    expect(workerCliMcpPathMatchesSession("/mcp/", "s1")).toBe(false);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/", "s1")).toBe(false);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/s2", "s1")).toBe(false);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/s1/extra", "s1")).toBe(false);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/%E0%A4", "s1")).toBe(false);
    expect(workerCliMcpPathMatchesSession("/mcp/sessions/", "")).toBe(false);
  });

  it("refuses the unscoped /mcp and other sessions instead of running the unscoped MCP", async () => {
    const { store, sessions } = deps();
    for (const path of ["/mcp", "/mcp/", "/mcp/sessions/other"]) {
      const reply = await dispatchWorkerCliMcp({
        store,
        sessions,
        sessionId: "s1",
        path,
        raw: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "docker_swarm_services", arguments: {} },
        },
      });
      expect(reply.status, path).toBe(404);
      expect(reply.body).toMatchObject({ error: { code: -32004 } });
      const listed = await dispatchWorkerCliMcp({
        store,
        sessions,
        sessionId: "s1",
        path,
        raw: toolsList,
      });
      expect(listed.status, path).toBe(404);
    }
  });

  it("serves the turn's own session MCP", async () => {
    const { store, sessions, gitCalls } = deps();
    const listed = await dispatchWorkerCliMcp({
      store,
      sessions,
      sessionId: "s1",
      path: "/mcp/sessions/s1",
      raw: toolsList,
    });
    expect(listed.status).toBe(200);
    const names = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    expect(names).toContain("git_push");
    const pushed = await dispatchWorkerCliMcp({
      store,
      sessions,
      sessionId: "s1",
      path: "/mcp/sessions/s1",
      raw: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "git_push", arguments: {} },
      },
    });
    expect(pushed.status).toBe(200);
    expect(gitCalls).toEqual(["s1"]);
  });
});
