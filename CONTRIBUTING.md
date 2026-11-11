# Contributing

Thanks for trying Locus. This tree is a Node workspaces monorepo (`apps/*`, `packages/*`). Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

- Node.js 22.22+ (Brain FTS5 needs `node:sqlite`; GitHub Actions uses 22.22)
- npm 10+ (comes with Node)
- Optional: QEMU + `qemu-img` for real VMs; Docker CLI for real containers. Without them the mocks still run the UI

```bash
npm install
npm run dev
```

- UI: http://127.0.0.1:5173
- Control plane: http://127.0.0.1:7420 (`GET /api/health`)
- CLI: `npm run locus -- help` (package `apps/cli`; [docs/cli.md](docs/cli.md))

`npm run dev:app` opens the same UI in Electron.

## Checks

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

Visual regression (Chromium, Linux baselines in `apps/desktop/e2e`):

```bash
npx playwright install chromium
npm run test:visual
```

After an intentional UI change, recapture screenshots with `npm run test:visual:update`. CI Linux is the source of truth. Harness-backed README shots (New agent, New automation) copy with `npm run capture:readme`. Playwright also runs axe on confirm, prompt, feedback, empty-hero, shortcuts, and chat, plus phone-sized shots of confirm / prompt / toast / feedback / shortcuts. Visual runs with `prefers-reduced-motion: reduce`.

CI on `main` and pull requests runs those plus `npm run test:visual`, `npm run build --workspace=@locus/desktop`, a Docker image build, and `cd apps/android && ./gradlew assembleDebug`. When Docker is available, tests include a real container write/patch/commit eval. Installers are **Package Linux / macOS / Windows**; they also publish to a GitHub Release when you push a `v*` tag. **Actions → Package from main → Run workflow** builds all three platforms from current `main` and uploads artifacts without publishing a release. Only the Linux job sets `generate_release_notes: true` so the three parallel packagers do not concatenate the changelog.

Please run those four checks before you open a PR. Target `main`.

First agent without Docker: Settings → Providers (Ollama needs no key) then New agent → Host. Guide: [docs/quickstart-ollama.md](docs/quickstart-ollama.md). If something fails: [docs/troubleshooting.md](docs/troubleshooting.md).

## Releases

After merge to `main`:

```bash
git tag v0.20.0
git push origin v0.20.0
```

GitHub Releases are the distribution channel (`v*` tags). Pushing a `v*` tag publishes Linux, macOS, and Windows installers, then **Prune GitHub Releases** deletes older published releases so only the last three remain (git tags are kept). See [docs/public-release.md](docs/public-release.md) for listing settings this tree cannot change (visibility, vulnerability reporting, unsigned macOS/Windows). Keep the repository description as the README tagline and topics `ai-agents`, `qemu`, `docker`, `computer-use`, `electron`, `local-first`.

## Layout

This is a Node workspaces monorepo (`apps/*`, `packages/*`). Full map: [docs/architecture.md](docs/architecture.md). Package READMEs sit next to each `package.json`.

| Path | Role |
|------|------|
| `apps/desktop` | Vite + React UI, Electron shell, installers |
| `apps/cli` | Terminal client for the loopback API |
| `apps/server` | Hono API, WebSocket hub, session/automation services |
| `apps/android` | WebView around the phone shell |
| `packages/shared` | Types and pure helpers |
| `packages/hypervisor` | QEMU + Docker + mocks |
| `packages/providers` | Chat streaming and the native agent loop |
| `packages/guest-agent` | Guest tool commands and SSH/WinRM |
| `packages/alb` | Agent Loop Builder workflow runtime |
| `packages/worker` | LAN Docker/Host worker (`npm run dev:worker`) |
| `packages/compute` | Fargate placement |
| `images/agent` | First-party Docker image (`locus/agent:0.1`) |
| `docs/` | Operator guides ([docs/README.md](docs/README.md)) |

Put new server modules in the matching `apps/server/src/<domain>/` folder (session, workspace, git, slack, …). Put new desktop UI in the matching `apps/desktop/src/components/<feature>/` folder. Renderer imports use `@/` (for example `@/lib/api`).

## Notes

- Do not commit `~/.locus`, ISOs, qcow2 disks, API keys, or forge tokens.
- Guest tools must stay on the guest. MCP is the exception: stdio servers run on the host, are opt-in in Settings, and wait for chat approval.
- Bind host must remain loopback; tests cover non-local `Origin` rejection.
- Prefer a failing test in `apps/server` or `packages/shared` when you change control-plane behavior.
- Session state lives in `~/.locus/sessions/<id>.json`. A legacy `sessions.json` is migrated on boot.
