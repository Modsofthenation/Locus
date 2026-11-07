import {
  compactK8sItems,
  encodeIntegrationJson,
  k8sResourcePath,
  k8sResourceSpec,
  K8S_SCALE_KINDS,
  parseK8sManifest,
  redactK8sSecrets,
  type IntegrationAccount,
} from "@locus/shared";

export type KubernetesFetcher = typeof fetch;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function num(args: Record<string, unknown>, key: string, fallback: number, max: number): number {
  const raw = args[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : fallback;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function callKubernetes(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  if (name === "k8s_logs") return k8sLogs(args, account, fetchFn);
  if (name === "k8s_events") return k8sEvents(args, account, fetchFn);
  if (name === "k8s_apply") return k8sApply(args, account, fetchFn);
  if (name === "k8s_delete") return k8sDelete(args, account, fetchFn);
  if (name === "k8s_scale") return k8sScale(args, account, fetchFn);
  if (name === "k8s_get") return k8sGet(args, account, fetchFn);
  return k8sList(args, account, fetchFn);
}

async function k8sList(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const kind = str(args, "kind") || str(args, "resource") || "Pod";
  const spec = k8sResourceSpec(kind);
  if (!spec) return { ok: false, output: `Unknown kind ${kind}` };
  const namespace = str(args, "namespace") || str(args, "ns");
  const label = str(args, "label") || str(args, "selector") || str(args, "labelSelector");
  const url = new URL(joinUrl(account.baseUrl, k8sResourcePath(spec, { namespace })));
  if (label) url.searchParams.set("labelSelector", label);
  url.searchParams.set("limit", String(num(args, "limit", 50, 200)));
  const body = (await k8sJson(url, account, fetchFn)) as { items?: unknown[] };
  const items = Array.isArray(body.items) ? body.items : [];
  return { ok: true, output: compactK8sItems(spec.kind, items) };
}

async function k8sGet(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const kind = str(args, "kind") || str(args, "resource");
  const name = str(args, "name") || str(args, "pod") || str(args, "resource_name");
  if (!kind || !name) return { ok: false, output: "kind and name are required" };
  const spec = k8sResourceSpec(kind);
  if (!spec) return { ok: false, output: `Unknown kind ${kind}` };
  const namespace = str(args, "namespace") || str(args, "ns") || (spec.namespaced ? "default" : "");
  if (spec.namespaced && !namespace) return { ok: false, output: "namespace is required" };
  const body = await k8sJson(
    joinUrl(account.baseUrl, k8sResourcePath(spec, { namespace, name })),
    account,
    fetchFn,
  );
  return { ok: true, output: encodeIntegrationJson(redactK8sSecrets(body)) };
}

async function k8sLogs(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const name = str(args, "name") || str(args, "pod");
  if (!name) return { ok: false, output: "pod name is required" };
  const namespace = str(args, "namespace") || str(args, "ns") || "default";
  const spec = k8sResourceSpec("Pod")!;
  const url = new URL(
    joinUrl(account.baseUrl, k8sResourcePath(spec, { namespace, name, subresource: "log" })),
  );
  const container = str(args, "container");
  if (container) url.searchParams.set("container", container);
  url.searchParams.set("tailLines", String(num(args, "tail", 200, 5_000)));
  if (args.previous === true || str(args, "previous") === "true") {
    url.searchParams.set("previous", "true");
  }
  const text = await k8sText(url, account, fetchFn, { headers: { Accept: "*/*" } });
  return { ok: true, output: text.trim() || "(empty log)" };
}

async function k8sEvents(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const spec = k8sResourceSpec("Event")!;
  const namespace = str(args, "namespace") || str(args, "ns");
  const url = new URL(joinUrl(account.baseUrl, k8sResourcePath(spec, { namespace })));
  const name = str(args, "name") || str(args, "pod");
  const kind = str(args, "kind") || str(args, "resource");
  const selectors: string[] = [];
  if (name) selectors.push(`involvedObject.name=${name}`);
  if (kind) selectors.push(`involvedObject.kind=${kind}`);
  if (selectors.length) url.searchParams.set("fieldSelector", selectors.join(","));
  url.searchParams.set("limit", String(num(args, "limit", 50, 200)));
  const body = (await k8sJson(url, account, fetchFn)) as { items?: unknown[] };
  const items = Array.isArray(body.items) ? body.items : [];
  return { ok: true, output: compactK8sItems("Event", items) };
}

async function k8sApply(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const manifest = str(args, "manifest") || str(args, "yaml") || str(args, "json");
  if (!manifest) return { ok: false, output: "manifest is required" };
  const meta = parseK8sManifest(manifest);
  if (!meta) return { ok: false, output: "manifest needs apiVersion, kind, and metadata.name" };
  const spec = k8sResourceSpec(meta.kind, meta.apiVersion);
  if (!spec) return { ok: false, output: `Unknown kind ${meta.kind}` };
  const namespace =
    str(args, "namespace") ||
    str(args, "ns") ||
    meta.namespace ||
    (spec.namespaced ? "default" : "");
  if (spec.namespaced && !namespace) return { ok: false, output: "namespace is required" };
  const path = k8sResourcePath(spec, { namespace, name: meta.name });
  const url = new URL(joinUrl(account.baseUrl, path));
  url.searchParams.set("fieldManager", "locus");
  await k8sJson(url, account, fetchFn, {
    method: "PATCH",
    headers: {
      // Kubernetes SSA only accepts application/apply-patch+yaml (JSON bodies are valid YAML).
      "Content-Type": "application/apply-patch+yaml",
    },
    body: manifest,
  });
  const ref = spec.namespaced ? `${namespace}/${meta.name}` : meta.name;
  return { ok: true, output: `Applied ${spec.kind} ${ref}` };
}

async function k8sDelete(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const kind = str(args, "kind") || str(args, "resource");
  const name = str(args, "name") || str(args, "pod");
  if (!kind || !name) return { ok: false, output: "kind and name are required" };
  const spec = k8sResourceSpec(kind);
  if (!spec) return { ok: false, output: `Unknown kind ${kind}` };
  const namespace = str(args, "namespace") || str(args, "ns") || (spec.namespaced ? "default" : "");
  if (spec.namespaced && !namespace) return { ok: false, output: "namespace is required" };
  await k8sJson(
    joinUrl(account.baseUrl, k8sResourcePath(spec, { namespace, name })),
    account,
    fetchFn,
    { method: "DELETE" },
  );
  const ref = spec.namespaced ? `${namespace}/${name}` : name;
  return { ok: true, output: `Deleted ${spec.kind} ${ref}` };
}

async function k8sScale(
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
): Promise<{ ok: boolean; output: string }> {
  const kind = str(args, "kind") || str(args, "resource") || "Deployment";
  const name = str(args, "name");
  const replicasRaw = args.replicas ?? args.count;
  const replicas =
    typeof replicasRaw === "number"
      ? replicasRaw
      : typeof replicasRaw === "string"
        ? Number(replicasRaw)
        : NaN;
  if (!name) return { ok: false, output: "name is required" };
  if (!Number.isFinite(replicas) || replicas < 0)
    return { ok: false, output: "replicas is required" };
  const spec = k8sResourceSpec(kind);
  if (!spec || !K8S_SCALE_KINDS.has(spec.kind)) {
    return { ok: false, output: "kind must be Deployment, ReplicaSet, or StatefulSet" };
  }
  const namespace = str(args, "namespace") || str(args, "ns") || "default";
  await k8sJson(
    joinUrl(account.baseUrl, k8sResourcePath(spec, { namespace, name, subresource: "scale" })),
    account,
    fetchFn,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/merge-patch+json" },
      body: JSON.stringify({ spec: { replicas: Math.floor(replicas) } }),
    },
  );
  return {
    ok: true,
    output: `Scaled ${spec.kind} ${namespace}/${name} to ${Math.floor(replicas)}`,
  };
}

async function k8sJson(
  url: string | URL,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
  init: RequestInit = {},
): Promise<unknown> {
  const text = await k8sText(url, account, fetchFn, init);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

async function k8sText(
  url: string | URL,
  account: IntegrationAccount,
  fetchFn: KubernetesFetcher,
  init: RequestInit = {},
): Promise<string> {
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const token = account.token?.trim();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchFn(url.toString(), { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(k8sHttpError(text, res.status));
  return text;
}

function k8sHttpError(text: string, status: number): string {
  const snippet = text.slice(0, 400).trim() || `HTTP ${status}`;
  try {
    const body = JSON.parse(text) as { message?: unknown; reason?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (message) return `HTTP ${status}${reason ? ` ${reason}` : ""}: ${message}`;
  } catch {
    /* not JSON */
  }
  return `HTTP ${status}: ${snippet}`;
}
