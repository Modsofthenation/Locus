# Agent compute backends

Goal: pick **where** a guest runs without moving the Locus control plane off this machine.

First slice (this tree): spin up Docker agents from the laptop onto **other machines running `locus-worker`** — a LAN box, a cloud VM you created, or a Fargate / Azure / GCP worker whose definition already runs that binary. Placement stays `local` | `worker`. Cloud paste-URL is `WorkerBackend.kind === "cloud"`. Native Fargate is `kind === "fargate"` (size allowlist, recorded HTTP to ECS, no AWS SDK). Azure (`kind: azure`) and GCP (`kind: gcp`) reuse the same recorded-HTTP seam.

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
locus-worker (0.0.0.0:7421) — DockerEngine + QEMU + host folders + guest tools
        LAN box  or  cloud VM you created (kind: cloud)
        or Fargate task (kind: fargate) after RunTask + DescribeTasks
```

Workers run **Docker, Host, or QEMU VM**. Restricted jail runs the CONNECT allowlist proxy on the worker (`host.docker.internal`). Design sessions use the same worker workspace GET/PUT and Preview HTTP as coding agents — the canvas is `/workspace/index.html` on that bind-mount. Docker golden-image seeds and the laptop **Host share** (`/mnt/host`) upload as tar.gz after create. Host-on-worker uses a folder on the worker (`host-workspaces/<session>` or an absolute path typed in New agent; root, `$HOME`, secret home dirs, and the worker data directory are refused). Worker VMs resolve Ubuntu/Debian cloud images from `LOCUS_WORKER_HOME/media` (laptop ISO paths are ignored unless they exist on the worker). Cursor CLI on a worker Docker/Host guest runs `agent` on that host; on a Linux VM it SSHs into the guest and reverse-forwards the worker-loopback MCP. Session MCP (playwright / `git_pr_*` / Grafana) and Codex `locus_git` are a loopback proxy on the worker, not the laptop `127.0.0.1:7420` URL.

LLM calls stay on the laptop for the native loop. The worker never stores provider keys. Cursor CLI on a worker receives the key on each `agent -p` spawn over pinned HTTPS (same channel as `GIT_TOKEN`); Codex CLI follows the same per-turn flow and maps the key to `OPENAI_API_KEY`. Forge tokens may be sent as guest `GIT_TOKEN` so clone/push works.

## Current seams

```
POST /api/sessions
  SessionService.create()
    cursorCloud? skip bootGuest
    else bootGuest()
      placement worker → WorkerClient HTTPS → locus-worker Docker, Host, **or QEMU**
        fargate/azure/gcp: ComputeBackend.quote/provision then WorkerClient
        stop: destroy guest (default) unless LAN destroyOnStop=false
        fargate stop: StopTask and confirm the task terminated
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

`runAgentLoop` does not grow `if (aws)` branches. Remote tools are HTTP `POST /v1/guests/:id/tools`. The composer usage hint shows token USD, `$n VM`, and a combined total when both LLM and compute USD are accruing (operator hourly rate, or the Fargate/Azure/GCP quote locked at provision).

## Operator flow (LAN or cloud VM)

1. On the other machine (LAN box or a VM you created): install Docker, `npm run dev:worker` (listens on `https://0.0.0.0:7421`, prints a token only when it first creates `~/.locus-worker/token`, prints a `locus-worker:add?url=…&fp=…` line per LAN address, prints the TLS fingerprint every start).
2. On the laptop: paste that line in Settings → Workers (or `locus config workers add '<line>'`). Add tests the token, pins the cert, and lists the host. New agent **Where** shows live / unreachable. Locus does not scan the LAN. Mark **Cloud VM** when the host is metered (forces destroy-on-stop, default idle TTL 15 minutes, max concurrent 1, requires hourly USD and an image allowlist). Mark **Fargate** when ECS should RunTask an allowed size (region, task definition, size allowlist, image allowlist; no paste URL; hourly USD comes from the dated list-price quote). Save remaining fields (kind, allowlists) if you need them.
3. New agent → **Where** → that worker. Runtime is Docker, Host, or VM. For VMs, place the cloud image in `~/.locus-worker/media` (or `LOCUS_WORKER_HOME/media`) on the worker.

Tokens live in the vault, not `config.json`. The control plane bind host stays loopback. Fargate talks to ECS with signed `fetch` (recorded JSON fixtures). Azure uses ARM + client-credentials; GCP uses a Bearer access token against Compute Engine. There is no AWS/Azure/GCP SDK in `package.json`.

## Multiple Locus apps, one worker host

A `locus-worker` is not paired to one control plane. Settings → Workers and New agent → Where only list hosts **that app** added (its `~/.locus` / `LOCUS_HOME`). Locus does not scan the LAN for other workers. The worker prints its own add line; you paste it. Agents stay in that app’s session dir, so App A’s sidebar never lists App B’s chats.

Two ways to point more than one Locus app at compute on the same machine:

### 1. Share one worker

One process, default port. Register the same URL and token in each app:

1. On the host: `npm run dev:worker` (`https://0.0.0.0:7421`, token in `~/.locus-worker/token`).
2. On each Locus app: Settings → Workers → that URL and token → Test connection.

Fine when the apps may share Docker guests. Each Locus app stamps an `X-Locus-Plane` id so `GET /v1/guests` (and mutate/display) only returns that plane’s guests. Legacy guests without a plane id stay visible. Anyone with the token can still mint another plane id; isolated workers remain the strong tenancy boundary. When a concurrent-guest cap is set (cloud default 1), create lists live guests **on this plane**. Settings → Advanced → **Reset all data** then tries to destroy those cached guests.

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

## Git worktrees (Host)

A Host agent created with `worktree: true` (or `worktreeFrom: <sessionId>`) runs `git worktree add -b locus/<slug>-<id> ~/.locus/worktrees/<repo>-<id> <HEAD>` from the chosen checkout and uses that folder as `hostDir`. `session.worktree` records `source`, `path`, `branch`, `baseSha`, and `baseBranch`; everything else (Files, git pane, CLI turns, checkpoints) just sees a normal host folder.

| Call | What it does |
|------|--------------|
| `POST /api/sessions` with `worktree: true` | One agent on its own branch. Needs a git folder with a commit; worker placement is rejected. |
| `POST /api/sessions/fanout` `{ create, agents: [{ providerId, model }], prompt }` | Creates a base agent (no prompt), then one worker per agent row. Host: one worktree each off the base checkout (a linked repo is cloned once into the base agent first). Docker: one container each (2–4). |
| `POST /api/sessions/:id/workers` `{ agents \| count, prompt }` | Same fan-out from an existing agent. |
| `GET /api/sessions/:id/workers/board` | Per agent: status, provider, model, branch, diffstat vs `baseSha` (committed + uncommitted + untracked), commits, dirty files. |
| `POST /api/sessions/:id/workers/merge` `{ workerId }` | Worktree workers: `git add -A && git commit` in the worktree, then `git merge --no-ff` into the base checkout. A dirty base or a conflict is refused / aborted, never left half-merged. |
| `POST /api/sessions/:id/workers/discard` | Stops the agent, removes the worktree, deletes its branch and the session. |

Removing a worktree agent runs `git worktree remove --force` and `git worktree prune`; the branch is deleted only when it has no commits and no changes. `.locus/worktree.json` in the source checkout can list extra git-ignored files to copy (`copy`) and a `setup` command run in the background in each new worktree. Limits: worktrees are local-Host only (not LAN/cloud workers or VMs); Docker workers still snapshot the container rather than bind-mounting a worktree.

## Custom CLI agents

Provider kind `cli-agent` runs any coding-agent CLI as a fifth Host CLI Turn adapter (`HostCliKind = "generic"`, `packages/providers/src/genericCli.ts`). Settings → Providers → **Add CLI agent** starts from a preset in `packages/shared/src/models/cliAgent.ts` (Gemini CLI, Gemini CLI ACP, OpenCode, Aider, Amp, GitHub Copilot CLI, Custom). Several can coexist; they are keyed by name.

| Field | Meaning |
| --- | --- |
| `cli.command` | One executable (PATH or absolute). No shell. |
| `cli.args` | Argv template. `{prompt}`, `{model}`, `{workspace}`, `{resume}`. An arg with an empty value is dropped with its bare flag (`-m {model}`). No `{prompt}` → prompt on stdin. |
| `cli.resumeArgs` | Appended when the session has a stored id (`session.genericCli.sessionId`). Without `{resume}` (e.g. `--continue`) Locus stores `continue` after the first turn. |
| `cli.output` | `text` (stdout lines → text), `jsonl` (best-effort: `message`/`text`/`assistant`, `tool_use`/`tool_result`, `result`, `session_id`), `claude-stream-json` (Claude Code parser), `acp`. |
| `cli.env`, `cli.apiKeyEnv` | Extra env (secret-looking names go to the vault like MCP env) and the env var that receives the provider API key. |

**ACP** ([Agent Client Protocol](https://agentclientprotocol.com)): Locus is the client. `initialize` (no fs / terminal capabilities) → `session/load` when the agent advertises `loadSession` and a stored id exists (replayed history is not re-rendered) → otherwise `session/new` with `cwd` = workspace and the session MCP URL when the agent accepts HTTP MCP → `session/prompt`. `session/update` maps `agent_message_chunk` → text, `agent_thought_chunk` → reasoning, `tool_call` / `tool_call_update` → tool chips. `session/request_permission` is answered with an allow option; Locus approval gates sit around the Turn and its MCP tools, not inside the CLI.

Placement: Host, Docker, and Linux VM (SSH, stdin piped through `ssh`) work. Worker spawns have no stdin channel yet, so ACP and stdin-prompt configs return a clear error there; argv-prompt configs run. Gemini presets write `.gemini/settings.json` (`mcpServers.locus.httpUrl`) on Host and VM workspaces; other CLI agents get no MCP file. Presets marked UNVERIFIED in code were written from public docs, not run end to end.

## Native Fargate

`@locus/compute` quotes dated Fargate Linux/x86 US-East-1 list prices (`2026-08`) and POSTs `RunTask` / `DescribeTasks` / `ListTasks` / `StopTask` to `ecs.{region}.amazonaws.com`, or to the worker **ECS endpoint** when set (PrivateLink or API Gateway; path kept; execute-api hosts sign as `execute-api`). Empty `allowedSizes` cannot provision. Known sizes: `0.25-0.5`, `0.5-1`, `1-2`, `2-4`. The handle is `https://<publicIPv4 or privateIPv4>:7421` after `DescribeTasks` returns an ENI address (no loopback fallback), plus a generated `LOCUS_WORKER_TOKEN` injected as a container env override. The existing `WorkerClient` then creates a Host guest inside the task. Operator registers a task definition that already runs `locus-worker` and pastes the ARN. Locus does not create VPCs, NAT gateways, or GPU nodes. Destroying a Docker guest does not stop a paste-URL VM; Fargate session stop does `StopTask`. Azure Container Instances (`kind: azure`) and GCP Compute Engine (`kind: gcp`) follow the same quote → provision → WorkerClient path with recorded `fetch` (no SDKs).


### Fargate chats (each agent is its own task)

Picking a Fargate worker in New agent → **Where** is the whole user flow: runtime, image, and host-folder choices disappear, and the chat opens immediately. Behind it:

1. Create returns at once; the boot list shows **Start cloud task → Connect agent → (Clone repo) → Ready**.
2. The control plane persists a provisioning intent and claims a concurrency slot before contacting ECS. It mints a TLS key pair and a bearer token, then `RunTask`s the operator's task definition with them as `worker` container env (`LOCUS_WORKER_TLS_CERT_B64` / `LOCUS_WORKER_TLS_KEY_B64`, `LOCUS_WORKER_TOKEN`, `LOCUS_WORKER_ALLOW_HOST=1`). The cert fingerprint is pinned before the task exists — no trust-on-first-use over the internet.
3. `DescribeTasks` polls for the ENI address (up to 3 minutes; a `STOPPED` task or a `RunTask` failure such as missing capacity is reported with ECS's reason), then `/v1/info` is polled until the cold container answers (up to 4 minutes). A refusal or a pin mismatch fails at once and initiates task cleanup.
4. Fargate has no Docker daemon or KVM, so the agent runs as a **Host guest inside the task** (`host-workspaces/<session>`). The task is single-tenant and destroyed on Stop / idle TTL; the worker drops the token and TLS key from its environment so guest commands cannot read them. A later turn after the reaper provisions a fresh task and re-clones the repo.
5. The image allowlist does not apply (the task definition is the image). Managed policy's "no Host agents" does not block it — that rule is about this machine. PR reviews still need Docker or a VM.

Build the image and register the task definition from [`images/worker`](../images/worker/README.md). Optional **Security group** must allow inbound TCP 7421 from this machine.

### Fargate cleanup and recovery

Grant the control plane `ecs:ListTasks` for recovery alongside the existing ECS actions. An ECS API Gateway override must forward `ListTasks`. The original cluster and region are saved with each new task. Keep credentials for that AWS account available under the same worker ID while tasks or provisioning intents remain.

Locus uses the provisioning ID as both the ECS `clientToken` and the `startedBy` marker. If ECS accepts `RunTask` but the response is lost, reconciliation uses `ListTasks` filtered by that exact marker in the recorded cluster. Empty results leave the intent pending because ECS listings can lag. Failed or incomplete cleanup keeps the provider slot occupied and retries at startup and on the worker reaper interval. A session with a failed stop retains its task ID and shows a cleanup error. Reset requires confirmed cloud cleanup before it wipes local state.

The desktop-only `GET /api/workers/compute/cleanup` lists resource IDs, worker IDs, optional session IDs, and pending stop markers. If an ambiguous intent remains after repeated retries, an operator can use the provisioning ID in ECS and CloudTrail to verify what happened. If AWS confirms there is no billable resource left but Locus cannot confirm it through ECS, stop the control plane and back up `compute-tasks.json` before removing that specific stale row. Restart after repairing an unreadable registry.

## Daytona, E2B, Modal, and Runloop

These providers run one disposable Linux worker per agent. Select a provider in **Settings → Workers**, verify its profile and rate, then select that worker under **New agent → Where**. [Managed sandbox setup and verification](managed-sandboxes.md).

## v1 limits

- HTTPS with a self-signed cert (fingerprint pin). Set `LOCUS_WORKER_TLS_CERT` / `LOCUS_WORKER_TLS_KEY` for your own cert.
- Restricted jail: the allowlist CONNECT proxy listens on the worker (not the laptop). Bind is `0.0.0.0` on a random port so `host.docker.internal` from the guest can reach it; do not publish that port.
- Docker golden-image seed and host share upload over worker HTTPS (`PUT /v1/guests/:id/workspace-seed` and `PUT /v1/guests/:id/host-share`). VM golden disks upload once to `PUT /v1/images/:id` (8 GiB cap) and live under the worker data dir.
- Worker QEMU VNC stays bound to the worker loopback; the laptop noVNC pane reaches it through pinned WSS `/v1/guests/:id/display`. Docker Preview and the live Chromium pane already used worker HTTP tunnels.
- Design sessions use worker Files + Preview (canvas is `/workspace/index.html`).
- code-server / IDE tunnels stay on this machine. Preview is the guest HTTP port (or static `index.html`) proxied through the worker.
- Worker Files reads the worker host bind-mount (`docker-workspaces/`), not a laptop copy.
- Cursor CLI on a worker requires `agent` on the worker host PATH. Codex CLI requires `codex` on the worker host PATH. Kiro CLI requires `kiro-cli` on the worker host PATH. Their API keys are sent per turn over the pinned worker HTTPS connection and are not stored on the worker.
- Cursor CLI session MCP (playwright, `git_pr_*`, Grafana/Slack/Jira) is a worker-loopback HTTP proxy written into `.cursor/mcp.json`. Claude Code uses the same proxy via project `.mcp.json` (`type: http`) and `--mcp-config .mcp.json`. Kiro CLI uses `.kiro/settings/mcp.json`. Codex coding turns rewrite `locus_git` and `LOCUS_GIT_MCP_URL` onto that same proxy. Codex Design/Games/Assets enable `playwright` on `locus_git`; Codex review enables `git_pr_*` inspect tools (no `git_push`). The laptop control plane stays on loopback; those JSON-RPC calls tunnel over the CLI stream. Do not copy `http://127.0.0.1:7420/mcp` onto a worker workspace.
- Chat attachments and Assets `source.png` land on the worker guest via workspace writes. Worker CLI turns write screenshots into `.locus-attachments` and keep the attached-files note. Do not skip those copies because `placement === "worker"`.
- Design/Games/Assets kits (`ASSET.md`, `GAME.md`, `vendor/reconstruct.js`, design-system files) land after the worker guest is attached. Do not write them during `create` before `bootGuest` — `writeWorkspace` needs `vmId`. Host workers land the same files from `ensureWorkerHost`. Create-time Games `assetIds` copy into `vendor/assets/` on that attach even when there is no first prompt.
- Browser live pane: screencast/input proxy over the same pinned worker HTTPS WebSocket. VM CDP, host Chrome, and phone-specific takeover stay out of this slice.

## Compute governance

The existing daily model spend and token policies are checked before managed compute provisioning. When a turn encounters an exhausted daily budget with an attached cloud task, the server starts task cleanup. The per-turn governor also uses the existing compute estimate alongside model usage. For new Fargate tasks the elapsed estimate starts at the provisioning request and continues through confirmed teardown. The pricing basis remains the dated US-East-1 Linux/x86 fixture. Hard compute-dollar ceilings require conservative regional rates, durable spend reservations, and a runtime deadline.

See [Cloud compute architecture decision](cloud-compute-architecture.md) for the rollout sequence.
