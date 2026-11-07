import { describe, expect, it } from "vitest";
import type { Automation } from "./automation.js";
import {
  applyNamedEnvironment,
  automationHealth,
  automationHealthCounts,
  automationLastFact,
  automationLatestAgentRun,
  clipFact,
  clipNamedEnvName,
  formatAutomationHealth,
  namedEnvironmentError,
  namedEnvironmentSessionFields,
  namedEnvironmentsError,
  namedEnvironmentSummary,
  parseNamedEnvironment,
  parseSpendUsd,
  snapshotNamedEnvironment,
  upsertNamedEnvironment,
} from "./namedEnv.js";

const base = {
  id: "env-1",
  name: "restricted-oncall",
  runtime: "docker" as const,
  os: "ubuntu" as const,
  dockerImage: "locus/agent",
  imageId: "gold-1",
  network: "restricted" as const,
  recipeId: "ops-loop",
  maxUsd: 20,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

describe("named environment", () => {
  it("parses a golden + jail + recipe + spend + Where snapshot", () => {
    const env = parseNamedEnvironment({
      ...base,
      placement: "worker",
      backendId: "studio",
    });
    expect(env).toMatchObject({
      name: "restricted-oncall",
      runtime: "docker",
      imageId: "gold-1",
      network: "restricted",
      recipeId: "ops-loop",
      maxUsd: 20,
      placement: "worker",
      backendId: "studio",
    });
  });

  it("rejects worker placement on a VM", () => {
    expect(
      parseNamedEnvironment({
        ...base,
        runtime: "vm",
        placement: "worker",
        backendId: "studio",
      }),
    ).toBeUndefined();
  });

  it("parses worker placement on Host", () => {
    const env = parseNamedEnvironment({
      ...base,
      runtime: "host",
      dockerImage: undefined,
      placement: "worker",
      backendId: "studio",
    });
    expect(env).toMatchObject({
      name: "restricted-oncall",
      runtime: "host",
      placement: "worker",
      backendId: "studio",
    });
  });

  it("applies recipe extras and worker Where onto a create payload", () => {
    const applied = applyNamedEnvironment({
      ...base,
      placement: "worker",
      backendId: "studio",
    });
    expect(applied.runtime).toBe("docker");
    expect(applied.network).toBe("restricted");
    expect(applied.maxUsd).toBe(20);
    expect(applied.placement).toBe("worker");
    expect(applied.backendId).toBe("studio");
    expect(applied.playbook).toMatch(/Grafana/i);
    expect(applied.imageId).toBe("gold-1");
  });

  it("overlays a live environment onto an automation at run time", () => {
    const fields = namedEnvironmentSessionFields(
      {
        namedEnvironmentId: "env-1",
        runtime: "docker",
        os: "ubuntu",
        templateId: "ubuntu-24.04",
        dockerImage: "old/image",
        imageId: "stale",
        maxUsd: 5,
        network: "open",
      },
      { ...base, network: "none", maxUsd: 12, dockerImage: "locus/agent" },
    );
    expect(fields.dockerImage).toBe("locus/agent");
    expect(fields.network).toBe("none");
    expect(fields.maxUsd).toBe(12);
    expect(fields.imageId).toBe("gold-1");
  });

  it("keeps the selected box when Save as uses a new name and id", () => {
    const selected = snapshotNamedEnvironment({
      id: "prod",
      name: "prod",
      runtime: "docker",
      os: "ubuntu",
      dockerImage: "locus/agent",
      network: "restricted",
      now: "2026-08-29T00:00:00.000Z",
    });
    const created = snapshotNamedEnvironment({
      id: "staging",
      name: "staging",
      runtime: "docker",
      os: "ubuntu",
      dockerImage: "locus/agent",
      network: "none",
      now: "2026-08-29T01:00:00.000Z",
    });
    expect(selected && created).toBeTruthy();
    const list = upsertNamedEnvironment([selected!], created!);
    expect(list.map((row) => row.id)).toEqual(["prod", "staging"]);
    expect(list[0]?.network).toBe("restricted");
  });

  it("upserts by name so Save as environment replaces the same box", () => {
    const first = snapshotNamedEnvironment({
      id: "a",
      name: "staging-qa",
      runtime: "docker",
      os: "ubuntu",
      dockerImage: "locus/agent",
      network: "restricted",
      now: "2026-08-29T00:00:00.000Z",
    });
    const next = snapshotNamedEnvironment({
      id: "b",
      name: "staging-qa",
      runtime: "docker",
      os: "ubuntu",
      dockerImage: "locus/agent:0.3",
      network: "none",
      maxUsd: 8,
      now: "2026-08-29T01:00:00.000Z",
    });
    expect(first && next).toBeTruthy();
    const list = upsertNamedEnvironment([first!], next!);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("a");
    expect(list[0]?.network).toBe("none");
    expect(list[0]?.maxUsd).toBe(8);
  });

  it("summarizes and reads the latest memory fact", () => {
    expect(namedEnvironmentSummary(base, { whereLabel: "studio" })).toBe(
      "Docker · Restricted · Ops loop · $20 · studio",
    );
    const item = {
      memories: [
        { id: "old", text: "yesterday", createdAt: "2026-08-28T00:00:00.000Z" },
        { id: "new", text: "Grafana is down after 2am", createdAt: "2026-08-29T00:00:00.000Z" },
      ],
    } as Pick<Automation, "memories">;
    expect(automationLastFact(item)).toBe("Grafana is down after 2am");
    expect(clipFact("Grafana is down after 2am", 12)).toBe("Grafana is…");
    expect(clipNamedEnvName("acme-prod")).toBe("acme-prod");
    expect(clipNamedEnvName(`Setup environment · ${"a".repeat(80)} env`).length).toBe(64);
    expect(clipNamedEnvName("   ")).toBe("product env");
    expect(parseSpendUsd("20")).toBe(20);
    expect(parseSpendUsd("")).toBeUndefined();
  });

  it("rejects duplicate names and a missing worker", () => {
    expect(
      namedEnvironmentError(
        { ...base, placement: "worker", backendId: "studio" },
        { workerIds: ["lab"] },
      ),
    ).toMatch(/Unknown worker/);
    expect(
      namedEnvironmentsError([base, { ...base, id: "env-2", name: "Restricted-Oncall" }]),
    ).toMatch(/Duplicate environment name/);
  });

  it("counts healthy, failing, and paused jobs", () => {
    const jobs = [
      { id: "ok", enabled: true },
      { id: "fail", enabled: true },
      { id: "off", enabled: false },
    ];
    const runs = [
      {
        id: "r1",
        automationId: "ok",
        status: "succeeded" as const,
        trigger: "schedule" as const,
        startedAt: "2026-09-01T02:00:00.000Z",
      },
      {
        id: "r2",
        automationId: "fail",
        status: "failed" as const,
        trigger: "schedule" as const,
        startedAt: "2026-09-01T02:00:00.000Z",
      },
      {
        id: "r3",
        automationId: "off",
        status: "failed" as const,
        trigger: "schedule" as const,
        startedAt: "2026-09-01T02:00:00.000Z",
      },
    ];
    expect(automationHealth(jobs[1]!, runs[1])).toBe("failing");
    expect(automationHealth(jobs[2]!, runs[2])).toBe("paused");
    expect(automationHealthCounts(jobs, runs)).toEqual({
      healthy: 1,
      failing: 1,
      paused: 1,
      needsYou: 0,
    });
    expect(formatAutomationHealth({ healthy: 3, failing: 1, paused: 2 })).toBe(
      "3 healthy · 1 failing · 2 paused",
    );
  });

  it("ignores a later Send-test skip when counting failing jobs", () => {
    const jobs = [{ id: "fail", enabled: true }];
    const runs = [
      {
        id: "r-fail",
        automationId: "fail",
        status: "failed" as const,
        trigger: "schedule" as const,
        startedAt: "2026-09-01T02:00:00.000Z",
      },
      {
        id: "r-test",
        automationId: "fail",
        status: "skipped" as const,
        trigger: "webhook" as const,
        error: "Test POST accepted. No agent run.",
        startedAt: "2026-09-01T03:00:00.000Z",
      },
    ];
    expect(automationLatestAgentRun(runs, "fail")?.id).toBe("r-fail");
    expect(automationHealth(jobs[0]!, automationLatestAgentRun(runs, "fail"))).toBe("failing");
    expect(automationHealthCounts(jobs, runs)).toEqual({
      healthy: 0,
      failing: 1,
      paused: 0,
      needsYou: 0,
    });
  });
});
