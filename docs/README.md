# Docs

Operator guides for running Locus. Screenshots used by the README gallery are in [screenshots/](screenshots/).

## Start here

| Guide | Covers |
|-------|--------|
| [../README.md](../README.md) | Product overview, install, screenshots |
| [../SECURITY.md](../SECURITY.md) | Threat model, vault, jail, vulnerability reporting |
| [architecture.md](architecture.md) | Control plane, repo layout, where code lives |
| [../CONTEXT.md](../CONTEXT.md) | Domain vocabulary (Agent, Guest, Forge, Turn) |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, checks, PR expectations |

## Operator guides

| Guide | Covers |
|-------|--------|
| [cli.md](cli.md) | `npx locus` command map (agents, design, games, assets, IDE, workflows, Settings) |
| [quickstart-ollama.md](quickstart-ollama.md) | First Host agent with Ollama (no API key) |
| [troubleshooting.md](troubleshooting.md) | Demo replies, FTS5/Node 22.22, git tests, boot waits |
| [codebase.md](codebase.md) | Linked repos, PR review, Change Stack |
| [slack.md](slack.md) | Local Slack client and Ask Locus |
| [phone.md](phone.md) | LAN pairing, Android app, phone shell |
| [chrome-extension.md](chrome-extension.md) | Host Use my Chrome (unpacked MV3 extension) |
| [agent-backends.md](agent-backends.md) | Workers, Host-on-worker, Fargate |
| [webhook-automations.md](webhook-automations.md) | Git push / PR / Slack webhooks |
| [grafana.md](grafana.md) | Grafana dashboards and Explore tools |
| [confluence.md](confluence.md) | Confluence page search / get / create |
| [figma.md](figma.md) | Figma file, node, and image tools |
| [linear.md](linear.md) | Linear issue tools |
| [incidentio.md](incidentio.md) | incident.io incident tools |
| [aws-iam.md](aws-iam.md) | AWS IAM / STS, PrivateLink, API Gateway, Bedrock SigV4 |
| [docker-swarm.md](docker-swarm.md) | Local Docker Swarm nodes, services, and `docker_swarm` |
| [portainer.md](portainer.md) | Portainer environments, containers, and stacks |
| [google.md](google.md) | Gmail, Google Calendar, and Google Drive |
| [kubernetes.md](kubernetes.md) | Kubernetes cluster tools |
| [sentry.md](sentry.md) | Sentry issue tools |
| [integration-plugins.md](integration-plugins.md) | Agent-authored HTTP plugins |
| [builtin-browser.md](builtin-browser.md) | In-app Chromium watch / takeover |
| [harness.md](harness.md) | Eval harness and safety walls |
| [public-release.md](public-release.md) | Public listing checklist (GitHub settings this tree cannot change) |

`slack-app-manifest.yaml` is the Slack app manifest to paste at api.slack.com.
