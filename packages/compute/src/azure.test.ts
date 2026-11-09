import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkerBackend } from "@locus/shared";
import { AzureComputeBackend } from "./azure.js";
import { CompositeComputeBackend } from "./composite.js";
import { GcpComputeBackend } from "./gcp.js";
import { MockComputeBackend } from "./mock.js";

const azure: WorkerBackend = {
  id: "az1",
  name: "Azure",
  url: "",
  kind: "azure",
  token: "client-secret",
  tenantId: "tenant",
  clientId: "app",
  subscriptionId: "sub",
  resourceGroup: "rg",
  containerGroup: "locus",
  region: "eastus",
  allowedSizes: ["0.25-0.5"],
  allowedImages: ["locus/agent"],
};

function azureFetch(): typeof fetch {
  let described = 0;
  return (async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("login.microsoftonline.com")) {
      return new Response(JSON.stringify({ access_token: "arm-token" }), { status: 200 });
    }
    if (method === "PUT") {
      return new Response(JSON.stringify({ properties: {} }), { status: 200 });
    }
    if (method === "GET") {
      described += 1;
      const ip = described > 1 ? "203.0.113.20" : undefined;
      return new Response(JSON.stringify({ properties: { ipAddress: { ip } } }), { status: 200 });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    return new Response(`unexpected ${method} ${url}`, { status: 500 });
  }) as typeof fetch;
}

describe("Azure recorded HTTP", () => {
  const wait = async () => {};

  it("puts an ACI group then waits for a public IP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-az-"));
    const urls: string[] = [];
    const fetchFn = azureFetch();
    const compute = new AzureComputeBackend(
      ((input, init) => {
        urls.push(`${init?.method ?? "GET"} ${String(input)}`);
        return fetchFn(input, init);
      }) as typeof fetch,
      wait,
      join(dir, "compute-azure.json"),
    );
    const handle = await compute.provision({ backend: azure, sessionId: "s1", size: "0.25-0.5" });
    expect(handle.url).toBe("https://203.0.113.20:7421");
    expect(urls[0]).toContain("login.microsoftonline.com");
    expect(urls.some((row) => row.startsWith("PUT "))).toBe(true);
    await compute.destroy(handle.id, azure);
    expect(compute.get(handle.id)).toBeUndefined();
  });
});

describe("composite compute", () => {
  it("routes Azure and GCP kinds away from Fargate", () => {
    const fargate = new MockComputeBackend({ url: "https://fargate", token: "f" });
    const azureBackend = new MockComputeBackend({ url: "https://azure", token: "a" });
    const gcpBackend = new MockComputeBackend({ url: "https://gcp", token: "g" });
    const composite = new CompositeComputeBackend(fargate, azureBackend, gcpBackend);
    expect(composite.quote({ ...azure, kind: "azure" }, "0.25-0.5").usdPerHour).toBe(
      azureBackend.quote({ ...azure, kind: "azure" }, "0.25-0.5").usdPerHour,
    );
    expect(
      composite.quote({ ...azure, kind: "gcp", allowedSizes: ["0.25-0.5"] }, "0.25-0.5"),
    ).toEqual(gcpBackend.quote({ ...azure, kind: "gcp", allowedSizes: ["0.25-0.5"] }, "0.25-0.5"));
  });
});

describe("GCP recorded HTTP", () => {
  const wait = async () => {};
  const gcp: WorkerBackend = {
    id: "g1",
    name: "GCP",
    url: "",
    kind: "gcp",
    token: "ya29.token",
    project: "proj",
    zone: "us-central1-a",
    instanceTemplate: "projects/proj/global/instanceTemplates/locus",
    allowedSizes: ["0.25-0.5"],
    allowedImages: ["locus/agent"],
  };

  it("inserts from a template then waits for a NAT IP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locus-gcp-"));
    let described = 0;
    const compute = new GcpComputeBackend(
      (async (input, init) => {
        const method = init?.method ?? "GET";
        if (method === "POST") {
          return new Response(JSON.stringify({ name: "locus-s1" }), { status: 200 });
        }
        if (method === "GET") {
          described += 1;
          const natIP = described > 1 ? "203.0.113.30" : undefined;
          return new Response(
            JSON.stringify({ networkInterfaces: [{ accessConfigs: [{ natIP }] }] }),
            { status: 200 },
          );
        }
        if (method === "DELETE") return new Response(null, { status: 204 });
        return new Response("nope", { status: 500 });
      }) as typeof fetch,
      wait,
      join(dir, "compute-gcp.json"),
    );
    const handle = await compute.provision({ backend: gcp, sessionId: "s1", size: "0.25-0.5" });
    expect(handle.url).toBe("https://203.0.113.30:7421");
    await compute.destroy(handle.id, gcp);
    expect(compute.get(handle.id)).toBeUndefined();
  });
});
