import { describe, expect, it } from "vitest";
import {
  compactK8sItems,
  k8sResourcePath,
  k8sResourceSpec,
  parseK8sManifest,
  redactK8sSecrets,
  resolveK8sKind,
} from "./k8sResource.js";

describe("k8s resource helpers", () => {
  it("resolves kubectl-style aliases", () => {
    expect(resolveK8sKind("po")).toBe("Pod");
    expect(resolveK8sKind("deploy")).toBe("Deployment");
    expect(resolveK8sKind("svc")).toBe("Service");
    expect(k8sResourceSpec("pods")?.plural).toBe("pods");
    expect(k8sResourcePath(k8sResourceSpec("Pod")!, { namespace: "ops", name: "web" })).toBe(
      "/api/v1/namespaces/ops/pods/web",
    );
    expect(k8sResourcePath(k8sResourceSpec("Node")!, { name: "n1" })).toBe("/api/v1/nodes/n1");
    expect(
      k8sResourcePath(k8sResourceSpec("Deployment")!, {
        namespace: "default",
        name: "web",
        subresource: "scale",
      }),
    ).toBe("/apis/apps/v1/namespaces/default/deployments/web/scale");
  });

  it("parses JSON and YAML manifests", () => {
    expect(
      parseK8sManifest(
        JSON.stringify({
          apiVersion: "apps/v1",
          kind: "Deployment",
          metadata: { name: "web", namespace: "ops" },
        }),
      ),
    ).toEqual({
      apiVersion: "apps/v1",
      kind: "Deployment",
      name: "web",
      namespace: "ops",
      isJson: true,
    });
    expect(
      parseK8sManifest(`apiVersion: v1
kind: ConfigMap
metadata:
  name: "env"
  namespace: default
data:
  a: b
`),
    ).toEqual({
      apiVersion: "v1",
      kind: "ConfigMap",
      name: "env",
      namespace: "default",
      isJson: false,
    });
    expect(parseK8sManifest("kind: Pod")).toBeUndefined();
  });

  it("redacts Secret data and compact-lists pods", () => {
    const secret = redactK8sSecrets({
      kind: "Secret",
      metadata: { name: "reg" },
      data: { password: "abc" },
      stringData: { token: "xyz" },
    }) as { data: Record<string, string>; stringData: Record<string, string> };
    expect(secret.data.password).toBe("***");
    expect(secret.stringData.token).toBe("***");
    expect(
      compactK8sItems("Pod", [
        {
          metadata: { name: "web-1", namespace: "ops" },
          status: {
            phase: "Running",
            containerStatuses: [{ ready: true, restartCount: 2 }],
          },
        },
      ]),
    ).toBe("Pod ops/web-1 Running ready=1/1 restarts=2");
  });
});
