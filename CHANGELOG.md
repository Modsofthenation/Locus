# Changelog

## Unreleased

## 0.29.0 — 2026-11-24

Choose how slow tests run before a push, more reliable git tools on host clones, managed cloud sandboxes, a CLI sandbox setting, extra themes, and Slack reviewers that finish large PRs in parts. Settings → About is **0.29.0**.

**Harness and git.** The push and PR approval card can run tests, skip them, or publish now and test in the background. Slow suites prompt first instead of blocking silently; if nobody answers in two minutes, the tests run. A timed-out test gate now kills the whole process tree, not just `npm`. Git tools work on a folder that already holds a clone: they pick the forge from origin, fast-forward instead of merging, and say what to try next. A session can bypass named harness gates (test gate, pre-tool-use hooks, force-push refusal, recursive-delete refusal) when a managed policy allows it. Protected-branch pushes, secrets, sensitive paths, and allowlists stay non-bypassable.

**Managed sandboxes.** Run agents on Daytona, E2B, Modal, and Runloop from Settings → Workers. E2B templates can be built entirely in the app. Fargate tasks recover after interrupted provisioning. Set the CLI agent sandbox (filesystem and network, filesystem only, or off) under Settings → Advanced, including allowed loopback ports for a local proxy.

**Slack reviewers.** Large PRs can split into up to 12 parts grouped by folder, with a live summary as each part finishes. CLI reviewers can split with No token limits on, and prompts that used to overflow the command line now fit. Tag the bot in any thread of its channel to start a review. Adaptive and smart polling, live logs, and exclusions for people you do not want reviewed. Reply `full re-review` (or enable Force full re-review under Try it) to use the full PR diff even when the current commit has already been reviewed. Upload a workspace file to Slack by path; uploads wait for Slack to confirm they were shared.

**Appearance.** Eight extravagant theme styles (Baroque, Stained Glass, Steampunk, Art Nouveau, Casino, Circus, Disco, Psychedelic) add 24 palettes, 210 in total. Motion stops when the OS asks for reduced motion.

## 0.24.0 — 2026-11-22

Slack PR reviewers, operator-token API auth, sandboxed CLI agents, generated themes and 48 new palettes (186 in total), Android and Unreal workspaces, Fargate workers that open as a chat, any-language verification, and computer-use reliability. Settings → About is **0.24.0**.

**Slack PR reviewers.** Settings → Reviewers points a reviewer at a Slack channel. When someone posts a PR link, it reviews the PR and replies in that thread and on the PR. You can ask it to review again after a skip, review PRs nobody posted, run several reviews at once, use a CLI agent you already subscribe to, clone the repo to check around the diff, and answer questions in the thread. Tagging the bot in any thread of its channel starts a review there. Adaptive and smart polling slow a quiet reviewer down; Live logs show every Slack and forge API call as it happens.

**Reviewer quality.** Blocker and major findings are double-checked before posting. Settings shows accuracy, traces, in-progress and open chats, cost caps, skip labels, base-branch and requester filters, path-specific instructions, and a reaction legend that matches your channel. Reviews learn from dismissals and can propose them as REVIEW.md.

**Security.** The control plane no longer treats every process on this machine as you: `/api` and `/ws` need an operator token. CLI agents on Docker, worker, and VM sessions run in a sandbox, cannot reach the Locus HTTP API or other sessions, and Slack reviewer CLIs get the same treatment. Worker MCP is limited to that session. Opt out with `LOCUS_OPERATOR_AUTH=off` or `LOCUS_CLI_SANDBOX=off`.

**Appearance.** Generated themes let you describe a look, build one in the editor, or ask an agent to restyle the app. Eight structural styles (Brutalist, Glass, Paper, Retro OS, Blueprint, Neon, Clay, Zen) and eight more (Pixel, Comic, Sketch, HUD, Skeuo, Bauhaus, Y2K, Editorial, plus Origami, Art Deco, Memphis, Typewriter, Riso, Glitch, Kawaii, Receipt) bring the catalog to 186 palettes. Design has a Present mode for full-screen walkthroughs.

**Engineering.** Verification is no longer npm-only: environment files and detected presets cover Python, Go, Rust, Maven, Gradle and Make. Agents get language-server navigation and rename. Benchmarks are a tracked regression suite. OpenTelemetry export, a hash-chained audit log, daily spend budgets, headless `locus ci run`, CI logs with a fix loop, evidence-based Rank, and risk-gated merge are all available.

**Workspaces.** More → Android opens native (and React Native / Expo) app projects beside an emulator canvas. Games offers Unreal next to Unity and Godot. Fargate workers open as a chat: pick one in New agent and the task boots in the background. Plan-usage meters sit next to the model picker for agent CLIs.

**Turns and first runs.** The turn card shows cost and time. Compare ranks parallel attempts. Start-up steps replace a spinner. Try a sample task runs a tiny Host repo with one failing test. Computer-use is more reliable, with native VM actions and shared control. Home, Reviewers, Android and Design are easier to read, and you can create from the collapsed sidebar.

**Also.** Skills load from folder layouts, and chat can add skills and MCP servers. A step can be handed to another model. Git tools work in a folder that already holds a clone. Stale `locus/agent` images rebuild when they are missing iptables.

## 0.21.0 — 2026-11-13

Decide from the Inbox, a turn summary card, tray and actionable notifications, encrypted backup and restore, background update checks with one-click install, a model benchmark, a smoother first hour with a public repo, and much faster workspaces on large repos. Settings → About is **0.21.0**.

**Inbox decisions.** The Inbox shows a decision card for each waiting item: what will run, where it runs, the agent's last words, and a risk hint. Approve, Deny, Always allow and Open chat sit on the card, with keyboard shortcuts (J/K, A, D, Enter) and **Approve all** when several chats wait on the same tool.

**Turn summary and first task.** When a turn changes files, runs tests or opens a PR, a card under the reply lists the files changed, whether tests passed, and next steps: Review changes, Open PR, Continue, or Undo this turn. The first-task card on New agent now suggests real work on your most recent repo or folder.

**Tray and notifications.** The desktop app has a tray icon and dock/taskbar badge with the needs-you count. Notifications say what the agent wants and open the chat when clicked; on macOS, approvals can be answered straight from the notification.

**Backup and restore.** Settings → Advanced → Back up and restore, or `locus backup` / `locus restore`, writes one passphrase-encrypted file with your sessions, settings, boards, projects, Jobs, Brain, workspaces and stored keys. Machine-bound keys are never copied; the vault is re-encrypted for the new machine, so a restore on a new laptop keeps every provider key. A wrong passphrase or tampered file is refused.

**Updates.** The desktop checks for new releases shortly after launch and every six hours, and **Install** downloads, verifies the checksum and installs (in place for Linux AppImage). Turn it off in Settings → About. CLI: `locus update`.

**Model benchmark.** Settings → Benchmark, or `locus eval run`, runs five small coding tasks against the models you pick and records pass rate, tokens, cost, tool calls and time per model.

**First hour with a public repo.** With Docker stopped, actions that need a container say so and offer to start on Host instead. A linked repo is preselected across New agent, Design, Jobs, Brain and IDE. No-token accounts show their rate limit and when it resets. Codebase gains an About card for the repo, and the setup wizard tests local servers such as Ollama with a real call.

**Performance on large repos.** Agent search after an edit no longer rebuilds the whole index (seconds down to milliseconds on very large repos), VM file listings, search without ripgrep, repo index rebuilds, the repo map and Quick Open are all much faster, and the desktop app now ships ripgrep.

**Fixes.** Undo on a git workspace reliably restores edited files. The desktop app uses Electron's async secure-storage API, so the deprecation warnings are gone and existing vault keys still unlock. The control plane and worker start without `ssh-keygen` (only VM agents need it).

## 0.20.0 — 2026-11-11

Eight new Terminal themes, a UI/UX polish pass on Swarm, the composer, and empty states, and launchers that check Docker is actually running before they start. Settings → About is **0.20.0**.

**Terminal themes.** Settings → Appearance adds a **Terminal** filter and group. Console is joined by eight terminal-window themes that share its titlebar, scanlines, and monospace type: Green Screen, White Phosphor, Cathode, Darkroom, Cobalt, Uplink, Mainframe, and Teletype (light).

**Docker readiness.** The Agents, Design, and Games launchers now check that the Docker daemon is answering before they start. When it isn't, they start on Host and say "Docker isn't running" instead of launching and failing, and the Docker footer reports when the daemon is down.

**UI/UX pass.** The Swarm sidebar no longer runs under the chat, narrow windows get the same rail and slide-over list as Developer, and teammate rows show full names. In the composer, the model picker shrinks instead of covering Stop, Queue, and Send. Empty states, Settings spacing, and the setup screen are more consistent, and the phone top bar is tidier.

**Fixes.** Repeated Docker errors and a stale "Waiting for the guest…" no longer linger in the thread, and "Loading local model…" no longer shows while a reply is streaming. The scroll tick rail no longer covers message text, collapsed-rail peek titles show in full, and Settings → Integrations lists each forge once.

## 0.19.0 — 2026-11-11

Inbox and a resizable sidebar with pinnable rail sections, the Console theme, a UI/UX polish pass across every section, and more reliable Jobs, worker uploads, and desktop updates. Settings → About is **0.19.0**.

**Sidebar and Inbox.** The icon rail opens with Inbox: agents, boards, Brain, and failing jobs waiting on you, with Approve / Deny on waiting tools. Sections from More can be pinned to the rail, reordered, and unpinned by right-clicking a rail icon. The list panel resizes (240–480px), session lists share All / Needs you / Running / Unread filters, and Alt+1–9 jumps between Inbox and pinned sections. On narrow windows the sidebar no longer slides under the chat, and the phone Needs you tab shares the Inbox list.

**UI/UX pass.** List headers, empty states, and filter chips are consistent across the app. The chat composer is a single frame with Send inside it, the model chip and topbar always agree, and Design sessions open with the canvas visible. Automations are called Jobs throughout. Settings pages lead with a one-line summary, providers are grouped Enabled / Available, and on/off settings are switches.

**Console theme.** Settings → Appearance adds Console: amber phosphor on charcoal with a monospace font and scanlines (`locus config theme console`).

**Jobs.** Run now checks Docker first and offers to switch to Host or start Docker. Jobs whose linked repo was removed run and save again, and run errors read as one plain sentence with details on demand.

**Codebase and IDE.** Public GitHub, GitLab, Bitbucket, Gitea, and Azure repos load pull requests and issues without a token, and blocked or rate-limited reads say so in place. README badges render correctly in the IDE.

**Fixes.** Uploads to guests on a worker plane no longer answer "Not found". Deleting the open agent returns to the new-agent screen, with Undo reopening it. The desktop app picks up rebuilt UI between releases and restarts a control plane left by an older build. Kiro CLI turns no longer duplicate tool chips, recognise more test runners as verification, and use Locus's Git tools instead of reading forge tokens from the environment.

**Under the hood.** Host, Docker, and worker guests share one tool catalog and lifecycle, simplifying how VMs, containers, and remote workers are driven.

## 0.18.0 — 2026-11-09

Worker VMs with proxied displays and golden disks, Azure and GCP placement, Slack Approve, Windows guest CLIs, and Linux installers. Settings → About is **0.18.0**.

**Workers.** QEMU guests on a LAN or cloud worker stream the display to the laptop over a pinned WebSocket instead of treating worker loopback as local. Phone threads get a view-only pane; control stays on the desktop. Golden VM disks upload once to the worker and reuse. Azure Container Instances and Google Compute Engine sit next to Fargate for placement. Worker planes namespace guests under one token.

**Slack.** Posting and uploading from an agent can be approved with Slack action buttons. Forge writes still confirm in Locus.

**Guests.** Cursor, Claude, Codex, and Kiro spawn over SSH into Windows VMs via PowerShell. Linux guests stay POSIX.

**Desktop.** The composer Explore / Review chip matches neighboring controls. Opening the model menu no longer flashes above the trigger. A usage hint shows combined LLM and VM spend. Setup offers a first Host task from the empty Agents state. On the phone, More opens Settings, New automation, and the command palette; threads gain Find in chat.

**Coding CLIs.** Kiro CLI stream-json envelopes map into the chat thread instead of finishing with no reply, and duplicate tool chips are gone. A turn that already ran the project's tests is not flagged Needs you for a scratch write or a trailing delete-only cleanup. Codex keeps file-change details in the thread.

**Packaging.** Linux ships AppImage, deb, and rpm. The agent image is tagged with both a stable alias and this version. About → Download and verify checks SHA256SUMS before opening the installer.

## 0.17.0 — 2026-11-08

Quieter desktop shell, more guest runtimes, extra forges, and more reliable installer builds. Settings → About is **0.17.0**.

**Runtimes.** Dev Container files can define install, start, ports, and image when a Locus environment file is absent. Docker, Podman, and nerdctl are all valid container engines. Linux guests on Apple silicon use arm64 QEMU; Windows guests stay x86_64. Host coding CLIs can run over SSH inside a Linux VM. LAN workers can run QEMU guests (live display stays on the worker).

**Forges and subscriptions.** Gitea, Forgejo, and Azure DevOps can be added as forges. Subscribe also understands Linear, Jira, Sentry, Grafana alerts, incident.io, and pull URLs from those extra forges.

**Desktop.** Shared themed dialogs, empty states, shortcuts, undo toasts, and command-palette search. Failed actions surface in the notice stack with Retry. Confirm and prompt no longer use the browser’s native dialogs. The computer column stays collapsed until the agent opens a canvas.

**Packaging.** Linux, macOS, and Windows installer jobs prefetch Electron and packaging tools through the GitHub Releases API and retry failed fetches.

## 0.16.1 — 2026-11-08

First public release.
