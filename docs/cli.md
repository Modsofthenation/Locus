# Locus CLI

The desktop app is a UI on the **same loopback control plane** (`http://127.0.0.1:7420`). The CLI is another client of that API: agents, design canvases, games, assets, IDE, Codebase, Slack, Docker, automations, workflows, and Settings.

It does not replace the desktop. Live VNC, canvas click-to-comment, the theme chrome, and the command palette stay in the app. Most control-plane actions have a CLI command (agents, design, boards, projects, Codebase, Slack, Docker, automations, workflows, Settings). Canvas clicking and live VNC stay in the desktop.

## Install

From a clone (Node 22.22+):

```bash
npm install
npm run locus -- help
```

That runs `apps/cli` through the workspace bin `locus`. After `npm install`, `npx locus` also works from the repo root.

```bash
npx locus status
npx locus agent list
```

Override the control plane URL with `--api` or `LOCUS_URL`. If unset, the CLI reads `bindHost` / `bindPort` from `~/.locus/config.json` (and still uses `127.0.0.1` when the server listens on `0.0.0.0` for phone remote). `LOCUS_HOME` is the same data directory the server uses.

## Start the control plane

The CLI talks to a running server. Start one of:

| How | When |
| --- | --- |
| `locus serve` | CLI-only. Same process as `npm run dev:server`. Foreground. |
| `npm run dev` | Desktop UI on 5173 plus control plane on 7420. CLI attaches. |
| Packaged desktop app | Already listening on 7420. CLI attaches. |

```bash
# terminal 1
npx locus serve

# terminal 2
npx locus status
npx locus agent list
```

If 7420 is already up, `locus serve` prints that and exits 0. Do not start a second server against the same `~/.locus`.

## Global flags

```
locus [--api URL] [--json] [--help] [--version] <command>
```

- `--json` prints the API payload instead of a table.
- Ids may be a unique **prefix** or a unique **title** / channel name (`sess-aaa`, `#eng`, `Nightly`).

Exit codes: `0` ok, `1` usage or API error, `2` a tool call is waiting for Approve / Deny.

## Command map (desktop → CLI)

| Desktop | CLI |
| --- | --- |
| New agent | `locus agent new [prompt] --runtime docker\|vm\|host` |
| Chat / Steer / Plan | `locus agent chat <id> "…" [--steer] [--plan] [--wait] [--notify <sessionId>]` |
| Send a queued prompt now | `locus agent queue send <id> <itemId>` |
| Approve / Deny | `locus agent approve <id> <toolCallId>` / `deny` |
| Stop turn | `locus agent abort <id>` |
| Undo / fork / clear / takeover / handback | `locus agent undo\|fork\|clear\|takeover\|handback <id>` |
| Duplicate a chat / design / game / asset | `locus agent\|design\|game\|asset fork <id>` |
| Workers | `locus agent workers spawn\|diff\|merge` |
| Agent memory | `locus agent memory <id> [list\|add\|forget]` |
| Checkpoint diff | `locus agent checkpoint-diff <id> <checkpointId>` |
| Design empty-state recipes | `locus design new "…" --recipe landing-page` |
| Agent canvas HTML | `locus agent canvas <id> [--canvas <canvasId>]` |
| Canvas HTML | `locus design canvas <id>` |
| Comment on a selector | `locus design comment <id> --selector ".hero" --text "…"` |
| Promote to agent | `locus design promote <id> --scaffold vite-react` |
| Game empty-state recipes | `locus game new "…" --recipe arcade` |
| Game canvas HTML | `locus game canvas <id>` |
| Asset empty-state recipes | `locus asset new "…" --recipe image-to-3d` |
| Asset styles | `locus asset styles list` |
| Asset canvas HTML | `locus asset canvas <id>` |
| Codebase repos / PRs | `locus repo …` |
| Continue last agent | `locus repo agent <id> --reuse` |
| Open product | `locus repo agent <id> --reuse` (starts from the repo named environment when none is live) |
| Setup environment | `locus repo setup <id>` |
| Save as environment | `locus agent save-environment <id> --name NAME` |
| Fix with agent | `locus repo fix-session <id> <number>` |
| Slack section | `locus slack …` |
| Grafana dashboards / logs | `locus grafana status\|dashboards\|get\|query` |
| Docker sidebar | `locus docker …` (`swarm` for this engine's Swarm) |
| Duplicate a board or project | `locus board duplicate <id>` / `locus project duplicate <id>` |
| Projects | `locus project …` |
| Brain | `locus brain status\|build|search|remember|inbox|correct` |
| Automations | `locus automation …` |
| Workflows | `locus workflow templates\|add\|import\|run\|resume` |
| Open folder in IDE | `locus ide new [--dir PATH]` |
| Settings | `locus config …` (`workers add` pastes the worker add line) |
| Phone remote | `locus config phone enable\|disable\|rotate` |
| Chrome extension | `locus config chrome enable\|disable\|rotate` |
| Tailscale Funnel | `locus config funnel enable\|disable` |
| Golden images | `locus image capture\|list\|delete` |
| View trace | `locus debug logs` / `locus debug log <kind> <key>` |
| Egress / approvals audit | `locus debug egress <id>` / `locus debug approvals [id]` |
| Managed policy | `locus config policy` |
| Revoke integration tokens | `locus config revoke-all --confirm REVOKE` |

Shortcuts: `locus ls`, `locus new`, `locus chat <id> …`, `locus session …`, `locus codebase …`, `locus auto …`.

## Agents

```bash
npx locus agent recipes
npx locus agent new "Fix the failing tests" --runtime docker
npx locus agent new "Book the flight" --runtime host --live-chrome
npx locus agent new --recipe repo-fixer --repo <repoId>
npx locus agent new "Cross-repo change" --runtime docker --repo <appId> --repo <libId>
npx locus agent list
npx locus agent get sess-aaa
npx locus agent chat sess-aaa "look at src/checkout.ts"
npx locus agent chat sess-aaa --steer "stop, try grep first"
npx locus agent approve sess-aaa tc_01abc
npx locus agent deny sess-aaa tc_01abc
npx locus agent abort sess-aaa
npx locus agent transcript sess-aaa
npx locus agent canvas sess-aaa
npx locus agent canvas sess-aaa --canvas billing-review
npx locus agent workspace tree sess-aaa
npx locus agent workspace cat sess-aaa README.md
npx locus agent workspace write sess-aaa notes.md --text "operator note"
npx locus agent workspace grep sess-aaa "TODO"
npx locus agent workspace git sess-aaa
npx locus agent tool sess-aaa exec --arg command=ls --arg cwd=/tmp
npx locus agent vm start sess-aaa
npx locus agent pin sess-aaa
npx locus agent delete sess-aaa
```

`agent new` fills provider/model/template from Settings (first enabled provider, template matching `--os`). Docker sessions default to image `locus/agent`; `--runtime vm` / `host` omit `dockerImage` unless you pass `--docker-image`. `--no-start` creates the session without booting the guest.

`--autonomy guided|supervised|autonomous` matches the desktop. `--network open|restricted|none`. `--placement worker --worker <id>` sends Docker agents to a Settings → Workers host. Repeat `--repo` to clone several linked repos into `/workspace/<name>` (first is primary).

`agent chat` returns immediately after queueing the turn (async / fire-and-forget) so Swarm coordinators can keep directing work. Pass `--wait` to block until the turn is idle, errors, or needs approval (default 600s, `--timeout` seconds). With `--wait`, pass `--stream` to print tokens as they arrive; if approval is needed it prints the `approve` / `deny` lines and exits 2. Pass `--notify <sessionId>` so the peer's done / needs_you / failure wakes that session asynchronously (also used by Swarm `team_message`).

Takeover still needs the desktop (or phone remote) to drive VNC / Chromium. The CLI only flips the control bit.

`agent canvas` prints the latest HTML canvas a coding or review chat built beside the thread. `--canvas` picks one by id or title. That canvas is not `/workspace/index.html` (Design, Games, and Assets use `design|game|asset canvas`).

## Design

```bash
npx locus design new "Landing page for a local agent product" --recipe landing-page
npx locus design canvas <id> > /tmp/canvas.html
npx locus design comment <id> --selector "h1" --text "Make the headline shorter" --viewport desktop
npx locus design variant create <id> --name "Dark"
npx locus design variant activate <id> <variantId>
npx locus design promote <id> --scaffold vite-react
npx locus design systems list
npx locus design systems get <id>
npx locus design systems import --file tokens.json
```

Design sessions always run Docker (`locus/design`). `--recipe` is `landing-page`, `app-dashboard`, `slide-deck`, `one-pager`, or `mobile-screen`.

## Games

```bash
npx locus game new "Arcade dodge with a score" --recipe arcade
npx locus game new "Neon crawl" --recipe roguelike --style <style-id>
npx locus game canvas <id> > /tmp/game.html
npx locus game comment <id> --selector "canvas" --text "Stronger hit flash"
npx locus game generate <id> sprite
npx locus game play-link <id>
npx locus game styles save <id> --name "Neon tile"
npx locus game promote <id> --scaffold canvas-vite
```

Game sessions use the same canvas as Design (`/workspace/index.html`) with a playable-game playbook. `--recipe` is `arcade`, `platformer`, `puzzle`, `card-table`, `arena`, `match-3`, `trivia`, `tower-defense`, `racing`, `maze`, `juice`, `hold-move`, `mobile-touch`, `speedrun`, `roguelike`, or `endless-drive`. `--style` binds a saved game style. Promote scaffolds are `canvas-vite`, `three-vite`, `phaser`, or `static`. Saved looks: `locus game styles list|create|save|delete|default`. `locus game generate` starts an Assets turn (or an SFX bank on the game) and links the pack. `locus game play-link` mints a static/LAN share URL.

## Assets

```bash
npx locus asset new "Hero from a photo" --recipe image-to-3d
npx locus asset styles save <id> --name "Clay hero"
npx locus asset new "Fox" --style <style-id>
npx locus asset new "Print swan" --topology high-detail --quality flagship --resolution 4x --rest-pose a-pose --printable
npx locus asset canvas <id> > /tmp/asset.html
npx locus asset comment <id> --selector "#rig" --text "Tighter silhouette"
npx locus asset promote <id> --scaffold three-vite
```

Asset sessions use the same canvas as Design (`/workspace/index.html`) with an image-to-3D / rig playbook. `--recipe` is `image-to-3d`, `text-to-3d`, `cutout`, `sprite-sheet`, `voxel`, `low-poly`, `rig`, `walk-cycle`, `hold`, `attacks`, or `pbr`. Generation knobs: `--topology high-detail|smart`, `--quality standard|flagship`, `--resolution standard|2x|4x`, `--rest-pose a-pose|t-pose|custom`, `--poly-budget 2k|8k|20k`, `--split`, `--multi-view`, `--printable`, `--no-texture`, `--no-enhance`. Promote scaffolds are `three-vite`, `canvas-vite`, or `static`. Saved looks: `locus asset styles list|create|save|delete|default` and `locus asset new --style <id>`.

## Codebase

```bash
npx locus repo link --url https://github.com/org/repo
npx locus repo import
npx locus repo list
npx locus repo pulls <id> --state open
npx locus repo pull <id> 12
npx locus repo comment <id> 12 --body "nit: name this" --path src/a.ts --line 40
npx locus repo review <id> 12 --body "lgtm" --event APPROVE
npx locus repo merge <id> 12
npx locus repo agent <id> --prompt "fix CI"
npx locus repo agent <id> --reuse
npx locus repo setup <id>
npx locus repo review-session <id> 12
npx locus repo fix-session <id> 12
npx locus repo stack <id> 12
```

`locus repo agent --reuse` continues the live coding agent for that repo. `--new` (the default) always creates a new chat. `locus repo setup` runs the Setup environment recipe (install, start, verify, write `.locus/environment.json`). `fix-session` implements the reviewer findings on the PR branch.

```bash
npx locus agent memory <id>
npx locus agent memory <id> add "Default branch is main"
npx locus agent memory <id> forget m1
npx locus agent checkpoint-diff <id> <checkpointId>
npx locus agent clear <id>
npx locus agent save-environment <id> --name acme-prod
```

Coding Docker/host chats persist `remember` facts in `.locus/memories.json`. Checkpoint diffs include the unified patch from the hidden git refs. `locus agent clear` drops the transcript and model context and keeps linked repos plus the guest.

Forge OAuth is `locus config git oauth start <forgeId>` (opens the same loopback callback as the desktop). Tokens stay in `~/.locus/secrets.enc`.

## Slack

Reads and default sends use the **user** token (as you). Bot posting is opt-in.

```bash
npx locus slack login
npx locus slack status
npx locus slack channels
npx locus slack history eng
npx locus slack send eng "shipped" --as user
npx locus slack send eng "nightly report" --as bot
npx locus slack react C012 1710000000.000200 +1
npx locus slack ask eng "summarize the last hour" --thread 1710000000.000100
npx locus slack logout
```

Existing Slack apps: paste `docs/slack-app-manifest.yaml` into api.slack.com, reinstall, then `locus slack login` again so OAuth stores the bot `xoxb-` token. `--as bot` needs that token. Private channels still need `@Locus` invited; the CLI never joins as the bot.

## Grafana

Uses the vaulted Settings → Integrations token. `get` queries live panels.

```bash
npx locus grafana status
npx locus grafana dashboards
npx locus grafana dashboards checkout
npx locus grafana get check --from now-6h
npx locus grafana query "logger.level:error" --from now-6h
```

`slack login` prints an authorize URL. Open it in a browser; the redirect hits `http://127.0.0.1:7420/api/oauth/callback` on the running server.

## Docker / automations / config

```bash
npx locus docker list
npx locus docker logs <containerId> --tail 200
npx locus docker stop-many id1 id2
npx locus docker swarm status
npx locus docker swarm services
npx locus docker swarm scale web 3

npx locus project list
npx locus project new "Migrate CSS to Tailwind" --starter migration
npx locus project chat <id> "spawn the auth slice"
npx locus project pause <id>
npx locus project keep <id>
npx locus project unkeep <id>
npx locus project context <id>
npx locus project mission <id>
npx locus project delete <id>

npx locus board list
npx locus board new "Sprint" --starter kanban
npx locus board chat <id> "add a sticky"
npx locus board export <id>

npx locus brain status
npx locus brain setup .
npx locus brain build ~/src/app
npx locus brain search "charge API"
npx locus brain remember "we never bill from the worker"
npx locus brain inbox
npx locus brain correct --accept <id>

npx locus automation new --name Nightly --prompt "run tests" --schedule daily --hour 2
npx locus automation new --name Busy --prompt "…" --schedule adaptive --start 09:00 --end 17:00 --every 60 --otherwise 180
npx locus automation run <id>
npx locus automation runs <id>
npx locus automation clone <id>
npx locus automation test-webhook <id>

npx locus workflow templates
npx locus workflow add locus-file
npx locus workflow import ./research-agent.alb.json
npx locus workflow run <id> --session <agent> --input '{"path":"/workspace/note.txt"}'
npx locus workflow resume <id> --session <agent> --run <runId> --approve

npx locus ide new --dir ~/src/app

npx locus config show
npx locus config providers
npx locus config provider test <id>
npx locus config mcp
npx locus config skills
npx locus config git
npx locus config workers add 'locus-worker:add?url=…'
npx locus config phone enable
npx locus config chrome enable
npx locus config funnel enable
npx locus config theme ember
npx locus config policy
npx locus config revoke-all --confirm REVOKE
npx locus config reset --confirm RESET
npx locus debug egress <session>
npx locus debug approvals
```

Schedule kinds: `interval` (`--every` minutes), `daily`, `weekly` (`--weekday` 0–6), `cron --cron "0 2 * * *"`, `adaptive`, `forge`, `pull_request`, `webhook`. `--reuse` and `--persist-memory` match the desktop checkboxes. Overlap is `--overlap skip|coalesce|queue`.

`config reset --confirm RESET` is the same wipe as Settings → Advanced → Reset all data.

## Workflows

Agent Loop Builder graphs saved under `~/.locus/workflows`. A run uses the target session's tools (files, shell, git, browser, integrations, MCP) and still waits for Approve / Deny. Coding chats can also call `list_workflows` / `run_workflow` / `resume_workflow`.

```bash
npx locus workflow templates
npx locus workflow add locus-agent
npx locus workflow import ./research-agent.alb.json
npx locus workflow list
npx locus workflow show <id>
npx locus workflow run <id> --session <agent> --input '{"path":"/workspace/README.md"}'
npx locus workflow resume <id> --session <agent> --run <runId> --approve
npx locus workflow runs <id>
npx locus workflow delete <id>
```

`templates` lists Locus-native graphs (`locus-file`, `locus-agent`) plus ALB patterns (Research Agent, ReAct, Plan-and-Execute, Human-in-the-Loop, Magentic-One, Tree of Thoughts, and the rest). `add` materializes one of those templates. `import` stores a `.alb.json` bundle. `run` needs a live coding session; a human gate pauses until `resume --approve` or `--deny`.

## Events and debug

```bash
npx locus events
npx locus completion bash
npx locus debug logs
npx locus debug egress <session>
npx locus debug approvals
npx locus debug log session <id>
npx locus debug eval session <id>
```

`events` streams the hub WebSocket (`session.updated`, `chat.delta`, `slack.message`, …). Ctrl+C stops. `--json` prints one JSON object per frame.

## What the CLI will not do

- Render the guest desktop (VNC / noVNC) or click the design canvas. Use the desktop or phone remote.
- Host a second copy of `~/.locus`. One data dir, one server.
- Bypass Approve / Deny, vault redaction, or the loopback bind. Same security model as [SECURITY.md](../SECURITY.md).
- Publish port 7420. Phone remote is still an opt-in LAN pairing token.

## Development

```bash
npm test --workspace=@locus/cli
npm run typecheck --workspace=@locus/cli
```

Package: `apps/cli`. It depends on `@locus/shared` and calls the Hono API in `apps/server`. No extra daemon.
