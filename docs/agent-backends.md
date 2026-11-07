# Agent compute backends

Goal: pick **where** a guest runs without moving the Locus control plane off this machine.

First slice (this tree): spin up Docker agents from the laptop onto **other machines running `locus-worker`** — a LAN box, a cloud VM you created, or a Fargate task whose definition already runs that binary. Placement stays `local` | `worker`. Cloud paste-URL is `WorkerBackend.kind === "cloud"`. Native Fargate is `kind === "fargate"` (size allowlist, recorded HTTP to ECS, no AWS SDK). Azure / GCP adapters are not in this slice.

Related: [SECURITY.md](../SECURITY.md) (loopback control plane), [builtin-browser.md](builtin-browser.md) (live guest Chromium pane, including LAN/cloud workers), `SessionService` in `apps/server/src/session/sessions.ts`, `@locus/worker` in `packages/worker`, `@locus/compute` in `packages/compute`.

## Two knobs

| Knob | Today | Question |
| --- | --- | --- |
| **Model provider** | Settings → Providers | Which LLM bills tokens? |
| **Compute placement** | `local` (this machine) or `worker` (another host running locus-worker) | Which computer runs `exec`, git, the browser, and `/workspace`? |

Runtime (Docker / VM / Host) is **how** the guest is shaped. Placement is **where** that shape is scheduled. Cursor Cloud stays a **provider** that skips the guest; it is not a placement.

```
Laptop Locus (127.0.0.1:7420) — keys, chat, runAgentLoop, approvals
        │  outbound HTTPS + Bearer token (cert fingerprint pinned)
        ▼
locus-worker (0.0.0.0:7421) — DockerEngine + host folders + guest tools
        LAN box  or  cloud VM you created (kind: cloud)
        or Fargate task (kind: fargate) after RunTask + DescribeTasks
```

Workers run **Docker or Host**. QEMU VMs stay on this machine. Restricted jail runs the CONNECT allowlist proxy on the worker (`host.docker.internal`). Design sessions use the same worker workspace GET/PUT and Preview HTTP as coding agents — the canvas is `/workspace/index.html` on that bind-mount. Docker golden-image seeds and the laptop **Host share** (`/mnt/host`) upload as tar.gz after create. Host-on-worker uses a folder on the worker (`host-workspaces/<session>` or an absolute path typed in New agent; root, `$HOME`, secret home dirs, and the worker data directory are refused). Cursor CLI on a worker runs `agent` on that host. Session MCP (playwright / `git_pr_*` / Grafana) and Codex `locus_git` are a loopback proxy on the worker, not the laptop `127.0.0.1:7420` URL.

LLM calls stay on the laptop for the native loop. The worker never stores provider keys. Cursor CLI on a worker receives the key on each `agent -p` spawn over pinned HTTPS (same channel as `GIT_TOKEN`); Codex CLI follows the same per-turn flow and maps the key to `OPENAI_API_KEY`. Forge tokens may be sent as guest `GIT_TOKEN` so clone/push works.

## Current seams

```
POST /api/sessions
  SessionService.create()
    cursorCloud? skip bootGuest
    else bootGuest()
      placement worker → WorkerClient HTTPS → locus-worker Docker **or Host**
        fargate: ComputeBackend.quote/provision (RunTask) then WorkerClient
        stop: destroy guest (default) unless LAN destroyOnStop=false
        fargate stop: destroy guest, then StopTask
        idle reaper: destroy guest after idleTtlMs (cloud/fargate cannot disable)
        create: reject when live guests >= maxConcurrent (cloud/fargate default 1)
        create: reject image not on allowlist (metered empty = none; LAN omitted = any)
        fargate: reject empty size allowlist; pick first allowed size when omitted
      runtime docker  → this.docker.create/start   (bind-mount diskPath:/workspace)
      runtime vm      → this.hypervisor.create/start
      runtime host    → host folder, GuestHub.forHost (or worker HostGuestRuntime)
  runAgentLoop
    GuestHub.forVm | forHost | setRemote(WorkerGuestRuntime)
    checkBudget(llm usd + worker compute usd, time, rounds, tokens, subagents)
```

`runAgentLoop` does not grow `if (aws)` branches. Remote tools are HTTP `POST /v1/guests/:id/tools`. The composer usage hint shows token USD and `$n VM` when compute USD is accruing (operator hourly rate, or the Fargate quote locked at provision).

## Operator flow (LAN or cloud VM)

1. On the other machine (LAN box or a VM you created): install Docker, `npm run dev:worker` (listens on `https://0.0.0.0:7421`, prints a token only when it first creates `~/.locus-worker/token`, prints a `locus-worker:add?url=…&fp=…` line per LAN address, prints the TLS fingerprint every start).
2. On the laptop: paste that line in Settings → Workers (or `locus config workers add '<line>'`). Add tests the token, pins the cert, and lists the host. New agent **Where** shows live / unreachable. Locus does not scan the LAN. Mark **Cloud VM** when the host is metered (forces destroy-on-stop, default idle TTL 15 minutes, max concurrent 1, requires hourly USD and an image allowlist). Mark **Fargate** when ECS should RunTask an allowed size (region, task definition, size allowlist, image allowlist; no paste URL; hourly USD comes from the dated list-price quote). Save remaining fields (kind, allowlists) if you need them.
3. New agent → **Where** → that worker. Runtime is Docker or Host (VM stays local).

Tokens live in the vault, not `config.json`. The control plane bind host stays loopback. Fargate talks to ECS with signed `fetch` (recorded JSON fixtures). There is no AWS/Azure/GCP SDK in `package.json`.

## Multiple Locus apps, one worker host

A `locus-worker` is not paired to one control plane. Settings → Workers and New agent → Where only list hosts **that app** added (its `~/.locus` / `LOCUS_HOME`). Locus does not scan the LAN for other workers. The worker prints its own add line; you paste it. Agents stay in that app’s session dir, so App A’s sidebar never lists App B’s chats.

Two ways to point more than one Locus app at compute on the same machine:

### 1. Share one worker

One process, default port. Register the same URL and token in each app:

1. On the host: `npm run dev:worker` (`https://0.0.0.0:7421`, token in `~/.locus-worker/token`).
2. On each Locus app: Settings → Workers → that URL and token → Test connection.

Fine when the apps may share Docker guests. The worker is not multi-tenant: `GET /v1/guests` returns every guest on that process. Anyone with the token can start or destroy any of them. When a concurrent-guest cap is set (cloud default 1), create lists every live guest on that process, so the other app’s guests count against the cap and can appear in this app’s machine list. Settings → Advanced → **Reset all data** then tries to destroy those cached guests.

### 2. Isolated workers on the same machine

There is no single-instance lock. Defaults collide (`7421` and `~/.locus-worker`), so give each process its own port and home:

```bash
# Worker for app A
LOCUS_WORKER_NAME=app-a \
LOCUS_WORKER_HOME=~/.locus-worker-a \
LOCUS_WORKER_PORT=7421 \
npm run dev:worker

# Worker for app B
LOCUS_WORKER_NAME=app-b \
LOCUS_WORKER_HOME=~/.locus-worker-b \
LOCUS_WORKER_PORT=7422 \
npm run dev:worker
```

Register `https://host:7421` in one Locus app and `https://host:7422` in the other.

| Env var | Default | Why split it |
| --- | --- | --- |
| `LOCUS_WORKER_PORT` | `7421` | Second process cannot bind the same port |
| `LOCUS_WORKER_HOME` | `~/.locus-worker` | Separate token, TLS cert, and `docker-workspaces/` |
| `LOCUS_WORKER_NAME` | hostname | Label on `/v1/info` |
| `LOCUS_WORKER_TOKEN` | file in home | Optional; otherwise a token is created per home dir |
| `LOCUS_WORKER_HOST` | `0.0.0.0` | Bind address |

That isolates tokens, certs, HTTP, and in-memory guest lists. Both still share the host Docker daemon. Container names are `locus-<uuid>`, so names should not collide.

There is no “this worker belongs only to app X” setting. Isolation is a different port, `LOCUS_WORKER_HOME`, and token.

## Native Fargate

`@locus/compute` quotes dated Fargate Linux/x86 US-East-1 list prices (`2026-08`) and POSTs `RunTask` / `DescribeTasks` / `StopTask` to `ecs.{region}.amazonaws.com`, or to the worker **ECS endpoint** when set (PrivateLink or API Gateway; path kept; execute-api hosts sign as `execute-api`). Empty `allowedSizes` cannot provision. Known sizes: `0.25-0.5`, `0.5-1`, `1-2`, `2-4`. The handle is `https://<publicIPv4 or privateIPv4>:7421` after `DescribeTasks` returns an ENI address (no loopback fallback), plus a generated `LOCUS_WORKER_TOKEN` injected as a container env override. Existing `WorkerClient` then creates the Docker guest on that worker. Operator registers a task definition that already runs `locus-worker` and pastes the ARN. Locus does not create VPCs, NAT gateways, or GPU nodes. Destroying a Docker guest does not stop a paste-URL VM; Fargate session stop does `StopTask`. Azure / GCP adapters are not in this slice.

## v1 limits

- HTTPS with a self-signed cert (fingerprint pin). Set `LOCUS_WORKER_TLS_CERT` / `LOCUS_WORKER_TLS_KEY` for your own cert.
- Restricted jail: the allowlist CONNECT proxy listens on the worker (not the laptop). Bind is `0.0.0.0` on a random port so `host.docker.internal` from the guest can reach it; do not publish that port.
- Docker golden-image seed and host share upload over worker HTTPS (`PUT /v1/guests/:id/workspace-seed` and `PUT /v1/guests/:id/host-share`). VM golden disks stay local.
- Design sessions use worker Files + Preview (canvas is `/workspace/index.html`).
- code-server / IDE tunnels stay on this machine. Preview is the guest HTTP port (or static `index.html`) proxied through the worker.
- Worker Files reads the worker host bind-mount (`docker-workspaces/`), not a laptop copy.
- Cursor CLI on a worker requires `agent` on the worker host PATH. Codex CLI requires `codex` on the worker host PATH. Kiro CLI requires `kiro-cli` on the worker host PATH. Their API keys are sent per turn over the pinned worker HTTPS connection and are not stored on the worker.
- Cursor CLI session MCP (playwright, `git_pr_*`, Grafana/Slack/Jira) is a worker-loopback HTTP proxy written into `.cursor/mcp.json`. Claude Code uses the same proxy via project `.mcp.json` (`type: http`) and `--mcp-config .mcp.json`. Kiro CLI uses `.kiro/settings/mcp.json`. Codex coding turns rewrite `locus_git` and `LOCUS_GIT_MCP_URL` onto that same proxy. Codex Design/Games/Assets enable `playwright` on `locus_git`; Codex review enables `git_pr_*` inspect tools (no `git_push`). The laptop control plane stays on loopback; those JSON-RPC calls tunnel over the CLI stream. Do not copy `http://127.0.0.1:7420/mcp` onto a worker workspace.
- Chat attachments and Assets `source.png` land on the worker guest via workspace writes. Worker CLI turns write screenshots into `.locus-attachments` and keep the attached-files note. Do not skip those copies because `placement === "worker"`.
- Design/Games/Assets kits (`ASSET.md`, `GAME.md`, `vendor/reconstruct.js`, design-system files) land after the worker guest is attached. Do not write them during `create` before `bootGuest` — `writeWorkspace` needs `vmId`. Host workers land the same files from `ensureWorkerHost`. Create-time Games `assetIds` copy into `vendor/assets/` on that attach even when there is no first prompt.
- Browser live pane: screencast/input proxy over the same pinned worker HTTPS WebSocket. VM CDP, host Chrome, and phone-specific takeover stay out of this slice.

## Cost walls (required before billable APIs)

The governor today meters **LLM** USD / time / rounds / tokens / sub-agents (`packages/shared/src/governor.ts`). It does not see EC2/Fargate time.

1. Destroy-on-stop for remote guests (default; cloud cannot turn this off). **Done.**
2. Idle TTL (default 15 minutes; cloud cannot set `0`). **Done.**
3. Concurrent guest cap (cloud default 1). **Done.**
4. Compute meter next to token `maxUsd` (operator hourly USD × live-guest wall clock). Hitting the cap destroys the worker guest. **Done.**
5. Docker image allowlist (cloud/fargate: empty cannot create guests; LAN omitted = any image). **Done.** This is the paste-URL analog of size allowlists.
6. Size allowlist + recorded-HTTP Fargate adapter so a runaway agent cannot pick 4 vCPU. **Done.** Task ARNs persist in `compute-tasks.json` so a control-plane restart can `StopTask` orphans (live `remoteGuestId`s are left running).
