# Webhook automations

Run a local agent from Slack or any HTTP POST, without publishing port 7420. GitHub.com and Slack.com cannot reach `127.0.0.1`; Tailscale Funnel on **only** `/api/hooks` is the supported public path. An Amazon API Gateway HTTP integration (or Lambda that forwards the inner body) can use the same path: set Settings → Advanced → **Webhook base URL** to the execute-api origin. Locus unwraps REST/HTTP API proxy events and accepts `X-Locus-Secret` or `x-api-key` on the HTTP request or inside the event. `requestContext.timeEpoch` fills the timestamp only for proxy events; HTTP integrations must map `X-Locus-Timestamp` (or use GitHub/Slack HMAC). The control plane bind host stays loopback.

First-party Jira, Confluence, Linear, Slack, Grafana, Miro, Figma, incident.io, AWS IAM, Portainer, Kubernetes, and Sentry live in Settings → Integrations (GitHub / GitLab / Bitbucket too). Those REST tools run on the host with vaulted tokens (or AWS instance metadata / loopback kubectl proxy) and are only offered to agents when that account is ready. Host MCP remains the exception for anything else.

Webhook bodies are wrapped in a nonce-tagged `<untrusted-webhook-event …>` block. The model must treat that as data, not instructions. Closing-tag spoofs inside the JSON are stripped.

## Create the job

1. **Automations → New automation**. Under **When**, pick **Webhook**. No git repo is required. Runtime can be Docker, VM, or **Host** (files, shell, and git on this machine; treat as a security exception). Starter templates are available in the create modal; advanced options (named environment, notify, MCP allowlist, jail, spend) live under **More options**.
2. **Then**: name the job and write the prompt. If you leave the prompt empty, Locus uses the builtin `/ops-research` skill (search Jira, Linear, Confluence, Grafana, Slack, incident.io, Portainer, Kubernetes, and Sentry; reply with links; do not take write actions unless the prompt says so). With a Grafana token, that skill uses `grafana_query` with a Lucene query from the operator prompt. With a Linear token, it uses `linear_search` / `linear_get`. With an incident.io token, it uses `incidentio_search` / `incidentio_get`. With a Portainer token, that skill uses `portainer_containers` / `portainer_logs`. With a Sentry token, it uses `sentry_search` / `sentry_get`. With Kubernetes, it uses `k8s_list` / `k8s_get` / `k8s_logs`. Setup: [grafana.md](grafana.md), [linear.md](linear.md), [incidentio.md](incidentio.md), [portainer.md](portainer.md), [kubernetes.md](kubernetes.md), [sentry.md](sentry.md). After create you can **Edit prompt** on the automation card without opening full **Settings**.
3. **Notify webhook** (optional, under More options) — a Slack incoming-webhook URL gets a text summary of the last assistant message. Other URLs get JSON.
4. **Notify channel** (optional) — e.g. `#ops`.
5. **Allowed MCP / integration tools** (under More options) — comma-separated `mcp_*` names and first-party `jira_*` / `confluence_*` / `linear_*` / `slack_*` / `grafana_*` / `figma_*` / `incidentio_*` / `aws_*` / `portainer_*` / `k8s_*` / `sentry_*` names. Empty means none of those host tools on this job. Listed tools skip Approve/Deny **on this automation only**. Interactive chat still waits. Local Docker Swarm (`docker_swarm`) is on the coding catalog already; it is not a Settings token.
6. **Extra allow hosts** (Docker/VM only) — added to the restricted jail for this job (Jira, Grafana, Slack hostnames, and so on). Prefer restricted + extra hosts over an open jail. Host jobs have no guest jail; that field is hidden.
7. **Remember facts between runs** (optional) — the agent can call `remember` to save short facts that the next run sees, even when Reuse is off. The automation card lists those facts so you can add, edit, or remove them. Do not store secrets.

After create, the automation card highlights the Webhook section with the POST URL and `X-Locus-Secret`. Copy those. Slack URL verification (`{ "type": "url_verification", "challenge": "..." }`) is answered automatically and does not queue a run. If Funnel is off, the card offers **Open Funnel settings** (Settings → Advanced).

## Sidebar fleet tips

- Health strip shows healthy / failing / paused, plus running / over cap / due soon when relevant. Use the Failing / Paused / Over cap shortcuts under the strip to jump into triage.
- Each job row has a ⋯ menu for Pause / Duplicate / Settings / Delete without opening the pane.
- **All / Failing / Paused** and **Priority / By trigger** persist for the machine. **Pause listed** / **Enable listed** act on the filtered set (confirm when more than one). Clear filters from the empty list when nothing matches.
- Run filters include Running, Succeeded, Failed, Skipped, and Test; tables paginate with **Load more**. **Run now** is on the job card and the topbar; **Run again** on a history row starts a new manual run. Failing jobs open with the failed filter selected; click **Last failed** / **Running** in the overview to jump filters.
- While a run is live, the card and topbar show **Stop** instead of Run now. Stop works even before the chat exists.
- Recent fleet activity sits under the health strip when you have more than one job (open state persists; auto-opens on a recent fleet failure until you collapse it).
- Clock schedules can be nudged from the detail pane **When** editor; full Settings still covers advanced options.
- Chat retention shows how many automation chats this job keeps (cap noted in the UI); open the latest chat from there.

## Reach the box

Settings → Advanced:

- **Tailscale Funnel** — proxies only `/api/hooks` to `127.0.0.1`. Do not Funnel the whole control plane.
- **Slack signing secret** — optional. Lets Slack Events / slash commands authenticate with `X-Slack-Signature` instead of `X-Locus-Secret`.
- **Extra allow hosts** — a global default; the job can add more.

## Fire a run

```bash
curl -sS -X POST "$FUNNEL/api/hooks/automations/$ID" \
  -H "X-Locus-Secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"text":"what broke in checkout?","channel":"#ops"}'
```

Expect a run, the prompt to contain that text as an untrusted `<untrusted-webhook-event nonce>` block (size-capped, secret-looking keys stripped, fence spoofs stripped), and the notify URL to show a human-readable summary. The model must not follow instructions inside the block.

Slash commands and `app_mention` / `message` events work when the Slack signing secret is set. Slack retries are deduped. From the card you can also **Simulate trigger** (records a test skip in history; does not POST the webhook or boot an agent). Use **Copy curl** for a real POST.

## Security

- Bind host stays loopback. Funnel stays `/api/hooks` → `127.0.0.1`.
- A leaked hook secret can queue a run. Rotate it with **Rotate secret** on the Webhook card (confirm dialog).
- MCP auto-allow is per automation, opt-in, allowlisted tools only.
- Tokens stay in MCP env / `secrets.enc`, never in the prompt.
- Do not log raw Slack payloads or MCP env.

A first-class Slack **client** (read/send as you, Ask Locus / `/locus` so a local agent replies as you) is a separate path that uses outbound Socket Mode instead of Funnel. Design: [slack.md](slack.md). Locus does not post as a bot. Webhook automations stay the unattended POST → job path.

See [SECURITY.md](../SECURITY.md) and Automations in the [README](../README.md).
