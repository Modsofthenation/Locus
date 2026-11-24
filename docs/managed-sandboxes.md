# Managed cloud sandboxes

Locus can create a private, disposable sandbox on Daytona, E2B, Modal, or Runloop. Locus runs the agent and applies its model and tool settings. The provider hosts the Linux workspace and the Locus worker. Choose a configured worker under **New agent → Where**. Stop or expiry deletes the workspace, so commit or export work you want to keep.

## E2B: set up entirely from Settings

E2B needs no Docker, registry, or CLI. Locus builds the worker template in your E2B team.

1. Create an E2B project API key in the E2B dashboard with template build and read, and sandbox create, commands, list, and kill access. Optionally set a spend limit there.
2. In **Settings → Workers**, add a worker, choose **E2B**, and paste the API key.
3. Choose a template size and click **Build template**. Leave **Include Claude Code and Codex CLIs** on if chats use those CLI providers. Locus uploads its bundled worker (`<resources>/worker/locus-worker.mjs`, about 1 MB) and builds the `locus-worker` template on E2B's build service. The card shows the build log. A build usually takes 3 to 8 minutes, and the **Template ID** fills in when it finishes.
4. Enter the maximum runtime, hourly upper bound, rate date, and session limit (see [Configure Locus](#configure-locus)), then click **Verify profile**.

The template matches [`images/worker/Dockerfile`](../images/worker/Dockerfile): Node 22 on Debian bookworm, git, ripgrep, Python, Chromium, the git credential helper, and optionally the agent CLIs. It starts with `sleep infinity` so port 7421 stays free. Settings records the Locus version that built the template and asks for **Rebuild template** after an upgrade, so the worker always matches the control plane. Rebuilding replaces the `locus-worker` template's default build in place, and running sandboxes are unaffected. Pasting a different Template ID clears that record.

In a repository checkout, Locus bundles the worker from source on each build into `<data dir>/cache/locus-worker.mjs`. `LOCUS_WORKER_BUNDLE` overrides the bundle path.

## Prepare a profile

For Daytona, Modal, and Runloop, or to use your own E2B template, build the worker image from this repository using [the worker build instructions](../images/worker/README.md). Install it in a Linux profile for the selected provider. The image must include the current worker at `/opt/locus/packages/worker/src/main.ts` and its `tsx` launcher at `/opt/locus/node_modules/.bin/tsx`. Leave TCP 7421 available to the provider's authenticated HTTP gateway. Locus starts the worker and supplies its per-sandbox token. For E2B and Daytona, leave port 7421 free in the template or snapshot so the worker can bind after creation.

| Provider | Profile | Credentials and scope |
| --- | --- | --- |
| Daytona | Existing Linux snapshot with zero GPUs | API key with snapshot read, sandbox create, process execute, preview, and sandbox delete permissions. Region is optional. [Sandbox lifecycle](https://www.daytona.io/docs/en/sandboxes/) · [Preview authentication](https://www.daytona.io/docs/en/preview/) |
| E2B | Existing template ID with a current envd in the default E2B Cloud control plane | Project API key with template read and sandbox create, commands, list, and kill access. Private traffic is required. [Sandbox lifecycle](https://e2b.dev/docs/sandbox) · [Private traffic](https://e2b.dev/docs/network/restrict-public-access) |
| Modal | Existing built image ID (`im-…`) and app in environment `main`. Locus requests and limits the sandbox to 1 CPU and 1 GiB RAM | Workspace token ID and token secret with access to the app, image, sandboxes, and connect tokens. Region is optional. [Sandbox configuration](https://modal.com/docs/sdk/js/latest/Sandbox) · [Connect tokens](https://modal.com/docs/guide/sandbox-networking) |
| Runloop | Existing blueprint ID. Locus requests the `SMALL` instance size | API key with blueprint read, devbox create, list, retrieve, shutdown, and authenticated tunnel access. [Lifetime](https://docs.runloop.ai/docs/devboxes/start-stop) · [Tunnels](https://docs.runloop.ai/docs/devboxes/tunnels) |

For provider profiles that preserve the container's default command, derive an image that waits for Locus to launch the worker.

```dockerfile
FROM registry.example.com/locus-worker:VERSION
CMD ["sleep", "infinity"]
```

- **Daytona** uses a [snapshot built from the registry image](https://www.daytona.io/docs/en/snapshots/). Create it in the account and region where Locus will provision.
- **E2B** can use a [template built from a registry image](https://docs.e2b.dev/template/quickstart) instead of the Settings build. Use an idle start command such as `sleep infinity` and configure readiness without binding port 7421. Copy the template ID. Locus starts `/opt/locus/locus-worker.mjs` with `node` when the template has it, and otherwise the image's source tree with `tsx`.
- **Modal** uses a built image. Import the registry image with `client.images.fromRegistry(imageTag)`, call `.build(app)` for an existing app, then copy the returned `imageId`. [Modal Image SDK](https://modal.com/docs/sdk/js/latest/Image)
- **Runloop** uses a [blueprint built from a Dockerfile](https://docs.runloop.ai/docs/devboxes/blueprints/dockerfile-customization). Copy the blueprint ID. Locus supplies the devbox entrypoint at launch.

## Configure Locus

1. Add the provider in **Settings → Workers** and enter its profile and credentials. Locus stores the provider secret in its vault.
2. Enter a conservative all-in hourly USD upper bound for that profile and account. Include the applicable billable increments, disk, network, minimum charges, and provider fees. Enter the verification date and a session compute limit. Locus rejects a new lease when the rate is older than 30 days or the remaining limit cannot cover the lease. Review provider account quotas and egress rules when choosing the profile.
3. Set the maximum runtime from 1 to 60 minutes. Locus requests that deadline from the provider and stops sending guest requests at its locally recorded deadline. The quote includes two extra minutes for billing and teardown. Set **Max concurrent guests** to control the number of outstanding leases, including those awaiting cleanup. The default is one.
4. Use **Verify profile** to check access to the configured resource without launching a billable sandbox. Save the worker and select it when creating a new agent.

Locus journals the quote before provisioning. After confirmed teardown, the journal retains an estimate based on the locked rate and elapsed time through teardown. It uses that estimate when checking the remaining session compute allowance. These controls depend on the operator's pricing inputs. The estimate can differ from the provider invoice. Global, project, and automation model budgets still use the existing model ledger.

Each deployment serves one Host guest over the provider's authenticated HTTPS gateway. Locus can execute shell commands and use files and Git through the worker. Browser tooling depends on the installed worker image and provider gateway. Provisioned profiles use an ephemeral workspace. Persistent volumes, pause and resume, GPUs, Docker and VM nesting, and automatic provider placement are outside this rollout.

## Recover a failed sandbox

If Locus restarts, it attempts to terminate provisioned sandboxes. The gateway and worker tokens live only in memory. Locus keeps the resource ID or discovery marker, the worker ID, and the estimate in `compute-sandboxes.json`. If Stop fails or the provider is unavailable, keep the original worker configuration and provider account accessible. Locus retries and reports pending resources through the chat and the local operator endpoint `GET /api/workers/compute/cleanup`. A provider listing that returns no match after an ambiguous create leaves the local record pending.

## Run a live smoke test

The default test suite uses mocks. The live test launches one five-minute sandbox. Set these environment variables for the test process and use a dedicated journal directory.

| Variable | Value |
| --- | --- |
| `LOCUS_SANDBOX_LIVE_SMOKE` | `I_ACCEPT_PROVIDER_CHARGES` |
| `LOCUS_SANDBOX_SMOKE_PROVIDER` | `daytona`, `e2b`, `modal`, or `runloop` |
| `LOCUS_SANDBOX_SMOKE_API_KEY` | The API key or Modal token secret |
| `LOCUS_SANDBOX_SMOKE_TEMPLATE` | The configured profile identifier |
| `LOCUS_SANDBOX_SMOKE_HOURLY_USD` and `LOCUS_SANDBOX_SMOKE_LIMIT_USD` | The reviewed hourly upper bound and explicit maximum USD |
| `LOCUS_SANDBOX_SMOKE_DATA_DIR` | A writable directory for the smoke-test journal |
| `LOCUS_SANDBOX_SMOKE_TOKEN_ID`, `LOCUS_SANDBOX_SMOKE_APP` | Required for Modal |
| `LOCUS_SANDBOX_SMOKE_REGION` | Optional for Daytona and Modal |

```sh
npx vitest run apps/server/src/session/sandboxLive.test.ts
```

The test verifies worker authentication, shell execution, workspace file access, and confirmed provider cleanup. If cleanup fails, find the tracking ID in `compute-sandboxes-smoke.json` and resolve it through the provider before running another smoke test.
