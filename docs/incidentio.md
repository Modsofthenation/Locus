# incident.io

First-party incident.io tools run on the host with a vaulted API key. Agents only see them after Settings → Integrations has an incident.io account with a token.

## Setup

1. Create an API key in incident.io (Settings → API keys). Grant `incidents.view` for reads. Add `incidents.create`, `incidents.update_*`, and `incident_updates.create` if agents should open or edit incidents.
2. Settings → Integrations → **Add incident.io**.
3. Base URL is `https://api.incident.io` (the default).
4. Paste the API key. Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When incident.io (or Grafana / Slack / Jira / Linear) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider.

## Agent tools

All tools are host-side. Large JSON is offloaded to `/workspace/.locus/tool-results/` — grep that file. Do not re-fetch with exec or curl.

| Tool | Purpose |
| --- | --- |
| `incidentio_search` | List incidents. Optional `query` (name, summary, or `INC-123`), `status_category` (`live` / Active, `triage`, `closed`, …), `status`, `severity`, `page_size`, `after`. |
| `incidentio_get` | Fetch one incident by id or reference (`INC-123`). |
| `incidentio_comment` | Post an update (Approve / Deny). Pass `incident` and `body`. Optional `status` / `severity`. |
| `incidentio_create` | Open an incident (Approve / Deny). Pass `name`, optional `summary`, `status`, `severity`, `visibility` (`public` default). |
| `incidentio_update` | Edit name, summary, status, or severity (Approve / Deny). |

`status` and `severity` accept a name (`Investigating`, `Major`) or an incident.io id.

## Automations

On webhook jobs, list `incidentio_search` (and any other `incidentio_*` names) in **Allowed MCP / integration tools**. Empty means no first-party incident.io tools on that job. See [webhook-automations.md](webhook-automations.md).
