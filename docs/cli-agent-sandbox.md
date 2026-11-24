# CLI agents and the Docker trust model

Cursor CLI, Claude Code, Codex CLI, Kiro CLI, and Custom CLI agents bring their own tool loop, including a shell tool. Locus does not see or gate those calls. It only decides **where the CLI process runs**. On Docker sessions that answer used to be "the operator machine, with full access", which is not what a Docker label promises.

## Where each CLI runs

`apps/server/src/session/hostCliTurn.ts` picks the spawn path the same way for all five CLI kinds (`cursor`, `claude`, `codex`, `kiro`, `generic`):

| Session | CLI process runs | Its shell can reach | Containment |
|---|---|---|---|
| **Docker, this machine** | Operator machine, cwd `<LOCUS_HOME>/docker-workspaces/<session>` (or the container's bind-mounted `diskPath`) | Host filesystem except `<LOCUS_HOME>`, which is hidden apart from this session's workspace. Outbound network, but no host loopback except the session MCP gateway. | **Sandbox** (below) |
| Host, this machine | Operator machine, the Host workspace | Everything the operator can reach | None. Host agents are host access by design. |
| Linux / Windows VM, this machine | Inside the guest over SSH | The guest, plus the session MCP gateway through the SSH reverse forward (below) | VM |
| Worker VM | Inside the guest over SSH from the worker | The guest, plus the worker's per-turn MCP proxy through the SSH reverse forward | VM |
| Worker Docker | The **worker** machine, cwd the guest's `diskPath` (`<LOCUS_WORKER_HOME>/docker-workspaces/<session>`) | Worker filesystem except `<LOCUS_WORKER_HOME>`, which is hidden apart from this guest's workspace. Worker network, including loopback. | **Sandbox** (below) |
| Worker Host | The worker machine, the Host workspace | Everything the worker user can reach | None. Host guests are host access by design (and off unless `LOCUS_WORKER_ALLOW_HOST=1`). |

Only Locus MCP tools (`git_*`, `playwright`, integrations) run inside the Docker container. The CLI's own file and shell tools act on the bind-mounted workspace from the host side.

## The sandbox

The argv / profile builders, env scrub and backend probe live in `packages/shared/src/cliSandbox.ts` (`@locus/shared/cliSandbox`). Three places use them:

- **Control plane:** a Docker session on this machine (`apps/server/src/session/cliSandbox.ts`, called from `hostCliTurn.ts`). The hidden data dir is `<LOCUS_HOME>`, and the network is isolated too (below).
- **`locus-worker`:** a worker Docker guest (`POST /v1/guests/:id/cursor-cli` in `packages/worker/src/app.ts`, which passes the wrap to `spawnWorkerCursorCli` in `cursorCli.ts`). The hidden data dir is `<LOCUS_WORKER_HOME>` (default `~/.locus-worker`).
- **Slack PR reviewer:** a reviewer that uses a CLI agent (`apps/server/src/slack/reviewSandbox.ts`, passed to `completeOneShot` as `spawnFor`). Stricter than the other two, because it hides the home directory too: see [Slack PR reviewer](#slack-pr-reviewer).

Below, `<data dir>` is whichever of the two applies and `<workspace>` is the session workspace or the guest's `diskPath`:

- **Linux:** `bwrap --die-with-parent --new-session --unshare-pid --dev-bind / / --proc /proc --tmpfs <data dir> --bind <workspace> <workspace>`. `<data dir>` becomes an empty tmpfs, the workspace is bound back read-write, and a private PID namespace with a fresh `/proc` stops `/proc/<locus-pid>/root` and `/proc/<pid>/environ` from walking around the tmpfs or reading the parent's env.
- **macOS:** `sandbox-exec` with a profile that denies `file-read*` / `file-write*` under `<data dir>` and allows them again under the workspace.
- **Env:** `LOCUS_*KEY` / `*TOKEN` / `*SECRET` / `*PASSWORD` (for example `LOCUS_MASTER_KEY`, `LOCUS_WORKER_TOKEN`) are dropped from the CLI env. Provider keys the CLI needs (`CURSOR_API_KEY`, …) and `LOCUS_GIT_MCP_URL` are kept.

What stays visible on purpose: the CLI binary, its own config and login (`~/.claude`, `~/.cursor`, `~/.codex`, `~/.kiro`, `~/.gemini`), and the rest of the home directory. The CLI needs its login. On a worker the CLI also keeps the worker's network, including loopback, because it reaches Locus MCP through the worker's loopback MCP proxy.

So a Docker-session CLI cannot read `<LOCUS_HOME>/config.json`, `secrets.enc`, `master.key`, `sessions/*.json`, `attachments/<other session>/`, other sessions' workspaces, or `traces/`. Attachments for **this** session are copied into the workspace under `.locus-attachments/`.

On a worker, a Docker-guest CLI likewise cannot read `<LOCUS_WORKER_HOME>/token`, `tls/` (the worker's TLS key), host keys, golden disks, or other guests' `docker-workspaces/<session>/`. It still reaches the worker's loopback MCP proxy, which is how its Locus tools work.

### Network: the MCP gateway is the only control-plane surface

Since the operator token (see [SECURITY.md](../SECURITY.md)), a loopback client without `<LOCUS_HOME>/operator.token` gets 403 on `/api` and `/ws`, and the sandbox hides that file. The network namespace below predates it and stays as defence in depth. Before the token, the control plane on `127.0.0.1:<bindPort>` (default 7420) treated any loopback client as the operator: `isLocalOperator` and the phone gate in `apps/server/src/core/localguard.ts` accept a loopback peer with no `Origin`, and a non-browser client can send any `Origin` it likes. So the filesystem sandbox alone still let `curl http://127.0.0.1:7420/api/sessions/<other>` read other sessions' transcripts.

Requiring an operator credential on `/api/*` would mean giving one to the desktop UI, phone pairing, the worker, and every script that talks to Locus today. Instead the sandbox takes the control plane out of the CLI's reach:

- **Session MCP gateway** (`apps/server/src/http/cliMcpGateway.ts`). A second HTTP listener on `127.0.0.1:<ephemeral>`. It routes only `POST /mcp/sessions/<id>/<token>`. Each token is 256 random bits, bound to one session, issued when a sandboxed CLI turn starts and revoked when it ends. `/api/*`, `/ws`, the UI, the unscoped `/mcp`, and other sessions' MCP all return 404 (or 403 for a token from another session). Calls go through the same handler as `/mcp/sessions/:id` on the control plane, so approvals and Git gates are unchanged.
- **The CLI gets the gateway URL.** `.mcp.json` (Claude Code), `.cursor/mcp.json` (Cursor), `.kiro/settings/mcp.json`, `.gemini/settings.json`, and `LOCUS_GIT_MCP_URL` (Codex, Kiro) point at the gateway URL with the token. These files sit in this session's workspace, which no other session's CLI can read, and are git-excluded.
- **Linux: its own network namespace.** bubblewrap runs inside [pasta](https://passt.top/) (`passt` package), the user-mode network stack rootless Podman uses: `pasta --config-net --no-map-gw -t none -u none -T <gateway port> -U none -- bwrap …`. The CLI keeps outbound egress (TCP, UDP, DNS) for its provider, but its `127.0.0.1` is its own. `-T` forwards only the gateway port to the host's loopback. `-T` is never left at its default, `auto`, which would forward every port the host listens on, the control plane included. `--no-map-gw` stops the gateway address from being NAT'ed to the host's loopback. If `/etc/resolv.conf` points at a loopback stub (systemd-resolved), the sandbox gets a resolv.conf that sends DNS to pasta's forwarder instead (`--dns-forward 169.254.1.1`).
- **macOS:** the Seatbelt profile adds `(deny network-outbound (remote ip "localhost:*"))` and then allows only the gateway port.

`apps/server/src/session/hostCliTurn.test.ts` runs a real CLI process on a Docker session against a real control plane. Unsandboxed it reads another session's transcript through `/api/sessions/<id>`. Sandboxed, `/api/sessions` and `/api/sessions/<id>` are unreachable (with or without a forged `Origin`), the gateway port returns 404 for `/api/*` and 403 for another session's MCP, its own session's `tools/list` works, and the token is dead after the turn.

### Slack PR reviewer

A [Slack PR reviewer](slack-pr-reviewer.md#cli-agents) feeds its CLI untrusted pull request text, and the CLI needs no Locus MCP. Its main threat is a PR telling the CLI to read secrets under `HOME` and post them in the review, so its policy adds `isolateHome` to the usual one:

- **Linux:** `pasta … -T none … -- bwrap … --tmpfs $HOME [--tmpfs <LOCUS_HOME> if outside $HOME] --tmpfs /tmp --tmpfs $XDG_RUNTIME_DIR --ro-bind-try <install dirs> --bind-try <CLI login paths> --bind <workspace> <workspace>`. The home directory, `/tmp` and the runtime dir (ssh-agent, gpg-agent, keyring sockets) are empty tmpfs. Only the selected CLI's login paths are bound back read-write (`cliHomeAllowList`: `~/.claude` + `~/.claude.json` + `~/.config/claude`, `~/.codex` (or `$CODEX_HOME`), `~/.cursor` + `~/.config/cursor`, `~/.kiro` + `~/.local/share/kiro-cli`, a custom CLI's `~/.<name>` / `~/.config/<name>` / `~/.local/share/<name>` and `~/.gemini`). Its install, when under `HOME`, is bound back read-only (`cliInstallDirs`: the `PATH` entry's folder and where its symlinks lead, the npm package root for a Node script, and the same for `node`, which covers `~/.local/bin`, `~/.npm-global` and nvm). The workspace is the review's clone, or `completeOneShot`'s scratch folder with `cloneRepo` off.
- **macOS:** the Seatbelt profile denies `file-read*` / `file-write*` under `$HOME` and `<LOCUS_HOME>`, allows metadata reads on `$HOME` and the folders leading to each allowed path, allows the login paths (read-write) and install dirs (read-only) again, denies the secret paths and `<LOCUS_HOME>` once more, and allows the workspace last. `~/Library/Keychains` is allowed read-only, because Claude Code and Cursor keep their login in the Keychain.
- **Never bound back** (`CLI_SANDBOX_SECRET_HOME_PATHS`): `~/.ssh`, `~/.aws`, `~/.azure`, `~/.config/gcloud`, `~/.config/gh`, `~/.kube`, `~/.docker`, `~/.gnupg`, `~/.password-store`, `~/.local/share/keyrings`, `~/.netrc`, `~/.git-credentials`, `~/.npmrc`, `~/.pypirc`, `~/.pgpass`, `~/.vault-token`, `~/.terraform.d`. An allow-list entry that is one of these, contains one (`~/.config`), sits inside one, resolves to one through a symlink, or overlaps `<LOCUS_HOME>` is dropped. So is `$HOME` itself.
- **Network:** no host loopback port is forwarded (`-T none` on Linux, `localhost:*` denied on macOS) apart from `LOCUS_CLI_SANDBOX_ALLOW_PORTS`. Outbound egress stays for the provider. A loopback proxy that is not allowed fails the review with the same message as a session turn.
- **Env:** the reviewer already gives the CLI a scrubbed environment (`isolateEnv`: tokens, cloud prefixes, `SSH_AUTH_SOCK`, …), and the sandbox drops `LOCUS_*` secrets on top.
- **Fail closed:** with no working sandbox the review (or thread answer) fails before the CLI starts, with a message naming the missing package (`bubblewrap` / `passt`) and the opt-outs, and is not retried. `LOCUS_CLI_SANDBOX=off` runs reviewer CLIs unsandboxed too; `LOCUS_CLI_SANDBOX_NET=host` keeps the filesystem part.

What it does not stop: the CLI reads the clone, its own login folder (which holds its provider token) and everything outside `HOME` it could read before (`/etc`, `/opt`, other users' world-readable files), and it has outbound internet, so it can still send what it reads somewhere. A CLI login stored as a single file (`~/.claude.json`) is bind-mounted, so a CLI that replaces it with a rename instead of writing it in place gets `EBUSY`. On macOS `/tmp` is not hidden and the Keychain is reachable through `securityd`, which decides per item.

`packages/shared/src/cliSandboxHome.test.ts` checks the argv and profile (the HOME tmpfs, the binds, never a secret path), `apps/server/src/slack/reviewSandbox.test.ts` the reviewer's policy and refusals, and `slackReviewer.test.ts` that a review spawns through the sandbox and fails without retrying when none is available.

### VM sessions

A CLI on a local Linux or Windows VM session runs inside the guest, so the sandbox does not apply. It reaches Locus MCP through its SSH connection, which reverse-forwards the guest's `127.0.0.1:<bindPort>` to this machine. ssh connects from `127.0.0.1`, so a forward to the control plane would make the guest the local operator. The forward goes to the gateway port instead: `ssh -R <bindPort>:127.0.0.1:<gateway port>`. The guest's MCP configs (`writeGuestCliMcp`) and `LOCUS_GIT_MCP_URL` get `http://127.0.0.1:<bindPort>/mcp/sessions/<id>/<token>`, the gateway URL with the guest's port, and the token is revoked when the turn ends (`hostCliTurn.test.ts`, "local VM sessions"). A guest CLI that calls `/api/*` on that port gets the gateway's 404. If no gateway grant is available, nothing is forwarded.

Worker VM guests already work this way: `packages/worker/src/app.ts` forwards the guest's port to a per-turn loopback MCP proxy on the worker that serves only this session's `/mcp/sessions/<id>`, and relays calls to the control plane over the turn's stream. The unscoped `/mcp` returns 404 on the proxy, and the control plane (`dispatchWorkerCliMcp` in `apps/server/src/http/mcpRoutes.ts`) also refuses any relayed path other than the turn's own session, so a modified worker cannot reach the unscoped Locus MCP either. The worker API is not forwarded. Worker Docker CLIs reach the same proxy over the worker's loopback.

### Loopback proxies

If `HTTPS_PROXY`, `HTTP_PROXY`, or `ALL_PROXY` points at `127.0.0.1` / `localhost` / `::1`, the CLI could not reach it from its namespace and every provider call would fail. Forwarding it automatically would not be safe either: the CLI could ask the proxy to connect to `127.0.0.1:7420` for it. So the turn stops with a message instead. If the proxy refuses loopback targets, allow its port with `LOCUS_CLI_SANDBOX_ALLOW_PORTS=3128` (comma-separated). Proxies on another host need nothing.

### Fail closed

If no sandbox works (bwrap or, on the control plane, pasta missing; unprivileged user namespaces disabled; no `/dev/net/tun`; Locus running as root; Windows), the turn stops with a system message instead of running unsandboxed. On a worker the `cursor-cli` route answers `503` with the same reason, which the control plane shows as the turn's error; install bubblewrap **on the worker host**. Install `bubblewrap` and, on the control-plane machine, `passt` (Debian/Ubuntu: `apt install bubblewrap passt`; Fedora: `dnf install bubblewrap passt`). On Ubuntu 24.04+ both packages ship the AppArmor profiles that allow their user namespaces.

On the control plane, `LOCUS_CLI_SANDBOX_NET=host` keeps the filesystem sandbox but shares the host network, so the CLI can call the control plane on loopback again, including other sessions' transcripts.

### Settings

**Settings → Advanced → CLI agent sandbox** sets the same options on the control plane without restarting, for both Docker-session CLIs and Slack reviewers (`advanced.cliSandbox` in `config.json`):

| Setting | Same as |
| --- | --- |
| **Sandbox: Filesystem and network** (default) | nothing set |
| **Sandbox: Filesystem only** | `LOCUS_CLI_SANDBOX_NET=host` |
| **Sandbox: Off** | `LOCUS_CLI_SANDBOX=off` |
| **Allowed loopback ports** (`3128, 8080`) | `LOCUS_CLI_SANDBOX_ALLOW_PORTS=3128,8080` |

A `LOCUS_CLI_SANDBOX*` variable set when Locus starts overrides the matching setting. `locus-worker` does not read these settings; set its environment on the worker host.

To run Docker-session CLIs unsandboxed anyway, choose **Off** in Settings or start Locus with `LOCUS_CLI_SANDBOX=off`. That restores the old behaviour: the CLI can read everything the operator can, including other sessions and Locus config. The same variable on `locus-worker` turns off the worker sandbox; each process reads its own environment.

## Gaps

- **Other local services.** The network namespace blocks every TCP/UDP port on the host's loopback except the gateway, but the filesystem view still includes Unix sockets: `/var/run/docker.sock` (if the operator can use Docker, so can the CLI, and a container can mount `<LOCUS_HOME>`), the D-Bus session bus, `ssh-agent`. Locus' own sockets (for example a VM's `swtpm.sock`) live under `<LOCUS_HOME>` and are hidden.
- **Allowed ports and `LOCUS_CLI_SANDBOX_NET=host`.** A port in `LOCUS_CLI_SANDBOX_ALLOW_PORTS` is reachable from the sandbox. If it is a proxy that will connect to loopback, it reaches the control plane too. `LOCUS_CLI_SANDBOX_NET=host` reopens the control plane outright.
- **Control plane on the LAN.** If the bind host is not loopback, the sandbox can reach the host's LAN address like any other machine on the network. Non-loopback clients need the phone pairing token for `/api/*`.
- **Worker loopback.** A worker Docker guest's CLI keeps the worker's network. The worker API on its own port needs the bearer token, which the sandbox hides, but the CLI can still reach other loopback services on the worker.
- **The rest of the home directory.** On Docker sessions and workers, `~/.ssh`, `~/.aws`, and similar are still visible to the CLI, as they are to any CLI the operator runs by hand. Locus' own credential-path refusals apply to Locus tools only. The Slack reviewer hides them (above); sessions do not, because an agent working on your code usually needs your Git and cloud setup.
- **Windows.** No sandbox backend. Docker-session CLI turns fail closed unless `LOCUS_CLI_SANDBOX=off`.
- **Running the CLI in the container** would be the stronger boundary, but it needs the CLI binary and the operator's CLI login inside every container image. The VM paths already do this over SSH.
