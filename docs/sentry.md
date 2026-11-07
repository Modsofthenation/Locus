# Sentry

First-party Sentry tools run on the host with a vaulted auth token. Agents only see them after Settings → Integrations has a Sentry account with a token.

`sentry_search` sends a **Sentry search query from the operator prompt** (for example `is:unresolved level:error`). Locus does not invent product-specific filters; the agent should copy the query the operator asked for.

Works with **sentry.io** and self-hosted Sentry (`/api/0`).

## Setup

1. Create a Sentry **User Auth Token** (sentry.io → Settings → Account → Auth Tokens) or an **Organization Auth Token**. Scopes: `org:read`, `project:read`, `event:read`. Add `event:write` if the agent should resolve or ignore issues.
2. Settings → Integrations → **Add Sentry**.
3. Base URL `https://sentry.io` (or `https://de.sentry.io`, or your self-hosted origin).
4. Paste the token. Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

When the token can see more than one organization, pass `org` on the tool call (or pick it from `sentry_projects`).

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When Sentry (or Grafana / Slack / Jira) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. The workspace URL is `http://127.0.0.1:7420/mcp/sessions/<sessionId>`, which also exposes that session's `git_pr_*` tools. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider for Sentry queries.

## Agent tools

Sentry calls are host-side. JSON is returned to the model. Results larger than the model context clip are written to `/workspace/.locus/tool-results/` — grep that file. Do not treat truncation as a broken API, and do not re-fetch with exec or curl.

| Tool | Purpose |
| --- | --- |
| `sentry_projects` | List organizations and projects the token can see |
| `sentry_search` | Search issues (`query`, optional `org`, `project`, `statsPeriod`, `limit`, `sort`) |
| `sentry_get` | Fetch an issue by id, short id (`WEB-12`), or permalink. Includes the latest event stack by default |
| `sentry_events` | Latest event, a specific `event` id, or a short list |
| `sentry_update` | Set `status` (`resolved` / `ignored` / `unresolved`) or `assignedTo`. Waits for Approve |

Examples:

- Unresolved errors: `{ "query": "is:unresolved level:error" }`
- One project, last 24h: `{ "query": "is:unresolved", "project": "web", "statsPeriod": "24h" }`
- Issue plus stack: `{ "issue": "WEB-12" }`
- Resolve after a fix: `{ "issue": "WEB-12", "status": "resolved" }` (Approve)

## Automations

On webhook jobs, list `sentry_search` (and any other `sentry_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Sentry tools on that job. See [webhook-automations.md](webhook-automations.md).
