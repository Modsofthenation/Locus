export const CLI_NAME = "locus";

export const HELP_ROOT = `Locus CLI — same control plane as the desktop app (loopback HTTP).

Usage:
  locus [--api URL] [--json] <command> [args]

Start / status:
  locus serve              Start the control plane (same as npm run dev:server)
  locus status             Health, hypervisor, Docker, setup
  locus setup              First-run / QEMU setup status
  locus setup install-qemu Install QEMU via the host package manager
  locus ui                 Print a browser sign-in URL if the server serves the desktop build
  locus events             Stream hub WebSocket events
  locus completion bash|zsh|fish
  locus version            Print CLI version

Agents (coding chats):
  locus agent list [--kind agent|design|game|assets|review] [--archived]
  locus agent get <id>
  locus agent new [prompt] [--title] [--runtime docker|vm|host] [--os] [--kind]
                   [--provider] [--model] [--repo id]... [--recipe] [--host-dir]
                   [--image] [--docker-image] [--autonomy] [--network]
                   [--vision] [--placement] [--worker] [--live-chrome] [--no-start] [--plan]
                   [--bypass-gate test-gate|pre-tool-use-hooks|force-push|recursive-delete]...
  locus agent chat <id> [message] [--steer] [--plan] [--skill] [--wait] [--timeout] [--stream] [--notify]
  locus agent queue send <id> <itemId> [--timeout] [--stream]
  locus agent abort <id>
  locus agent approve <id> <toolCallId> [--answer] [--always]
  locus agent deny <id> <toolCallId>
  locus agent rewind <id> [--checkpoint]
  locus agent clear <id>
  locus agent checkpoint-diff <id> <checkpointId>
  locus agent memory <id> [list|add TEXT|forget <memoryId>]
  locus agent fork <id>
  locus agent duplicate <id>
  locus agent takeover <id>
  locus agent handback <id>
  locus agent browser-takeover <id>
  locus agent browser-handback <id>
  locus agent undo <id>
  locus agent save-environment <id> --name NAME
  locus agent delete <id>
  locus agent pin|unpin|archive|unarchive <id>
  locus agent rename <id> <title>
  locus agent workers spawn <id> [--count] [--prompt]
  locus agent workers diff <id>
  locus agent workers merge <id> <workerId> [--approve-risk]
  locus agent role cycle <id>
  locus agent promote <id> [--scaffold vite-react|static|next|astro]
  locus agent canvas <id> [--canvas <canvasId>]
  locus agent preview <id>
  locus agent workspace tree <id> [path]
  locus agent workspace cat <id> <path>
  locus agent workspace write <id> <path> [--file FILE | --text]
  locus agent workspace grep|search|mkdir|git <id>
  locus agent tool <id> <name> [--arg key=value]...
  locus agent vm start|stop|pause|resume|logs <id>
  locus agent transcript <id>

IDE:
  locus ide new [--dir PATH] [--title] [--repo] [--provider] [--model]

Design:
  locus design list|new|get|canvas|comment|promote|fork
  locus design variant list|create|activate|rename|delete
  locus design systems list|create|import|get|delete|default

Games:
  locus game list|new|get|canvas|comment|promote|fork|link|assets|play-link|generate
  locus game styles list|create|save|delete|default

Assets:
  locus asset list|new|get|canvas|comment|promote|fork|pack
  locus asset styles list|create|save|delete|default

Codebase:
  locus repo list|get|link|import|refresh|delete|patch
  locus repo pulls <id> [--state open|draft|all] [--fresh]
  locus repo pull <id> <number>
  locus repo comment <id> <number> --body TEXT [--path] [--line] [--side]
  locus repo review <id> <number> --body TEXT [--event COMMENT|APPROVE|REQUEST_CHANGES]
  locus repo merge <id> <number> [--approve-risk]
  locus repo agent <id> [--reuse|--new] [--prompt]
  locus repo setup <id>
  locus repo fix-session <id> <number>
  locus repo review-session <id> <number>
  locus repo stack <id> <number>

Slack:
  locus slack status|login|logout|channels|history|replies|send|react|gif|ask|star|unstar

Grafana:
  locus grafana status|dashboards|get|query

Docker:
  locus docker list|get|start|stop|restart|stop-many|logs|stats|swarm

Projects:
  locus project list|new|get|chat|pause|unpause|keep|unkeep|delete|duplicate|context|mission

Board:
  locus board list|new|get|delete|duplicate|chat|run|export

Brain:
  locus brain status|build|search|remember|inbox|correct|setup

Jobs:
  locus automation list|get|new|patch|enable|disable|delete|run|runs|clone|test-webhook

Workflows:
  locus workflow list|templates|add|import|show|delete|run|resume|runs

Config / Settings:
  locus config show
  locus config providers|provider test|provider models
  locus config mcp|skills|git|workers|phone|chrome|funnel|theme
  locus config policy
  locus config revoke-all --confirm REVOKE
  locus config reset --confirm RESET
  locus config telemetry [enable --endpoint URL …|disable|test]
  locus config budget [--daily-usd N] [--daily-tokens N]

Team controls:
  locus audit verify [--local] [--dir path]          Exit 1 at the first broken record
  locus audit export [--since 7d|YYYY-MM-DD] [--format jsonl|csv] [--out file]
  locus budget [status]                              Today's spend vs daily caps
  locus budget set --daily-usd N [--daily-tokens N] [--automation id|--project id]
  locus budget override --reason "…" [--scope global|automation|project] [--id]
  locus ci run [--recipe pr-reviewer|repo-fixer] [--prompt] [--repo path|url] [--pr URL]
               [--runtime host|docker] [--model] [--max-usd] [--allow rule]… [--out result.json]
               [--post-comment] [--no-auto-deny] [--timeout s]   Exit 0/1/2/3

Backup / updates:
  locus backup [file.locusbak] [--include-disks]     Encrypted copy of ~/.locus
  locus restore <file.locusbak> --yes [--inspect]   Applies at the next start
  locus restore status|cancel
  locus update [download]                            Check GitHub releases

Model benchmark (alias: locus eval):
  locus bench run --model provider/model[,…] [--case id,…] [--suite dir] [--repeat N] [--wait]
  locus bench cases|list|show <run>|cancel <run>|history|compare <a> <b>
  locus bench mine <repo> [--since date] [--limit N] [--out dir] [--dry-run]

Images / debug:
  locus image list|capture|delete|fetch|fetch-virtio
  locus debug logs|log|eval|egress|approvals

Ids may be a unique prefix or title. Most commands talk to http://127.0.0.1:7420
(or --api / LOCUS_URL / bindPort in ~/.locus/config.json). --json prints machine output.

See docs/cli.md for the full reference. Desktop-only: live VNC, canvas click-to-comment UI,
theme chrome, and the command palette. Board, project, and workspace HTTP surfaces have CLI
commands; clicking a canvas stays in the app.`;

export function helpFor(path: string[]): string {
  const key = path.join(" ");
  return HELP_TOPICS[key] ?? HELP_ROOT;
}

const HELP_TOPICS: Record<string, string> = {
  audit: `Tamper-evident audit log (~/.locus/audit/audit-YYYY-MM-DD.jsonl, sha256 hash chain).

  locus audit verify [--local] [--dir path] [--json]
      Exit 0 when every record hashes and links; exit 1 and print the first broken record.
      Uses the running control plane, or reads the files directly with --local / --dir
      (also when the control plane is not running).
  locus audit export [--since 7d|24h|YYYY-MM-DD|ISO] [--format jsonl|csv] [--out file]

Records: approvals and denials (including Always allow), blocked actions, git_push / git_pr /
merge results, policy and budget changes, budget stops and overrides, credential and
integration changes. Values of secrets are never written.`,
  budget: `Server-enforced daily caps (local calendar day).

  locus budget [status]
  locus budget set --daily-usd 25 [--daily-tokens 2000000]
  locus budget set --automation <id> --daily-usd 5
  locus budget set --project <id> --daily-tokens 500000
  locus budget set --daily-usd 0                      Clear the global USD cap
  locus budget override --reason "release day" [--scope global|automation|project] [--id]

A turn checks the caps before its first model call and between rounds. When a cap is hit the
agent posts "Budget reached: …", sets Needs you, and stops. Overrides last until local midnight
and are written to the audit log.`,
  ci: `Headless CI run. Exit codes: 0 pass · 1 fail · 2 stopped waiting for approval · 3 error.

  locus ci run --recipe pr-reviewer --pr https://github.com/acme/web/pull/42 --out result.json
  locus ci run --recipe repo-fixer --repo . --runtime host --allow "git_push(branch:locus/*)"
  locus ci run --prompt "Bump lodash and run tests" --repo https://github.com/acme/web --max-usd 2

  --api URL          Use this control plane (else reuse a running one, else start an ephemeral one)
  --ephemeral        Always start a fresh control plane (LOCUS_HOME in a temp dir unless --home)
  --allow RULE       Approve matching tool calls (param syntax: git_push(branch:locus/*)); repeatable
  --no-auto-deny     Stop with exit 2 at the first approval instead of denying it
  --post-comment     Post the review verdict on the PR (review recipes)
  --out FILE         Write { outcome, verdict, reasons, risk, costUsd, tokens, tests, sessionId }
  --timeout SECONDS  Default 1800

An ephemeral plane reads ANTHROPIC_API_KEY / OPENAI_API_KEY and GITHUB_TOKEN from the
environment. See docs/ci.md.`,
  serve: `Start the Locus control plane on loopback (default port 7420).

  locus serve

This is the same process as \`npm run dev:server\`. Leave it running, then use
other \`locus\` commands in another terminal. If the desktop app is already
open, you do not need to start a second server — point the CLI at it with
--api or LOCUS_URL.`,
  agent: HELP_ROOT,
  design: `Design canvases are Docker sessions (kind=design). HTML lives at /workspace/index.html.

  locus design new "Landing page for …" [--recipe landing-page|app-dashboard|slide-deck|one-pager|mobile-screen]
  locus design canvas <id>             Print the live HTML
  locus design comment <id> --selector ".hero" --text "Make this bigger" [--viewport desktop|tablet|phone]
  locus design fork <id>               Duplicate the canvas session
  locus design promote <id> [--scaffold vite-react|static|next|astro]
  locus design systems list
  locus design systems get <id>`,
  game: `Games canvases are Docker sessions (kind=game). HTML lives at /workspace/index.html.

  locus game new "Arcade dodge with a score" [--recipe arcade|platformer|puzzle|card-table|arena|match-3|trivia|tower-defense|racing|maze|juice|hold-move|mobile-touch|speedrun|roguelike|endless-drive] [--style id]
  locus game canvas <id>             Print the live HTML
  locus game comment <id> --selector "canvas" --text "Make hit flash stronger"
  locus game fork <id>               Duplicate the canvas session
  locus game promote <id> [--scaffold canvas-vite|three-vite|phaser|static]
  locus game link <id> <assetId>     Copy an Assets chat pack into vendor/assets
  locus game assets <id>             List linked @asset refs
  locus game play-link <id>          Mint a static/LAN play URL
  locus game generate <id> sprite|sheet|mesh|sfx
  locus game styles list
  locus game styles create --name "Neon tile" [--summary] [--guidelines]
  locus game styles save <sessionId> [--name]
  locus game styles delete <id>
  locus game styles default <id>`,
  asset: `Assets canvases are Docker sessions (kind=assets). HTML lives at /workspace/index.html.

  locus asset new "Hero from a photo" [--recipe image-to-3d|text-to-3d|cutout|sprite-sheet|voxel|low-poly|rig|walk-cycle|hold|attacks|pbr] [--style id] [--topology high-detail|smart] [--quality standard|flagship] [--resolution standard|2x|4x] [--rest-pose a-pose|t-pose|custom] [--poly-budget 2k|8k|20k] [--split] [--multi-view] [--printable] [--no-texture] [--no-enhance]
  locus asset canvas <id>             Print the live HTML
  locus asset comment <id> --selector "#rig" --text "Tighter silhouette"
  locus asset fork <id>               Duplicate the canvas session
  locus asset promote <id> [--scaffold three-vite|canvas-vite|static]
  locus asset pack <id>               Rebuild .locus-asset from source photos / exports
  locus asset styles list
  locus asset styles create --name "Clay hero" [--summary] [--guidelines]
  locus asset styles save <sessionId> [--name]
  locus asset styles delete <id>
  locus asset styles default <id>`,
  ide: `Host IDE workspaces (kind=ide, runtime=host). Opens a folder on this machine.

  locus ide new --dir ~/src/app
  locus ide new --dir ~/src/app --title app --repo <repo-id>
  locus agent new --kind ide --runtime host --host-dir ~/src/app --no-start
`,
  repo: `Linked GitHub / GitLab / Bitbucket repos (Codebase).

  locus repo link --url https://github.com/org/repo [--name] [--ref] [--account]
  locus repo pulls <id> [--state open|draft|all]
  locus repo review-session <id> 12
  locus repo fix-session <id> 12
  locus repo agent <id> --reuse
  locus repo setup <id>
  locus repo agent <id> --prompt "Fix the failing tests"`,
  slack: `Slack section. Reads and default sends use the signed-in user token.

  locus slack login [--client-id] [--client-secret]
  locus slack channels
  locus slack history C0123
  locus slack send C0123 "hello" [--as user|bot] [--thread ts]
  locus slack ask C0123 "summarize this thread" [--thread ts]

Existing Slack apps need docs/slack-app-manifest.yaml, a reinstall, and Sign in
again before --as bot works.`,
  grafana: `Grafana explorer. Uses the vaulted Settings → Integrations token.

  locus grafana status
  locus grafana dashboards [query]
  locus grafana get <uid> [--from now-1h] [--to now]
  locus grafana query <lucene> [--from now-1h] [--to now] [--datasource name] [--limit 25]

get queries live panel data (timeseries, stats, tables, logs) and prints a summary.
query runs the same Lucene path as the Grafana rail. Open the rail to see the histogram.`,
  docker: `Host Docker engine (not only Locus agents).

  locus docker list
  locus docker stop <id>
  locus docker stop-many <id> <id>
  locus docker logs <id> [--tail 200]
  locus docker stats <id>
  locus docker swarm status|nodes|services|stacks
  locus docker swarm get <service>
  locus docker swarm logs <service> [--tail 200]
  locus docker swarm scale <service> <n>`,
  "docker swarm": `Docker Swarm on this engine (not Locus Swarm teams, not Portainer).

  locus docker swarm status
  locus docker swarm nodes
  locus docker swarm services
  locus docker swarm stacks
  locus docker swarm get <service>
  locus docker swarm logs <service> [--tail 200]
  locus docker swarm scale <service> <n>`,
  project: `Body-of-work coordinators (More → Projects). The coordinator does not write code.

  locus project list
  locus project new "Migrate CSS to Tailwind" --starter migration
  locus project get <id>
  locus project chat <id> "spawn the auth slice"
  locus project pause <id>
  locus project unpause <id>
  locus project keep <id>
  locus project unkeep <id>
  locus project delete <id>
  locus project duplicate <id>
  locus project context <id>
  locus project mission <id>
`,
  brain: `Shared knowledge graph + distilled memory (More → Brain).

  locus brain status
  locus brain build [/path/to/repo]
  locus brain search "charge API"
  locus brain remember "we never bill from the worker"
  locus brain inbox
  locus brain correct --accept <id>
  locus brain correct --dismiss <id>
  locus brain correct --node <id> "wrong owner"
  locus brain setup [dir]

Coding agents orient on this automatically. Grep remains the source of truth for the tree.
\`locus brain setup\` writes personal Cursor, Claude Code, and Codex hooks that POST a transcript tail to loopback. Git exclude keeps those files uncommitted.
Agents flag bad claims with correct_graph; inbox Accept/Dismiss is the human gate.`,
  automation: `Unattended jobs (interval, daily, weekly, cron, adaptive, forge, pull_request, webhook).

  locus automation new --name "Nightly" --prompt "…" --schedule daily --hour 2 --minute 0 --timezone America/Los_Angeles
  locus automation run <id>
  locus automation run <id> --replay <runId>
  locus automation runs <id>
  locus automation clone <id>
  locus automation test-webhook <id>`,
  workflow: `Agent Loop Builder workflows saved in Locus. Runs use the session's tools.

  locus workflow templates
  locus workflow add locus-file
  locus workflow import ./research-agent.alb.json
  locus workflow run <id> --session <agent> --input '{"path":"/workspace/note.txt"}'
  locus workflow resume <id> --session <agent> --run <runId> --approve`,
  board: `Planning canvases (More → Board).

  locus board list
  locus board new "Sprint board" --starter kanban
  locus board get <id>
  locus board chat <id> "add a sticky for auth"
  locus board run <id> <frame-id>
  locus board export <id>
  locus board duplicate <id>
  locus board delete <id>
`,
  completion: `Print shell completion for bash, zsh, or fish.

  locus completion bash
  locus completion zsh
  locus completion fish
`,
  config: `Settings that the desktop stores in ~/.locus (redacted over the API).

  locus config show
  locus config policy
  locus config revoke-all --confirm REVOKE
  locus config provider test <id>
  locus config provider usage [id] [--refresh]
  locus config git oauth start <forgeId>
  locus config phone enable
  locus config chrome enable
  locus config funnel enable
  locus config theme ember
  locus config workers add 'locus-worker:add?url=…'
  locus config reset --confirm RESET`,
  backup: `Write an encrypted backup of ~/.locus (sessions, settings, vault, boards, projects, Brain).

  locus backup [file.locusbak] [--include-disks]

The passphrase comes from LOCUS_BACKUP_PASSPHRASE (or --passphrase-env NAME), or a hidden
prompt. Stored secrets travel inside the encrypted file and are re-encrypted with the target
machine's key on restore. VM disks and images are left out unless --include-disks.`,
  restore: `Restore a backup made by \`locus backup\` or Settings → Advanced.

  locus restore <file.locusbak> --inspect   Check the passphrase and show what is inside
  locus restore <file.locusbak> --yes       Stage it; quit and reopen Locus to apply
  locus restore status
  locus restore cancel

The swap happens at the next start, before anything loads. Current files move to
~/.locus/.before-restore-<time>/. This machine's master key stays in place.`,
  update: `Check GitHub Releases for a newer Locus.

  locus update             Show the latest release for this platform
  locus update download    Download the installer and verify it against SHA256SUMS

The desktop app checks at launch and every six hours unless Settings → About →
Check automatically is off. On a Linux AppImage, Install swaps the file and relaunches.`,
  bench: `Benchmark models on coding tasks as real Host agent turns, and track results over time.

  locus bench cases [--suite <dir|repo>]
  locus bench run --model openai/gpt-5 --model anthropic/claude-sonnet [--case fix-add,go-wordwrap]
                  [--suite <dir|repo>] [--repeat 3] [--timeout 10] [--wait]
  locus bench list
  locus bench show <run>
  locus bench cancel <run>
  locus bench history                  Pass rate / cost / time per model and harness version
  locus bench compare <before> <after> [--all]   Cases that flipped between two runs
  locus bench mine <repo> [--since "6 months ago"] [--limit 5] [--max-commits 500] [--ref main]
                  [--require-issue] [--test-command "npm test"] [--setup "npm ci" | --no-setup]
                  [--out <dir>] [--dry-run]

Built-in: small JavaScript toy cases plus TypeScript / Python / Go bug-fix fixtures (skipped
when the toolchain is missing). Spec cases check out the base commit with no history, run the
setup, send the issue text, then copy in the fix commit's test files and run testCommand: the
case passes when every fail-to-pass test passes, pass-to-pass tests stay green, and protected
paths were not edited. \`mine\` drafts verified specs from git history into
<repo>/.locus/benchmarks/ for review. Results: ~/.locus/benchmarks/. See docs/benchmarks.md.`,
  eval: `Alias of \`locus bench\` (run, cases, list, show, cancel). See \`locus bench --help\`.`,
  debug: `JSONL traces under ~/.locus/traces, plus audit exports.

  locus debug logs
  locus debug log <kind> <key>
  locus debug eval <kind> <key>
  locus debug egress <session>
  locus debug approvals [session]
`,
};
