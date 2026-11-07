# Kubernetes

First-party Kubernetes tools run on the host with a vaulted service account token (or `kubectl proxy` on loopback). Agents only see them after Settings → Integrations has a Kubernetes account that is ready.

## Setup

1. Settings → Integrations → **Add Kubernetes**.
2. **API server** is the cluster URL.
   - Local-first: run `kubectl proxy --port=8001` and keep the default `http://127.0.0.1:8001`. The proxy authenticates with your kubeconfig, so the token field can stay empty.
   - Remote cluster: paste `https://…` and a **service account bearer token** (`kubectl create token` or a long-lived secret).
3. Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt. Self-signed local API certs (kind / minikube) should go through `kubectl proxy` on HTTP loopback rather than HTTPS.

Do not paste a kubeconfig into chat.

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When Kubernetes (or Grafana / Slack / Jira) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider.

## Agent tools

All tools are host-side. Large JSON is offloaded to `/workspace/.locus/tool-results/` — grep that file. Do not re-fetch with `kubectl`, `exec`, or curl.

| Tool | Purpose |
| --- | --- |
| `k8s_list` | List resources. Pass `kind` (`pod`, `deploy`, `svc`, …) and optional `namespace` / `label`. |
| `k8s_get` | Fetch one resource. Pass `kind` and `name`. Secret `data` / `stringData` values are redacted. |
| `k8s_logs` | Pod logs. Pass `name`, optional `namespace`, `container`, `tail` (default 200), `previous`. |
| `k8s_events` | Cluster events. Optional `namespace`, plus `name` / `kind` for the involved object. |
| `k8s_apply` | Server-side apply a JSON or YAML `manifest` (Approve / Deny). |
| `k8s_delete` | Delete a resource (Approve / Deny). |
| `k8s_scale` | Scale a Deployment, ReplicaSet, or StatefulSet (Approve / Deny). Pass `replicas`. |

`kind` accepts kubectl aliases (`po`, `deploy`, `svc`, `ns`). Namespaced gets default to `default` when namespace is omitted. List without a namespace is cluster-wide.

## Automations

On webhook jobs, list `k8s_list` (and any other `k8s_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Kubernetes tools on that job. See [webhook-automations.md](webhook-automations.md).
