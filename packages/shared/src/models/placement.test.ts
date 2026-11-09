import { describe, expect, it } from "vitest";
import { parseAgentPlacement, placementAllowsRuntime, sessionPlacement } from "./placement.js";
import {
  normalizeWorkerUrl,
  parseWorkerBackend,
  parseWorkerBackends,
  parseWorkerFingerprint,
  workerAllowedImages,
  workerAllowedSizes,
  workerBackendError,
  workerIdleTtlMs,
  workerImageAllowed,
  workerIsMetered,
  workerMaxConcurrent,
  workerPickSize,
  workerWhereLabel,
  workerHourlyUsd,
  workerProvisionsCompute,
  computeUsdForMs,
  sessionComputeMs,
  DEFAULT_WORKER_IDLE_TTL_MS,
} from "./worker.js";

describe("agent placement", () => {
  it("defaults missing placement to local", () => {
    expect(sessionPlacement({})).toBe("local");
    expect(parseAgentPlacement("worker")).toBe("worker");
    expect(parseAgentPlacement("aws")).toBe("local");
  });

  it("allows Docker, Host, and VM on a worker", () => {
    expect(placementAllowsRuntime("local", "host")).toBe(true);
    expect(placementAllowsRuntime("worker", "docker")).toBe(true);
    expect(placementAllowsRuntime("worker", "host")).toBe(true);
    expect(placementAllowsRuntime("worker", "vm")).toBe(true);
  });
});

describe("worker backends", () => {
  it("fills https and the default port", () => {
    expect(normalizeWorkerUrl("192.168.1.20")).toBe("https://192.168.1.20:7421");
    expect(normalizeWorkerUrl("http://10.0.0.5:9000/")).toBe("http://10.0.0.5:9000");
    expect(normalizeWorkerUrl("https://10.0.0.5:9000/")).toBe("https://10.0.0.5:9000");
  });

  it("parses a backend list and drops junk", () => {
    const rows = parseWorkerBackends([
      {
        id: "w1",
        name: "Studio PC",
        url: "https://192.168.1.8:7421",
        token: "secret",
        fingerprint: "sha256:" + "ab".repeat(32),
      },
      { name: "no id" },
      null,
    ]);
    expect(rows).toEqual([
      {
        id: "w1",
        name: "Studio PC",
        url: "https://192.168.1.8:7421",
        token: "secret",
        fingerprint: "sha256:" + "ab".repeat(32),
      },
    ]);
  });

  it("requires a name", () => {
    expect(workerBackendError({ id: "w", name: "  ", url: "https://127.0.0.1:7421" })).toMatch(
      /name/i,
    );
  });

  it("rejects cleartext LAN URLs and accepts loopback http", () => {
    expect(workerBackendError({ id: "w", name: "Studio", url: "http://192.168.1.8:7421" })).toMatch(
      /https/i,
    );
    expect(workerBackendError({ id: "w", name: "Studio", url: "http://127.0.0.1:7421" })).toBe(
      undefined,
    );
    expect(parseWorkerFingerprint("ab".repeat(32))).toBe(`sha256:${"ab".repeat(32)}`);
  });

  it("parses cloud workers and refuses a disabled idle TTL", () => {
    const row = parseWorkerBackends([
      {
        id: "c1",
        name: "Box",
        url: "https://10.0.0.8:7421",
        kind: "cloud",
        maxConcurrent: 1,
      },
    ])[0];
    expect(row).toMatchObject({ id: "c1", kind: "cloud", maxConcurrent: 1 });
    expect(workerWhereLabel(row!)).toBe("Box · cloud");
    expect(workerMaxConcurrent({ kind: "cloud" })).toBe(1);
    expect(workerMaxConcurrent({})).toBeUndefined();
    expect(workerIdleTtlMs({})).toBe(DEFAULT_WORKER_IDLE_TTL_MS);
    expect(workerIdleTtlMs({ idleTtlMs: 0 })).toBe(0);
    expect(workerIdleTtlMs({ kind: "cloud", idleTtlMs: 0 })).toBe(DEFAULT_WORKER_IDLE_TTL_MS);
    expect(
      workerBackendError({
        id: "c1",
        name: "Box",
        url: "https://10.0.0.8:7421",
        kind: "cloud",
        idleTtlMs: 0,
      }),
    ).toMatch(/idle TTL/i);
    expect(
      workerBackendError({
        id: "w",
        name: "Studio",
        url: "http://127.0.0.1:7421",
        maxConcurrent: 0,
      }),
    ).toMatch(/at least 1/i);
    expect(
      workerBackendError({
        id: "c1",
        name: "Box",
        url: "https://10.0.0.8:7421",
        kind: "cloud",
      }),
    ).toMatch(/hourly USD/i);
    expect(
      workerBackendError({
        id: "c1",
        name: "Box",
        url: "https://10.0.0.8:7421",
        kind: "cloud",
        hourlyUsd: 1.1,
      }),
    ).toMatch(/image allowlist/i);
    expect(
      workerBackendError({
        id: "c1",
        name: "Box",
        url: "https://10.0.0.8:7421",
        kind: "cloud",
        hourlyUsd: 1.1,
        allowedImages: ["locus/agent"],
      }),
    ).toBeUndefined();
    expect(workerHourlyUsd({ hourlyUsd: 0.12 })).toBe(0.12);
    expect(computeUsdForMs(3_600_000, 0.5)).toBe(0.5);
    expect(
      sessionComputeMs(
        { computeMs: 1_000, computeStartedAt: "2020-01-01T00:00:00.000Z" },
        Date.parse("2020-01-01T00:00:10.000Z"),
      ),
    ).toBe(11_000);
  });

  it("parses an image allowlist and treats an omitted cloud list as empty", () => {
    expect(
      parseWorkerBackends([
        {
          id: "c1",
          name: "Box",
          url: "https://10.0.0.8:7421",
          kind: "cloud",
          hourlyUsd: 1.1,
          allowedImages: ["locus/agent", "node:22-bookworm", "locus/agent"],
        },
      ])[0]?.allowedImages,
    ).toEqual(["locus/agent:0.1", "node:22-bookworm"]);
    expect(workerAllowedImages({ kind: "cloud" })).toEqual([]);
    expect(workerAllowedImages({})).toBeUndefined();
    expect(workerImageAllowed({}, "node:22-bookworm")).toBe(true);
    expect(
      workerImageAllowed({ kind: "cloud", allowedImages: ["locus/agent"] }, "locus/agent"),
    ).toBe(true);
    expect(
      workerImageAllowed({ kind: "cloud", allowedImages: ["locus/agent"] }, "node:22-bookworm"),
    ).toBe(false);
  });

  it("parses a fargate worker without a URL", () => {
    const backend = parseWorkerBackend({
      id: "fg-1",
      name: "ecs",
      kind: "fargate",
      token: "secret",
      region: "us-east-1",
      taskDefinition: "locus-worker",
      allowedImages: ["locus-guest:local"],
      allowedSizes: ["0.25-0.5", "0.5-1"],
      ecsUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod/ecs",
    });
    expect(backend).toMatchObject({
      id: "fg-1",
      kind: "fargate",
      url: "",
      region: "us-east-1",
      taskDefinition: "locus-worker",
      ecsUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod/ecs",
    });
    expect(workerIsMetered(backend!)).toBe(true);
    expect(workerWhereLabel(backend!)).toBe("ecs · fargate");
    expect(workerAllowedSizes(backend!)).toEqual(["0.25-0.5", "0.5-1"]);
    expect(workerPickSize(backend!)).toBe("0.25-0.5");
    expect(workerPickSize(backend!, "0.5-1")).toBe("0.5-1");
    expect(() => workerPickSize(backend!, "2-4")).toThrow(/2-4 is not on the allowlist/);
  });

  it("rejects a fargate worker with an empty size allowlist", () => {
    expect(
      workerBackendError({
        id: "fg-1",
        name: "ecs",
        url: "",
        kind: "fargate",
        token: "secret",
        region: "us-east-1",
        taskDefinition: "locus-worker",
        accessKeyId: "AKIATEST",
        allowedImages: ["locus-guest:local"],
        allowedSizes: [],
      }),
    ).toMatch(/size allowlist/);
  });

  it("parses Azure and GCP workers without a paste URL", () => {
    const azure = parseWorkerBackend({
      id: "az-1",
      name: "aci",
      kind: "azure",
      token: "secret",
      tenantId: "ten",
      clientId: "app",
      subscriptionId: "sub",
      resourceGroup: "rg",
      containerGroup: "locus",
      region: "eastus",
      allowedImages: ["locus/agent"],
      allowedSizes: ["0.25-0.5"],
    });
    expect(azure).toMatchObject({ id: "az-1", kind: "azure", url: "" });
    expect(workerProvisionsCompute(azure!)).toBe(true);
    expect(workerIsMetered(azure!)).toBe(true);
    expect(workerWhereLabel(azure!)).toBe("aci · azure");
    const gcp = parseWorkerBackend({
      id: "g-1",
      name: "gce",
      kind: "gcp",
      token: "ya29.token",
      project: "proj",
      zone: "us-central1-a",
      instanceTemplate: "locus-worker",
      allowedImages: ["locus/agent"],
      allowedSizes: ["0.25-0.5"],
    });
    expect(gcp).toMatchObject({ id: "g-1", kind: "gcp", url: "" });
    expect(workerProvisionsCompute(gcp!)).toBe(true);
    expect(workerWhereLabel(gcp!)).toBe("gce · gcp");
  });

  it("rejects a fargate worker without an access key id", () => {
    expect(
      workerBackendError({
        id: "fg-1",
        name: "ecs",
        url: "",
        kind: "fargate",
        token: "secret",
        region: "us-east-1",
        taskDefinition: "locus-worker",
        allowedImages: ["locus-guest:local"],
        allowedSizes: ["0.25-0.5"],
      }),
    ).toMatch(/access key/);
  });
});
