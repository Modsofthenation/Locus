export const CLI_NAME = "locus";

export const HELP_ROOT = `Locus CLI — same control plane as the desktop app (loopback HTTP).

Usage:
  locus [--api URL] [--json] <command> [args]

Start / status:
  locus serve              Start the control plane (same as npm run dev:server)
  locus status             Health, hypervisor, Docker, setup
  locus setup              First-run / QEMU setup status
  locus setup install-qemu Install QEMU via the host package manager
  locus ui                 Print the UI URL if the server is serving the desktop build
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
  locus agent workers merge <id> <workerId>
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
  locus repo merge <id> <number>
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

Automations:
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
  locus config git oauth start <forgeId>
  locus config phone enable
  locus config chrome enable
  locus config funnel enable
  locus config theme ember
  locus config workers add 'locus-worker:add?url=…'
  locus config reset --confirm RESET`,
  debug: `JSONL traces under ~/.locus/traces, plus audit exports.

  locus debug logs
  locus debug log <kind> <key>
  locus debug eval <kind> <key>
  locus debug egress <session>
  locus debug approvals [session]
`,
};
