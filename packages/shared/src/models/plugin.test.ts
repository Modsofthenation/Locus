import { describe, expect, it } from "vitest";
import {
  applyPluginManageAction,
  automationAllowsPlugin,
  findPluginTool,
  formatPluginCatalog,
  MANAGE_INTEGRATION_PLUGIN_NAME,
  normalizePlugin,
  normalizePlugins,
  pluginAllowedHosts,
  pluginExtraTools,
  pluginFieldRequired,
  pluginFunctionName,
  pluginReady,
  pluginReadToolNames,
  pluginSlug,
  pluginToolIsWrite,
  pluginUrlHostError,
  pluginWriteToolNames,
  staticHostsFromUrlTemplate,
  validatePlugin,
  type IntegrationPlugin,
} from "./plugin.js";

function sample(overrides: Partial<IntegrationPlugin> = {}): IntegrationPlugin {
  return {
    id: "p1",
    slug: "status",
    name: "Status",
    description: "Internal status API",
    enabled: true,
    configFields: [
      { key: "baseUrl", label: "Base URL", type: "url" },
      { key: "token", label: "Token", type: "secret" },
    ],
    config: { baseUrl: "https://status.example.com" },
    tools: [
      {
        name: "list",
        description: "List incidents",
        parameters: { type: "object", properties: {} },
        http: { method: "GET", url: "{{config.baseUrl}}/incidents" },
      },
      {
        name: "create",
        description: "Open an incident",
        parameters: {
          type: "object",
          properties: { title: { type: "string", description: "Title" } },
          required: ["title"],
        },
        http: {
          method: "POST",
          url: "{{config.baseUrl}}/incidents",
          headers: { Authorization: "Bearer {{config.token}}" },
          body: { title: "{{args.title}}" },
        },
      },
    ],
    ...overrides,
  };
}

describe("plugin model", () => {
  it("accepts a short slug and rejects reserved names", () => {
    expect(pluginSlug("status-page")).toBe("status-page");
    expect(pluginSlug("Jira")).toBeUndefined();
    expect(pluginSlug("mcp")).toBeUndefined();
    expect(pluginSlug("portainer")).toBeUndefined();
    expect(pluginSlug("gmail")).toBeUndefined();
    expect(pluginSlug("gcal")).toBeUndefined();
    expect(pluginSlug("gdrive")).toBeUndefined();
    expect(pluginSlug("miro")).toBeUndefined();
    expect(pluginSlug("1bad")).toBeUndefined();
  });

  it("names flattened tools and classifies writes", () => {
    expect(pluginFunctionName("status", "list")).toBe("plugin_status_list");
    const plugin = sample();
    expect(pluginToolIsWrite(plugin.tools[0]!)).toBe(false);
    expect(pluginToolIsWrite(plugin.tools[1]!)).toBe(true);
    expect(pluginReadToolNames([plugin])).toEqual(["plugin_status_list"]);
    expect(pluginWriteToolNames([plugin])).toEqual(["plugin_status_create"]);
    expect(findPluginTool([plugin], "plugin_status_create")?.tool.name).toBe("create");
    expect(
      pluginToolIsWrite({
        write: false,
        http: { method: "POST", url: "https://status.example.com/incidents" },
      }),
    ).toBe(true);
    expect(
      pluginToolIsWrite({
        write: true,
        http: { method: "GET", url: "https://status.example.com/delete" },
      }),
    ).toBe(true);
    expect(pluginReadToolNames([{ ...plugin, tools: [plugin.tools[1]!] }])).toEqual([]);
  });

  it("is ready only when required url/secret values exist", () => {
    const plugin = sample();
    expect(pluginFieldRequired(plugin.configFields[0]!)).toBe(true);
    expect(pluginReady(plugin)).toBe(false);
    expect(pluginReady({ ...plugin, config: { ...plugin.config, token: "tok" } })).toBe(true);
    expect(
      pluginReady({ ...plugin, enabled: false, config: { baseUrl: "https://x", token: "t" } }),
    ).toBe(false);
    expect(pluginExtraTools([plugin])).toEqual([]);
    expect(
      pluginExtraTools([
        { ...plugin, config: { baseUrl: "https://status.example.com", token: "tok" } },
      ]).map((tool) => tool.name),
    ).toEqual(["plugin_status_list", "plugin_status_create"]);
  });

  it("rejects URL templates that let args pick the host", () => {
    const plugin = sample();
    expect(pluginUrlHostError("{{config.baseUrl}}/v1/{{args.id}}", plugin)).toBeUndefined();
    expect(pluginUrlHostError("https://{{args.host}}/x", plugin)).toMatch(/host cannot use/);
    expect(staticHostsFromUrlTemplate("https://api.linear.app/graphql")).toEqual([
      "api.linear.app",
    ]);
    expect(pluginAllowedHosts(plugin)).toEqual(["status.example.com"]);
  });

  it("normalizes and validates a plugin row", () => {
    const parsed = normalizePlugin({
      id: "p1",
      slug: "Status",
      name: "Status",
      config_fields: [{ key: "baseUrl", label: "URL", type: "url" }],
      tools: [
        {
          name: "list",
          description: "List",
          http: { method: "get", url: "{{config.baseUrl}}/x" },
        },
      ],
    });
    expect(parsed?.slug).toBe("status");
    expect(validatePlugin(parsed!, [])).toBeUndefined();
    expect(normalizePlugins([{ id: "x" }])).toEqual([]);
  });

  it("creates and updates plugins without storing secrets", () => {
    const created = applyPluginManageAction(
      [],
      {
        action: "create",
        slug: "pager",
        name: "Pager",
        config_fields: JSON.stringify([
          { key: "baseUrl", label: "Base URL", type: "url" },
          { key: "token", label: "Token", type: "secret" },
        ]),
        tools: JSON.stringify([
          {
            name: "search",
            description: "Search incidents",
            parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
            http: {
              method: "GET",
              url: "{{config.baseUrl}}/search",
              query: { q: "{{args.q}}" },
              headers: { Authorization: "Bearer {{config.token}}" },
            },
          },
        ]),
        config: JSON.stringify({ baseUrl: "https://pager.example", token: "should-drop" }),
      },
      () => "new-id",
    );
    expect(created.ok).toBe(true);
    expect(created.plugins[0]?.id).toBe("new-id");
    expect(created.plugins[0]?.config?.baseUrl).toBe("https://pager.example");
    expect(created.plugins[0]?.config?.token).toBeUndefined();
    expect(created.output).toMatch(/Settings → Integrations/);

    const withSecret: IntegrationPlugin = {
      ...created.plugins[0]!,
      config: { ...created.plugins[0]!.config, token: "vaulted-token" },
    };
    const updated = applyPluginManageAction(
      [withSecret],
      { action: "update", slug: "pager", name: "Pager Duty" },
      () => "x",
    );
    expect(updated.ok).toBe(true);
    expect(updated.plugins[0]?.name).toBe("Pager Duty");
    expect(updated.plugins[0]?.tools).toHaveLength(1);
    expect(updated.plugins[0]?.config?.token).toBe("vaulted-token");
    expect(updated.plugins[0]?.config?.baseUrl).toBe("https://pager.example");

    const injected = applyPluginManageAction(
      updated.plugins,
      {
        action: "update",
        slug: "pager",
        config: JSON.stringify({ token: "agent-supplied", baseUrl: "https://pager.example" }),
      },
      () => "x",
    );
    expect(injected.ok).toBe(true);
    expect(injected.plugins[0]?.config?.token).toBe("vaulted-token");

    const demoted = applyPluginManageAction(
      updated.plugins,
      {
        action: "update",
        slug: "pager",
        config_fields: JSON.stringify([
          { key: "baseUrl", label: "Base URL", type: "url" },
          { key: "token", label: "Token", type: "string" },
        ]),
      },
      () => "x",
    );
    expect(demoted.ok).toBe(true);
    expect(demoted.plugins[0]?.config?.token).toBeUndefined();
    expect(demoted.plugins[0]?.config?.baseUrl).toBe("https://pager.example");

    const listed = applyPluginManageAction(updated.plugins, { action: "list" }, () => "x");
    expect(listed.output).toMatch(/plugin_pager_search/);
    expect(listed.output).not.toMatch(/should-drop/);

    const removed = applyPluginManageAction(
      updated.plugins,
      { action: "delete", slug: "pager" },
      () => "x",
    );
    expect(removed.ok).toBe(true);
    expect(removed.plugins).toEqual([]);
  });

  it("gates plugin tools on automation allowlists", () => {
    expect(automationAllowsPlugin({ automationId: "a1" }, "plugin_status_list")).toBe(false);
    expect(
      automationAllowsPlugin(
        { automationId: "a1", allowedMcpTools: ["plugin_status_list"] },
        "plugin_status_list",
      ),
    ).toBe(true);
    expect(automationAllowsPlugin({}, "plugin_status_list")).toBe(true);
    expect(automationAllowsPlugin({ automationId: "a1" }, "exec")).toBe(true);
  });

  it("lists plugins in the catalog even when they still need Settings", () => {
    const catalog = formatPluginCatalog([sample()]);
    expect(catalog).toMatch(/manage_integration_plugin/);
    expect(catalog).toMatch(/needs Settings values/);
    expect(catalog).toMatch(/plugin_status_list/);
    expect(formatPluginCatalog([])).toMatch(/None yet/);
    expect(MANAGE_INTEGRATION_PLUGIN_NAME).toBe("manage_integration_plugin");
  });
});
