<img src="apps/desktop/public/logo.svg" width="72" height="72" alt="Locus">

# Locus

**Local coding agents on your machine.**

Locus is a desktop control plane for AI coding agents that run on hardware you own — a Docker container, a QEMU virtual machine, or a folder on disk. Chat on one side, the live guest on the other. Code, keys, sessions, and disks stay under `~/.locus`.

This is **v0.18.0** (MIT). The API binds to loopback. Linux, macOS, and Windows. Bring any LLM provider you have a key for.

## Install

Download the latest [GitHub Release](https://github.com/Modsofthenation/Locus/releases). Each `v*` tag attaches:

- Linux AppImage, deb, and rpm
- macOS dmg (signed when `CSC_LINK` is set on the repo; otherwise unsigned — right-click → Open the first time)
- Windows NSIS installer (unsigned builds show SmartScreen)
- Per-platform checksums (`SHA256SUMS-linux`, `SHA256SUMS-macos`, `SHA256SUMS-windows`)

The listing keeps the **last three** published releases. Verify with `sha256sum -c SHA256SUMS-linux` (or `Get-FileHash` on Windows). QEMU, Docker, OVMF/swtpm, and guest ISOs still come from the host. GitHub Releases are the distribution channel.

## How it works

```
You chat  →  Locus control plane  →  Guest executes
             loopback API            files, git, browser,
             encrypted vault         shell, desktop
             approval gates
```

You describe a task. Locus runs the agent in a guest you own. Review diffs, steer mid-turn, take over a VM desktop or Docker Chromium, or pair a phone on the LAN.

| Runtime | What it is | When |
|---------|------------|------|
| **Host** | Edits a folder on this disk (a path you pick, or a private per-session folder). Isolated Chromium under `~/.locus/host-chrome`, or **Use my Chrome** for the tabs already open on this machine. | Trusted local work. A deliberate security exception. No VM desktop or VNC. |
| **Docker** | `locus/agent` with git, Node, Chromium, and code-server. Linux containers. A Windows 11/10 desktop is a VM. | Isolated daily coding. Fastest path to a container agent. |
| **Virtual machine** | Full desktop via QEMU — Ubuntu, Debian, Omarchy, or Windows. | GUI and installer QA. Screenshot, mouse, keyboard, window tools. |

The runtime is chosen per agent and stays fixed. New agents default to Docker when the engine is present, otherwise Host.

**Where** defaults to this machine. Docker, VM, and Host are shapes of a guest; placement is which computer runs it. Other LAN machines running `npm run dev:worker` can host **Docker, Host, or QEMU VM** agents — paste the printed `locus-worker:add` line in Settings → Workers (or `locus config workers add`), then New agent → Where. Worker VMs resolve cloud images from `LOCUS_WORKER_HOME/media`; live VNC is proxied to the laptop over pinned WSS (the worker still binds VNC to localhost). Golden VM disks upload to the worker once. Azure and GCP workers use the same recorded-HTTP placement as Fargate. Locus does not scan the LAN. Each app only lists workers it registered. Two apps can share one worker, or run isolated workers on the same host with different `LOCUS_WORKER_PORT` and `LOCUS_WORKER_HOME` — [docs/agent-backends.md](docs/agent-backends.md#multiple-locus-apps-one-worker-host). Cursor Cloud is a provider that skips the guest, not a placement.

## Tour

The icon rail is **Agents, Design, IDE, Codebase, Automations**, then **More** for Games, Assets, Board, Projects, Brain, Slack, Grafana, and Docker. Settings is a full page. Developer / Swarm lives in Appearance (and the command palette) — Developer is this control plane; Swarm hides the rail and is teammate-first (Teammates, Teams, Routines).

### Setup

First-run wizard: provider key, then Developer or Swarm. Docker and QEMU sit under **Set up later**. **Skip for now** leaves a one-line Finish setup hint until you Continue or Dismiss it. The command palette **Finish setup** reopens the wizard.

![Set up Locus wizard](docs/screenshots/setup_wizard.png)

### Agents

New agent is a full-page composer: Docker / VM / Host, a private folder or a folder you open, a repo (defaults to **No repo**; several linked remotes clone side by side under `/workspace/<name>`, then the repo is locked), then **More options** for image, jail, spend, named environment, and recipes. Recipes are **PR reviewer**, **Installer QA** (Windows VM), **Repo fixer**, **Setup environment** (install, start, verify, write `.locus/environment.json`), **Web QA** (headed Chromium), and **Ops loop** (Grafana, Jira, Confluence, Linear, Slack, incident.io, AWS IAM, Portainer, Kubernetes, Sentry). Sidebar overflow **Duplicate** forks the workspace into a new empty chat. Missing Docker or QEMU is a blocking callout — **Use Host instead**, or Finish setup.

Chat sits on the left. The guest sits on the right (Docker opens on **Files**; Host uses the same editor on `/workspace`). `.html` has a Browser preview, `.md` / `.svg` open in Preview, and `.pdf` renders inline. A listening HTTP port stacks **Preview** under Files. Host agents also get a **Browser** tab on the isolated Chrome profile. A coding or review agent can `canvas_write` a self-contained HTML report on a **Canvas** tab, separate from the repo and from Design's canvas.

Consecutive reads, searches, and commands collapse into one summary (`Explored 8 files, 4 searches, ran 1 command`). Expand the row for the per-call chips. Edits, questions, sub-agents, and pending approvals stay on their own rows.

Ask an agent to **subscribe** to a Slack channel or thread, a GitHub/GitLab/Bitbucket/Gitea/Forgejo/Azure DevOps pull request, a Linear/Jira/Sentry/incident.io issue, a Grafana alert, or a timer. A Listening card stays in the chat, and Agent settings lists every live subscription. The Agents rail surfaces **Needs you** when a chat is waiting on Approve / Deny. **Compare models** and **Replay** sit on those rows. Name a golden image, or export the chat as HTML or PDF, from the agent menu. Multi-file `apply_patch` / `git_diff` cards open the Change Stack walkthrough. A `Locus.md` at the repo root loads ahead of `AGENTS.md`, `CLAUDE.md`, and `.locus/rules`.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/new_agent.png" alt="New agent"><br>New agent</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/agents_workspace.png" alt="Agent workspace with collapsed tool activity"><br>Workspace</td>
</tr>
<tr>
<td align="center" valign="top" colspan="2"><img src="docs/screenshots/agent_settings.png" alt="Agent settings"><br>Agent settings</td>
</tr>
</table>

### Design

Composer first, then **Or start from** pills (Landing page, App dashboard, Slide deck, One-pager, Mobile screen). A linked repo on create is **read-only design context** — the agent reads UI and tokens and does not commit or open PRs. Chat plus a live HTML canvas (Desktop / Tablet / Phone, Comment, Export, **Promote to agent**). **Save variant** snapshots the live HTML; **Design systems** reuse a named palette across canvases (`locus design variant` / `locus design systems`). Promote writes `DESIGN.md` into a Vite + React, Next.js, Astro, or static scaffold. The Design sidebar shows a preview of each canvas. **Where** can be a LAN worker — the canvas is still `/workspace/index.html` on that bind-mount. Thin briefs get a short questionnaire before the first canvas.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/design_empty.png" alt="Design empty state"><br>Empty</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/design_workspace.png" alt="Design workspace"><br>Canvas</td>
</tr>
<tr>
<td align="center" valign="top" colspan="2"><img src="docs/screenshots/design_settings.png" alt="Design settings"><br>Settings</td>
</tr>
</table>

### Games

A rail next to Design for **playable web games**. Same live `/workspace/index.html` canvas, chat, Comment, Export, and **Promote to agent**. Starters (Arcade, Platformer, Grid puzzle, Cards, Twin-stick, Match-3, Trivia, Tower defense, Racing, Maze, Juice, Hold-to-move, Mobile touch, Speedrun, Roguelike, Endless drive) require a real game loop, input, and a win/lose or score on the first draft. New game also has 2D / 3D and Hotseat chips, plus remixable one-sentence prompts (Vegas match-3, Saloon match-3, Recycle drop, City siege, Deep maze, Trivia night).

Operator chrome includes Play mode, feel sliders and presets, Playtest, Fix from playtest, iterate chips (Soften / Crunch / Juice / Teach / Fail-state / Balance), Apply brief, Keep feel, reset/pause, mute/clear-save, audio unlock, a control legend with last keys and a replay tape, landscape aspect lock, touch sticks, gamepad, debug HUD, pop-out, an Unlisted play link with a phone QR and a per-token scoreboard, generate sprite/sheet/mesh/SFX, a seed slider, Explore 3 loops, Export zip (PWA + itch), and a 15s Record. Grow this into a project promotes to a Vite, Three.js, Phaser, or static scaffold. The Studio panel pins the tape as a moment, pins named builds, and edits rooms, waves, and the deck. A one-page `GDD.md`, living `GAME.md`, content JSON (`rooms.json` / `waves.json` / `deck.json`), and `.locus-game/last-run.json` ground the next turn. **Game styles** save tile, HUD, and juice. Asset kits (pixel / Three.js / Phaser / SFX) land under `vendor/`. Promote writes `GAME.md` and a Vite canvas, Three.js, Phaser, or static scaffold. Scores persist in `localStorage` key `locus-game`. Phone **More → Games** lists those canvases.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/games_empty.png" alt="New game"><br>New game</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/games_workspace.png" alt="Games canvas"><br>Canvas</td>
</tr>
</table>

### Assets

A rail next to Games for **2D sprites and rigged 3D models**. Same live canvas, chat, Comment, Export, and **Promote to agent**. Starters are Image to 3D, Text to 3D, Cutout, Sprite sheet, Voxel, Low poly, Rig, Walk cycle, Hold, Attacks, and PBR. Drop a front, side, and back photo, or describe a prop.

Operator chrome includes Orbit, Wireframe, clip Play (idle / walk / jump / pickup / carry / attack, plus heavy and ranged variants), pose sliders and presets, **Build** (High detail / Smart topology, Flagship quality, Ultra 2x/4x, A-Pose / T-Pose, texture, split, multi-view, enhance, printability), a topology / faces / verts / printability overlay, iterate chips (Retopo / Texture / Rig / Animate / Low poly / Split / Printability), Apply brief, Apply build, Keep pose, Export zip / PNG / GLB, and Explore 3 directions. A living `ASSET.md` grounds the next turn. **Asset styles** save silhouette, materials, and palette. Kits land under `vendor/`. The agent writes the studio HTML locally. Phone **More → Assets** lists those studios.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/assets_empty.png" alt="New asset"><br>New asset</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/assets_workspace.png" alt="Assets studio"><br>Studio</td>
</tr>
</table>

### IDE

Host workspaces live in the **IDE** rail. Open a folder on this machine, or clone a linked GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps repo. Chat sits on the right (collapse it to a rail). The Files editor is the main pane: markdown and SVG preview, minimap, wrap, split editors (`Ctrl/Cmd+\` or explorer **Open to the side**), `Ctrl/Cmd+Shift+K` inline AI, Go to file (`Ctrl/Cmd+P`), workspace symbols (`Ctrl/Cmd+T`), Search (`Ctrl/Cmd+Shift+F`), and a workspace terminal. The explorer includes a **Containers** section so you can inspect, stop, or restart host Docker containers.

Type `@file` in the composer to rank that path in the repo map. TypeScript gets auto-import, Quick Fix, Go to Type Definition / Implementation, and workspace Problems (**Fix with agent**, **Run test**). Python uses `pylsp` with the project virtualenv. Completions also route to `gopls`, `rust-analyzer`, and `jdtls` when those binaries are on PATH. The status-bar Debug pane can Launch / Continue / Step / Stop for Node and Python on Host and local Docker. Worker and VM sessions can Launch against the laptop mirror. The Git tab can branch, merge, discard, stash, stage hunks, rebase, resolve conflicts, and open a PR. Codebase **Open PR in IDE** checks out the PR head and paints review comments in the gutter. Phone **More** lists those workspaces as **Open on desktop**.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/ide_empty.png" alt="IDE start"><br>Start</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/ide_workspace.png" alt="IDE workspace"><br>Workspace</td>
</tr>
</table>

### Automations

Interval, daily, weekly, cron, **Adaptive (by time of day)**, **On git push**, **On pull request**, or **On webhook** (Slack or any HTTP POST). Pick a named environment so overnight jobs reuse that machine. Jobs can store an IANA timezone, blackout dates, and a lifetime spend cap. Overlap can **Skip if busy**, **Run latest when free**, or **Queue one**. Optional **Remember facts between runs**. The card shows last run, last fact, and next fire. Docker, VM, or **Host**. Codebase can auto-review new pull requests. CLI and operator notes: [docs/webhook-automations.md](docs/webhook-automations.md).

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/automations_empty.png" alt="Automation job"><br>Job</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/new_automation.png" alt="New automation"><br>New job</td>
</tr>
<tr>
<td align="center" valign="top" colspan="2"><img src="docs/screenshots/new_automation_webhook.png" alt="New webhook automation"><br>Webhook</td>
</tr>
</table>

### Board

A local planning canvas. Infinite pan/zoom, stickies and sticky stacks, frames, shapes and connectors, tables, timelines, freehand ink, Mermaid (M), comments, and live cards that cite agents, designs, PRs, Slack, files, automations, Jira, or Linear. Start from Architecture, Sprint, **Kanban**, Retro, RCA, Research, or Blank. J / K walks frames; Tab spawns a mind-map child. Select stickies and **Cluster** (`board_cluster`) to group them by shared words into labeled frames. Optional board chat runs on the host with `board_*` tools. Connect Miro in Settings → Integrations to copy boards either way (`miro_list` / `miro_get` / `miro_import` / `miro_export`). Connect Figma to read a file from board or Design chat. **Run** on a frame starts a coding agent, Design canvas, or `/plan`, then pins a live card back on that frame. **Pin /plan onto frame** lays the checklist onto that frame. A Jira or Linear card can **draft a brain briefing** and post it from Approve. Export JSON, PNG, or PDF from the board menu. Phone **More → Boards** opens the same canvases.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/board_empty.png" alt="Board empty state"><br>Empty</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/board_workspace.png" alt="Kanban board"><br>Kanban</td>
</tr>
</table>

### Projects

A body of work with a coordinator, shared context, and members. The coordinator plans and delegates. Members are normal agent, review, or design sessions that share the project's context files. Starters are Feature, Migration, Gardening, and Blank. Fleet columns track Needs you, Working, In review, Ready to merge, and Done. **Keep running** leaves the control plane up after you quit, so subscriptions and fleet wake keep ticking. A member pull request that newly fails or gains a comment wakes one fix member; green CI flags Needs you and leaves merge behind Approve. Pin a Board, and let the coordinator subscribe to Slack, a pull request, or a timer.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/projects_empty.png" alt="New project"><br>New project</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/projects_workspace.png" alt="Project workspace"><br>Workspace</td>
</tr>
</table>

### Codebase

Linked GitHub, GitLab, and Bitbucket repos (tokens or **Sign in with GitHub / GitLab / Bitbucket** in Settings → Git). Repo home, PR conversation / files / **Stack**, issues, comments, merge, **Open PR in IDE**, and review sessions. **Continue** reopens the live coding agent for that repo. **Fix with agent** implements reviewer findings on the PR branch. **Review with agent** starts a new review chat. The Stack tab opens on a pre-merge overview (failing checks, comments, conflicts) before the first layer. **Architecture** reads a Host or Docker checkout in Repo, Feature, and Code sections, suggests behaviour-preserving improvements, and can hand the ones that still hold to an agent. See [docs/codebase.md](docs/codebase.md).

![Codebase](docs/screenshots/codebase_empty.png)

### Brain

A local knowledge graph plus distilled memory (`~/.locus/brain`). Index a repo folder to learn services, APIs, and decisions. Coding agents call `orient`, `search_knowledge`, `find_entity`, and `remember`. `brain_brief` drafts a short Jira or Linear comment from owning service, file:line evidence, and decisions, and posts it only after Approve. `correct_graph` queues a human inbox — Accept contradicts the memory and lowers confidence. Graph, Memories, Inbox, and Activity sit on the same pane. `locus brain setup` writes personal Cursor, Claude Code, and Codex hooks that POST a redacted transcript tail to loopback; the distiller is the only writer (pinned to an allowed provider when a managed policy is active; otherwise the first enabled non-CLI provider, or local heuristics). Slack/Jira corpus ingest stays off until you enable it in Settings.

![Brain](docs/screenshots/brain_empty.png)

### Slack

A local Slack client on the icon rail. Sign in as yourself in Settings → Integrations (OAuth or a pasted user token). Read as you; send as you by default, or **as Locus** when a bot token is stored. Opening a channel marks it read. Edit or delete your own messages, mention someone with `@`, and resize a thread from its left edge. **Open in Slack** jumps to Slack.app. HTML, CSV, video, and PDF files preview inline. **Ask Locus** runs a local agent against a thread; recipe shortcuts start Review, Design, or Ops with that thread attached. **Catch me up** summarizes the channel locally. **Listen** pins a channel or thread onto an agent. Pending `slack_post` drafts edit in the thread before Send. File, PR, and session cites jump into Locus. Slack.com stays Slack. Operator notes: [docs/slack.md](docs/slack.md).

![Slack](docs/screenshots/slack_empty.png)

### Grafana

Settings → Integrations stores a Grafana API key or service account token. The Grafana rail lists dashboards by folder and tag, pins boards, and opens them **in the pane**: live timeseries, stats, tables, logs, and text, with template variables, firing alerts, annotation markers, and a time range you can type. A logs panel can jump back into Lucene Explore. Explore shows the histogram, stack traces linked into a checkout at a file and line, a Tempo or Jaeger span list, an AI brief, and **Investigate** from a log query or a panel (an Ops loop agent). Agents still get `grafana_query`, `grafana_search`, and `grafana_get`. CLI: `locus grafana status|dashboards|get|query`. The frame below is the rail before a token is saved, because dashboards appear only after that token is stored. Setup: [docs/grafana.md](docs/grafana.md).

![Grafana explorer](docs/screenshots/grafana_empty.png)

### Docker

The **Docker** sidebar lists every container on this engine. Running / stopped / exited groups, a detail pane with Logs / Inspect / Stats / Files, and bulk stop/restart. Locus agents stay linked. Check running rows and **Stop selected**, or use the command palette to stop the running set. The IDE explorer lists the same containers.

**Swarm** on that rail lists nodes and services when this engine is in Docker Swarm mode (service logs and scale on a manager). That is the local Docker engine. Locus Swarm (the teammate shell) and the Portainer integration are separate. Agents get `docker_swarm`. CLI: `locus docker swarm`. Setup: [docs/docker-swarm.md](docs/docker-swarm.md).

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/docker_empty.png" alt="Docker containers"><br>Containers</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/docker_workspace.png" alt="Docker Swarm"><br>Swarm</td>
</tr>
</table>

### Command palette

`Ctrl/Cmd+K` opens the command palette. In the files editor, `Ctrl/Cmd+Shift+K` opens inline AI. Type `?` in the palette for the keyboard cheat sheet.

![Command palette](docs/screenshots/command_palette.png)

### Settings

Grouped as **Models** (Providers, MCP, Skills), **Workspace** (Machines, Workers, Environments, Git, Integrations), and **System** (Appearance, Notifications, Phone, Advanced, About). The page can find a provider, MCP server, skill, worker, environment, Git account, or integration by name.

Git includes **Sign in with GitHub** / **Sign in with GitLab** / **Sign in with Bitbucket**. MCP defaults to deferred tool schemas (**Preload tool schemas** per server). HTTP MCP to an AWS API Gateway signs SigV4 when AWS keys are in that server's env. Traces live on the agent or design ⋯ menu → **View trace**.

Settings → Phone mints a LAN pairing token (QR on that tab). Settings → Workers lists LAN / Cloud VM / Fargate hosts. Settings → Environments lists named boxes saved from New agent or Automations. Settings → Notifications toggles desktop alerts and quiet hours. Settings → Appearance filters themes and sets editor font size, format on save, and the minimap. Settings → Advanced **Tailscale Funnel** exposes **only** `/api/hooks` (never the whole control plane) so GitHub can reach forge webhooks; `locus config funnel enable|disable`.

Integrations: Slack, Grafana, Jira, Confluence, Linear, Miro, Figma, incident.io, AWS IAM, Portainer, Kubernetes, Sentry, Gmail, Google Calendar, Google Drive, and agent-authored HTTP plugins. Settings → About is **0.18.0**.

<table>
<tr>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/settings_providers.png" alt="Providers"><br>Providers</td>
<td align="center" valign="top" width="50%"><img src="docs/screenshots/settings_mcp.png" alt="MCP"><br>MCP</td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/settings_skills.png" alt="Skills"><br>Skills</td>
<td align="center" valign="top"><img src="docs/screenshots/settings_machines.png" alt="Machines"><br>Machines</td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/settings_workers.png" alt="Workers"><br>Workers</td>
<td align="center" valign="top"><img src="docs/screenshots/settings_environments.png" alt="Environments"><br>Environments</td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/settings_git.png" alt="Git"><br>Git</td>
<td align="center" valign="top"><img src="docs/screenshots/settings_integrations.png" alt="Integrations"><br>Integrations</td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/settings_appearance.png" alt="Appearance"><br>Appearance</td>
<td align="center" valign="top"><img src="docs/screenshots/settings_notifications.png" alt="Notifications"><br>Notifications</td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/settings_phone.png" alt="Phone"><br>Phone</td>
<td align="center" valign="top"><img src="docs/screenshots/settings_advanced.png" alt="Advanced"><br>Advanced</td>
</tr>
<tr>
<td align="center" valign="top" colspan="2"><img src="docs/screenshots/settings_about.png" alt="About"><br>About</td>
</tr>
</table>

### Phone

Settings → Phone mints a LAN pairing token. The pairing URL, `?shell=mobile`, and the Android app (`apps/android`) open a thumb-first shell. Tabs: **Agents**, **Design**, **Code**, **Slack**, **Needs you**, **More**.

Agents is a reverse-chronological list with status dots, All / Needs you / Running / Unseen chips, and search. Comment on a canvas, Promote it into an agent, reply to a pull, walk the Change Stack, merge, and Approve / Deny. The phone can watch or take over Docker Chromium for logins. **More** lists Games, Assets, Boards, Projects, Grafana explorer, Automations (pause / enable), IDE workspaces (Open on desktop), notifications, theme, and desktop-only items (Live VNC, Settings, New automation, command palette, Find in chat). VNC stays on the desktop. Operator notes: [docs/phone.md](docs/phone.md).

<table>
<tr>
<td align="center" valign="top" width="20%"><img src="docs/screenshots/mobile_agents.png" alt="Phone Agents"><br>Agents</td>
<td align="center" valign="top" width="20%"><img src="docs/screenshots/mobile_new_chat.png" alt="Phone new chat"><br>New chat</td>
<td align="center" valign="top" width="20%"><img src="docs/screenshots/mobile_chat.png" alt="Phone thread"><br>Thread</td>
<td align="center" valign="top" width="20%"><img src="docs/screenshots/mobile_design.png" alt="Phone Design"><br>Design</td>
<td align="center" valign="top" width="20%"><img src="docs/screenshots/mobile_design_canvas.png" alt="Phone canvas"><br>Canvas</td>
</tr>
<tr>
<td align="center" valign="top"><img src="docs/screenshots/mobile_games.png" alt="Phone game"><br>Game</td>
<td align="center" valign="top"><img src="docs/screenshots/mobile_code.png" alt="Phone Code"><br>Code</td>
<td align="center" valign="top"><img src="docs/screenshots/mobile_slack.png" alt="Phone Slack"><br>Slack</td>
<td align="center" valign="top"><img src="docs/screenshots/mobile_inbox.png" alt="Phone Needs you"><br>Needs you</td>
<td align="center" valign="top"><img src="docs/screenshots/mobile_more.png" alt="Phone More"><br>More</td>
</tr>
<tr>
<td align="center" valign="top" width="20%"><img src="docs/screenshots/mobile_board.png" alt="Phone Boards"><br>Boards</td>
</tr>
</table>

### Swarm

Developer / Swarm in the sidebar switches the product shell. Developer keeps the icon rail. Swarm is a teammate-first messenger: the rail is hidden, Agents become **Teammates**, Projects become **Teams**, Automations become **Routines**. Chat sits in the middle; the right pane is that teammate's **Computer** (Status / Preview / Takeover). New teammate picks a name, avatar, role, and personality. Coordinators call `team_roster`, `team_peer_status`, `team_add_teammate`, and `team_message`; `team_directory` / `team_handoff` move work across named teams. Settings shrinks to Providers, Appearance, Notifications, Advanced, and About.

## While you work

**Workspace.** Chat while the guest boots. Queue follow-ups, **Send now** to interrupt the current turn, or **Steer** so the next model round sees the new instruction. Stop still aborts. Type `/` for takeover, handback, undo, fork, **clear**, workers, record, vision, **websearch**, **plan**, **roles**, and custom **skills**. `/plan` may read the repo, then lands a proposed plan; **Accept** / **Run** executes it. `/roles` cycles planner → implementer → reviewer. `/clear` drops the transcript and model context and keeps linked repos. Composer **⋯** repeats Plan / Web / Vision / Record / Roles / Undo / Fork / Clear. Workers snapshot `/workspace` on `locus/worker-N` and can **merge into parent**. Coding chats can `remember` short facts in `.locus/memories.json`. Paste an image or a clipboard chip into the composer — hover the chip to preview. Toggle **Vision** and **Web search** there. The Files tree shows `+`/`−` on files the agent changed, with **All / Updated**. A listening HTTP port stacks live **Preview** under Files.

**Workflows.** Agent Loop Builder graphs run inside a coding chat. `list_workflows` / `run_workflow` / `resume_workflow` use that session's tools (still gated). Import a `.alb.json` or add a template (`locus workflow templates|add|import|run|resume`). Templates include Research Agent, ReAct, Plan-and-Execute, Human-in-the-Loop, Magentic-One, Tree of Thoughts, plus Locus-native file-read and tool-agent graphs. Runs pause on human gates until you Approve. Saved under `~/.locus/workflows`. CLI: [docs/cli.md](docs/cli.md#workflows).

**Host peers.** A Host agent can list, read, grep, and copy files from other Locus chats on this machine — Games, Assets, Design, and other agents. Type `@game:` / `@asset:` / `@agent:` or ask it to look. Copy lands under `/workspace/peers/<slug>/`. Docker and VM agents stay isolated.

**MCP.** Settings → MCP lists stdio servers or an HTTP/SSE URL, with an optional tool allowlist. HTTP MCP to an AWS API Gateway signs SigV4 when AWS keys are in that server's env. Schemas stay deferred until the model calls `mcp_list_tools` unless you check **Preload tool schemas**. **Host** MCP runs on this machine. **Guest** MCP stdio runs inside the Docker container. Tool calls wait for Approve / Deny unless autonomy is **Autonomous**.

**Integrations.** Each connected account gives the agent host-side tools. Writes (send, create, update, apply, scale, comment) wait for Approve / Deny. Tokens stay in the vault.

| Integration | Tools | Guide |
|-------------|-------|-------|
| Slack | `slack_history`, `slack_replies`, `slack_post`, `slack_upload`, plus the Slack rail | [docs/slack.md](docs/slack.md) |
| Grafana | `grafana_query`, `grafana_search`, `grafana_get`, plus the in-pane explorer | [docs/grafana.md](docs/grafana.md) |
| Jira | search, get, create, update (including Epic Link) | Settings → Integrations |
| Confluence | CQL search, get, create, update, comment | [docs/confluence.md](docs/confluence.md) |
| Linear | search, get, create, update, comment | [docs/linear.md](docs/linear.md) |
| Miro | list, get, import, export (Board copy either way) | Settings → Integrations |
| Figma | list, get, images, comment | [docs/figma.md](docs/figma.md) |
| incident.io | search, get, create, update, comment | [docs/incidentio.md](docs/incidentio.md) |
| Sentry | projects, search, get, events, update | [docs/sentry.md](docs/sentry.md) |
| Portainer | endpoints, containers, inspect, logs, stacks, start/stop | [docs/portainer.md](docs/portainer.md) |
| Kubernetes | list, get, logs, events, apply, delete, scale | [docs/kubernetes.md](docs/kubernetes.md) |
| AWS IAM | STS identity, list, get, simulate. Optional PrivateLink / API Gateway | [docs/aws-iam.md](docs/aws-iam.md) |
| Google | Gmail, Calendar, Drive | [docs/google.md](docs/google.md) |
| Plugins | agent-authored HTTP APIs, `plugin_*` tools | [docs/integration-plugins.md](docs/integration-plugins.md) |

**CLI.** `npx locus` / `npm run locus --` is a loopback client for the same control plane: agents, design, games, assets, IDE, projects, Codebase, Brain, Slack, Grafana, Docker, automations, workflows, Settings, phone remote, and Funnel. `locus serve` starts the server when the app is not running. `locus project keep` leaves that control plane up after the desktop quits. `locus workflow` imports and runs Agent Loop Builder graphs. `locus brain setup` writes personal editor hooks that send a redacted transcript tail to the local brain. Live VNC and canvas clicking stay in the desktop. Guide: [docs/cli.md](docs/cli.md).

**App.** Ninety-seven themes (Ember default). Settings → About is **0.18.0**. Electron packages (Linux AppImage, macOS dmg, Windows NSIS), or `npm run dev` in the browser. **Ctrl/Cmd+K** command palette. **Ctrl/Cmd+N** new agent, new automation, or (on Design, Games, Assets) the empty composer. **Ctrl/Cmd+F** find in chat. **Ctrl/Cmd+,** settings.

## Security model

- **Encrypted vault.** Provider keys, forge tokens, and guest passwords in AES-256-GCM `secrets.enc`. Wrapped with OS keychain when available.
- **Loopback by default.** The control plane binds to `127.0.0.1`. Non-local origins are rejected. Settings → Phone is an opt-in LAN pairing token. Tailscale Funnel exposes only `/api/hooks`. Do not publish port 7420 to the internet.
- **Approval gates.** Push, PR, MCP tools, and package installs wait for Approve / Deny. Protected branches always stay gated. **Supervised** shows every mutating command.
- **Network jail.** Guests start **restricted** (forge + provider allowlist, logged CONNECT). Open and none remain selectable unless a managed policy locks the jail. VMs and Docker both support it.
- **Managed policy.** `/etc/locus/policy.json` or a signed `~/.locus/policy.json` allow-lists enterprise providers, pins Brain, forces sandboxing, and greys those Settings controls. [docs/managed-policy.md](docs/managed-policy.md).
- **Secrets stay out of prompts.** Keys are injected as env vars at guest runtime. `.env` and cloud credential files are blocked from `file_read`.
- **Untrusted input.** Webhooks, web search, MCP, and PR comments are wrapped in nonce-tagged data fences. Restricted-jail CONNECT allow/deny is traced as egress.

Details and how to report a vulnerability: [SECURITY.md](SECURITY.md).

## Quick start

Needs [Node.js](https://nodejs.org/) 22.22+ (Brain FTS5; CI uses 22.22).

```bash
git clone https://github.com/Modsofthenation/Locus.git
cd Locus
npm install
npm run dev
```

UI: http://127.0.0.1:5173 (proxies to the control plane on **7420**).

**CLI** (same API, no Electron):

```bash
npm run locus -- serve          # if the desktop is not already running
npm run locus -- agent list
npm run locus -- agent new "Fix the failing tests" --runtime docker
npm run locus -- help
```

`npx locus` works after `npm install`. Full command map: [docs/cli.md](docs/cli.md). Shell completion: `locus completion bash|zsh|fish`.

**First agent (no Docker).** Enable a provider in Settings (Ollama needs no key — [docs/quickstart-ollama.md](docs/quickstart-ollama.md)), then New agent → **Host** → Send. A **Demo reply** banner means no provider is ready. Setup defaults to Developer. More: [docs/troubleshooting.md](docs/troubleshooting.md).

Desktop window: `npm run dev:app`. Installable for this OS (`apps/desktop/dist-electron/`): `npm run dist`.

The package includes the UI and control plane. QEMU, OVMF/swtpm, Docker, and guest ISOs still come from the host. Pushing a `v*` tag runs **Package Linux / macOS / Windows** and attaches the artifacts to the GitHub Release. **Prune GitHub Releases** then keeps only the last three published releases.

Data: `~/.locus` (`config.json`, `secrets.enc`, `sessions/*.json`, VM disks, automations). Override with `LOCUS_HOME`. Settings → Advanced → **Reset all data** wipes that directory (two confirms) and returns you to first-run setup. Host QEMU/Docker installs stay.

Without QEMU or Docker on `PATH`, the UI still loads (mock hypervisor / mock engine). Create stays off until a real engine or **Host** is chosen.

## Docker runtime

Docker agents skip QEMU, ISOs, and VNC.

- **Linux containers.** Guest OS is Ubuntu/Debian-style. Windows 11/10 desktop guests are VM-only. The Locus app itself still runs on Linux, macOS, and Windows.
- **Image.** Default is `locus/agent` (built from `images/agent/Dockerfile` on first use: git, Node 22, Chromium/Xvfb, ffmpeg, code-server). Suggested tags: `locus/agent`, `ubuntu:24.04`, `debian:12-slim`, `python:3.12-bookworm`. Aliases `locus/node`, `locus/web-qa`, and `locus/design` build that image locally on first start (`npm run images` to prebuild).
- **Workspace.** The agent's cwd is `/workspace`. **Files** is the host editor on the bind-mounted workspace. When the real Docker CLI is present, a host folder can also be mounted read-only at `/mnt/host`.
- **Network.** Restricted by default (HTTP(S)_PROXY to the same allowlist proxy VMs use — on a worker the proxy runs on that host). Open is the default bridge; none is `--network none`.
- **Tools.** `exec`, files (`file_read`, `file_write`, `file_list`, `grep`, `glob`, `apply_patch`), `git_*`, `start_process`, `preview`, `playwright`, headed Chromium (`screenshot`, mouse, `key`, `browser_*`), and `record_screen` on `locus/agent`. Bind web apps to `0.0.0.0` so the right pane can proxy the port. Logins persist under `/workspace/.locus-chrome`.

Docker agents support undo, fork, workers (2–4 parallel containers from the same snapshot), golden workspace images, automations, and operator takeover of guest Chromium. A repo `.locus/environment.json` can list an `install` command, extra packages, ports, env, and a start command. `.locus/skills/*.md` and `.locus/memory.md` load into the agent.

## VM and host tools

**VM.** Screenshot, record, mouse, keyboard, type, clipboard, window, `exec`, files, git. Linux guests also get `a11y_tree`; Windows guests get `powershell` and `uia_tree`. After GUI actions Locus stores a screenshot and, when Vision is on, sends the latest image to the model. Live `playwright` click/fill/wait does the same.

**Host.** `file_read` / `file_write` / `file_list` / `apply_patch` stay inside the chosen tree; `exec` and git run on this machine (same security exception as host MCP). Headed Chrome defaults to an isolated profile under `~/.locus/host-chrome/<session>` (override with `LOCUS_CHROME`). Pair the unpacked extension in Settings → Chrome and turn on **Use my Chrome** on that Host agent to drive the tabs already open on this machine (cookies and logins included). Workers keep isolated Chromium. New agent **Where + Host** can also run a folder on a worker. Root, `$HOME`, secret home dirs, and the worker data directory are refused. See [docs/chrome-extension.md](docs/chrome-extension.md).

**Control.** Undo any of the last several turns. Scrub the guest-pane filmstrip to preview a screenshot or restore that checkpoint. Take over a VM desktop or a Docker/Host Chromium session, then hand it back. Fork a new agent from the current guest disk. **Compare models** forks that disk and replays the last prompt on a second model. **Replay** opens the screenshot timeline. An **artifact drawer** lists screenshots, recordings, patches, and PR links from the thread.

## Git

Clone a GitHub, GitLab, Bitbucket, Gitea, Forgejo, Azure DevOps, or generic git remote into the guest on boot. Pick several linked repos on New agent to clone them side by side under `/workspace/<name>`. Sign in with GitHub, GitLab, or Bitbucket in Settings → Git, or paste a PAT for Gitea, Forgejo, or Azure DevOps. `.devcontainer/devcontainer.json` maps onto `.locus/environment.json` install, start, ports, image, and env. Container engines can be Docker, Podman, or nerdctl (`LOCUS_CONTAINER_ENGINE`). Linux QEMU guests follow the host arch (`qemu-system-aarch64` + `virt` on arm64). Cursor / Claude / Codex / Kiro CLIs can run inside a Linux VM over SSH. GitHub uses device flow; GitLab and Bitbucket open a browser and return to `http://127.0.0.1:<port>/api/oauth/callback`. Each Sign in row needs an OAuth client ID (GitLab and Bitbucket also need the application secret), or set `LOCUS_GITHUB_OAUTH_CLIENT_ID` / `LOCUS_GITLAB_OAUTH_CLIENT_ID` / `LOCUS_BITBUCKET_OAUTH_CLIENT_ID`.

Commit, branch, stash, revert, push, open a PR (optional draft), post a `git_pr_review`, and list/get/comment issues (`git_issue_list` / `git_issue_get` / `git_issue_comment`). Push, PR, review, comment, merge, and issue comments wait for Approve / Deny. Protected branches (`main`/`master`) stay gated. Forge tokens stay in Settings and can be injected as `GIT_TOKEN` in the container.

## Host requirements

First-run setup detects the OS and offers **Install QEMU** when a package manager is available (`winget` / Chocolatey / Scoop, Homebrew, or apt / dnf / pacman / zypper). Same action: Settings → Advanced.

| Host    | Accelerator   | Extra for Windows 11   | One-click install           |
|---------|---------------|------------------------|-----------------------------|
| Linux   | KVM, else TCG | OVMF, swtpm            | apt / dnf / pacman / zypper |
| macOS   | HVF / TCG     | bundled QEMU firmware  | `brew install qemu`         |
| Windows | WHPX / TCG    | OVMF, swtpm            | `winget install` QEMU       |

Point each template at install media in Settings → Machines. **Fetch cloud image** downloads Ubuntu 24.04 or Debian 12 into `~/.locus/media`. **Fetch ISO** downloads Omarchy 4. The new-agent OS list only shows OSes with media configured.

- **Ubuntu live-server ISO** — autoinstall writes `disk.qcow2`, GNOME, OpenSSH, and the Linux computer-use packages.
- **Ubuntu or Debian cloud image** — backing file for `disk.qcow2`, cloud-init on the already-installed OS.
- **Omarchy 4 ISO** — unattended cidata install. Needs UEFI/OVMF.
- **Windows 11 / 10 ISO** — Autounattend, OpenSSH, WinRM, optional VirtIO. Windows 11 still needs OVMF and TPM 2.0.
- **Golden image** — **Save image** snapshots a running disk. New agents and forks can boot a copy.

VNC displays start at `:10` (TCP 5910). Guest network jail: open, restricted (forges + providers), or none. New installs generate a random guest password. Rotate it in Settings → Machines before the first VM boot. A host SSH key is generated at `~/.locus/ssh` and injected into cloud-init / unattend.

## Providers

Settings lists OpenCode Zen first (`https://opencode.ai/zen/v1`, default `big-pickle`), then OpenAI, Anthropic, Grok (xAI), DeepSeek, Cursor Cloud, Cursor CLI, Claude Code, Codex CLI, Kiro CLI, OpenRouter, Ollama (`http://127.0.0.1:11434/v1`), Gemini, Groq, Mistral, Together, Amazon Bedrock, Fireworks, and any OpenAI-compatible base URL.

Cursor Cloud launches or follows a [Cloud Agent](https://cursor.com/docs/cloud-agent/api/endpoints). The local Docker/VM guest is skipped. A linked **GitHub** repo is passed as `repos[]`.

Cursor CLI spawns [`agent -p`](https://cursor.com/docs/cli/headless) against the session workspace. The Locus tool loop is skipped. The composer **Web** toggle still applies. Docker, Host, and **worker** sessions work; VMs do not. **Steer** interrupts a running CLI process. The model picker can turn Fast on or off and set thinking / effort. Worker Cursor CLI sessions write `.cursor/mcp.json` to a loopback MCP proxy on the worker so Design, Games, Assets, review, and Grafana/Slack/Jira tools tunnel back to Locus.

Claude Code spawns [`claude -p`](https://code.claude.com/docs/en/headless) (print / headless mode, `stream-json`) against the session workspace. The Locus tool loop is skipped. The composer **Web** toggle still applies. Docker, Host, and **worker** sessions work; VMs do not. **Steer** interrupts a running CLI process. Enable it in Settings → Providers (`claude` on PATH, then `claude auth login` or a pasted key). Worker sessions write `.mcp.json` so Design, Games, Assets, review, and Grafana/Slack/Jira tools tunnel back to Locus.

Codex CLI spawns `codex exec --json` against the session workspace. The Locus tool loop is skipped. The composer **Web** toggle still applies. Docker, Host, and **worker** sessions work; VMs do not. **Steer** interrupts a running CLI process. Enable it in Settings → Providers (`codex` on PATH, then `codex login` or a pasted OpenAI key). Git, Design/Games/Assets `playwright`, and review `git_pr_*` go through a session `locus_git` MCP connection (credentials stay in the vault). Worker sessions rewrite that URL onto the worker-loopback MCP proxy. Follow-up turns resume the same Codex thread with `exec resume`.

Kiro CLI spawns [`kiro-cli chat --no-interactive`](https://kiro.dev/docs/cli/headless/) (`stream-json`) against the session workspace. The Locus tool loop is skipped. Docker, Host, and **worker** sessions work; VMs do not. **Steer** interrupts a running CLI process. Enable it in Settings → Providers (`kiro-cli` on PATH, then `kiro-cli login` or a pasted `KIRO_API_KEY`). Worker sessions write `.kiro/settings/mcp.json` so Design, Games, Assets, review, and Grafana/Slack/Jira tools tunnel back to Locus.

OpenCode Zen still needs a key from [opencode.ai/auth](https://opencode.ai/auth). Loopback OpenAI-compatible URLs (Ollama, local OpenCode) do not need a key. With no usable key, Locus uses a local mock stream and shows a **Demo reply** banner.

The model picker shows approximate published input/output prices (USD per 1M tokens). These are list-price estimates.

## Automations

Each automation has a **When** trigger, a **Then** prompt, guest OS, provider/model, optional repo, and optional golden image:

- interval (every N minutes)
- **adaptive** — every N minutes during a daily window, otherwise every M minutes
- daily at a local time
- weekly on a weekday at a local time
- **on git push** — `POST /api/hooks/automations/:id` with `X-Locus-Secret` or GitHub `X-Hub-Signature-256`. GitHub.com cannot reach loopback; expose **only** `/api/hooks` with Tailscale Funnel (Settings → Advanced) or poll the forge when a token is set
- **on pull request** — same URL. Codebase **Auto-review new pull requests** starts a dedicated review session for each new PR
- **on webhook** — same URL, no git repo. Slack URL verification (`challenge`) is answered automatically. A Slack incoming notify webhook receives the last assistant message as `text`

A run creates a Docker, VM, or **host** session (or reuses the last machine / chat), sends the prompt, and records the outcome. Overlap can skip if busy, run the latest event when free, or queue one. On webhook automations, MCP tools listed on the job skip chat approval. Without **Reuse the last chat**, each run opens a new thread; Locus keeps the newest 60 chats for that job.

## Guest network

| Jail | When | Effect |
|------|------|--------|
| **Open** | Default for ISO / cloud / empty workspace | Full user-net or Docker bridge. Needed for first-boot apt. |
| **Restricted** | Default when booting a golden image | VMs: QEMU `restrict=on` plus a host CONNECT proxy allowlisting GitHub, Bitbucket, and configured provider/forge hosts. Docker: the same proxy via `HTTP(S)_PROXY`. |
| **None** | Opt-in | VMs: `restrict=on`, no proxy. Docker: `--network none`. |

Override per agent in the new-agent flow or agent settings (applies on the next start). Restricted is not a guaranteed sandbox; see [SECURITY.md](SECURITY.md).

## Architecture

```
apps/desktop         Vite + React UI (Electron shell + installers)
apps/cli             Terminal client for the same loopback API (`npx locus`)
apps/server          Hono API + WebSocket hub
apps/android         WebView around the phone shell
packages/shared      Session, VM, Docker, provider, git, tool, automation types
packages/hypervisor  QEMU (KVM / WHPX / HVF / TCG) and Docker engines, with mock fallbacks
packages/providers   OpenAI-compatible + Anthropic streaming, Cursor / Claude / Codex / Kiro CLI
packages/guest-agent Linux/Windows tool catalog, SSH / WinRM, docker exec, git auth
packages/alb         Agent Loop Builder workflow runtime (graphs, gates, templates)
packages/worker      LAN Docker/Host guest service over HTTPS (`npm run dev:worker`)
packages/compute     Fargate (and later cloud) placement quotes / RunTask
```

Folder-by-folder map: [docs/architecture.md](docs/architecture.md). Domain terms: [CONTEXT.md](CONTEXT.md).

Each VM session binds one template (install media, hardware, VNC vs SPICE, cloud-init, Omarchy cidata, or unattend, forwarded ports). Docker sessions skip the hypervisor and run an allowlisted tool catalog inside the container.

Compute **placement** (`local` or a Settings → Workers host) is independent of runtime. Investigation: [docs/agent-backends.md](docs/agent-backends.md).

Shared in-app browser: [docs/builtin-browser.md](docs/builtin-browser.md).

## Docs

Index: [docs/README.md](docs/README.md).

| Guide | What it covers |
|-------|----------------|
| [SECURITY.md](SECURITY.md) | Threat model, vault, jail, how to report a vulnerability |
| [docs/architecture.md](docs/architecture.md) | Control plane and repository layout |
| [docs/cli.md](docs/cli.md) | `npx locus` command map, including `locus workflow` |
| [docs/docker-swarm.md](docs/docker-swarm.md) | Local Docker Swarm rail, CLI, and `docker_swarm` |
| [docs/codebase.md](docs/codebase.md) | Linked repos, PR review, Change Stack |
| [docs/slack.md](docs/slack.md) | Local Slack client and Ask Locus |
| [docs/phone.md](docs/phone.md) | LAN pairing, Android app, phone shell |
| [docs/agent-backends.md](docs/agent-backends.md) | Workers, Host-on-worker, Fargate |
| [docs/webhook-automations.md](docs/webhook-automations.md) | Git push / PR / Slack webhooks |
| [docs/grafana.md](docs/grafana.md) | Grafana dashboards and Explore |
| [docs/confluence.md](docs/confluence.md) | Confluence page tools |
| [docs/figma.md](docs/figma.md) | Figma file, node, and image tools |
| [docs/linear.md](docs/linear.md) | Linear issue tools |
| [docs/incidentio.md](docs/incidentio.md) | incident.io incident tools |
| [docs/portainer.md](docs/portainer.md) | Portainer environments, containers, stacks |
| [docs/google.md](docs/google.md) | Gmail, Google Calendar, Google Drive |
| [docs/kubernetes.md](docs/kubernetes.md) | Kubernetes cluster tools |
| [docs/sentry.md](docs/sentry.md) | Sentry issue tools |
| [docs/aws-iam.md](docs/aws-iam.md) | AWS IAM / STS, PrivateLink, API Gateway |
| [docs/integration-plugins.md](docs/integration-plugins.md) | Agent-authored HTTP plugins |
| [docs/public-release.md](docs/public-release.md) | Listing checklist this tree cannot change |

## Development

```bash
npm test
npm run typecheck
npm run test:visual
npm run capture:readme
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Locus contributors.

[CHANGELOG](CHANGELOG.md) · [CONTRIBUTING](CONTRIBUTING.md) · [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md) · [SECURITY](SECURITY.md)
