import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_WORKER_SIZE, type WorkerBackend } from "@locus/shared";
import { SandboxComputeBackend, type SandboxDriver } from "./sandbox.js";

const start = Date.parse("2026-11-22T08:00:00Z");
const profile: WorkerBackend = {
  id: "worker",
  name: "E2B worker",
  kind: "e2b",
  url: "",
  token: "provider-secret",
  hourlyUsd: 0.6,
  sandbox: { template: "template-id", maxMinutes: 10, maxUsd: 0.3, rateDate: "2026-11-22" },
};

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function registryPath() {
  const dir = await mkdtemp(join(tmpdir(), "locus-sandbox-compute-"));
  tempDirs.push(dir);
  return join(dir, "compute-sandboxes.json");
}

function fixture() {
  const connect = vi.fn(async () => ({
    url: "https://7421-sandbox.e2b.app",
    headers: { "e2b-traffic-access-token": "gateway-secret" },
  }));
  const driver = {
    verify: vi.fn<SandboxDriver["verify"]>(async () => undefined),
    create: vi.fn<SandboxDriver["create"]>(async () => ({ id: "vendor-id", connect })),
    find: vi.fn<SandboxDriver["find"]>(async () => []),
    destroy: vi.fn<SandboxDriver["destroy"]>(async () => undefined),
  };
  const drivers = { daytona: driver, e2b: driver, modal: driver, runloop: driver };
  return { driver, drivers, connect };
}

function request(sessionId = "session", backend = profile) {
  return { sessionId, backend, size: SANDBOX_WORKER_SIZE };
}

describe("managed sandbox lifecycle", () => {
  it("reserves the priced lease before creation, keeps gateway credentials in memory, and stops on restart", async () => {
    const path = await registryPath();
    const { driver, drivers, connect } = fixture();
    driver.create.mockImplementationOnce(async ({ marker, workerEnv }) => {
      expect(workerEnv.LOCUS_WORKER_TOKEN).toBeTruthy();
      expect(Object.values(workerEnv)).not.toContain(profile.token);
      const journal = await readFile(path, "utf8");
      expect(JSON.parse(journal).tasks[0].sandbox).toMatchObject({
        deadlineAt: start + 600_000,
        marker,
        template: profile.sandbox?.template,
        reservedUsd: 0.12,
      });
      expect(journal).not.toContain(profile.token);
      expect(journal).not.toContain(workerEnv.LOCUS_WORKER_TOKEN);
      return { id: "vendor-id", connect };
    });
    const compute = new SandboxComputeBackend(drivers, path, () => start);
    const handle = await compute.provision(request());
    expect(handle.gateway?.headers).toEqual({ "e2b-traffic-access-token": "gateway-secret" });
    expect(await readFile(path, "utf8")).not.toContain("gateway-secret");
    expect(await compute.listOrphans(new Set([handle.id]))).toEqual([]);

    const restarted = new SandboxComputeBackend(drivers, path, () => start + 60_000);
    expect(restarted.get(handle.id)).toBeUndefined();
    expect(await restarted.listOrphans(new Set([handle.id]))).toEqual([
      { id: handle.id, backendId: "worker", sessionId: "session", cleanupPending: true },
    ]);
    await restarted.destroy(handle.id, profile);
    expect(driver.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "worker" }),
      expect.objectContaining({ remoteId: "vendor-id" }),
      "vendor-id",
    );
    expect(await restarted.listOrphans(new Set())).toEqual([]);
    expect(JSON.parse(await readFile(path, "utf8")).tasks[0].sandbox.closedUsd).toBe(0.03);
  });

  it("does not admit concurrent leases beyond capacity", async () => {
    const { driver, drivers, connect } = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markAdmitted!: () => void;
    const admitted = new Promise<void>((resolve) => {
      markAdmitted = resolve;
    });
    driver.create.mockImplementationOnce(async () => {
      markAdmitted();
      await gate;
      return { id: "vendor-id", connect };
    });
    const compute = new SandboxComputeBackend(drivers, undefined, () => start);
    const first = compute.provision(request());
    await admitted;
    try {
      await expect(compute.provision(request("second"))).rejects.toThrow(/maxConcurrent/);
      expect(driver.create).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await first;
    }
  });

  it("fails closed on missing and stale pricing and denies reallocation beyond the session budget", async () => {
    const { driver, drivers } = fixture();
    const path = await registryPath();
    const compute = new SandboxComputeBackend(drivers, path, () => start);
    await expect(
      compute.provision(request("missing", { ...profile, hourlyUsd: undefined })),
    ).rejects.toThrow(/hourly/);
    const stale = { ...profile, sandbox: { ...profile.sandbox!, rateDate: "2026-08-03" } };
    await expect(compute.provision(request("stale", stale))).rejects.toThrow(/last 30 days/);
    expect(driver.create).not.toHaveBeenCalled();

    const capped = { ...profile, sandbox: { ...profile.sandbox!, maxUsd: 0.12 } };
    const first = await compute.provision(request("capped", capped));
    await compute.destroy(first.id, capped);
    const restarted = new SandboxComputeBackend(drivers, path, () => start);
    await expect(restarted.provision(request("capped", capped))).rejects.toThrow(
      /remaining sandbox budget/,
    );
    expect(driver.create).toHaveBeenCalledTimes(1);
  });

  it("expires the guest at its deadline and retains failed cleanup for retry", async () => {
    let time = start;
    const { driver, drivers } = fixture();
    const compute = new SandboxComputeBackend(drivers, undefined, () => time);
    const handle = await compute.provision(request());
    time = handle.gateway!.deadlineAt;
    expect(compute.get(handle.id)).toBeUndefined();
    expect(await compute.listOrphans(new Set([handle.id]))).toHaveLength(1);
    driver.destroy.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(compute.destroy(handle.id, profile)).rejects.toThrow(/unavailable/);
    expect(await compute.listOrphans(new Set([handle.id]))).toHaveLength(1);
    await compute.destroy(handle.id, profile);
    expect(await compute.listOrphans(new Set())).toEqual([]);
  });

  it("finds an ambiguous create by its own marker and retains it on an empty listing", async () => {
    const { driver, drivers } = fixture();
    const path = await registryPath();
    driver.create.mockRejectedValueOnce(new Error("create response lost"));
    const compute = new SandboxComputeBackend(drivers, path, () => start);
    await expect(compute.provision(request())).rejects.toThrow(/failed to start/);
    const restarted = new SandboxComputeBackend(drivers, path, () => start);
    const [orphan] = await restarted.listOrphans(new Set());
    expect(orphan?.cleanupPending).toBe(true);
    await expect(restarted.destroy(orphan!.id, profile)).rejects.toThrow(/unconfirmed/);
    await expect(restarted.destroy(orphan!.id, { ...profile, id: "wrong" })).rejects.toThrow(
      /original worker/,
    );
    driver.find.mockResolvedValueOnce(["recovered-id"]);
    await restarted.destroy(orphan!.id, profile);
    expect(driver.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "worker" }),
      expect.objectContaining({ marker: orphan!.id.split(":")[1] }),
    );
    expect(driver.destroy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "recovered-id",
    );
  });

  it("stops the resource when the gateway is outside the provider's trusted origin", async () => {
    const { driver, drivers, connect } = fixture();
    connect.mockResolvedValueOnce({
      url: "https://e2b.app.example.test",
      headers: { "e2b-traffic-access-token": "secret" },
    });
    const compute = new SandboxComputeBackend(drivers, undefined, () => start);
    await expect(compute.provision(request())).rejects.toThrow(/failed to start/);
    expect(driver.destroy).toHaveBeenCalledOnce();
    expect(await compute.listOrphans(new Set())).toEqual([]);
  });
});
