import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import { MockDockerEngine } from "@locus/hypervisor";
import { X509Certificate } from "node:crypto";
import { createWorkerApp } from "./app.js";
import { WorkerClient } from "./client.js";
import {
  createSelfSignedWorkerTls,
  loadOrCreateWorkerTls,
  pinnedHttpsFetch,
  workerTlsFromEnv,
} from "./tls.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe("worker TLS", () => {
  it("creates a self-signed cert that Node can parse", async () => {
    const pair = createSelfSignedWorkerTls();
    const cert = new X509Certificate(pair.cert);
    expect(cert.subject).toMatch(/locus-worker/);
    expect(pair.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(pair.fingerprint).toBe(`sha256:${cert.fingerprint256.replace(/:/g, "").toLowerCase()}`);
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-tls-"));
    const first = await loadOrCreateWorkerTls(dir);
    expect(first.created).toBe(true);
    const again = await loadOrCreateWorkerTls(dir);
    expect(again.created).toBe(false);
    expect(again.fingerprint).toBe(first.fingerprint);
  });

  it("delivers a pinned HTTPS response chunk before the response finishes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-tls-stream-"));
    const tls = createSelfSignedWorkerTls();
    const app = createWorkerApp({ engine: new MockDockerEngine(dir), token: "secret" });
    let writer: ReadableStreamDefaultController<Uint8Array> | undefined;
    app.get(
      "/stream-test",
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              writer = controller;
              controller.enqueue(new TextEncoder().encode("first"));
            },
          }),
        ),
    );
    const { port, close } = await listenHttps(app, tls);
    cleanup.push(close);
    const abort = AbortSignal.timeout(2000);
    const { response } = await pinnedHttpsFetch(
      `https://127.0.0.1:${port}/stream-test`,
      {
        headers: { authorization: "Bearer secret" },
        signal: abort,
      },
      tls.fingerprint,
      true,
    );
    const reader = response.body!.getReader();
    try {
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
      writer?.close();
      expect((await reader.read()).done).toBe(true);
    } finally {
      await reader.cancel();
    }
  });

  it("pins the worker certificate on HTTPS", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-worker-tls-app-"));
    const tls = createSelfSignedWorkerTls();
    const engine = new MockDockerEngine(dir);
    const app = createWorkerApp({ engine, token: "secret", name: "studio" });
    const { port, close } = await listenHttps(app, tls);
    cleanup.push(close);

    const client = new WorkerClient({
      id: "w1",
      name: "studio",
      url: `https://127.0.0.1:${port}`,
      token: "secret",
    });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(health.fingerprint).toBe(tls.fingerprint);
    await expect(
      client.create({ sessionId: "s1", name: "agent", image: "locus/agent" }),
    ).rejects.toThrow(/pin this worker/i);

    const pinned = new WorkerClient({
      id: "w1",
      name: "studio",
      url: `https://127.0.0.1:${port}`,
      token: "secret",
      fingerprint: tls.fingerprint,
    });
    await expect(pinned.health()).resolves.toMatchObject({ fingerprint: tls.fingerprint });

    const wrong = new WorkerClient({
      id: "w1",
      name: "studio",
      url: `https://127.0.0.1:${port}`,
      token: "secret",
      fingerprint: "sha256:" + "ab".repeat(32),
    });
    await expect(wrong.health()).rejects.toThrow(/fingerprint mismatch/i);

    const created = await pinned.create({ sessionId: "s1", name: "agent", image: "locus/agent" });
    const tool = await pinned.execute(created.id, { name: "exec", args: { command: "echo hi" } });
    expect(tool.ok).toBe(true);
  });
});

function listenHttps(
  app: ReturnType<typeof createWorkerApp>,
  tls: { key: string; cert: string },
): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: 0,
        createServer,
        serverOptions: { key: tls.key, cert: tls.cert },
      },
      (info) => {
        resolve({
          port: info.port,
          close: () =>
            new Promise((done, fail) => {
              server.close((err) => (err ? fail(err) : done()));
            }),
        });
      },
    );
    server.on("error", reject);
  });
}

describe("workerTlsFromEnv", () => {
  it("loads a control-plane minted identity and keeps its fingerprint", () => {
    const minted = createSelfSignedWorkerTls();
    const loaded = workerTlsFromEnv({
      LOCUS_WORKER_TLS_CERT_B64: Buffer.from(minted.cert).toString("base64"),
      LOCUS_WORKER_TLS_KEY_B64: Buffer.from(minted.key).toString("base64"),
    });
    expect(loaded?.fingerprint).toBe(minted.fingerprint);
    expect(loaded?.key).toBe(minted.key);
  });

  it("ignores a half-set pair and rejects non-PEM values", () => {
    expect(workerTlsFromEnv({ LOCUS_WORKER_TLS_CERT_B64: "abc" })).toBeUndefined();
    expect(() =>
      workerTlsFromEnv({
        LOCUS_WORKER_TLS_CERT_B64: Buffer.from("nope").toString("base64"),
        LOCUS_WORKER_TLS_KEY_B64: Buffer.from("nope").toString("base64"),
      }),
    ).toThrow(/not PEM/);
  });
});
