# Gmail, Google Calendar, and Google Drive

First-party Google tools run on the host with a vaulted OAuth token. Agents only see them after Settings → Integrations has that product connected.

| Product | Tools | Writes (Approve / Deny) |
|---------|-------|-------------------------|
| Gmail | `gmail_search`, `gmail_get`, `gmail_send` | `gmail_send` |
| Google Calendar | `calendar_list`, `calendar_get`, `calendar_create` | `calendar_create` |
| Google Drive | `drive_list`, `drive_get`, `drive_upload` | `drive_upload` |

Each product is its own account so you can connect only Gmail, or all three. They can share one Google Cloud OAuth client.

## Setup

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth client (Web application or Desktop). Add authorized redirect URI `http://127.0.0.1:7420/api/oauth/callback` (same loopback callback as Slack / Git forges; change the port if Settings → Advanced bind port is not 7420).
2. Enable the Gmail, Google Calendar, and/or Google Drive APIs on that project.
3. Settings → Integrations → **Add Gmail** / **Add Google Calendar** / **Add Google Drive**.
4. Paste the OAuth client ID and secret (or set `LOCUS_GOOGLE_OAUTH_CLIENT_ID` and `LOCUS_GOOGLE_OAUTH_CLIENT_SECRET`).
5. **Sign in with Google**. Locus requests only the scopes for that product (`gmail.readonly` + `gmail.send`, `calendar.readonly` + `calendar.events`, or `drive.readonly` + `drive.file`).

Access tokens expire in about an hour. Locus stores the refresh token in `~/.locus/secrets.enc` and refreshes automatically. You can paste a short-lived `ya29.…` access token for a one-off test; Sign in with Google is the durable path.

Tokens stay in the vault, never in the guest or the prompt.

## Cursor CLI

When Gmail, Calendar, or Drive is configured, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. Tokens are never written into `.cursor/mcp.json`. Cursor Cloud still cannot call Locus host tools.

## Agent tools

### Gmail

| Tool | Arguments |
|------|-----------|
| `gmail_search` | `q` (Gmail search), optional `max` (default 20) |
| `gmail_get` | `id` (message id) |
| `gmail_send` | `to`, `subject`, `body`; optional `cc`, `bcc`, `thread_id` |

### Calendar

| Tool | Arguments |
|------|-----------|
| `calendar_list` | optional `calendar` (default `primary`), `time_min`, `time_max`, `q`; `calendars: true` lists calendars |
| `calendar_get` | `event`, optional `calendar` |
| `calendar_create` | `summary`, `start`, `end` (ISO-8601 or `YYYY-MM-DD`); optional `description`, `location`, `attendees` |

### Drive

| Tool | Arguments |
|------|-----------|
| `drive_list` | optional `q` (Drive query), `folder`, `max` |
| `drive_get` | `file` (file id). Text files under 200 KiB include contents |
| `drive_upload` | `name` plus `content` or `bytes_base64`; optional `mime`, `folder`. Max 20 MiB |

Large JSON is offloaded to `/workspace/.locus/tool-results/` — grep that file. Do not re-fetch with exec or curl.

## Automations

On webhook jobs, list the `gmail_*` / `calendar_*` / `drive_*` names in **Allowed MCP / integration tools**. Empty means no first-party Google tools on that job. See [webhook-automations.md](webhook-automations.md).
