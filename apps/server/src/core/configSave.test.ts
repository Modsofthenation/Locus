import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { customThemeFromInput } from "@locus/shared";
import { defaultConfig } from "../defaults.js";
import { normalizeSavedConfig, prepareSavedConfig, providerBaseUrlError } from "./configSave.js";

describe("normalizeSavedConfig", () => {
  it("accepts a generated theme id only when that theme is in the config", () => {
    const config = defaultConfig("/data");
    const theme = customThemeFromInput(
      { name: "Neon Rain", colors: { bg: "#05060a", text: "#e6f1ff", accent: "#ff2a6d" } },
      { now: "2026-01-01T00:00:00.000Z" },
    );
    const withTheme = { ...config, customThemes: [theme], theme: theme.id };
    const saved = normalizeSavedConfig(withTheme, theme.id, "/data");
    expect(saved.ok).toBe(true);
    expect(
      normalizeSavedConfig({ ...config, customThemes: [] }, "custom-missing", "/data"),
    ).toEqual({ ok: false, error: "Unknown theme" });
  });

  it("rejects an unknown theme and a non-loopback bind host", () => {
    const config = defaultConfig("/data");
    expect(normalizeSavedConfig(config, "not-a-theme" as never, "/data")).toEqual({
      ok: false,
      error: "Unknown theme",
    });
    config.advanced.bindHost = "0.0.0.0";
    expect(normalizeSavedConfig(config, undefined, "/data")).toEqual({
      ok: false,
      error: "Bind host must be loopback (127.0.0.1, ::1, or localhost)",
    });
  });

  it("fills a missing host share path", () => {
    const config = defaultConfig("/data");
    config.advanced.hostSharePath = "";
    const saved = normalizeSavedConfig(config, config.theme, "/data");
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.config.advanced.hostSharePath).toBe(join("/data", "share"));
  });

  it("defaults desktop notify prefs to on and keeps false", () => {
    const config = defaultConfig("/data");
    const fresh = normalizeSavedConfig(config, config.theme, "/data");
    expect(fresh.ok).toBe(true);
    if (fresh.ok) {
      expect(fresh.config.notifyAgents).toBe(true);
      expect(fresh.config.notifyNeedsYou).toBe(true);
      expect(fresh.config.notifySlack).toBe(true);
      expect(fresh.config.notifyAutomations).toBe(true);
    }
    config.notifyAgents = false;
    config.notifyAutomations = false;
    const muted = normalizeSavedConfig(config, config.theme, "/data");
    expect(muted.ok).toBe(true);
    if (muted.ok) {
      expect(muted.config.notifyAgents).toBe(false);
      expect(muted.config.notifyNeedsYou).toBe(true);
      expect(muted.config.notifySlack).toBe(true);
      expect(muted.config.notifyAutomations).toBe(false);
    }
  });

  it("accepts named environments and rejects a missing worker", () => {
    const config = defaultConfig("/data");
    config.namedEnvironments = [
      {
        id: "env-1",
        name: "restricted-oncall",
        runtime: "docker",
        os: "ubuntu",
        dockerImage: "locus/agent",
        network: "restricted",
        maxUsd: 20,
        createdAt: "2026-08-29T00:00:00.000Z",
        updatedAt: "2026-08-29T00:00:00.000Z",
      },
    ];
    const saved = normalizeSavedConfig(config, config.theme, "/data");
    expect(saved.ok).toBe(true);
    config.namedEnvironments[0]!.placement = "worker";
    config.namedEnvironments[0]!.backendId = "missing";
    expect(normalizeSavedConfig(config, config.theme, "/data")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Unknown worker/i),
    });
  });
});

describe("prepareSavedConfig", () => {
  it("restores masked secrets and locks managed policy from the stored config", () => {
    const current = defaultConfig("/data");
    current.providers[0]!.apiKey = "sk-live";
    current.managedPolicy = { source: "file", path: "/etc/locus/policy.json" } as never;
    const body = structuredClone(current);
    body.providers[0]!.apiKey = "••••••••";
    body.managedPolicy = { source: "none" } as never;
    const saved = prepareSavedConfig(current, body, "/data");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.config.providers[0]?.apiKey).toBe("sk-live");
    expect(saved.config.managedPolicy).toEqual(current.managedPolicy);
  });
});

describe("Custom CLI agent providers", () => {
  const cliProvider = (cli: unknown, enabled = true) => ({
    id: "cli-agent:Gemini CLI",
    name: "Gemini CLI",
    kind: "cli-agent" as const,
    baseUrl: "",
    models: [],
    defaultModel: "",
    enabled,
    extraHeaders: {},
    cli: cli as never,
  });

  it("normalizes a valid config and fills the placeholder base URL", () => {
    const config = defaultConfig("/data");
    config.providers.push(
      cliProvider({ command: " gemini ", args: ["-p", "{prompt}"], output: "jsonl", junk: 1 }),
    );
    const saved = normalizeSavedConfig(config, config.theme, "/data");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const row = saved.config.providers.find((p) => p.kind === "cli-agent");
    expect(row?.baseUrl).toBe("cli-agent://local");
    expect(row?.cli).toEqual({ command: "gemini", args: ["-p", "{prompt}"], output: "jsonl" });
  });

  it("rejects a bad enabled config with a clear message", () => {
    const config = defaultConfig("/data");
    config.providers.push(cliProvider({ command: "gemini", args: ["{promt}"], output: "text" }));
    expect(normalizeSavedConfig(config, config.theme, "/data")).toEqual({
      ok: false,
      error:
        "Gemini CLI: unknown placeholder {promt} — use {prompt}, {model}, {workspace}, or {resume}",
    });
    config.providers[config.providers.length - 1] = cliProvider({ args: [], output: "text" });
    expect(normalizeSavedConfig(config, config.theme, "/data")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/command is required/),
    });
  });

  it("lets a disabled card without a command save as a draft", () => {
    const config = defaultConfig("/data");
    config.providers.push(cliProvider({ command: "", args: ["{prompt}"], output: "text" }, false));
    expect(normalizeSavedConfig(config, config.theme, "/data").ok).toBe(true);
  });

  it("skips the base URL check", () => {
    expect(
      providerBaseUrlError({ name: "Aider", kind: "cli-agent", baseUrl: "not-a-url" }),
    ).toBeUndefined();
  });
});

describe("providerBaseUrlError", () => {
  it("skips Cursor CLI and checks other providers", () => {
    expect(
      providerBaseUrlError({ name: "Cursor CLI", kind: "cursor-cli", baseUrl: "not-a-url" }),
    ).toBeUndefined();
    expect(
      providerBaseUrlError({ name: "Claude Code", kind: "claude-code", baseUrl: "not-a-url" }),
    ).toBeUndefined();
    expect(
      providerBaseUrlError({ name: "Codex CLI", kind: "codex-cli", baseUrl: "not-a-url" }),
    ).toBeUndefined();
    expect(
      providerBaseUrlError({ name: "Kiro CLI", kind: "kiro-cli", baseUrl: "not-a-url" }),
    ).toBeUndefined();
    expect(providerBaseUrlError({ name: "OpenAI", baseUrl: "not-a-url" })).toMatch(/base URL/);
  });
});

describe("integration token hygiene", () => {
  it("blocks personal tokens in token-free mode", () => {
    const config = defaultConfig("/data");
    config.managedPolicy = {
      active: true,
      policy: {
        version: 1,
        tokenFreeMode: true,
        integrationProxyUrl: "https://mcp.example/mcp",
      },
      locked: ["personalTokens"],
    };
    config.integrations = [
      {
        id: "jira-1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://ex.atlassian.net",
        token: "ATATT-secret",
      },
    ];
    expect(normalizeSavedConfig(config, config.theme, "/data")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/token-free/i),
    });
  });

  it("blocks extra write scopes when policy tokenScope is block", () => {
    const payload = Buffer.from(
      JSON.stringify({ scope: "read:jira-work write:jira-work admin:jira" }),
    ).toString("base64url");
    const config = defaultConfig("/data");
    config.managedPolicy = {
      active: true,
      policy: { version: 1, tokenScope: "block" },
      locked: [],
    };
    config.integrations = [
      {
        id: "jira-1",
        kind: "jira",
        name: "Jira",
        enabled: true,
        baseUrl: "https://ex.atlassian.net",
        token: `eyJhbGciOiJub25lIn0.${payload}.sig`,
      },
    ];
    expect(normalizeSavedConfig(config, config.theme, "/data")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/write:jira-work|admin:jira/),
    });
  });

  it("stamps a rotation warning without blocking in warn mode", () => {
    const config = defaultConfig("/data");
    config.integrations = [
      {
        id: "slack-1",
        kind: "slack",
        name: "Slack",
        enabled: true,
        baseUrl: "https://slack.com/api",
        token: "xoxp-old",
        tokenSavedAt: "2020-01-01T00:00:00.000Z",
      },
    ];
    const saved = normalizeSavedConfig(config, config.theme, "/data");
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.config.integrations?.[0]?.tokenWarning).toMatch(/rotate/i);
    }
  });
});

describe("AWS gateway URLs", () => {
  it("rejects a cleartext non-loopback AWS gateway", () => {
    const config = defaultConfig("/data");
    config.integrations = [
      {
        id: "a1",
        kind: "aws",
        name: "AWS IAM",
        enabled: true,
        baseUrl: "https://iam.amazonaws.com",
        gatewayUrl: "http://api.example.com/prod",
      },
    ];
    expect(normalizeSavedConfig(config, config.theme, "/data")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/must be https/),
    });
  });
});
