# Portainer

First-party Portainer tools run on the host with a vaulted access token. Agents only see them after Settings → Integrations has a Portainer account with a token.

Works with **Portainer CE / BE 2.6+** access tokens (`X-API-Key`). A JWT pasted from `POST /api/auth` is sent as Bearer instead.

Container and stack tools talk to Docker (and Docker agent / edge Docker) environments. Kubernetes environments list in `portainer_endpoints` but container tools refuse them.

## Setup

1. In Portainer, open **User → My account → Access tokens** and create a token with permission to read environments, containers, and stacks (and start/stop if you want writes).
2. Settings → Integrations → **Add Portainer**.
3. Base URL is the Portainer UI origin, for example `http://127.0.0.1:9000` or `https://portainer.example.com` (HTTPS on `:9443` is common). Do not append `/api`.
4. Paste the access token. Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When Portainer (or Grafana / Slack / Jira / Miro) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. The workspace URL is `http://127.0.0.1:7420/mcp/sessions/<sessionId>`, which also exposes that session's `git_pr_*` tools. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider.

## Agent tools

All Portainer tools are host-side. JSON larger than the model context clip is written to `/workspace/.locus/tool-results/` — grep that file. Do not treat truncation as a broken API, and do not re-fetch with exec or curl.

| Tool | Purpose |
| --- | --- |
| `portainer_endpoints` | List environments (id, name, up/down, docker/agent/kubernetes) |
| `portainer_containers` | List containers on an environment. `endpoint` is optional when only one environment exists. Optional `name` filter. |
| `portainer_inspect` | Inspect a container (`container` id or name). Returns image, state, ports, and `EnvCount` — not `Env` values |
| `portainer_logs` | Tail stdout/stderr (`tail` default 100, max 500) |
| `portainer_stacks` | List stacks, or pass `stack` (id or name) for details plus the compose file |
| `portainer_container_action` | `start` / `stop` / `restart` a container. Waits for Approve |
| `portainer_stack_action` | `start` / `stop` a stack. Waits for Approve |

Examples:

- List environments: `{ }` on `portainer_endpoints`
- Running nginx on the only environment: `{ "name": "nginx" }` on `portainer_containers`
- Tail logs: `{ "container": "web", "tail": 80 }`
- Restart after Approve: `{ "container": "web", "action": "restart" }`

This is not the local Docker sidebar. Local engine inventory stays on the Docker rail; Portainer is for a remote Portainer instance.

## Automations

On webhook jobs, list `portainer_containers` (and any other `portainer_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Portainer tools on that job. See [webhook-automations.md](webhook-automations.md).
