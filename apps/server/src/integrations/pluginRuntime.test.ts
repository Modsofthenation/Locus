import { describe, expect, it } from "vitest";
import type { IntegrationPlugin } from "@locus/shared";
import { buildPluginRequest, callPluginTool } from "./pluginRuntime.js";

function plugin(): IntegrationPlugin {
  return {
    id: "p1",
    slug: "status",
    name: "Status",
    description: "Internal status",
    enabled: true,
    configFields: [
      { key: "baseUrl", label: "Base URL", type: "url" },
      { key: "token", label: "Token", type: "secret" },
    ],
    config: { baseUrl: "https://status.example.com", token: "secret-token" },
    tools: [
      {
        name: "list",
        description: "List",
        parameters: { type: "object", properties: { q: { type: "string" } } },
        http: {
          method: "GET",
          url: "{{config.baseUrl}}/incidents/{{args.id}}",
          query: { q: "{{args.q}}" },
          headers: { Authorization: "Bearer {{config.token}}" },
        },
      },
      {
        name: "create",
        description: "Create",
        parameters: { type: "object", properties: { title: { type: "string" } } },
        http: {
          method: "POST",
          url: "/incidents",
          headers: { Authorization: "Bearer {{config.token}}" },
          body: { title: "{{args.title}}" },
        },
      },
    ],
  };
}

describe("pluginRuntime", () => {
  it("fills templates and keeps the host on the url field", () => {
    const row = plugin();
    const req = buildPluginRequest(row, row.tools[0]!.http, { id: "a/b", q: "down" });
    expect(req.method).toBe("GET");
    expect(req.url).toBe("https://status.example.com/incidents/a%2Fb?q=down");
    expect(req.headers.Authorization).toBe("Bearer secret-token");
    expect(req.body).toBeUndefined();
  });

  it("joins a relative URL onto the url config field", () => {
    const row = plugin();
    const req = buildPluginRequest(row, row.tools[1]!.http, { title: "Outage" });
    expect(req.url).toBe("https://status.example.com/incidents");
    expect(req.body).toBe(JSON.stringify({ title: "Outage" }));
    expect(req.headers["Content-Type"]).toBe("application/json");
  });

  it("refuses a host that is not on the plugin", () => {
    const row = plugin();
    expect(() =>
      buildPluginRequest(row, { method: "GET", url: "https://evil.example/x" }, {}),
    ).toThrow(/not in this plugin/);
  });

  it("calls the host and returns JSON", async () => {
    const row = plugin();
    const result = await callPluginTool(
      "plugin_status_list",
      { id: "1", q: "x" },
      [row],
      async (url, init) => {
        expect(String(url)).toContain("https://status.example.com/incidents/1");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
        return new Response(JSON.stringify({ ok: true, items: [1] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/"ok": true/);
  });

  it("refuses redirects", async () => {
    const row = plugin();
    const result = await callPluginTool("plugin_status_list", { id: "1" }, [row], async () => {
      return new Response("", { status: 302, headers: { Location: "https://evil.example" } });
    });
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/Refusing redirect/);
  });
});
