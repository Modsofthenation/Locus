import { describe, expect, it } from "vitest";
import { IntegrationsClient } from "./integrations.js";

const cluster = {
  id: "k1",
  kind: "kubernetes" as const,
  name: "Kubernetes",
  enabled: true,
  baseUrl: "https://127.0.0.1:6443",
  token: "s.token",
};

describe("Kubernetes integration", () => {
  it("lists pods with a vaulted bearer token", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      calls.push({
        url: String(url),
        auth: new Headers(init?.headers).get("Authorization"),
      });
      return new Response(
        JSON.stringify({
          items: [
            {
              metadata: { name: "web-1", namespace: "ops" },
              status: { phase: "Running", containerStatuses: [{ ready: true, restartCount: 0 }] },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    const result = await client.call("k8s_list", { kind: "po", namespace: "ops" }, [cluster]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Pod ops/web-1 Running");
    expect(calls[0]?.url).toContain("/api/v1/namespaces/ops/pods");
    expect(calls[0]?.auth).toBe("Bearer s.token");
  });

  it("gets a resource and redacts Secret values", async () => {
    const client = new IntegrationsClient(async () => {
      return new Response(
        JSON.stringify({
          kind: "Secret",
          metadata: { name: "reg", namespace: "ops" },
          data: { password: "abc" },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    const result = await client.call("k8s_get", { kind: "secret", name: "reg", namespace: "ops" }, [
      cluster,
    ]);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('"password": "***"');
    expect(result.output).not.toContain("abc");
  });

  it("reads pod logs", async () => {
    const urls: string[] = [];
    const client = new IntegrationsClient(async (url) => {
      urls.push(String(url));
      return new Response("error: boom\n", { headers: { "Content-Type": "text/plain" } });
    });
    const result = await client.call(
      "k8s_logs",
      { name: "web-1", namespace: "ops", container: "app", tail: 50 },
      [cluster],
    );
    expect(result).toEqual({ ok: true, output: "error: boom" });
    expect(urls[0]).toContain("/api/v1/namespaces/ops/pods/web-1/log");
    expect(urls[0]).toContain("container=app");
    expect(urls[0]).toContain("tailLines=50");
  });

  it("lists events, applies YAML, scales, and deletes", async () => {
    const calls: Array<{ method: string; url: string; body: string; type: string | null }> = [];
    const client = new IntegrationsClient(async (url, init) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: String(init?.body ?? ""),
        type: new Headers(init?.headers).get("Content-Type"),
      });
      if (String(url).includes("/events")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                type: "Warning",
                reason: "BackOff",
                involvedObject: { kind: "Pod", name: "web-1" },
                message: "CrashLoop",
              },
            ],
          }),
        );
      }
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });
    const events = await client.call("k8s_events", { namespace: "ops", name: "web-1" }, [cluster]);
    expect(events.ok).toBe(true);
    expect(events.output).toContain("Warning BackOff Pod/web-1 CrashLoop");
    const applied = await client.call(
      "k8s_apply",
      {
        manifest: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ops
spec:
  replicas: 1
`,
      },
      [cluster],
    );
    expect(applied).toEqual({ ok: true, output: "Applied Deployment ops/web" });
    const scaled = await client.call(
      "k8s_scale",
      { kind: "deploy", name: "web", namespace: "ops", replicas: 3 },
      [cluster],
    );
    expect(scaled).toEqual({ ok: true, output: "Scaled Deployment ops/web to 3" });
    const deleted = await client.call(
      "k8s_delete",
      { kind: "pod", name: "web-1", namespace: "ops" },
      [cluster],
    );
    expect(deleted).toEqual({ ok: true, output: "Deleted Pod ops/web-1" });
    expect(calls.map((row) => row.method)).toEqual(["GET", "PATCH", "PATCH", "DELETE"]);
    expect(calls[1]?.url).toContain("/apis/apps/v1/namespaces/ops/deployments/web");
    expect(calls[1]?.url).toContain("fieldManager=locus");
    expect(calls[1]?.type).toBe("application/apply-patch+yaml");
    expect(calls[2]?.url).toContain("/scale");
    expect(JSON.parse(calls[2]?.body ?? "{}")).toEqual({ spec: { replicas: 3 } });
  });

  it("applies a JSON manifest with apply-patch+yaml", async () => {
    const types: Array<string | null> = [];
    const client = new IntegrationsClient(async (_url, init) => {
      types.push(new Headers(init?.headers).get("Content-Type"));
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    });
    const applied = await client.call(
      "k8s_apply",
      {
        manifest: JSON.stringify({
          apiVersion: "v1",
          kind: "ConfigMap",
          metadata: { name: "cfg", namespace: "ops" },
          data: { k: "v" },
        }),
      },
      [cluster],
    );
    expect(applied).toEqual({ ok: true, output: "Applied ConfigMap ops/cfg" });
    expect(types).toEqual(["application/apply-patch+yaml"]);
  });

  it("allows kubectl proxy on loopback without a token", async () => {
    const auths: Array<string | null> = [];
    const client = new IntegrationsClient(async (_url, init) => {
      auths.push(new Headers(init?.headers).get("Authorization"));
      return new Response(JSON.stringify({ items: [] }));
    });
    const result = await client.call("k8s_list", { kind: "ns" }, [
      {
        id: "k1",
        kind: "kubernetes",
        name: "Kubernetes",
        enabled: true,
        baseUrl: "http://127.0.0.1:8001",
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.output).toBe("No Namespace resources");
    expect(auths).toEqual([null]);
  });

  it("requires a token for a remote API server", async () => {
    const result = await new IntegrationsClient(async () => new Response("no")).call(
      "k8s_list",
      { kind: "pod" },
      [
        {
          id: "k1",
          kind: "kubernetes",
          name: "Kubernetes",
          enabled: true,
          baseUrl: "https://k8s.example.com",
        },
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/kubernetes token/i);
  });
});
