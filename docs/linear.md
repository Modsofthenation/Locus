# Linear

First-party Linear tools run on the host with a vaulted personal API key. Agents only see them after Settings → Integrations has a Linear account with a token.

## Setup

1. Create a personal API key in Linear (Settings → API).
2. Settings → Integrations → **Add Linear**.
3. Base URL is `https://api.linear.app` (the default).
4. Paste the API key (`lin_api_…`). Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When Linear (or Grafana / Slack / Jira) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider.

## Agent tools

All tools are host-side GraphQL calls to `https://api.linear.app/graphql`. Large JSON is offloaded to `/workspace/.locus/tool-results/` — grep that file. Do not re-fetch with exec or curl.

| Tool | Purpose |
| --- | --- |
| `linear_search` | Search issues. Optional `query` (text or `ENG-12`), `team` key, `state`, `assignee` (`me`, email, or name). |
| `linear_get` | Fetch one issue by identifier (`ENG-12`) or id. Includes description and recent comments. |
| `linear_comment` | Comment (Approve / Deny). Pass `issue` and `body`. |
| `linear_create` | Create an issue (Approve / Deny). Pass `team` and `title`. Optional `description`, `state`, `assignee`, `parent`, `labels`, `priority` (0–4). |
| `linear_update` | Edit title, description, state, assignee, parent, labels, or priority (Approve / Deny). |

`team`, `state`, `assignee`, `parent`, and `labels` accept a name/key/identifier or a Linear id.

## Automations

On webhook jobs, list `linear_search` (and any other `linear_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Linear tools on that job. See [webhook-automations.md](webhook-automations.md).
