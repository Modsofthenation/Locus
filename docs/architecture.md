# Architecture

Locus is a **local control plane**. The desktop (or CLI) talks to a loopback HTTP/WebSocket server. That server drives a **guest** — a Docker container, a QEMU VM, or a folder on this disk. LLM keys, forge tokens, and session state stay under `~/.locus`.

```
You  →  apps/desktop or apps/cli
            │  loopback :7420
            ▼
       apps/server          sessions, vault, approvals, forge, Slack
            │
            ├─ packages/hypervisor     QEMU / Docker (or mocks)
            ├─ packages/guest-agent    tools over SSH / WinRM / docker exec
            ├─ packages/providers     model streaming + native / CLI loops
            ├─ packages/alb            Agent Loop Builder workflow graphs
            └─ packages/worker         optional LAN/cloud host for Docker/Host
```

Domain vocabulary (Agent, Guest, Forge, Turn, …) lives in [CONTEXT.md](../CONTEXT.md).

## Repository layout

```
apps/
  desktop/     Vite + React UI, Electron shell, installers
  server/      Hono API, WebSocket hub, session and automation services
  cli/         Terminal client for the same loopback API (`npx locus`)
  android/     WebView around the phone shell
  chrome-extension/  Unpacked MV3 extension for Host "Use my Chrome"
packages/
  shared/      Types and pure helpers (models, protocol, recipes)
  hypervisor/  QEMU + Docker engines, mock fallbacks
  providers/   OpenAI-compatible + Anthropic streaming, Cursor / Claude / Codex / Kiro CLI
  guest-agent/ Guest tool catalog, SSH / WinRM, git auth
  alb/         Agent Loop Builder workflow runtime (graphs, gates, templates)
  worker/      LAN Docker/Host guest service (`npm run dev:worker`)
  compute/     Fargate placement quotes / RunTask
images/agent/  First-party Docker image (`locus/agent`)
docs/          Operator guides
scripts/       Release helpers
```

Each app and package has its own README.

## Control plane (`apps/server/src`)

Composition root stays at the top of `src/`: `index.ts` boots the process, `app.ts` mounts HTTP routes.

| Folder | Responsibility |
|--------|----------------|
| `http/` | Route modules extracted from the app (docker including Swarm, repo, automation, workflow, board, project, brain, workspace, slack, grafana, design) |
| `core/` | Store, vault, hub, guests, sockets, rate limit, redaction |
| `session/` | Agent turns, create, checkpoints, subscriptions, tool gates |
| `workspace/` | Files, git dirty, LSP, repo index, host folders |
| `git/` | GitHub / GitLab / Bitbucket adapters, linked repos |
| `slack/` | Slack gateway, OAuth, Socket Mode, cache |
| `design/` | Design kits, systems, canvas promote |
| `boards/` | Planning canvases under `~/.locus/boards` |
| `projects/` | Body-of-work documents under `~/.locus/projects` |
| `brain/` | Knowledge graph + distilled memory under `~/.locus/brain` |
| `automations/` | Scheduled and webhook jobs |
| `workflows/` | Agent Loop Builder import, templates, run / resume |
| `integrations/` | MCP, Grafana, Sentry, Confluence, Linear, incident.io, AWS IAM, Portainer, Kubernetes, plugins, Cursor CLI, web search |
| `media/` | Artifacts, attachments, recordings, screenshots, shares |
| `runtime/` | Preview, browser CDP stream, Chrome extension hub, phone remote, Tailscale, jail |
| `evals/` | Coding / harness / Docker eval tests |

Eval fixtures and mock media live in `apps/server/fixtures` (sibling of `src/`).

## Desktop UI (`apps/desktop`)

```
apps/desktop/
  electron/     Main process (window, vault key, zoom, close guard)
  src/
    App.tsx     Shell composition
    components/ Feature folders: layout, chat, design, game, workspace, guest,
                codebase, slack, grafana, docker, automations, board, projects, settings
    lib/        Renderer helpers
    state/      UI store
  test/         Packaging / bundle tests
  public/       Logos, theme images
```

Renderer imports use the `@/` alias (`@/components/chat/ChatPane`, `@/lib/api`).

## Data on disk

Operator data is **not** in this repo. Default: `~/.locus` (sessions, vault, indexes, golden images, recordings). Do not commit it. See [SECURITY.md](../SECURITY.md).
