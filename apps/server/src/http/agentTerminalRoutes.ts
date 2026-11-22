import type { Hono } from "hono";
import type { AgentTerminalRegistry } from "../workspace/agentTerminals.js";

/** Terminal mode: list and close a session's agent terminals. The PTY itself is `/ws/sessions/:id/terminal`. */
export function registerAgentTerminalRoutes(app: Hono, terminals?: AgentTerminalRegistry): void {
  app.get("/api/sessions/:id/terminals", async (c) => {
    if (!terminals) {
      return c.json({
        available: false,
        reason: "Terminal mode is off on this server.",
        defaultPreset: "shell",
        terminals: [],
      });
    }
    return c.json(await terminals.status(c.req.param("id")));
  });

  app.delete("/api/sessions/:id/terminals/:terminalId", (c) => {
    const closed = terminals?.close(c.req.param("id"), c.req.param("terminalId")) ?? false;
    return c.json({ ok: true, closed });
  });
}
