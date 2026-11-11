# Domain glossary

Names used at seams in this repository. Architecture reviews should keep these terms and not invent parallel ones. Folder map: [docs/architecture.md](docs/architecture.md).

## Agent

A chat session that drives a **guest** (Docker container, VM, or host workspace). Create, boot, turn, undo, and fork all belong to the agent.

## Guest

The machine the agent tools target. Docker, VM, and host are adapters behind one **guest runtime** interface. Live guests set `liveGuest`; the in-memory mock adapter omits it.

## Guest factory

Picks the Guest runtime adapter (Docker, Host, Windows SSH+WinRM, SSH, or mock) from a Machine. Control-plane GuestHub and worker WorkerGuestHub are thin adapters on that interface.

## Runtime catalog

The shared Guest tool list Host and Docker catalogs are derived from. Host adds Board / Project / Swarm planning tools and headed Chrome; Docker adds `start_process`, `record_screen`, and headed Chromium.

## Studio continue

Turn policy after a Design / Game / Asset round: look, incomplete canvas, quality, juice, sculpt, unused assets, mutate follow-up. Model, tool, and CLI Turns share the predicates; coding / review / ops continue stays on the Turn module.

## Session

Persisted agent state: messages, queue, checkpoints, linked repo, preview. Desktop streaming applies **Session merge** so a list-view snapshot does not wipe a fuller local transcript.

## Machine

Lifecycle of a Docker container or QEMU VM: create, start, stop, snapshot, restore. Pause-before-snapshot and stop-before-restore are flags on the machine lifecycle, not kind checks.

## Workspace

The `/workspace` tree the operator Files pane and the agent file tools share. Host listing, guest exec listing, and git dirty stats are one concept.

## Forge

GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps as the remote for clone, push, pull requests, and issues. Locus stays the local catalog. `ForgeClient` selects one forge adapter per account. Gitea/Forgejo/Azure DevOps are PAT-only and are not auto-added as empty Settings cards.

## Design

An agent whose canvas is `/workspace/index.html`. Promote copies that canvas into a coding agent.

## Game

An agent whose canvas is `/workspace/index.html`, like Design, but the playbook and starters target a fully playable web game (input, loop, score or win/lose). New game has 2D / 3D and Hotseat chips plus remixable one-sentence prompts. Attached photos are style references (restyle into `vendor/assets/`, do not embed the original). The first draft includes a How to Play overlay. Operator chrome covers Play mode, feel sliders/presets, Playtest, Fix from playtest, iterate chips, Apply brief / Keep feel, reset/pause, mute/clear-save, landscape + touch + gamepad, debug HUD, seed, replay tape, Explore 3 loops, an Unlisted play link with a phone QR and a per-token scoreboard, generate sprite/sheet/mesh/SFX, Export zip (PWA + itch), and a 15s Record. Grow this into a project is Promote (Three kit defaults to the Three scaffold). A one-page GDD.md, living GAME.md, content JSON, plus last-run.json ground the next turn. Game styles save tile/HUD/juice. Kits are pixel / Three.js / Phaser / SFX. Promote writes `GAME.md` plus a canvas/Three.js/Phaser/static scaffold. Not Design (UI prototype) and not a coding Agent.

## Asset

An agent whose canvas is `/workspace/index.html`, like Design and Games, but the playbook and starters target 2D sprites/tiles/cutouts or a 3D mesh with optional auto-rig (image-to-3D, text-to-3D, pose CSS vars, clips). Operator chrome covers a 3D stage (Front/Side/Top camera, Orbit, Wireframe, Grid, Studio/Clay/Albedo, Key/Rim lights, grey/checkered/photo background) hidden on 2D sprite recipes, clip timeline (Play/Pause, speed, scrub), pose sliders/presets on characters, Build settings (topology, quality, resolution, rest pose, poly budget, texture, split, multi-view, enhance, printability) with a dirty Generate, mesh stats (faces vs budget, units m/mm, printability, holes/non-manifold/open edges), isolate parts when Split is on, a source-photo well (front/side/back + onion-skin), iterate chips (Retopo / Texture / Rig / Animate / Low poly / Split / Printability; Texture/Low poly on sprites), recents thumbs with Live restore, Compare / Undo last pass, Explore 3-up, Apply brief / Keep pose, drop-on-canvas retarget, Export pack (zip with source photos + GLB/STL/PNG) plus PNG / GLB / STL / textures, and Explore 3 directions. New asset is well + prompt + Build + Send; runtime/jail sit under More options. A living ASSET.md grounds the next turn. First paint is a wired hull (silhouette → hull → texture → rig), not a CSS card. Playwright returns a screenshot image and fails the turn when verts are missing. Promote writes `ASSET.md` plus a three-vite, canvas-vite, or static scaffold. Local HTML studio — not a Meshy API. Not Design (UI prototype), not Games (playable loop), and not a coding Agent.

## Board

A session-less planning canvas (`~/.locus/boards/<id>/board.json`). Stickies (including stacks), frames, shapes, connectors, tables, timelines, freehand ink, comments, and live cards that cite agents, designs, PRs, Slack, files, automations, Jira, or Linear. Optional host chat (`kind: "board"`) uses `board_*` tools. A Miro token in Settings → Integrations unlocks `miro_list` / `miro_get` / `miro_import` / `miro_export`. A Figma token unlocks `figma_list` / `figma_get` / `figma_images` / `figma_comment`. Not Design (HTML prototype) and not `/plan` (agent checklist).

## Project

A session-less body of work (`~/.locus/projects/<id>/project.json` plus a `context/` tree). Host coordinator chat (`kind: "project"`) plans and spawns members. Members are normal agent/review/design sessions with `projectId`. **Keep running** leaves the control-plane process up after the desktop quits. A new failing check or review comment on a member pull request spawns one fix member; green CI flags Needs you and leaves merge behind Approve. Not a Board (canvas), not an Automation (fire-and-forget prompt), and not a LinkedRepo.

## Codebase

The local catalog of linked remotes, PR inbox, issue inbox, and review sessions.

## Architecture analysis

A Codebase tab on a linked repo. Three sections — **Repo**, **Feature**, and **Code** — read a Host or Docker checkout and suggest behaviour-preserving improvements (deep modules, one owner, one way, derived lists, sealed internals, blast radius). Improve with agent applies the ones that still hold. Not Brain (knowledge graph), not load path (PR impact), and not Change Stack (review walkthrough).

## Brain

A session-less knowledge graph plus distilled memory (`~/.locus/brain/default/brain.sqlite`). Services, APIs, and decisions with evidence. Coding agents call `orient` / `search_knowledge` / `find_entity` and `remember` (add) into it. `correct_graph` queues a human inbox; Accept contradicts the memory and lowers node confidence. `locus brain setup` writes personal Cursor, Claude Code, and Codex hooks that POST a transcript tail to loopback; the distiller is the only writer. Slack/Jira corpus ingest is Settings-off by default. Not a **Project** (body of work), not `repo_map` (file/symbol map), and not `.locus/memories.json` (the per-workspace override scratchpad).

## Grafana

A session-less explorer (`/api/grafana/*`) on the vaulted Settings → Integrations Grafana token. Native dashboard grid (panel queries via `/api/ds/query`, template variables, firing alerts, annotations), Lucene logs, extracted stack frames, a Tempo/Jaeger span list, links into linked-repo checkouts at a file and line, an AI brief, and Investigate (Ops loop agent, including from a panel). Not Slack (threads), not Codebase (PR inbox), and not `grafana_query` itself — that tool still runs inside agent turns. Dashboards are not an iframe of Grafana.

## Swarm

A product mode (`productMode: "swarm"`). The Developer icon rail is hidden. Agents are **Teammates**, Projects are **Teams**, Automations are **Routines**. Messenger chat plus a Computer pane (Status / Preview / Takeover). Coordinators use `team_roster` / `team_add_teammate` / `team_message`; `team_directory` / `team_handoff` are cross-team. Not **Docker Swarm** (the local engine tab).

## Workflow

An Agent Loop Builder graph stored under `~/.locus/workflows`. Templates and `.alb.json` imports run inside a coding session (`list_workflows` / `run_workflow` / `resume_workflow`, `locus workflow`). Tool nodes use that session's catalog and still wait for Approve. Runtime lives in `packages/alb`. Not an **Automation** (clock/webhook prompt) and not a **Project** (body of work).

## Automation

A scheduled or webhook-triggered prompt run that reuses an agent or boots a golden image. Overlap is skip, coalesce (latest when free), or queue one.

## Config save

The Settings write path: merge secrets, lock managed policy, validate providers/forges/templates/MCP/skills/plugins/workers, then persist. `prepareSavedConfig` is the merge+normalize interface; the route persists and notifies.

## Agent canvas

A durable HTML document a coding or review chat builds beside the thread (`canvas_write` / `canvas_read`). Stored under the session, not in the guest repo. Not a **Design** canvas (`/workspace/index.html`) and not a **Board**.

## Turn

One user prompt through the agent loop, including interrupt, Stop, queue drain, and Send now. Native model Turns and host **CLI Turns** (Cursor CLI, Claude Code, Codex CLI, Kiro CLI) share one continue policy: canvas/review/studio nudges after each round.

## Checkpoint

A rewind snapshot of session messages plus guest disk or Docker workspace.

## Browser CDP

The Chromium DevTools websocket the Docker Browser tab and browser tools share. Host agents default to isolated `host-chrome`. **Use my Chrome** is a separate loopback extension websocket (`/ws/chrome-extension`) that can attach those same `browser_*` tools to the operator's real Chrome tabs when the Host agent opts in.

## Forge auth

OAuth device vs redirect, token refresh, and username fetch chosen by a per-kind adapter. Sibling to the PR Forge adapter — not methods on it.

## Persona draft

Form state for a Swarm teammate (name, avatar, role, personality) that becomes SessionPersona on create and settings save.

## Docker Swarm

The host Docker engine in swarm mode (nodes, services, stacks, `docker service logs` / scale). The Docker rail **Swarm** tab and `locus docker swarm` talk to the same daemon as containers. Not **Swarm** product mode (multi-agent teams) and not the Portainer integration (a remote Portainer API).

## Edit history

Workspace undo/redo snapshots, typing coalesce, and path remap. The editor adapts DOM selection; history owns the stacks.

## Loadpath noise

Files the Change Stack drops (generated trees, lockfiles, minified JS). Not Files listing skip — lockfiles stay visible in the explorer.
