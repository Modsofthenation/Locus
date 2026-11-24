import { Daytona, DaytonaGoneError, DaytonaNotFoundError } from "@daytona/sdk";
import { Sandbox as E2BSandbox, Template as E2BTemplate } from "e2b";
import { ModalClient, NotFoundError as ModalNotFoundError } from "modal";
import { Runloop } from "@runloop/api-client";
import type { SandboxWorkerKind } from "@locus/shared";
import {
  SANDBOX_WORKER_COMMAND,
  SANDBOX_WORKER_PORT,
  SANDBOX_WORKER_SHELL,
  type SandboxDriver,
  type SandboxWorker,
} from "./sandbox.js";

const REQUEST_MS = 20_000;
const BOOT_SECONDS = 120;
const MARKER = "locus_provisioning";
const workerCommand = SANDBOX_WORKER_COMMAND.join(" ");

function daytonaClient(backend: SandboxWorker) {
  return new Daytona({
    apiKey: backend.token,
    apiUrl: "https://app.daytona.io/api",
    target: backend.region,
    requestTimeoutMs: REQUEST_MS,
    otelEnabled: false,
  });
}

const daytona: SandboxDriver = {
  async verify(backend, profile) {
    await using client = daytonaClient(backend);
    const snapshot = await client.snapshot.get(profile.template);
    if (snapshot.gpu > 0) throw new Error("GPU snapshots are outside this worker profile");
  },
  async create({ backend, marker, profile, workerEnv }) {
    await using client = daytonaClient(backend);
    const sandbox = await client.create(
      {
        name: marker,
        snapshot: profile.template,
        public: false,
        ephemeral: true,
        ttlMinutes: profile.maxMinutes,
        queueTimeout: 1,
        labels: { [MARKER]: marker },
      },
      { timeout: BOOT_SECONDS },
    );
    return {
      id: sandbox.id,
      async connect() {
        await using owner = daytonaClient(backend);
        const live = await owner.get(sandbox.id);
        const result = await live.process.executeCommand(
          `nohup ${workerCommand} </dev/null >/tmp/locus-worker.log 2>&1 &`,
          undefined,
          workerEnv,
          10,
        );
        if (result.exitCode !== 0) throw new Error("Daytona worker process failed to start");
        const proxy = await live.getPreviewLink(SANDBOX_WORKER_PORT);
        return { url: proxy.url, headers: { "x-daytona-preview-token": proxy.token } };
      },
    };
  },
  async find(backend, record) {
    await using client = daytonaClient(backend);
    try {
      const sandbox = await client.get(record.marker);
      return sandbox.labels?.[MARKER] === record.marker ? [sandbox.id] : [];
    } catch (err) {
      if (err instanceof DaytonaNotFoundError || err instanceof DaytonaGoneError) return [];
      throw err;
    }
  },
  async destroy(backend, _record, remoteId) {
    await using client = daytonaClient(backend);
    try {
      const sandbox = await client.get(remoteId);
      await sandbox.delete(15, true);
    } catch (err) {
      if (!(err instanceof DaytonaNotFoundError || err instanceof DaytonaGoneError)) throw err;
    }
  },
};

function e2bOptions(backend: SandboxWorker) {
  return {
    apiKey: backend.token,
    domain: "e2b.app",
    apiUrl: "https://api.e2b.app",
    debug: false,
    retries: 0,
    requestTimeoutMs: REQUEST_MS,
  };
}

const e2b: SandboxDriver = {
  async verify(backend, profile) {
    const list = E2BTemplate.list(e2bOptions(backend));
    while (list.hasNext) {
      if ((await list.nextItems()).some((template) => template.templateId === profile.template))
        return;
    }
    throw new Error("E2B template ID was not found");
  },
  async create({ backend, marker, profile, workerEnv }) {
    const sandbox = await E2BSandbox.create(profile.template, {
      ...e2bOptions(backend),
      timeoutMs: profile.maxMinutes * 60_000,
      lifecycle: { onTimeout: "kill", autoResume: false },
      metadata: { [MARKER]: marker },
      network: { allowPublicTraffic: false },
    });
    return {
      id: sandbox.sandboxId,
      async connect() {
        const token = sandbox.trafficAccessToken;
        if (!token) throw new Error("E2B did not return a private traffic token");
        await sandbox.commands.run(SANDBOX_WORKER_SHELL, {
          envs: workerEnv,
          background: true,
          timeoutMs: profile.maxMinutes * 60_000,
        });
        return {
          url: `https://${sandbox.getHost(SANDBOX_WORKER_PORT)}`,
          headers: { "e2b-traffic-access-token": token },
        };
      },
    };
  },
  async find(backend, record) {
    const result: string[] = [];
    const list = E2BSandbox.list({
      ...e2bOptions(backend),
      query: { metadata: { [MARKER]: record.marker } },
    });
    while (list.hasNext) {
      for (const sandbox of await list.nextItems()) {
        if (sandbox.metadata?.[MARKER] === record.marker) result.push(sandbox.sandboxId);
      }
    }
    return result;
  },
  async destroy(backend, _record, remoteId) {
    // The SDK treats an already absent sandbox as a successful idempotent kill.
    await E2BSandbox.kill(remoteId, e2bOptions(backend));
  },
};

function modalClient(backend: SandboxWorker) {
  return new ModalClient({
    tokenId: backend.accessKeyId,
    tokenSecret: backend.token,
    endpoint: "https://api.modal.com:443",
    environment: "main",
    timeoutMs: REQUEST_MS,
    maxRetries: 0,
  });
}

const modal: SandboxDriver = {
  async verify(backend, profile) {
    const client = modalClient(backend);
    try {
      await client.apps.fromName(profile.app!, { createIfMissing: false });
      await client.images.fromId(profile.template);
    } finally {
      client.close();
    }
  },
  async create({ backend, marker, profile, workerEnv }) {
    const client = modalClient(backend);
    let id: string;
    try {
      const app = await client.apps.fromName(profile.app!, { createIfMissing: false });
      const image = await client.images.fromId(profile.template);
      const sandbox = await client.sandboxes.create(app, image, {
        name: marker,
        tags: { [MARKER]: marker },
        command: [...SANDBOX_WORKER_COMMAND],
        env: workerEnv,
        cpu: 1,
        cpuLimit: 1,
        memoryMiB: 1024,
        memoryLimitMiB: 1024,
        timeoutMs: profile.maxMinutes * 60_000,
        ...(backend.region ? { regions: [backend.region] } : {}),
      });
      id = sandbox.sandboxId;
    } finally {
      client.close();
    }
    return {
      id,
      async connect() {
        const owner = modalClient(backend);
        try {
          const sandbox = await owner.sandboxes.fromId(id);
          const proxy = await sandbox.createConnectToken({ port: SANDBOX_WORKER_PORT });
          return { url: proxy.url, headers: { authorization: `Bearer ${proxy.token}` } };
        } finally {
          owner.close();
        }
      },
    };
  },
  async find(backend, record) {
    if (!record.app) throw new Error("Original Modal app was not recorded");
    const client = modalClient(backend);
    try {
      const sandbox = await client.sandboxes.fromName(record.app, record.marker, {
        includeTerminated: true,
      });
      return [sandbox.sandboxId];
    } catch (err) {
      if (err instanceof ModalNotFoundError) return [];
      throw err;
    } finally {
      client.close();
    }
  },
  async destroy(backend, _record, remoteId) {
    const client = modalClient(backend);
    try {
      const sandbox = await client.sandboxes.fromId(remoteId);
      await sandbox.terminate({ wait: true });
    } catch (err) {
      if (!(err instanceof ModalNotFoundError)) throw err;
    } finally {
      client.close();
    }
  },
};

function runloopClient(backend: SandboxWorker) {
  return new Runloop({
    bearerToken: backend.token,
    baseURL: "https://api.runloop.ai",
    timeout: REQUEST_MS,
    maxRetries: 0,
  });
}

const runloop: SandboxDriver = {
  async verify(backend, profile) {
    await runloopClient(backend).blueprints.retrieve(profile.template);
  },
  async create({ backend, marker, profile, workerEnv }) {
    const client = runloopClient(backend);
    const sandbox = await client.devboxes.create({
      name: marker,
      blueprint_id: profile.template,
      metadata: { [MARKER]: marker },
      entrypoint: workerCommand,
      environment_variables: workerEnv,
      launch_parameters: {
        keep_alive_time_seconds: profile.maxMinutes * 60,
        resource_size_request: "SMALL",
      },
    });
    return {
      id: sandbox.id,
      async connect() {
        await client.devboxes.awaitRunning(sandbox.id, { timeout: BOOT_SECONDS * 1000 });
        const proxy = await client.devboxes.enableTunnel(sandbox.id, {
          auth_mode: "authenticated",
          wake_on_http: false,
        });
        if (proxy.auth_mode !== "authenticated" || !proxy.auth_token) {
          throw new Error("Runloop did not return an authenticated tunnel");
        }
        return {
          url: `https://${SANDBOX_WORKER_PORT}-${proxy.tunnel_key}.tunnel.runloop.ai`,
          headers: { authorization: `Bearer ${proxy.auth_token}` },
        };
      },
    };
  },
  async find(backend, record) {
    const result: string[] = [];
    for await (const sandbox of runloopClient(backend).devboxes.list({
      include_total_count: false,
    })) {
      if (sandbox.metadata[MARKER] === record.marker) result.push(sandbox.id);
    }
    return result;
  },
  async destroy(backend, _record, remoteId) {
    const client = runloopClient(backend);
    try {
      const current = await client.devboxes.retrieve(remoteId);
      if (current.status === "shutdown" || current.status === "failure") return;
      const stopped = await client.devboxes.shutdown(remoteId);
      if (stopped.status !== "shutdown" && stopped.status !== "failure") {
        throw new Error("Runloop has not confirmed shutdown");
      }
    } catch (err) {
      if (!(err instanceof Runloop.NotFoundError)) throw err;
    }
  },
};

export const sandboxDrivers: Record<SandboxWorkerKind, SandboxDriver> = {
  daytona,
  e2b,
  modal,
  runloop,
};
