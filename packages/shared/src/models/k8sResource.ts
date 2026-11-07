/** Built-in Kubernetes kinds Locus can address without a discovery round-trip. */

export interface K8sResourceSpec {
  kind: string;
  plural: string;
  group: string;
  version: string;
  namespaced: boolean;
}

const RESOURCES: K8sResourceSpec[] = [
  { kind: "Pod", plural: "pods", group: "", version: "v1", namespaced: true },
  { kind: "Service", plural: "services", group: "", version: "v1", namespaced: true },
  { kind: "ConfigMap", plural: "configmaps", group: "", version: "v1", namespaced: true },
  { kind: "Secret", plural: "secrets", group: "", version: "v1", namespaced: true },
  { kind: "Namespace", plural: "namespaces", group: "", version: "v1", namespaced: false },
  { kind: "Node", plural: "nodes", group: "", version: "v1", namespaced: false },
  { kind: "Event", plural: "events", group: "", version: "v1", namespaced: true },
  { kind: "Endpoints", plural: "endpoints", group: "", version: "v1", namespaced: true },
  {
    kind: "PersistentVolumeClaim",
    plural: "persistentvolumeclaims",
    group: "",
    version: "v1",
    namespaced: true,
  },
  {
    kind: "PersistentVolume",
    plural: "persistentvolumes",
    group: "",
    version: "v1",
    namespaced: false,
  },
  { kind: "ServiceAccount", plural: "serviceaccounts", group: "", version: "v1", namespaced: true },
  { kind: "Deployment", plural: "deployments", group: "apps", version: "v1", namespaced: true },
  { kind: "ReplicaSet", plural: "replicasets", group: "apps", version: "v1", namespaced: true },
  { kind: "StatefulSet", plural: "statefulsets", group: "apps", version: "v1", namespaced: true },
  { kind: "DaemonSet", plural: "daemonsets", group: "apps", version: "v1", namespaced: true },
  { kind: "Job", plural: "jobs", group: "batch", version: "v1", namespaced: true },
  { kind: "CronJob", plural: "cronjobs", group: "batch", version: "v1", namespaced: true },
  {
    kind: "Ingress",
    plural: "ingresses",
    group: "networking.k8s.io",
    version: "v1",
    namespaced: true,
  },
  {
    kind: "NetworkPolicy",
    plural: "networkpolicies",
    group: "networking.k8s.io",
    version: "v1",
    namespaced: true,
  },
  {
    kind: "HorizontalPodAutoscaler",
    plural: "horizontalpodautoscalers",
    group: "autoscaling",
    version: "v2",
    namespaced: true,
  },
  {
    kind: "Role",
    plural: "roles",
    group: "rbac.authorization.k8s.io",
    version: "v1",
    namespaced: true,
  },
  {
    kind: "RoleBinding",
    plural: "rolebindings",
    group: "rbac.authorization.k8s.io",
    version: "v1",
    namespaced: true,
  },
  {
    kind: "ClusterRole",
    plural: "clusterroles",
    group: "rbac.authorization.k8s.io",
    version: "v1",
    namespaced: false,
  },
  {
    kind: "ClusterRoleBinding",
    plural: "clusterrolebindings",
    group: "rbac.authorization.k8s.io",
    version: "v1",
    namespaced: false,
  },
];

const ALIASES: Record<string, string> = {
  po: "Pod",
  pod: "Pod",
  pods: "Pod",
  svc: "Service",
  service: "Service",
  services: "Service",
  cm: "ConfigMap",
  configmap: "ConfigMap",
  configmaps: "ConfigMap",
  secret: "Secret",
  secrets: "Secret",
  ns: "Namespace",
  namespace: "Namespace",
  namespaces: "Namespace",
  no: "Node",
  node: "Node",
  nodes: "Node",
  ev: "Event",
  event: "Event",
  events: "Event",
  ep: "Endpoints",
  endpoints: "Endpoints",
  pvc: "PersistentVolumeClaim",
  persistentvolumeclaim: "PersistentVolumeClaim",
  pv: "PersistentVolume",
  persistentvolume: "PersistentVolume",
  sa: "ServiceAccount",
  serviceaccount: "ServiceAccount",
  deploy: "Deployment",
  deployment: "Deployment",
  deployments: "Deployment",
  rs: "ReplicaSet",
  replicaset: "ReplicaSet",
  sts: "StatefulSet",
  statefulset: "StatefulSet",
  ds: "DaemonSet",
  daemonset: "DaemonSet",
  job: "Job",
  jobs: "Job",
  cj: "CronJob",
  cronjob: "CronJob",
  cronjobs: "CronJob",
  ing: "Ingress",
  ingress: "Ingress",
  ingresses: "Ingress",
  netpol: "NetworkPolicy",
  networkpolicy: "NetworkPolicy",
  hpa: "HorizontalPodAutoscaler",
  role: "Role",
  roles: "Role",
  rolebinding: "RoleBinding",
  clusterrole: "ClusterRole",
  clusterrolebinding: "ClusterRoleBinding",
};

export const K8S_SCALE_KINDS = new Set(["Deployment", "ReplicaSet", "StatefulSet"]);

export function resolveK8sKind(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key) return "";
  return ALIASES[key] ?? RESOURCES.find((row) => row.kind.toLowerCase() === key)?.kind ?? "";
}

export function k8sResourceSpec(kind: string, apiVersion?: string): K8sResourceSpec | undefined {
  const resolved = resolveK8sKind(kind) || kind.trim();
  const known = RESOURCES.find((row) => row.kind.toLowerCase() === resolved.toLowerCase());
  if (known) return known;
  if (!resolved || !apiVersion?.trim()) return undefined;
  const { group, version } = splitApiVersion(apiVersion);
  if (!version) return undefined;
  return {
    kind: resolved,
    plural: guessPlural(resolved),
    group,
    version,
    namespaced: true,
  };
}

export function k8sResourcePath(
  spec: K8sResourceSpec,
  opts: { namespace?: string; name?: string; subresource?: string } = {},
): string {
  const root = spec.group ? `/apis/${spec.group}/${spec.version}` : `/api/${spec.version}`;
  const name = opts.name?.trim() ? `/${encodeURIComponent(opts.name.trim())}` : "";
  const sub = opts.subresource?.trim() ? `/${opts.subresource.trim()}` : "";
  if (!spec.namespaced) return `${root}/${spec.plural}${name}${sub}`;
  const ns = opts.namespace?.trim();
  if (ns) {
    return `${root}/namespaces/${encodeURIComponent(ns)}/${spec.plural}${name}${sub}`;
  }
  return `${root}/${spec.plural}${name}${sub}`;
}

export interface K8sManifestMeta {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
  isJson: boolean;
}

export function parseK8sManifest(raw: string): K8sManifestMeta | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const apiVersion = str(obj.apiVersion);
      const kind = str(obj.kind);
      const meta =
        obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata)
          ? (obj.metadata as Record<string, unknown>)
          : {};
      const name = str(meta.name);
      const namespace = str(meta.namespace) || undefined;
      if (!apiVersion || !kind || !name) return undefined;
      return { apiVersion, kind, name, namespace, isJson: true };
    } catch {
      return undefined;
    }
  }
  const apiVersion = yamlTopScalar(text, "apiVersion");
  const kind = yamlTopScalar(text, "kind");
  const name = yamlMetaScalar(text, "name");
  const namespace = yamlMetaScalar(text, "namespace");
  if (!apiVersion || !kind || !name) return undefined;
  return { apiVersion, kind, name, namespace, isJson: false };
}

export function redactK8sSecrets(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(redactK8sSecrets);
  if (!body || typeof body !== "object") return body;
  const rec = body as Record<string, unknown>;
  const kind = typeof rec.kind === "string" ? rec.kind : "";
  if (kind === "Secret") return redactSecretObject(rec);
  if (kind === "SecretList" && Array.isArray(rec.items)) {
    return { ...rec, items: rec.items.map(redactK8sSecrets) };
  }
  if (Array.isArray(rec.items)) {
    return { ...rec, items: rec.items.map(redactK8sSecrets) };
  }
  return body;
}

export function compactK8sItems(kind: string, items: unknown[]): string {
  const lines = items.map((item) => compactK8sItem(kind, item)).filter(Boolean);
  return lines.join("\n") || `No ${kind} resources`;
}

function compactK8sItem(kind: string, item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const rec = item as Record<string, unknown>;
  const meta =
    rec.metadata && typeof rec.metadata === "object"
      ? (rec.metadata as Record<string, unknown>)
      : {};
  const name = str(meta.name) || "?";
  const ns = str(meta.namespace);
  const ref = ns ? `${ns}/${name}` : name;
  if (kind === "Pod") {
    const status =
      rec.status && typeof rec.status === "object" ? (rec.status as Record<string, unknown>) : {};
    const phase = str(status.phase) || "Unknown";
    return `Pod ${ref} ${phase} ready=${podReady(status)} restarts=${podRestarts(status)}`;
  }
  if (kind === "Deployment" || kind === "StatefulSet" || kind === "ReplicaSet") {
    const spec =
      rec.spec && typeof rec.spec === "object" ? (rec.spec as Record<string, unknown>) : {};
    const status =
      rec.status && typeof rec.status === "object" ? (rec.status as Record<string, unknown>) : {};
    const want = typeof spec.replicas === "number" ? spec.replicas : 0;
    const ready = typeof status.readyReplicas === "number" ? status.readyReplicas : 0;
    return `${kind} ${ref} ${ready}/${want}`;
  }
  if (kind === "Service") {
    const spec =
      rec.spec && typeof rec.spec === "object" ? (rec.spec as Record<string, unknown>) : {};
    const type = str(spec.type) || "ClusterIP";
    const ip = str(spec.clusterIP);
    return `Service ${ref} ${type}${ip ? ` ${ip}` : ""}`;
  }
  if (kind === "Node") {
    const status =
      rec.status && typeof rec.status === "object" ? (rec.status as Record<string, unknown>) : {};
    const ready = conditionStatus(status, "Ready");
    return `Node ${name} Ready=${ready || "?"}`;
  }
  if (kind === "Event") {
    const involved =
      rec.involvedObject && typeof rec.involvedObject === "object"
        ? (rec.involvedObject as Record<string, unknown>)
        : {};
    const obj = `${str(involved.kind)}/${str(involved.name)}`.replace(/\/$/, "");
    const type = str(rec.type) || "Normal";
    const reason = str(rec.reason);
    const message = str(rec.message);
    return [type, reason, obj, message].filter(Boolean).join(" ");
  }
  return `${kind} ${ref}`;
}

function redactSecretObject(rec: Record<string, unknown>): Record<string, unknown> {
  const next = { ...rec };
  if (next.data && typeof next.data === "object" && !Array.isArray(next.data)) {
    next.data = redactMap(next.data as Record<string, unknown>);
  }
  if (next.stringData && typeof next.stringData === "object" && !Array.isArray(next.stringData)) {
    next.stringData = redactMap(next.stringData as Record<string, unknown>);
  }
  return next;
}

function redactMap(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(data)) out[key] = "***";
  return out;
}

function splitApiVersion(apiVersion: string): { group: string; version: string } {
  const trimmed = apiVersion.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash <= 0) return { group: "", version: trimmed };
  return { group: trimmed.slice(0, slash), version: trimmed.slice(slash + 1) };
}

function guessPlural(kind: string): string {
  const lower = kind.trim().toLowerCase();
  if (lower.endsWith("y") && !/[aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${lower}es`;
  return `${lower}s`;
}

function yamlTopScalar(text: string, key: string): string {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return unquote(match?.[1] ?? "");
}

function yamlMetaScalar(text: string, key: string): string | undefined {
  const meta = text.match(/^metadata:\s*\n((?:[ \t]+.*\n?)*)/m);
  if (!meta?.[1]) return undefined;
  const match = meta[1].match(new RegExp(`^[ \\t]+${key}:\\s*(.+)$`, "m"));
  const value = unquote(match?.[1] ?? "");
  return value || undefined;
}

function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed.split(/\s+#/)[0]?.trim() ?? "";
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function podReady(status: Record<string, unknown>): string {
  const statuses = Array.isArray(status.containerStatuses) ? status.containerStatuses : [];
  let ready = 0;
  for (const row of statuses) {
    if (row && typeof row === "object" && (row as { ready?: boolean }).ready) ready += 1;
  }
  return `${ready}/${statuses.length}`;
}

function podRestarts(status: Record<string, unknown>): number {
  const statuses = Array.isArray(status.containerStatuses) ? status.containerStatuses : [];
  let restarts = 0;
  for (const row of statuses) {
    if (row && typeof row === "object") {
      const count = (row as { restartCount?: unknown }).restartCount;
      if (typeof count === "number" && Number.isFinite(count)) restarts += count;
    }
  }
  return restarts;
}

function conditionStatus(status: Record<string, unknown>, type: string): string {
  const conditions = Array.isArray(status.conditions) ? status.conditions : [];
  for (const row of conditions) {
    if (row && typeof row === "object" && (row as { type?: string }).type === type) {
      return str((row as { status?: unknown }).status);
    }
  }
  return "";
}
