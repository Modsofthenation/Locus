# Confluence

First-party Confluence tools run on the host with a vaulted API token. Agents only see them after Settings → Integrations has a Confluence account with a token.

## Setup

1. Create an Atlassian **API token** (id.atlassian.com → Security → Create and manage API tokens). Use a **classic** token without scopes.
2. Settings → Integrations → **Add Confluence**.
3. Base URL, for example `https://your-site.atlassian.net` (Locus adds `/wiki`). Data Center: your server URL, with no `/wiki` prefix.
4. Paste `you@example.com:api-token` (account email, a colon, then the token). Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

A raw token on `*.atlassian.net` is sent as Bearer and Atlassian returns Failed to parse Connect Session Auth Token. Scoped tokens (`read:confluence-content.all` / `write:confluence-content`) need Base URL `https://api.atlassian.com/ex/confluence/{cloudId}` and still work as `email:api-token`. Data Center PATs are the raw token against your server URL.

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When Confluence (or Slack / Jira / Grafana) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. The workspace URL is `http://127.0.0.1:7420/mcp/sessions/<sessionId>`, which also exposes that session's `git_pr_*` tools. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider for Confluence.

## Agent tools

All Confluence calls are host-side. JSON is returned to the model. Results larger than the model context clip are written to `/workspace/.locus/tool-results/` — grep that file. Do not treat truncation as a broken API, and do not re-fetch with exec or curl.

| Tool | Purpose |
| --- | --- |
| `confluence_search` | CQL search (`cql` or `query`). Plain text is wrapped as `type=page AND text ~ "…"`. |
| `confluence_get` | Fetch a page by `id` / `page`, or by `title` plus `space`. Returns storage HTML. |
| `confluence_create` | Create a page. Pass `space`, `title`, optional `body` (storage HTML or plain text) and `parent`. Waits for Approve / Deny. |
| `confluence_update` | Update title and/or body. Pass `id` (or `title` plus `space`). Waits for Approve / Deny. |
| `confluence_comment` | Comment on a page. Pass `id` (or `title` plus `space`) and `body`. Waits for Approve / Deny. |

Examples:

- Search: `{ "query": "checkout runbook" }`
- CQL: `{ "cql": "space=ENG AND type=page AND title ~ \\"runbook\\"" }`
- Get: `{ "id": "123456" }` or `{ "title": "Checkout runbook", "space": "ENG" }`
- Create: `{ "space": "ENG", "title": "Incident 12", "body": "checkout 500", "parent": "100" }`

## Automations

On webhook jobs, list `confluence_search` (and any other `confluence_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Confluence tools on that job. See [webhook-automations.md](webhook-automations.md).
