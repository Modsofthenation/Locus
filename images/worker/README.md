# `locus/worker`

`locus-worker` packaged for **provisioned compute** (ECS Fargate). Settings → Workers → **Fargate** points at a task definition that runs this image; every chat placed on that worker gets its own task. The task is the sandbox, so the agent runs as a Host guest inside it (Fargate has no Docker daemon or KVM). Stop and the idle reaper `StopTask` it.

```bash
docker build -f images/worker/Dockerfile -t locus/worker:0.29.0 .   # from the repo root
```

`--build-arg INSTALL_AGENT_CLIS=0` skips the Claude Code / Codex CLIs.

Daytona, E2B, Modal, and Runloop profiles use the same image with a provider-authenticated gateway. E2B can skip this image: Settings → Workers → E2B → **Build template** builds an equivalent template from the app's bundled worker. [Managed sandbox setup](../../docs/managed-sandboxes.md).

## One-time AWS setup

1. Push the image to ECR (`locus-worker:0.29.0`).
2. Fill in `ACCOUNT_ID` / `REGION` in [`task-definition.json`](task-definition.json) and register it: `aws ecs register-task-definition --cli-input-json file://images/worker/task-definition.json`. The container **must** be named `worker` — Locus overrides its environment by that name.
3. Create the cluster (`aws ecs create-cluster --cluster-name locus`) and pick a subnet with a route to the internet (public subnet; Locus sets `assignPublicIp`). The security group must allow inbound **TCP 7421** from the machine running Locus.
4. IAM for the access key Locus uses: `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:ListTasks`, `ecs:StopTask`, `ecs:TagResource` on the cluster/task definition, plus `iam:PassRole` on the task execution role.

Then add the worker in Settings → Workers → Fargate (region, cluster, task definition ARN, subnet, security group, sizes). New agent → **Where** → that worker. No other choices: the chat opens immediately and the boot list shows *Start cloud task → Connect agent → Ready*.

## What Locus injects per task

| Variable | Purpose |
|----------|---------|
| `LOCUS_WORKER_TOKEN` | Per-task bearer token |
| `LOCUS_WORKER_TLS_CERT_B64` / `LOCUS_WORKER_TLS_KEY_B64` | TLS identity minted by the control plane, so the cert fingerprint is pinned before the task starts (no trust-on-first-use over the internet) |
| `LOCUS_WORKER_ALLOW_HOST=1` | Host guests in the task |

The worker removes the token and TLS variables from its environment after reading them, so guest commands and CLI agents do not inherit them. Model keys never go to the task for the native loop; CLI providers receive their key per turn over the pinned channel.
