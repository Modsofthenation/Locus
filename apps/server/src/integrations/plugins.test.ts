import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ComputerUseToolName } from "@locus/shared";
import { MockHypervisor } from "@locus/hypervisor";
import { Hub } from "../core/hub.js";
import { SessionService } from "../session/sessions.js";
import { JsonStore } from "../core/store.js";

function tool(name: string, args: Record<string, unknown>) {
  return { name: name as ComputerUseToolName, args };
}

describe("integration plugins", () => {
  it("lets manage_integration_plugin persist a plugin and then call it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-plugin-"));
    const store = new JsonStore(dir);
    await store.init();
    const config = await store.loadConfig();
    const provider = config.providers[0]!;
    provider.apiKey = "sk-test";
    await store.saveConfig(config);
    const hypervisor = new MockHypervisor(dir);
    const sessions = new SessionService(store, hypervisor, new Hub());
    const created = await sessions.create({
      os: "ubuntu",
      templateId: config.templates[0]!.id,
      runtime: "host",
      providerId: provider.id,
      model: provider.defaultModel,
      startVm: false,
    });
    const createdTool = await sessions.executeTool(
      created.id,
      tool("manage_integration_plugin", {
        action: "create",
        slug: "status",
        name: "Status",
        description: "Internal status",
        config_fields: [
          { key: "baseUrl", label: "Base URL", type: "url" },
          { key: "token", label: "Token", type: "secret" },
        ],
        tools: [
          {
            name: "list",
            description: "List incidents",
            http: {
              method: "GET",
              url: "{{config.baseUrl}}/incidents",
              headers: { Authorization: "Bearer {{config.token}}" },
            },
          },
        ],
        config: { baseUrl: "https://status.example.com" },
      }),
    );
    expect(createdTool.ok).toBe(true);
    expect(createdTool.output).toMatch(/plugin_status_list/);
    const saved = await store.loadConfig();
    expect(saved.integrationPlugins?.[0]?.slug).toBe("status");
    expect(saved.integrationPlugins?.[0]?.config?.baseUrl).toBe("https://status.example.com");
    expect(saved.integrationPlugins?.[0]?.config?.token).toBeUndefined();

    saved.integrationPlugins![0]!.config = {
      ...(saved.integrationPlugins![0]!.config ?? {}),
      token: "tok",
    };
    await store.saveConfig(saved);

    const renamed = await sessions.executeTool(
      created.id,
      tool("manage_integration_plugin", {
        action: "update",
        slug: "status",
        name: "Status page",
      }),
    );
    expect(renamed.ok).toBe(true);
    const afterRename = await store.loadConfig();
    expect(afterRename.integrationPlugins?.[0]?.name).toBe("Status page");
    expect(afterRename.integrationPlugins?.[0]?.config?.token).toBe("tok");
    const onDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      integrationPlugins?: Array<{ config?: Record<string, string> }>;
    };
    expect(onDisk.integrationPlugins?.[0]?.config?.token).toBeFalsy();

    const demoted = await sessions.executeTool(
      created.id,
      tool("manage_integration_plugin", {
        action: "update",
        slug: "status",
        config_fields: [
          { key: "baseUrl", label: "Base URL", type: "url" },
          { key: "token", label: "Token", type: "string" },
        ],
      }),
    );
    expect(demoted.ok).toBe(true);
    const afterDemote = await store.loadConfig();
    expect(afterDemote.integrationPlugins?.[0]?.config?.token).toBeUndefined();
    const demotedDisk = JSON.parse(await readFile(join(dir, "config.json"), "utf8")) as {
      integrationPlugins?: Array<{ config?: Record<string, string> }>;
    };
    expect(demotedDisk.integrationPlugins?.[0]?.config?.token).toBeFalsy();

    afterDemote.integrationPlugins![0]!.configFields = [
      { key: "baseUrl", label: "Base URL", type: "url" },
      { key: "token", label: "Token", type: "secret" },
    ];
    afterDemote.integrationPlugins![0]!.config = {
      ...(afterDemote.integrationPlugins![0]!.config ?? {}),
      token: "tok",
    };
    await store.saveConfig(afterDemote);

    let called = "";
    sessions.fetchFn = (async (input) => {
      called = String(input);
      return new Response(JSON.stringify({ incidents: [{ id: "1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const listed = await sessions.executeTool(created.id, tool("plugin_status_list", {}));
    expect(listed.ok).toBe(true);
    expect(listed.output).toMatch(/incidents/);
    expect(called).toBe("https://status.example.com/incidents");
    hypervisor.shutdown();
  });
});
