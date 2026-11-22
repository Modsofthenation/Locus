import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "@locus/shared";
import type { CursorCliSpawner } from "./cursorCli.js";
import {
  CLAUDE_USAGE_URL,
  CODEX_USAGE_URL,
  CURSOR_USAGE_URL,
  isUsageCapableProvider,
  parseClaudeUsage,
  parseCodexOauthUsage,
  parseCodexSessionRateLimits,
  parseCursorUsageSummary,
  parseKiroUsage,
  readProviderUsage,
} from "./usage.js";

const NOW = new Date("2026-11-13T12:00:00.000Z");

function provider(kind: AiProvider["kind"], extra: Partial<AiProvider> = {}): AiProvider {
  return {
    id: kind,
    name: kind,
    kind,
    baseUrl: `${kind}://local`,
    models: [],
    defaultModel: "",
    enabled: true,
    extraHeaders: {},
    ...extra,
  };
}

function files(map: Record<string, string>) {
  return async (path: string) => map[path];
}

function dirs(map: Record<string, string[]>) {
  return async (path: string) => map[path] ?? [];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function spawner(stdout: string, code = 0): CursorCliSpawner {
  return () => ({
    lines: (async function* () {
      for (const line of stdout.split("\n")) yield line;
    })(),
    wait: async () => ({ code, stderr: "" }),
  });
}

function jwt(payload: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "none" })}.${part(payload)}.sig`;
}

describe("isUsageCapableProvider", () => {
  it("covers the four account-backed agent CLIs only", () => {
    expect(isUsageCapableProvider({ kind: "codex-cli" })).toBe(true);
    expect(isUsageCapableProvider({ kind: "claude-code" })).toBe(true);
    expect(isUsageCapableProvider({ kind: "cursor-cli" })).toBe(true);
    expect(isUsageCapableProvider({ kind: "kiro-cli" })).toBe(true);
    expect(isUsageCapableProvider({ kind: "cli-agent" })).toBe(false);
    expect(isUsageCapableProvider({ kind: "openai" })).toBe(false);
  });
});

describe("Codex usage", () => {
  it("parses the ChatGPT usage endpoint", () => {
    const parsed = parseCodexOauthUsage(
      {
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 42,
            reset_at: 1_794_600_000,
            limit_window_seconds: 18_000,
          },
          secondary_window: {
            used_percent: 7,
            reset_at: 1_795_000_000,
            limit_window_seconds: 604_800,
          },
        },
        credits: { has_credits: true, unlimited: false, balance: "12.5" },
      },
      NOW,
    );
    expect(parsed.plan).toBe("Pro");
    expect(parsed.windows).toEqual([
      expect.objectContaining({
        id: "five_hour",
        label: "5-hour",
        usedPercent: 42,
        windowMinutes: 300,
      }),
      expect.objectContaining({
        id: "weekly",
        label: "Weekly",
        usedPercent: 7,
        windowMinutes: 10_080,
      }),
      { id: "credits", label: "Credits left", used: 12.5, unit: "credits" },
    ]);
    expect(parsed.windows[0]?.resetsAt).toBe(new Date(1_794_600_000 * 1000).toISOString());
  });

  it("reads rate limits from the newest rollout log", () => {
    const log = [
      JSON.stringify({
        timestamp: "2026-11-13T10:00:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message" },
      }),
      JSON.stringify({
        timestamp: "2026-11-13T11:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 55, window_minutes: 300, resets_in_seconds: 3600 },
            secondary: { used_percent: 20, window_minutes: 10_080, resets_at: 1_795_000_000 },
          },
        },
      }),
      "",
    ].join("\n");
    const parsed = parseCodexSessionRateLimits(log);
    expect(parsed?.source).toBe("session-log");
    expect(parsed?.windows[0]).toMatchObject({
      id: "five_hour",
      usedPercent: 55,
      resetsAt: "2026-11-13T12:00:00.000Z",
    });
    expect(parsed?.windows[1]).toMatchObject({ id: "weekly", usedPercent: 20 });
  });

  it("calls the usage endpoint with the CLI's ChatGPT token and account id", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000 } },
      }),
    );
    const usage = await readProviderUsage(provider("codex-cli"), {
      fetchFn: fetchFn as unknown as typeof fetch,
      home: "/h",
      env: {},
      now: () => NOW,
      readText: files({
        "/h/.codex/auth.json": JSON.stringify({
          tokens: { access_token: "tok", account_id: "acct" },
        }),
      }),
      listDir: dirs({}),
    });
    expect(usage.ok).toBe(true);
    expect(usage.windows[0]?.usedPercent).toBe(10);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CODEX_USAGE_URL);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer tok",
      "ChatGPT-Account-Id": "acct",
    });
  });

  it("falls back to session logs when the endpoint fails", async () => {
    const line = JSON.stringify({
      timestamp: "2026-11-13T11:00:00.000Z",
      payload: {
        type: "token_count",
        rate_limits: { primary: { used_percent: 3, window_minutes: 300 } },
      },
    });
    const usage = await readProviderUsage(provider("codex-cli"), {
      fetchFn: (async () => jsonResponse({}, 500)) as unknown as typeof fetch,
      home: "/h",
      env: {},
      now: () => NOW,
      readText: files({
        "/h/.codex/auth.json": JSON.stringify({ tokens: { access_token: "tok" } }),
        "/h/.codex/sessions/2026/11/13/rollout-b.jsonl": line,
      }),
      listDir: dirs({
        "/h/.codex/sessions": ["2026"],
        "/h/.codex/sessions/2026": ["11"],
        "/h/.codex/sessions/2026/11": ["13"],
        "/h/.codex/sessions/2026/11/13": ["rollout-a.jsonl", "rollout-b.jsonl"],
      }),
    });
    expect(usage).toMatchObject({ ok: true, source: "session-log" });
    expect(usage.windows[0]?.usedPercent).toBe(3);
  });

  it("reports API-key billing without reading credentials", async () => {
    const readText = vi.fn(async () => undefined);
    const usage = await readProviderUsage(provider("codex-cli", { apiKey: "sk-live" }), {
      readText,
      now: () => NOW,
    });
    expect(usage.ok).toBe(true);
    expect(usage.windows).toEqual([]);
    expect(usage.message).toMatch(/API key/);
    expect(readText).not.toHaveBeenCalled();
  });

  it("asks for login when there are no credentials or logs", async () => {
    const usage = await readProviderUsage(provider("codex-cli"), {
      home: "/h",
      env: {},
      now: () => NOW,
      readText: files({}),
      listDir: dirs({}),
    });
    expect(usage.ok).toBe(false);
    expect(usage.message).toMatch(/codex login/);
  });
});

describe("Claude Code usage", () => {
  it("parses 5-hour and weekly windows", () => {
    const parsed = parseClaudeUsage({
      five_hour: { utilization: 31, resets_at: "2026-11-13T15:00:00Z" },
      seven_day: { utilization: 12.5, resets_at: "2026-11-18T00:00:00Z" },
      seven_day_opus: null,
      extra_usage: { is_enabled: false },
    });
    expect(parsed.windows).toEqual([
      expect.objectContaining({
        id: "five_hour",
        usedPercent: 31,
        resetsAt: "2026-11-13T15:00:00.000Z",
      }),
      expect.objectContaining({ id: "seven_day", usedPercent: 12.5 }),
    ]);
  });

  it("uses the OAuth token from ~/.claude/.credentials.json", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ five_hour: { utilization: 80 } }));
    const usage = await readProviderUsage(provider("claude-code"), {
      fetchFn: fetchFn as unknown as typeof fetch,
      home: "/h",
      env: {},
      platform: "linux",
      now: () => NOW,
      readText: files({
        "/h/.claude/.credentials.json": JSON.stringify({
          claudeAiOauth: {
            accessToken: "oat",
            expiresAt: NOW.getTime() + 60_000,
            subscriptionType: "max",
          },
        }),
      }),
    });
    expect(usage).toMatchObject({ ok: true, plan: "Max", source: "oauth" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CLAUDE_USAGE_URL);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer oat",
      "anthropic-beta": "oauth-2025-04-20",
    });
  });

  it("does not send an expired token", async () => {
    const fetchFn = vi.fn();
    const usage = await readProviderUsage(provider("claude-code"), {
      fetchFn: fetchFn as unknown as typeof fetch,
      home: "/h",
      env: {},
      platform: "linux",
      now: () => NOW,
      readText: files({
        "/h/.claude/.credentials.json": JSON.stringify({
          claudeAiOauth: { accessToken: "oat", expiresAt: NOW.getTime() - 1 },
        }),
      }),
    });
    expect(usage.ok).toBe(false);
    expect(usage.message).toMatch(/expired/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("Cursor CLI usage", () => {
  it("parses the usage summary in dollars", () => {
    const parsed = parseCursorUsageSummary({
      membershipType: "pro",
      billingCycleEnd: "2026-12-01T00:00:00.000Z",
      individualUsage: {
        plan: { used: 1234, limit: 2000, totalPercentUsed: 61.7 },
        onDemand: { used: 250, limit: 5000 },
      },
    });
    expect(parsed.plan).toBe("Pro");
    expect(parsed.windows).toEqual([
      {
        id: "monthly",
        label: "Included usage",
        usedPercent: 61.7,
        used: 12.34,
        limit: 20,
        unit: "usd",
        resetsAt: "2026-12-01T00:00:00.000Z",
      },
      {
        id: "on_demand",
        label: "On-demand",
        used: 2.5,
        limit: 50,
        unit: "usd",
        resetsAt: "2026-12-01T00:00:00.000Z",
      },
    ]);
  });

  it("sends the cursor-agent token as a session cookie", async () => {
    const token = jwt({ sub: "auth0|user_abc123", exp: NOW.getTime() / 1000 + 3600 });
    const fetchFn = vi.fn(async () =>
      jsonResponse({ individualUsage: { plan: { used: 0, limit: 2000 } } }),
    );
    const usage = await readProviderUsage(provider("cursor-cli"), {
      fetchFn: fetchFn as unknown as typeof fetch,
      home: "/h",
      env: {},
      platform: "linux",
      now: () => NOW,
      readText: files({ "/h/.config/cursor/auth.json": JSON.stringify({ accessToken: token }) }),
    });
    expect(usage.ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CURSOR_USAGE_URL);
    expect((init.headers as Record<string, string>).Cookie).toBe(
      `WorkosCursorSessionToken=user_abc123%3A%3A${token}`,
    );
  });

  it("asks for login when no token is stored", async () => {
    const usage = await readProviderUsage(provider("cursor-cli"), {
      home: "/h",
      env: {},
      platform: "linux",
      now: () => NOW,
      readText: files({}),
    });
    expect(usage).toMatchObject({ ok: false });
    expect(usage.message).toMatch(/cursor-agent login/);
  });
});

describe("Kiro CLI usage", () => {
  const sample = [
    "\u001b[1m┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\u001b[0m",
    "┃ KIRO PRO                              ┃",
    "┃ Monthly credits:                      ┃",
    "┃ ████████░░░░░░░░ 50% (resets on 12/01) ┃",
    "┃ (500.00 of 1,000 covered in plan)     ┃",
    "┃ Bonus credits:                        ┃",
    "┃ 25.00/100 credits used, expires in 10 days ┃",
    "┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛",
  ].join("\n");

  it("parses plan credits, reset date and bonus credits", () => {
    const parsed = parseKiroUsage(sample, NOW);
    expect(parsed?.plan).toBe("Kiro Pro");
    expect(parsed?.windows).toEqual([
      {
        id: "monthly",
        label: "Monthly credits",
        usedPercent: 50,
        used: 500,
        limit: 1000,
        unit: "credits",
        resetsAt: "2026-12-01T00:00:00.000Z",
      },
      {
        id: "bonus",
        label: "Bonus credits",
        used: 25,
        limit: 100,
        unit: "credits",
        resetsAt: "2026-11-23T12:00:00.000Z",
      },
    ]);
  });

  it("parses the older request-count line and rolls the reset into next year", () => {
    const parsed = parseKiroUsage("Usage: 42/100 requests (resets on 01/01)", NOW);
    expect(parsed?.windows[0]).toMatchObject({
      used: 42,
      limit: 100,
      unit: "requests",
      resetsAt: "2027-01-01T00:00:00.000Z",
    });
  });

  it("runs `kiro-cli chat --no-interactive /usage` without the provider key", async () => {
    const spawnFn = vi.fn(spawner(sample));
    const usage = await readProviderUsage(provider("kiro-cli", { apiKey: "ksk_secret" }), {
      spawnFn,
      home: "/h",
      env: { KIRO_API_KEY: "ambient" },
      now: () => NOW,
    });
    expect(usage.ok).toBe(true);
    const req = spawnFn.mock.calls[0]?.[0];
    expect(req?.command).toBe("kiro-cli");
    expect(req?.args).toEqual(["chat", "--no-interactive", "/usage"]);
    expect(req?.env.KIRO_API_KEY).toBeUndefined();
  });

  it("explains a signed-out CLI", async () => {
    const usage = await readProviderUsage(provider("kiro-cli"), {
      spawnFn: spawner("error: You are not logged in, please log in with kiro-cli login", 1),
      home: "/h",
      env: {},
      now: () => NOW,
    });
    expect(usage.ok).toBe(false);
    expect(usage.message).toMatch(/kiro-cli login/);
  });

  it("turns a missing binary into a readable message", async () => {
    const usage = await readProviderUsage(provider("kiro-cli"), {
      spawnFn: () => {
        throw Object.assign(new Error("spawn kiro-cli ENOENT"), { code: "ENOENT" });
      },
      home: "/h",
      env: {},
      now: () => NOW,
    });
    expect(usage.ok).toBe(false);
    expect(usage.message).toMatch(/kiro-cli/);
  });
});
