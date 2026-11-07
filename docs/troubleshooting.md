# Troubleshooting

## Control plane is not running

The desktop, CLI, and phone shell all talk to `http://127.0.0.1:7420`.

```bash
npm run locus -- status
```

If that fails with “Cannot reach Locus”:

```bash
npm run locus -- serve
# or
npm run dev:server
```

Point the CLI at a non-default bind with `--api` or `LOCUS_URL` (not `--url` — that flag is for repo/worker URLs).

## Chat replies with “I heard: …”

No usable provider key is configured. Local servers (Ollama, loopback OpenCode) do not need a key but must be **enabled** in Settings → Providers. See [quickstart-ollama.md](quickstart-ollama.md).

## Brain / knowledge graph fails with `no such module: fts5`

Brain uses Node’s `node:sqlite` FTS5 module. Use **Node.js 22.22 or newer** (CI uses 22). Check `node -v`.

## Git tests hang or time out locally

Those tests isolate git from your global config (`commit.gpgsign`, aliases). If a test still times out, run it with `GIT_CONFIG_GLOBAL=/dev/null`.

## Guest did not become ready

Docker agents start with the turn. VM agents now auto-start too; if QEMU/media is missing, the chat note includes the underlying error. Start from the toolbar and send again, or switch the agent to Host.

## Queue is full

The composer queue holds 32 prompts (configurable in Settings → Advanced). Send, stop, or remove queued items.

## Image tag `locus/agent:0.1`

The Docker image tag is independent of the app semver (`0.10.x`). Rebuild with `npm run images` after Dockerfile changes.

## Windows opens a stack of terminal windows on each prompt

On Windows 11 the default terminal is Windows Terminal. Any host child process spawned without `CREATE_NO_WINDOW` (Node's `windowsHide: true`) becomes a real console window — `docker.exe`, `git.exe`, `ssh.exe`, `rg.exe`, MCP stdio servers, repo hooks. They cascade, steal focus, and with acrylic/Mica they can look like extra copies of the Locus window.

Locus hides those consoles. If windows still appear while a **Cursor CLI / Claude Code / Codex CLI / Kiro CLI** turn is running, they come from that CLI's own Shell/grep children, which Locus cannot mark hidden. Update that CLI, or use a native provider for that chat.

Host Chrome and QEMU display windows are headed on purpose.
