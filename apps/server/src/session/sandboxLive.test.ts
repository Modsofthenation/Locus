import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { SandboxComputeBackend, sandboxDrivers } from "@locus/compute";
import { SANDBOX_WORKER_SIZE, sandboxWorkerKind, type WorkerBackend } from "@locus/shared";
import { WorkerClient } from "@locus/worker";
import { expect, it } from "vitest";

const optedIn = process.env.LOCUS_SANDBOX_LIVE_SMOKE === "I_ACCEPT_PROVIDER_CHARGES";

it.runIf(optedIn)(
  "runs a live, bounded managed sandbox and confirms provider teardown",
  async () => {
    const kind = sandboxWorkerKind(process.env.LOCUS_SANDBOX_SMOKE_PROVIDER);
    const token = process.env.LOCUS_SANDBOX_SMOKE_API_KEY;
    const template = process.env.LOCUS_SANDBOX_SMOKE_TEMPLATE;
    const directory = process.env.LOCUS_SANDBOX_SMOKE_DATA_DIR;
    const hourlyUsd = Number(process.env.LOCUS_SANDBOX_SMOKE_HOURLY_USD);
    const maxUsd = Number(process.env.LOCUS_SANDBOX_SMOKE_LIMIT_USD);
    if (
      !kind ||
      !token ||
      !template ||
      !directory ||
      !Number.isFinite(hourlyUsd) ||
      hourlyUsd <= 0 ||
      !Number.isFinite(maxUsd) ||
      maxUsd <= 0
    ) {
      throw new Error(
        "Set the live smoke provider, credentials, template, journal directory, hourly rate, and USD limit",
      );
    }
    const backend: WorkerBackend = {
      id: `smoke-${kind}`,
      kind,
      name: `${kind} smoke`,
      url: "",
      token,
      hourlyUsd,
      accessKeyId: process.env.LOCUS_SANDBOX_SMOKE_TOKEN_ID,
      region: process.env.LOCUS_SANDBOX_SMOKE_REGION,
      sandbox: {
        app: process.env.LOCUS_SANDBOX_SMOKE_APP,
        template,
        maxMinutes: 5,
        maxUsd,
        rateDate: new Date().toISOString().slice(0, 10),
      },
    };
    const journal = join(directory, "compute-sandboxes-smoke.json");
    const compute = new SandboxComputeBackend(sandboxDrivers, journal);
    // Run against a dedicated journal so recovery never acts on ordinary agent sandboxes.
    const earlier = await compute.listOrphans(new Set());
    if (earlier.length)
      throw new Error(
        `Resolve the pending live smoke resource in ${journal} before creating another`,
      );

    const sessionId = randomUUID();
    let failure: unknown;
    try {
      const handle = await compute.provision({ backend, sessionId, size: SANDBOX_WORKER_SIZE });
      const worker = new WorkerClient(
        { ...backend, url: handle.url, token: handle.token },
        undefined,
        undefined,
        handle.gateway,
      );
      await worker.waitReady({ timeoutMs: 60_000 });
      const guest = await worker.create({
        sessionId,
        name: "Smoke",
        templateId: "host",
        os: "ubuntu",
        image: "host",
        runtime: "host",
      });
      const command = await worker.execute(guest.id, {
        name: "exec",
        args: { command: "printf 'locus-smoke' > smoke.txt && cat smoke.txt" },
      });
      expect(command.ok).toBe(true);
      expect(command.output).toContain("locus-smoke");
      const file = await worker.readWorkspace(guest.id, "smoke.txt");
      expect(file.content).toBe("locus-smoke");
    } catch (err) {
      failure = err;
    }
    const deadline = Date.now() + 120_000;
    let pending = await compute.listOrphans(new Set());
    while (pending.length && Date.now() < deadline) {
      for (const row of pending) await compute.destroy(row.id, backend).catch(() => undefined);
      pending = await compute.listOrphans(new Set());
      if (pending.length) await delay(2_000);
    }
    if (pending.length) {
      throw new Error(
        `Provider teardown is still pending. Inspect ${journal} for the recorded IDs`,
        {
          cause: failure,
        },
      );
    }
    if (failure) throw failure;
  },
  360_000,
);
