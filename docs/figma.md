# Figma

First-party Figma tools run on the host with a vaulted personal access token. Agents only see them after Settings → Integrations has a Figma account with a token.

`figma_get` and `figma_images` are the main path for Design: pass a file key or a `figma.com/design/…` URL, then implement `/workspace/index.html` from the compact tree and render URLs. Locus does not iframe the Figma editor.

## Setup

1. Create a **personal access token** at [Figma settings](https://www.figma.com/settings) → Security. Grant file content and (if you want comments) comments scopes.
2. Settings → Integrations → **Add Figma**.
3. Base URL is `https://api.figma.com` (the default).
4. Paste the token. Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt. Requests use the `X-Figma-Token` header.

## Cursor CLI

Cursor CLI is a separate agent process. It does not receive Locus host tools in its native catalog. When Figma (or Grafana / Slack / Jira) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane and starts `agent` with `--approve-mcps`. The global URL is `http://127.0.0.1:7420/mcp`. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider.

## Agent tools

All tools are host-side. Large JSON is offloaded to `/workspace/.locus/tool-results/` — grep that file. Do not re-fetch with exec or curl. Do not scrape figma.com.

| Tool | Purpose |
| --- | --- |
| `figma_list` | Signed-in user, or projects for `team` (team id or `figma.com/files/team/…` URL), or files for `project`. |
| `figma_get` | Compact page/frame/text/fill tree. Pass `file` (key or URL). Optional `node` / `ids` and `depth` (default 2). |
| `figma_images` | Render nodes to short-lived PNG/JPG/SVG/PDF URLs. Pass `file` and `ids` (comma-separated `1:2` or `1-2`). Optional `format`, `scale` (default 2). |
| `figma_comment` | Post a comment (Approve / Deny). Pass `file`, `message`, optional `node`. |

Node ids in Figma URLs use a hyphen (`node-id=12-34`); the API uses a colon (`12:34`). Either form works.

## Automations

On webhook jobs, list `figma_get` (and any other `figma_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Figma tools on that job. See [webhook-automations.md](webhook-automations.md).
