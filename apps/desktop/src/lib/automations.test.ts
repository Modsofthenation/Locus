import { describe, expect, it } from "vitest";
import {
  automationAllowlistOptions,
  automationFleetExtras,
  automationFunnelHint,
  automationTriggerFamily,
  defaultKindForTriggerFamily,
  fleetRecentRuns,
  fleetShouldAutoOpen,
  formatAutomationFleetExtras,
  groupAutomationsBySchedule,
  promptNeedsCollapse,
  runMatchesHistoryFilter,
  runOutcomeLabel,
  runSpendLabel,
  automationSpendLabel,
  sortAutomationsByPriority,
  spendChipTitle,
  isDockerDownError,
  plainJobError,
} from "./automations";
import type { AgentSession, Automation, AutomationRun, LocusConfig } from "@locus/shared";

const config: LocusConfig = {
  theme: "ember",
  providers: [
    {
      id: "p1",
      name: "OpenAI",
      kind: "openai",
      baseUrl: "https://api.openai.com/v1",
      models: ["gpt-4.1"],
      defaultModel: "gpt-4.1",
      enabled: true,
      extraHeaders: {},
    },
  ],
  templates: [],
  hardwareProfiles: [],
  forges: [],
  mcpServers: [
    {
      id: "jira",
      name: "Jira",
      enabled: true,
      command: "npx",
      args: [],
      env: {},
      allowedTools: ["search"],
    },
  ],
  integrations: [
    {
      id: "g1",
      kind: "grafana",
      name: "Grafana",
      enabled: true,
      baseUrl: "http://127.0.0.1:3000",
      token: "glsa",
    },
    {
      id: "p1",
      kind: "portainer",
      name: "Portainer",
      enabled: true,
      baseUrl: "http://127.0.0.1:9000",
      token: "ptr_test",
    },
  ],
  advanced: {
    dataDir: "/tmp",
    qemuBinary: "qemu-system-x86_64",
    swtpmBinary: "swtpm",
    ovmfCodePath: "",
    ovmfVarsPath: "",
    maxConcurrentVms: 4,
    defaultAcceleratorAuto: true,
    logLevel: "info",
    bindHost: "127.0.0.1",
    bindPort: 7420,
    openBrowserOnStart: true,
    hostSharePath: "",
  },
};

describe("automationAllowlistOptions", () => {
  it("lists MCP meta tools, flattened allowed tools, and connected integrations", () => {
    const rows = automationAllowlistOptions(config, ["custom_tool"]);
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(["mcp_list_tools", "mcp_jira_search", "grafana_query", "custom_tool"]),
    );
    expect(rows.find((row) => row.name === "grafana_query")?.group).toBe("Grafana");
    expect(rows.find((row) => row.name === "portainer_containers")?.group).toBe("Portainer");
    expect(rows.find((row) => row.name === "jira_search")).toBeUndefined();
  });
});

describe("run labels", () => {
  const run: AutomationRun = {
    id: "run-1",
    automationId: "auto-1",
    sessionId: "s1",
    status: "succeeded",
    trigger: "schedule",
    startedAt: "2026-08-29T02:00:00.000Z",
    finishedAt: "2026-08-29T02:05:00.000Z",
  };

  it("shows spend against the cap", () => {
    const session: AgentSession = {
      id: "s1",
      title: "Nightly",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p1",
      model: "gpt-4.1",
      status: "idle",
      messages: [],
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
      createdAt: "2026-08-29T02:00:00.000Z",
      updatedAt: "2026-08-29T02:05:00.000Z",
    };
    expect(
      runSpendLabel(run, { maxUsd: 20, providerId: "p1", model: "gpt-4.1" }, session, config),
    ).toBe("$2.00 / $20.00");
    expect(
      automationSpendLabel(
        [run, { ...run, id: "run-2", sessionId: "s2", startedAt: "2026-08-29T03:00:00.000Z" }],
        { id: "auto-1", providerId: "p1", model: "gpt-4.1" },
        [session, { ...session, id: "s2" }],
        config,
      ),
    ).toEqual({ label: "$4.00", over: false });
    expect(
      automationSpendLabel(
        [
          { ...run, spendUsd: 3 },
          { ...run, id: "run-2", sessionId: "s2", spendUsd: 2 },
        ],
        { id: "auto-1", lifetimeMaxUsd: 4, providerId: "p1", model: "gpt-4.1" },
        [session],
        config,
      ),
    ).toEqual({ label: "$5.00 / $4.00", over: true });
  });

  it("prefers skip/fail error over the last assistant line", () => {
    const session: AgentSession = {
      id: "s1",
      title: "Nightly",
      os: "ubuntu",
      templateId: "ubuntu-24.04",
      providerId: "p1",
      model: "gpt-4.1",
      status: "idle",
      messages: [
        {
          id: "a1",
          role: "assistant",
          content: "all green",
          createdAt: "2026-08-29T02:01:00.000Z",
        },
      ],
      createdAt: "2026-08-29T02:00:00.000Z",
      updatedAt: "2026-08-29T02:05:00.000Z",
    };
    expect(runOutcomeLabel({ ...run, error: "A run is already in progress" }, session)).toBe(
      "A run is already in progress",
    );
    expect(runOutcomeLabel(run, session)).toBe("all green");
  });
});

describe("automationFunnelHint", () => {
  it("says when Funnel is on", () => {
    expect(automationFunnelHint("https://funnel.example")).toEqual({
      public: true,
      text: "Reachable at https://funnel.example (Funnel / webhook base).",
    });
    expect(automationFunnelHint(undefined).public).toBe(false);
  });
});

describe("automation list helpers", () => {
  const base: Automation = {
    id: "a1",
    name: "Alpha",
    enabled: true,
    prompt: "go",
    os: "ubuntu",
    templateId: "ubuntu-24.04",
    providerId: "p1",
    model: "gpt-4.1",
    startVm: false,
    schedule: { kind: "daily", hour: 9, minute: 0 },
    createdAt: "2026-08-17T12:00:00.000Z",
    updatedAt: "2026-08-17T12:00:00.000Z",
  };

  it("collapses prompts at the line threshold", () => {
    expect(promptNeedsCollapse("one\ntwo\nthree")).toBe(false);
    expect(promptNeedsCollapse(Array.from({ length: 6 }, (_, i) => `l${i}`).join("\n"))).toBe(true);
  });

  it("matches run history filters including live and test", () => {
    expect(runMatchesHistoryFilter({ status: "running" }, "running")).toBe(true);
    expect(runMatchesHistoryFilter({ status: "queued" }, "running")).toBe(true);
    expect(
      runMatchesHistoryFilter(
        { status: "skipped", error: "Test POST accepted. No agent run." },
        "test",
      ),
    ).toBe(true);
    expect(
      runMatchesHistoryFilter(
        { status: "skipped", error: "Test POST accepted. No agent run." },
        "skipped",
      ),
    ).toBe(false);
  });

  it("sorts failing jobs ahead of paused ones", () => {
    const jobs: Automation[] = [
      { ...base, id: "paused", name: "Paused", enabled: false },
      { ...base, id: "fail", name: "Fail", nextRunAt: "2026-09-13T12:00:00.000Z" },
      { ...base, id: "ok", name: "Ok", nextRunAt: "2026-09-13T11:00:00.000Z" },
    ];
    const runs: AutomationRun[] = [
      {
        id: "r1",
        automationId: "fail",
        status: "failed",
        trigger: "schedule",
        startedAt: "2026-09-13T10:00:00.000Z",
        finishedAt: "2026-09-13T10:01:00.000Z",
      },
    ];
    expect(sortAutomationsByPriority(jobs, runs).map((row) => row.id)).toEqual([
      "fail",
      "ok",
      "paused",
    ]);
  });

  it("groups by schedule kind and formats fleet extras", () => {
    const jobs: Automation[] = [
      { ...base, id: "d", schedule: { kind: "daily", hour: 9, minute: 0 } },
      { ...base, id: "w", name: "Hook", schedule: { kind: "webhook" } },
    ];
    expect(groupAutomationsBySchedule(jobs).map((row) => row.label)).toEqual(["Daily", "Webhook"]);
    expect(
      formatAutomationFleetExtras(
        automationFleetExtras(
          [
            {
              ...base,
              id: "live",
              nextRunAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            },
          ],
          [
            {
              id: "r",
              automationId: "live",
              status: "running",
              trigger: "manual",
              startedAt: "2026-09-13T10:00:00.000Z",
            },
          ],
          [],
          undefined,
        ),
      ),
    ).toBe("1 running · 1 due soon");
  });

  it("titles spend chips and sorts fleet recent runs", () => {
    expect(
      spendChipTitle({
        over: true,
        label: "$21 / $20",
        sessionCount: 2,
        pendingSessions: 1,
      }),
    ).toMatch(/still loading/);
    expect(
      fleetRecentRuns(
        [
          {
            id: "old",
            automationId: "a",
            status: "succeeded",
            trigger: "schedule",
            startedAt: "2026-09-13T09:00:00.000Z",
          },
          {
            id: "new",
            automationId: "b",
            status: "failed",
            trigger: "manual",
            startedAt: "2026-09-13T11:00:00.000Z",
          },
        ],
        1,
      ).map((row) => row.id),
    ).toEqual(["new"]);
  });

  it("maps schedule kinds onto When trigger families", () => {
    expect(automationTriggerFamily("daily")).toBe("clock");
    expect(automationTriggerFamily("cron")).toBe("clock");
    expect(automationTriggerFamily("forge")).toBe("forge");
    expect(automationTriggerFamily("webhook")).toBe("webhook");
    expect(defaultKindForTriggerFamily("clock", "webhook")).toBe("daily");
    expect(defaultKindForTriggerFamily("clock", "interval")).toBe("interval");
    expect(defaultKindForTriggerFamily("webhook", "daily")).toBe("webhook");
    expect(
      fleetShouldAutoOpen([
        {
          id: "ok",
          automationId: "a",
          status: "succeeded",
          trigger: "schedule",
          startedAt: "2026-09-13T10:00:00.000Z",
        },
      ]),
    ).toBe(false);
    expect(
      fleetShouldAutoOpen([
        {
          id: "bad",
          automationId: "a",
          status: "failed",
          trigger: "schedule",
          startedAt: "2026-09-13T10:00:00.000Z",
        },
      ]),
    ).toBe(true);
  });
});

describe("plainJobError", () => {
  it("maps Docker socket errors to one plain sentence and keeps the raw text", () => {
    const raw =
      "failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct";
    expect(plainJobError(raw)).toEqual({
      summary: "Docker isn't running — switch to Host or start Docker",
      detail: raw,
      cause: "docker",
    });
    expect(
      isDockerDownError(
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
      ),
    ).toBe(true);
  });

  it("leaves unknown errors alone", () => {
    expect(plainJobError("boom")).toBeNull();
    expect(plainJobError(undefined)).toBeNull();
    expect(isDockerDownError("Docker image not found")).toBe(false);
  });
});
