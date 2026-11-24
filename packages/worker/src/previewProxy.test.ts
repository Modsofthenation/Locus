import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockDockerEngine } from "@locus/hypervisor";
import { serveWorkerPreview } from "./previewProxy.js";

const temporary: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("keeps cloud gateway credentials and routing headers out of the guest preview", async () => {
  const directory = await mkdtemp(join(tmpdir(), "locus-preview-"));
  temporary.push(directory);
  const engine = new MockDockerEngine(directory);
  const guest = await engine.create({
    sessionId: "test-session",
    name: "Guest",
    os: "ubuntu",
    image: "node:22",
    templateId: "node",
  });
  Object.assign(engine, { inspectAddress: async () => "127.0.0.1" });
  const fetch = vi.fn(async (_target: string, init: RequestInit) => {
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({
      accept: "text/plain",
      host: "127.0.0.1:8080",
    });
    return new Response("preview");
  });
  vi.stubGlobal("fetch", fetch);
  const result = await serveWorkerPreview({
    engine,
    id: guest.id,
    port: 8080,
    path: "/",
    search: "",
    method: "GET",
    headers: new Headers({
      accept: "text/plain",
      authorization: "Bearer gateway",
      "x-locus-worker-token": "worker-token",
      "e2b-traffic-access-token": "traffic-token",
      "x-daytona-preview-token": "preview-token",
      "x-runloop-host": "other.runloop.invalid",
    }),
  });
  expect(await result.text()).toBe("preview");
  expect(fetch).toHaveBeenCalledOnce();
});
