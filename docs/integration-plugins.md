# Integration plugins

First-party Jira, Confluence, Linear, Slack, Grafana, Miro, Figma, AWS IAM, Kubernetes, and Sentry stay built in. For a bespoke HTTP API, ask a Locus agent to add an **integration plugin**. The agent writes the Settings fields and tool definitions; you paste secrets in Settings → Integrations. Tokens stay in `~/.locus/secrets.enc`, never in the guest or the prompt.

## What the agent does

Tell an agent something like:

> Add an integration for our status API at `https://status.example.com`. Bearer token. `GET /incidents` lists incidents and `POST /incidents` creates one with `{title}`.

The agent calls `manage_integration_plugin` (`create`). That stores:

- **Config fields** — shown on Settings → Integrations → Plugins (`url`, `secret`, `string`, `boolean`)
- **Tools** — host-side HTTP calls exposed as `plugin_<slug>_<tool>`

It must not put tokens in the tool call. After create, paste secrets in Settings and Save. The next turn offers the new tools.

`manage_integration_plugin` also supports `update`, `list`, and `delete`. Creating or changing a plugin waits for Approve / Deny (same as MCP). Autonomous sessions auto-allow the `plugin` family.

## Settings

Settings → Integrations → **Plugins** lists authored plugins. Edit the display name, fill URL/token fields, enable or remove. Tool schemas stay with the plugin the agent wrote.

## HTTP templates

Each tool has `http.method`, `http.url`, optional `headers`, `query`, and `body`. Strings may include:

- `{{config.fieldKey}}` — values from Settings (including vaulted secrets)
- `{{args.argName}}` — arguments the model passed

The request host must come from a `url` config field or a hardcoded `http(s)` host in the template. `{{args.*}}` cannot choose the host. Redirects are not followed. Responses are size-capped and wrapped as untrusted data. An Amazon API Gateway URL works as that host when the plugin uses an API key header; IAM SigV4 for first-party AWS tools and HTTP MCP is on the AWS IAM / MCP cards instead.

GET tools skip chat approval. POST / PUT / PATCH / DELETE always wait for Approve / Deny (`write: false` cannot turn a non-GET into a read). Mark a GET as `write: true` when it is not safe to auto-allow. Autonomy Autonomous or an automation allowlist still skips the prompt.

## Automations

Webhook and scheduled jobs do not see plugin tools until you list them on the job (same box as MCP / Jira / Linear / Slack / Grafana / Sentry). Example: `plugin_status_list`.

## Security

- Host-side HTTP with vaulted secrets, like first-party integrations.
- Do not paste tokens into chat. Settings → Integrations is the keyring.
- Review Approve / Deny when the agent creates a plugin or calls a write tool.
- Treat plugin responses as untrusted data.

See [SECURITY.md](../SECURITY.md).
