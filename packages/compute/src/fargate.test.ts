import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FargateComputeBackend } from "./fargate.js";
import { MockComputeBackend } from "./mock.js";
import { fargateUsdPerHour } from "./prices.js";
import type { WorkerBackend } from "@locus/shared";

const fargate: WorkerBackend = {
  id: "f1",
  name: "Fargate",
  url: "",
  kind: "fargate",
  region: "us-east-1",
  cluster: "locus",
  taskDefinition: "locus-worker",
  accessKeyId: "AKIATEST",
  token: "secret",
  allowedSizes: ["0.25-0.5", "1-2"],
  allowedImages: ["locus/agent"],
};

const runTask = {
  tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123:task/locus/abc", lastStatus: "PROVISIONING" }],
};
const describeTasks = {
  tasks: [
    {
      taskArn: "arn:aws:ecs:us-east-1:123:task/locus/abc",
      lastStatus: "RUNNING",
      attachments: [
        {
          type: "ElasticNetworkInterface",
          details: [
            { name: "privateIPv4Address", value: "10.0.0.8" },
            { name: "publicIPv4Address", value: "203.0.113.8" },
          ],
        },
      ],
    },
  ],
};
const stopTask = {
  task: { taskArn: "arn:aws:ecs:us-east-1:123:task/locus/abc", desiredStatus: "STOPPED" },
};

function fixtureFetch(opts?: { describeBodies?: unknown[] }): typeof fetch {
  let describes = 0;
  return (async (input, init) => {
    const target = String(
      (init?.headers as Record<string, string> | undefined)?.["x-amz-target"] ?? "",
    );
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (target.endsWith("RunTask")) {
      expect(body.overrides.cpu).toBe("256");
      expect(body.overrides.memory).toBe("512");
      expect(body.tags).toEqual(
        expect.arrayContaining([
          { key: "locus:managed", value: "true" },
          { key: "locus:session", value: "s1" },
        ]),
      );
      return new Response(JSON.stringify(runTask), { status: 200 });
    }
    if (target.endsWith("DescribeTasks")) {
      const bodies = opts?.describeBodies ?? [describeTasks];
      const row = bodies[Math.min(describes, bodies.length - 1)];
      describes += 1;
      return new Response(JSON.stringify(row), { status: 200 });
    }
    if (target.endsWith("StopTask")) {
      expect(body.task).toBe("arn:aws:ecs:us-east-1:123:task/locus/abc");
      return new Response(JSON.stringify(stopTask), { status: 200 });
    }
    return new Response(`unexpected ${target} ${input}`, { status: 500 });
  }) as typeof fetch;
}

describe("compute quote", () => {
  it("rejects an empty size allowlist", () => {
    const mock = new MockComputeBackend({ url: "https://127.0.0.1:7421", token: "tok" });
    expect(() => mock.quote({ ...fargate, allowedSizes: [] }, "0.25-0.5")).toThrow(
      /size allowlist/i,
    );
    expect(fargateUsdPerHour("0.25-0.5")).toBeCloseTo(0.25 * 0.04048 + 0.5 * 0.004445);
  });
});

describe("Fargate recorded HTTP", () => {
  const wait = async () => {};

  it("posts RunTask through an ECS API Gateway URL", async () => {
    const urls: string[] = [];
    const auths: string[] = [];
    const compute = new FargateComputeBackend(
      ((input, init) => {
        urls.push(String(input));
        auths.push(
          String((init?.headers as Record<string, string> | undefined)?.authorization ?? ""),
        );
        return fixtureFetch()(input, init);
      }) as typeof fetch,
      wait,
    );
    await compute.provision({
      backend: {
        ...fargate,
        ecsUrl: "https://abc.execute-api.us-east-1.amazonaws.com/prod/ecs",
      },
      sessionId: "s1",
      size: "0.25-0.5",
    });
    expect(urls[0]).toBe("https://abc.execute-api.us-east-1.amazonaws.com/prod/ecs");
    expect(auths[0]).toContain("/execute-api/");
  });

  it("stops the task through the same ECS API Gateway URL", async () => {
    const ecsUrl = "https://abc.execute-api.us-east-1.amazonaws.com/prod/ecs";
    const urls: string[] = [];
    const auths: string[] = [];
    const compute = new FargateComputeBackend(
      ((input, init) => {
        urls.push(String(input));
        auths.push(
          String((init?.headers as Record<string, string> | undefined)?.authorization ?? ""),
        );
        return fixtureFetch()(input, init);
      }) as typeof fetch,
      wait,
    );
    const handle = await compute.provision({
      backend: { ...fargate, ecsUrl },
      sessionId: "s1",
      size: "0.25-0.5",
    });
    urls.length = 0;
    auths.length = 0;
    await compute.destroy(handle.id);
    expect(urls).toEqual([ecsUrl]);
    expect(auths[0]).toContain("/execute-api/");
  });

  it("waits for a public ENI address then stops the tagged task", async () => {
    const pending = {
      tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123:task/locus/abc", lastStatus: "PROVISIONING" }],
    };
    const compute = new FargateComputeBackend(
      fixtureFetch({ describeBodies: [pending, describeTasks] }),
      wait,
    );
    const handle = await compute.provision({ backend: fargate, sessionId: "s1", size: "0.25-0.5" });
    expect(handle.id).toBe("arn:aws:ecs:us-east-1:123:task/locus/abc");
    expect(handle.url).toBe("https://203.0.113.8:7421");
    expect(handle.size).toBe("0.25-0.5");
    await compute.destroy(handle.id);
    expect(compute.get(handle.id)).toBeUndefined();
    expect(await compute.listOrphans(new Set())).toEqual([]);
  });

  it("persists task ARNs so a restarted control plane can StopTask orphans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-compute-"));
    const registryPath = join(dir, "compute-tasks.json");
    const first = new FargateComputeBackend(fixtureFetch(), wait, registryPath);
    const handle = await first.provision({ backend: fargate, sessionId: "s1", size: "0.25-0.5" });
    expect(handle.id).toBe("arn:aws:ecs:us-east-1:123:task/locus/abc");
    expect(await first.listOrphans(new Set())).toEqual([{ id: handle.id, backendId: "f1" }]);
    expect(await first.listOrphans(new Set([handle.id]))).toEqual([]);

    const stopped: string[] = [];
    const second = new FargateComputeBackend(
      ((input, init) => {
        const target = String(
          (init?.headers as Record<string, string> | undefined)?.["x-amz-target"] ?? "",
        );
        if (target.endsWith("StopTask")) {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          stopped.push(String(body.task ?? ""));
          return Promise.resolve(new Response(JSON.stringify(stopTask), { status: 200 }));
        }
        return Promise.resolve(new Response(`unexpected ${target} ${input}`, { status: 500 }));
      }) as typeof fetch,
      wait,
      registryPath,
    );
    expect(second.get(handle.id)?.url).toBe("https://203.0.113.8:7421");
    expect(second.get(handle.id)?.token).toBeTruthy();
    expect(await second.listOrphans(new Set())).toEqual([{ id: handle.id, backendId: "f1" }]);
    await second.destroy(handle.id, fargate);
    expect(stopped).toEqual([handle.id]);
    expect(await second.listOrphans(new Set())).toEqual([]);

    const third = new FargateComputeBackend(fixtureFetch(), wait, registryPath);
    expect(await third.listOrphans(new Set())).toEqual([]);
  });

  it("reclaims a live Fargate handle after restart instead of StopTask", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-compute-live-"));
    const registryPath = join(dir, "compute-tasks.json");
    const first = new FargateComputeBackend(fixtureFetch(), wait, registryPath);
    const handle = await first.provision({ backend: fargate, sessionId: "s1", size: "0.25-0.5" });
    const second = new FargateComputeBackend(fixtureFetch(), wait, registryPath);
    const restored = second.get(handle.id);
    expect(restored?.url).toBe(handle.url);
    expect(restored?.token).toBe(handle.token);
    expect(await second.listOrphans(new Set([handle.id]))).toEqual([]);
  });

  it("stops the task when DescribeTasks never returns an address", async () => {
    const pending = {
      tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123:task/locus/abc", lastStatus: "PROVISIONING" }],
    };
    const actions: string[] = [];
    const compute = new FargateComputeBackend(
      ((input, init) => {
        const target = String(
          (init?.headers as Record<string, string> | undefined)?.["x-amz-target"] ?? "",
        );
        actions.push(target.split(".").pop() ?? target);
        if (target.endsWith("RunTask"))
          return Promise.resolve(new Response(JSON.stringify(runTask)));
        if (target.endsWith("DescribeTasks")) {
          return Promise.resolve(new Response(JSON.stringify(pending)));
        }
        if (target.endsWith("StopTask"))
          return Promise.resolve(new Response(JSON.stringify(stopTask)));
        return Promise.resolve(new Response(`unexpected ${input}`, { status: 500 }));
      }) as typeof fetch,
      wait,
    );
    await expect(
      compute.provision({ backend: fargate, sessionId: "s1", size: "0.25-0.5" }),
    ).rejects.toThrow(/ENI address/);
    expect(actions.filter((row) => row === "StopTask")).toHaveLength(1);
    expect(compute.get("arn:aws:ecs:us-east-1:123:task/locus/abc")).toBeUndefined();
  });

  it("does not call AWS when the size is not allowed", async () => {
    let called = 0;
    const compute = new FargateComputeBackend((async () => {
      called += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    await expect(
      compute.provision({ backend: fargate, sessionId: "s1", size: "2-4" }),
    ).rejects.toThrow(/size allowlist|4 vCPU|not on the allowlist/i);
    expect(called).toBe(0);
  });
});
