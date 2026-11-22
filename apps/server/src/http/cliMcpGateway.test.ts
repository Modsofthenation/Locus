import { afterEach, describe, expect, it } from "vitest";
import { CliMcpGateway } from "./cliMcpGateway.js";

const gateways: CliMcpGateway[] = [];
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((g) => g.close()));
});

function gateway() {
  const seen: string[] = [];
  const g = new CliMcpGateway(async (c, sessionId) => {
    seen.push(sessionId);
    return c.json({ jsonrpc: "2.0", id: 1, result: { sessionId } });
  });
  gateways.push(g);
  return { g, seen };
}

const post = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };

describe("CliMcpGateway", () => {
  it("serves a session's MCP only with that session's live token", async () => {
    const { g, seen } = gateway();
    const grant = await g.issue("s1");
    expect(grant.url).toBe(
      `http://127.0.0.1:${grant.port}/mcp/sessions/s1/${grant.url.split("/").pop()}`,
    );

    const own = await fetch(grant.url, post);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ result: { sessionId: "s1" } });

    // The s1 token cannot be replayed against another session.
    const other = await fetch(grant.url.replace("/sessions/s1/", "/sessions/s2/"), post);
    expect(other.status).toBe(403);
    const forged = await fetch(grant.url.replace(/[^/]+$/, "nope"), post);
    expect(forged.status).toBe(403);

    grant.revoke();
    expect((await fetch(grant.url, post)).status).toBe(403);
    expect(seen).toEqual(["s1"]);
  });

  it("routes nothing else: no API, no unscoped MCP, no UI", async () => {
    const { g, seen } = gateway();
    const { port } = await g.issue("s1");
    for (const path of ["/api/sessions", "/api/sessions/s1", "/mcp", "/mcp/sessions/s1", "/"]) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      expect(res.status, path).toBe(404);
      const posted = await fetch(`http://127.0.0.1:${port}${path}`, post);
      expect(posted.status, path).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  it("listens once and hands every grant the same port", async () => {
    const { g } = gateway();
    const [a, b] = await Promise.all([g.issue("s1"), g.issue("s2")]);
    expect(a.port).toBe(b.port);
    expect(a.url).not.toBe(b.url);
  });
});
