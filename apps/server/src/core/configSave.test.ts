import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { defaultConfig } from "../defaults.js";
import { normalizeSavedConfig, providerBaseUrlError } from "./configSave.js";

describe("normalizeSavedConfig", () => {
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
