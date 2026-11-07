import { describe, expect, it } from "vitest";
import {
  applyManagedPolicy,
  enterpriseProviderKey,
  gifLookupAllowed,
  isConsumerLoginProvider,
  parseManagedPolicy,
  pickPolicyDistiller,
  policyBannerLabel,
  policyForcedJail,
  policyRejectsCreate,
  providerAllowedByPolicy,
} from "./policy.js";
import type { LocusConfig } from "./config.js";
import type { AiProvider } from "./provider.js";

function provider(
  partial: Partial<AiProvider> & Pick<AiProvider, "id" | "kind" | "name" | "baseUrl">,
): AiProvider {
  return {
    models: ["m"],
    defaultModel: "m",
    enabled: true,
    extraHeaders: {},
    ...partial,
  };
}

describe("managed policy parse", () => {
  it("fills enterprise defaults and rejects unknown versions", () => {
    expect(parseManagedPolicy({ version: 2 })).toBeUndefined();
    const parsed = parseManagedPolicy({
      version: 1,
      name: "Acme",
      brainDistillerProvider: "anthropic",
    });
    expect(parsed?.blockConsumerLogins).toBe(true);
    expect(parsed?.sandbox?.allowHostAgents).toBe(false);
    expect(parsed?.sandbox?.forceJail).toBe(true);
    expect(parsed?.gifLookup).toBe(false);
    expect(parsed?.name).toBe("Acme");
    expect(parseManagedPolicy({ version: 1 })?.name).toBeUndefined();
  });

  it("keeps an explicit empty allow-list so Brain can fall back to heuristics", () => {
    const parsed = parseManagedPolicy({ version: 1, allowedProviders: [] });
    expect(parsed?.allowedProviders).toEqual([]);
  });
});

describe("provider allow-list", () => {
  const anthropic = provider({
    id: "anthropic",
    kind: "anthropic",
    name: "Anthropic",
    baseUrl: "https://api.anthropic.com",
  });
  const cursor = provider({
    id: "cursor",
    kind: "cursor",
    name: "Cursor Cloud",
    baseUrl: "https://api.cursor.com/v1",
  });
  const ollama = provider({
    id: "openai-compatible:Ollama",
    kind: "openai-compatible",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
  });
  const custom = provider({
    id: "custom",
    kind: "openai-compatible",
    name: "Custom",
    baseUrl: "https://llm.evil.example/v1",
  });

  it("classifies enterprise vs consumer endpoints", () => {
    expect(enterpriseProviderKey(anthropic)).toBe("anthropic");
    expect(enterpriseProviderKey(ollama)).toBe("ollama");
    expect(isConsumerLoginProvider(cursor)).toBe(true);
    expect(isConsumerLoginProvider(anthropic)).toBe(false);
  });

  it("allows Anthropic/Ollama and blocks consumer logins plus arbitrary URLs", () => {
    const policy = parseManagedPolicy({ version: 1 })!;
    expect(providerAllowedByPolicy(anthropic, policy)).toBe(true);
    expect(providerAllowedByPolicy(ollama, policy)).toBe(true);
    expect(providerAllowedByPolicy(cursor, policy)).toBe(false);
    expect(providerAllowedByPolicy(custom, policy)).toBe(false);
  });
});

describe("applyManagedPolicy", () => {
  const base: LocusConfig = {
    theme: "ember",
    providers: [
      provider({
        id: "anthropic",
        kind: "anthropic",
        name: "Anthropic",
        baseUrl: "https://api.anthropic.com",
      }),
      provider({
        id: "cursor",
        kind: "cursor",
        name: "Cursor Cloud",
        baseUrl: "https://api.cursor.com/v1",
      }),
    ],
    templates: [],
    hardwareProfiles: [],
    forges: [],
    mcpServers: [
      {
        id: "host-mcp",
        name: "Host",
        enabled: true,
        command: "npx",
        args: [],
        env: {},
        runtime: "host",
      },
    ],
    integrations: [
      {
        id: "jira",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://ex.atlassian.net",
        token: "secret",
      },
    ],
    advanced: {
      dataDir: "/tmp",
      qemuBinary: "qemu",
      swtpmBinary: "swtpm",
      ovmfCodePath: "",
      ovmfVarsPath: "",
      maxConcurrentVms: 1,
      defaultAcceleratorAuto: true,
      logLevel: "info",
      bindHost: "127.0.0.1",
      bindPort: 7420,
      openBrowserOnStart: true,
      hostSharePath: "",
      autonomy: "autonomous",
    },
    phoneRemote: { enabled: true, token: "ph_x" },
    chromeExtension: { enabled: true, token: "cx_x" },
  };

  it("disables consumer providers, host MCP, phone, Chrome, and Autonomous", () => {
    const policy = parseManagedPolicy({ version: 1 })!;
    const applied = applyManagedPolicy(base, {
      active: true,
      source: "/etc/locus/policy.json",
      policy,
      locked: [],
    });
    expect(applied.providers.find((row) => row.id === "cursor")?.enabled).toBe(false);
    expect(applied.providers.find((row) => row.id === "anthropic")?.enabled).toBe(true);
    expect(applied.mcpServers?.[0]?.runtime).toBe("guest");
    expect(applied.phoneRemote?.enabled).toBe(false);
    expect(applied.chromeExtension?.enabled).toBe(false);
    expect(applied.advanced.autonomy).toBe("guided");
    expect(applied.brain?.distillerProviderId).toBe("anthropic");
    expect(applied.managedPolicy?.policy.name).toBeUndefined();
    expect(policyBannerLabel(applied.managedPolicy)).toBe("Managed by organization policy");
    expect(
      policyBannerLabel({
        active: true,
        policy: parseManagedPolicy({ version: 1, name: "Acme" })!,
        locked: [],
      }),
    ).toBe("Managed by Acme policy");
    expect(policyForcedJail(applied.managedPolicy)).toBe("restricted");
    expect(gifLookupAllowed(applied.managedPolicy)).toBe(false);
  });

  it("clears personal tokens in token-free mode and injects a managed MCP proxy", () => {
    const policy = parseManagedPolicy({
      version: 1,
      tokenFreeMode: true,
      integrationProxyUrl: "https://mcp.example/mcp",
    })!;
    const applied = applyManagedPolicy(base, { active: true, policy, locked: [] });
    expect(applied.integrations?.[0]?.token).toBeUndefined();
    expect(applied.mcpServers?.[0]?.id).toBe("managed-policy");
    expect(applied.mcpServers?.[0]?.name).toBe("Managed integrations");
    expect(applied.mcpServers?.[0]?.url).toBe("https://mcp.example/mcp");
  });

  it("replaces a leftover last-yard-policy MCP id with managed-policy", () => {
    const policy = parseManagedPolicy({
      version: 1,
      tokenFreeMode: true,
      integrationProxyUrl: "https://mcp.example/mcp",
    })!;
    const applied = applyManagedPolicy(
      {
        ...base,
        mcpServers: [
          {
            id: "last-yard-policy",
            name: "old",
            enabled: true,
            command: "mcp",
            args: [],
            env: {},
            url: "https://old.example/mcp",
            runtime: "host",
            managed: true,
          },
        ],
      },
      { active: true, policy, locked: [] },
    );
    expect(applied.mcpServers?.map((row) => row.id)).toEqual(["managed-policy"]);
  });

  it("pins Brain to an allowed provider and returns nothing when the allow-list is empty", () => {
    const policy = parseManagedPolicy({
      version: 1,
      brainDistillerProvider: "anthropic",
      brainDistillerModel: "claude-haiku-4-5",
    })!;
    const picked = pickPolicyDistiller(base.providers, policy);
    expect(picked).toEqual({ providerId: "anthropic", model: "claude-haiku-4-5" });
    expect(
      pickPolicyDistiller(base.providers, parseManagedPolicy({ version: 1, allowedProviders: [] })),
    ).toBeUndefined();
    const cleared = applyManagedPolicy(
      { ...base, brain: { distillerProviderId: "anthropic", distillerModel: "claude-haiku-4-5" } },
      {
        active: true,
        policy: parseManagedPolicy({ version: 1, allowedProviders: [] })!,
        locked: [],
      },
    );
    expect(cleared.brain?.distillerProviderId).toBeUndefined();
    expect(cleared.brain?.distillerModel).toBeUndefined();
  });

  it("rejects Host agents, Autonomous, live Chrome, and open jail", () => {
    const status = {
      active: true,
      policy: parseManagedPolicy({ version: 1 })!,
      locked: [],
    };
    expect(policyRejectsCreate({ runtime: "host", status })).toMatch(/Host agents/);
    expect(policyRejectsCreate({ autonomy: "autonomous", status })).toMatch(/Autonomous/);
    expect(policyRejectsCreate({ liveChrome: true, status })).toMatch(/Chrome/);
    expect(policyRejectsCreate({ network: "open", status })).toMatch(/jail/);
    expect(
      policyRejectsCreate({ runtime: "docker", network: "restricted", status }),
    ).toBeUndefined();
  });
});
