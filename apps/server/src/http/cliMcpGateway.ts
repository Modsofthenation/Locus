import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { Hono, type Context } from "hono";

/** A session-scoped MCP URL handed to one sandboxed CLI turn. */
export type CliMcpGrant = {
  /** `http://127.0.0.1:<port>/mcp/sessions/<id>/<token>`. */
  url: string;
  /** The gateway's loopback port: the only host port the CLI sandbox forwards. */
  port: number;
  /** Invalidate the token. Called when the turn ends. */
  revoke: () => void;
};

/**
 * The only control-plane surface a sandboxed (Docker-session) CLI agent can reach.
 *
 * A separate loopback listener, not the control plane: it serves nothing but
 * `POST /mcp/sessions/:sessionId/:token`, and each token is bound to one session and
 * revoked when that CLI turn ends. `/api/*`, `/ws`, the UI, the unscoped `/mcp` and other
 * sessions' MCP are not routed here, so a CLI that can only reach this port cannot read
 * other sessions or act as the operator. See docs/cli-agent-sandbox.md.
 */
export class CliMcpGateway {
  private readonly tokens = new Map<string, string>();
  private server?: Server;
  private listening?: Promise<number>;
  readonly app: Hono;

  constructor(
    handle: (c: Context, sessionId: string) => Promise<Response>,
    private readonly host = "127.0.0.1",
  ) {
    const app = new Hono();
    app.get("/mcp/sessions/:sessionId/:token", (c) => c.json({ error: "Method not allowed" }, 405));
    app.post("/mcp/sessions/:sessionId/:token", async (c) => {
      const sessionId = c.req.param("sessionId");
      if (!this.allows(sessionId, c.req.param("token"))) {
        return c.json({ error: "Forbidden" }, 403);
      }
      return handle(c, sessionId);
    });
    app.all("*", (c) => c.json({ error: "Not found" }, 404));
    this.app = app;
  }

  /** Start listening (once) on an ephemeral loopback port. */
  port(): Promise<number> {
    this.listening ??= new Promise<number>((resolve, reject) => {
      const server = createServer(getRequestListener(this.app.fetch));
      server.once("error", reject);
      server.listen(0, this.host, () => {
        server.off("error", reject);
        // Never keep the process alive just for this.
        server.unref();
        resolve((server.address() as AddressInfo).port);
      });
      this.server = server;
    }).catch((err: unknown) => {
      this.listening = undefined;
      throw err;
    });
    return this.listening;
  }

  async issue(sessionId: string): Promise<CliMcpGrant> {
    const port = await this.port();
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, sessionId);
    return {
      url: `http://${this.host}:${port}/mcp/sessions/${encodeURIComponent(sessionId)}/${token}`,
      port,
      revoke: () => {
        this.tokens.delete(token);
      },
    };
  }

  private allows(sessionId: string, token: string): boolean {
    const owner = this.tokens.get(token);
    if (owner === undefined) return false;
    const a = Buffer.from(owner);
    const b = Buffer.from(sessionId);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async close(): Promise<void> {
    this.tokens.clear();
    const server = this.server;
    this.server = undefined;
    this.listening = undefined;
    if (!server?.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
