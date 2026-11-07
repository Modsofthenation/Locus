# Grafana

First-party Grafana tools run on the host with a vaulted API key. Agents only see them after Settings → Integrations has a Grafana account with a token.

The **Grafana** rail is a custom explorer on that same token: a **dashboard grid** (click a dashboard in the catalog — timeseries, stats, tables, logs, and text panels, queried live through Grafana `/api/ds/query`), template variables (query, custom, textbox), firing alerts, annotations on the charts, plus Lucene query + time range, histogram and log stream, extracted stack frames / services / trace ids, a Tempo or Jaeger span list, links into **linked repos** at the file and line, an embedded AI brief, and **Investigate** (starts an Ops loop agent from the log view or from a panel). `grafana_query` stays the agent log path. Dashboards are not an iframe of Grafana; tokens stay in the vault.

`grafana_query` sends a **Lucene query from the operator prompt** to the Elasticsearch datasource. Locus does not invent product-specific filters; the agent should copy the query the operator asked for (or the equivalent Explore view).

Works with **Grafana 8.5** (Elasticsearch via the datasource proxy; dashboards that need Prometheus/Loki should use Grafana 9+) and Grafana 9+ (`/api/ds/query`, with a proxy fallback).

## Setup

1. Create a Grafana **API key** (Grafana 8.5: Configuration → API Keys) or a **service account token** (`glsa_…` on Grafana 9.1+) on the Grafana instance. The token needs permission to list dashboards and query the datasources those boards use (Elasticsearch for the log explorer).
2. Settings → Integrations → **Add Grafana**.
3. Base URL, for example `https://grafana.example.com`.
4. Paste the API key or service account token. The token needs permission to list dashboards (`/api/search`) and query datasources used on those boards.
5. Save.

Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

## Cursor CLI

Cursor CLI and Claude Code are separate agent processes. They do not receive Locus host tools in their native catalogs. When Grafana (or Slack / Jira / Confluence / Linear / incident.io / AWS IAM / Portainer / Gmail / Calendar / Drive / Kubernetes / Sentry) is configured in Settings → Integrations, Locus writes a project MCP server (`locus`) that points at the control plane. Cursor CLI starts with `--approve-mcps` and `.cursor/mcp.json`. Claude Code starts with `--mcp-config .mcp.json` (`type: http`). On this machine the global URL is `http://127.0.0.1:7420/mcp` (first-party integrations) and the workspace URL is `http://127.0.0.1:7420/mcp/sessions/<sessionId>`, which also exposes that session's `git_pr_*` tools (review sessions) and `git_issue_*` tools (coding and review) so forge work does not hunt for a third-party Bitbucket/GitHub MCP. Cursor CLI and Claude Code on a worker get a loopback URL on **that** host instead; JSON-RPC tunnels back to this control plane. The MCP server runs those first-party tools on the host with the vaulted token. Tokens are never written into `.cursor/mcp.json` or `.mcp.json`.

Cursor Cloud still cannot call Locus host tools; use Cursor CLI or a Locus-native provider for Grafana queries.

## Agent tool

`grafana_query` is host-side. JSON is returned to the model and always includes `lucene` and `explore_url` so the agent can show the same view in the Grafana UI. Results larger than the model context clip are written to `/workspace/.locus/tool-results/` — grep that file. Do not treat truncation as a broken API, and do not re-fetch with exec or curl.

| Argument | Default | Purpose |
| --- | --- | --- |
| `query` | required | Lucene query from the operator prompt (`q` / `lucene` aliases) |
| `from` | `now-1h` | Grafana range start (`now-15m`, `now-6h`, `now-7d`, or ISO-8601) |
| `to` | `now` | Grafana range end |
| `mode` | `both` | `count`, `logs`, or `both` |
| `limit` | `25` | Max log documents |
| `datasource` | auto | Elasticsearch datasource name, uid, or id |
| `explore_url_only` | off | Skip the API call |

Examples:

- Histogram + recent logs, last hour: `{ "query": "logger.level:error" }`
- Longer range: `{ "query": "status:500", "from": "now-6h" }`
- Count only: `{ "query": "message:timeout", "from": "now-24h", "mode": "count" }`
- Log documents only: `{ "query": "logger.level:error", "from": "now-15m", "mode": "logs", "limit": 25 }`
- Explore URL without calling Grafana: `{ "query": "logger.level:error", "from": "now-7d", "explore_url_only": true }`

`grafana_search` and `grafana_get` still search and fetch dashboards. The rail uses the same APIs, then queries each panel so you can see the board without leaving Locus.

## Explorer

Open **Grafana** on the icon rail (command palette: Grafana). The pane talks to the same vaulted account:

| Action | What it does |
| --- | --- |
| Dashboards | `GET /api/grafana/dashboards` then `POST /api/grafana/dashboards/:uid/query` — live panel grid. Catalog groups by folder, filters by tag, and pins boards in `~/.locus/grafana/pins.json` |
| Variables | Query, custom, and textbox variables from `templating.list`. Ad-hoc filters and repeated panels are left alone. `$var` / `${var}` / `[[var]]` are substituted before `/api/ds/query`. Empty Prometheus `label_values` queries load options from the datasource |
| Firing | `GET /api/grafana/alerts` — Grafana Alertmanager, then the Prometheus alerts API. A firing row opens its dashboard on a window around `startsAt`, or seeds Lucene from the labels |
| Annotations | `GET /api/annotations` for the open board. Markers sit on timeseries. The card shows the text plus any SHA or PR in it |
| Run | `POST /api/grafana/query` — Lucene + histogram + recent documents. Range chips, a custom from/to, or a histogram bucket set the window. The open dashboard can refresh every 15s, 30s, or 1m |
| Trace | Extracts files, SHAs, PRs, services, and exceptions, then matches linked repo checkouts. A trace id also queries Tempo or Jaeger and lists spans |
| AI brief | One-shot host model (or a heuristic fallback) with severity, hypotheses, and follow-up Lucene |
| Investigate | Creates an Ops loop agent (`grafana_query` / Jira / Slack / incident.io / Portainer) from the log view or from any panel that has a query. Log excerpts are wrapped as untrusted data. A PromQL or LogQL panel is labeled as a panel query, not Lucene |
| Open in Grafana | Dashboard URL with the selected range, or the Explore URL `grafana_query` already returns |
| Repo link | Opens the linked checkout at the file and line when a session for that repo is already running. Otherwise selects the repo |
| Query logs / Open query | Jumps back to the Lucene explorer with that panel's query |

Grafana 9+ uses `/api/ds/query` for Prometheus, Loki, Elasticsearch, SQL, and the rest. Grafana 8.5 Elasticsearch panels fall back to the same datasource proxy as `grafana_query`. Other 8.5 panel types show **Open in Grafana** when live query is missing.

## CLI

```
npx locus grafana status
npx locus grafana dashboards [query]
npx locus grafana get <uid-or-title> [--from now-1h] [--to now]
npx locus grafana query <lucene> [--from now-1h] [--to now] [--datasource name] [--limit 25]
```

Recent queries persist under `~/.locus/grafana/recents.json`. Tokens never leave the vault.

## Automations

On webhook jobs, list `grafana_query` (and any other `grafana_*` names) in **Allowed MCP / integration tools**. Empty means no first-party Grafana tools on that job. See [webhook-automations.md](webhook-automations.md).
