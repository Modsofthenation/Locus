import {
  THEME_OPTIONS,
  comparePeer,
  canReplay,
  canClearChat,
  conversationLabel,
  dockerContainerLive,
  forgeLabel,
  formatSchedule,
  guestLabel,
  isCanvasSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  isHiddenChatMessage,
  isHumanDriving,
  isIdeSession,
  isBoardSession,
  isProjectSession,
  lastUserPrompt,
  parseProductMode,
  sessionRuntime,
  setupHasRemainingTodos,
  type AgentSession,
  type Automation,
  type BoardSummary,
  type BrainSummary,
  type ProjectSummary,
  type DockerContainer,
  type LinkedRepo,
  type LocusConfig,
  type ProductMode,
  type SetupStatus,
  type SlackConversation,
  type VmInstance,
} from "@locus/shared";
import { featurePaletteItems } from "./discoverability";
import { SHORTCUTS, shortcutHint } from "./shortcuts";
import { needsYouCount, needsYouItems, needsYouSessions } from "./needsYou";
import { SETTINGS_NAV_GROUPS, settingsNavLabel, type SettingsTab } from "./settingsNav";
import { switchableSessions } from "./sessionSwitch";

export type PaletteGroup =
  | "Recents"
  | "Agents"
  | "Design"
  | "Games"
  | "Assets"
  | "Board"
  | "Project"
  | "IDE"
  | "Needs you"
  | "Automations"
  | "Codebase"
  | "Brain"
  | "Slack"
  | "Grafana"
  | "Docker"
  | "Guest"
  | "Settings"
  | "Appearance"
  | "Help";

export interface PaletteItem {
  id: string;
  title: string;
  hint: string;
  group: PaletteGroup;
  keywords: string;
}

export const PALETTE_SHORTCUTS: { keys: string; action: string }[] = SHORTCUTS.map((row) => ({
  keys: row.keys,
  action: row.action,
}));

export function editorOwnsCommandK(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  return Boolean(el.closest("[data-editor-inline-ai]"));
}

export function isPaletteShortcutsQuery(query: string): boolean {
  return query.trim() === "?";
}

const RUNNING = new Set(["running", "ready", "paused"]);

export function paletteItems(input: {
  sessions: AgentSession[];
  session?: AgentSession;
  vm?: VmInstance;
  repos?: LinkedRepo[];
  containers?: DockerContainer[];
  slackConversations?: SlackConversation[];
  automations?: Automation[];
  boards?: BoardSummary[];
  brain?: BrainSummary | null;
  projects?: ProjectSummary[];
  setup?: SetupStatus | null;
  config?: LocusConfig | null;
}): PaletteItem[] {
  const items: PaletteItem[] = [];
  items.push({
    id: "new-agent",
    title: "New agent",
    hint: shortcutHint("new"),
    group: "Agents",
    keywords: "new agent create session chat start",
  });
  items.push({
    id: "new-design",
    title: "New design",
    hint: shortcutHint("new", "on Design"),
    group: "Design",
    keywords: "new design create prototype mockup",
  });
  items.push({
    id: "section:games",
    title: "Games",
    hint: "Playable web games beside Design",
    group: "Games",
    keywords: "games arcade platformer puzzle card arena match-3 trivia racing maze playable html",
  });
  items.push({
    id: "new-game",
    title: "New game",
    hint: shortcutHint("new", "on Games"),
    group: "Games",
    keywords: "new game create arcade platformer puzzle playable",
  });
  items.push({
    id: "section:assets",
    title: "Assets",
    hint: "2D/3D studio from a photo or prompt",
    group: "Assets",
    keywords: "assets 3d 2d mesh rig sprite voxel image-to-3d texture glb",
  });
  items.push({
    id: "new-asset",
    title: "New asset",
    hint: shortcutHint("new", "on Assets"),
    group: "Assets",
    keywords: "new asset create mesh rig sprite 3d 2d image",
  });
  items.push({
    id: "section:board",
    title: "Board",
    hint: "Stickies, frames, and live cards",
    group: "Board",
    keywords: "board sticky frame planning diagram miro whiteboard ask locus cluster",
  });
  items.push({
    id: "new-board",
    title: "New board",
    hint: shortcutHint("new", "on Board"),
    group: "Board",
    keywords: "new board create sticky architecture sprint retro rca research",
  });
  for (const row of input.boards ?? []) {
    if (row.archived) continue;
    items.push({
      id: `board:${row.id}`,
      title: row.title,
      hint: `${row.objectCount} objects`,
      group: "Board",
      keywords: `${row.title} ${row.starter ?? ""} board sticky frame`,
    });
  }
  items.push({
    id: "section:project",
    title: "Projects",
    hint: "Coordinator, members, and shared context",
    group: "Project",
    keywords: "project coordinator fleet spawn garden migration feature",
  });
  items.push({
    id: "new-project",
    title: "New project",
    hint: shortcutHint("new", "on Projects"),
    group: "Project",
    keywords: "new project create feature migration gardening coordinator",
  });
  for (const row of input.projects ?? []) {
    if (row.archived) continue;
    items.push({
      id: `project:${row.id}`,
      title: row.title,
      hint: `${row.memberCount} members`,
      group: "Project",
      keywords: `${row.title} ${row.starter ?? ""} project coordinator`,
    });
  }
  items.push({
    id: "section:ide",
    title: "IDE",
    hint: "Open a folder or clone a repo",
    group: "IDE",
    keywords: "ide editor files workspace folder clone repo host coding",
  });
  items.push({
    id: "new-workspace",
    title: "New workspace",
    hint: shortcutHint("new", "on IDE"),
    group: "IDE",
    keywords: "new workspace open folder clone repo ide host",
  });
  if (input.session && !isCanvasSession(input.session)) {
    items.push({
      id: "workspace-goto",
      title: "Go to file",
      hint: shortcutHint("goto-file"),
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "go to file quick open symbol search index find workspace editor",
    });
    items.push({
      id: "workspace-goto-symbol",
      title: "Go to symbol",
      hint: shortcutHint("goto-symbol"),
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "go to symbol typescript navigate workspace editor",
    });
    items.push({
      id: "workspace-search",
      title: "Search in files",
      hint: shortcutHint("search-files"),
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "search in files grep find code workspace editor",
    });
    items.push({
      id: "workspace-reindex",
      title: "Re-index workspace",
      hint: "Rebuild Go to file",
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "reindex re-index rebuild index workspace files symbols goto",
    });
    items.push({
      id: "workspace-format",
      title: "Format document",
      hint: "Shift+Alt+F",
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "format prettier typescript organize document editor",
    });
    items.push({
      id: "workspace-split",
      title: "Split editor",
      hint: shortcutHint("split"),
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "split editor beside files columns pane group compare",
    });
    items.push({
      id: "workspace-git",
      title: "Git status",
      hint: "Stage, commit, blame",
      group: isIdeSession(input.session) ? "IDE" : "Guest",
      keywords: "git scm stage commit blame branch workspace",
    });
  }
  if (input.session && sessionRuntime(input.session) === "host") {
    items.push({
      id: "workspace-terminal",
      title: "Toggle terminal",
      hint: shortcutHint("terminal"),
      group: isIdeSession(input.session) ? "IDE" : "Agents",
      keywords: "terminal shell pty workspace bash cmd ide",
    });
    items.push({
      id: "workspace-terminal-new",
      title: "New terminal",
      hint: "Open another PTY",
      group: isIdeSession(input.session) ? "IDE" : "Agents",
      keywords: "new terminal shell pty tab workspace",
    });
  }
  for (const row of switchableSessions(input.sessions)) {
    if (isBoardSession(row) || isProjectSession(row)) continue;
    const design = isDesignSession(row);
    const game = isGameSession(row);
    const assets = isAssetSession(row);
    const ide = isIdeSession(row);
    items.push({
      id: `session:${row.id}`,
      title: row.title,
      hint: design || game || assets ? row.model : `${guestLabel(row.os)} · ${row.model}`,
      group: design ? "Design" : game ? "Games" : assets ? "Assets" : ide ? "IDE" : "Agents",
      keywords: `${row.title} ${row.os} ${row.model} ${lastUserPrompt(row.messages) ?? ""} ${design ? "design canvas" : game ? "game playable" : assets ? "asset mesh rig 3d 2d" : ide ? "ide workspace host folder" : "agent"} jump`,
    });
  }
  const waiting = needsYouSessions(input.sessions);
  const waitingDetails = needsYouItems(input.sessions, input.boards, input.brain);
  const boardWaiting = waitingDetails.filter((row) => row.boardId);
  const brainWaiting = waitingDetails.filter((row) => row.section === "brain");
  const needsCount = needsYouCount(input.sessions, input.boards, input.brain);
  const waitingNames = [
    ...waiting.map((row) => row.title),
    ...boardWaiting.map((row) => row.title),
    ...brainWaiting.map((row) => row.title),
  ];
  items.push({
    id: "needs-you",
    title: needsCount ? `Needs you · ${needsCount}` : "Needs you",
    hint: needsCount
      ? waitingNames.length <= 3
        ? waitingNames.join(", ")
        : `${waitingNames.slice(0, 2).join(", ")} +${waitingNames.length - 2}`
      : "Agents waiting on you",
    group: "Needs you",
    keywords: "needs you inbox waiting approval gated human agents board comments brain",
  });
  for (const row of waiting) {
    const detail =
      waitingDetails.find((item) => item.sessionId === row.id)?.detail ?? "Waiting on you";
    items.push({
      id: `needs-you:${row.id}`,
      title: row.title,
      hint: detail,
      group: "Needs you",
      keywords: `${row.title} ${detail} needs you waiting approval inbox`,
    });
  }
  for (const row of boardWaiting) {
    items.push({
      id: `needs-you:board:${row.boardId}:${row.objectId}`,
      title: row.title,
      hint: row.detail,
      group: "Needs you",
      keywords: `${row.title} ${row.detail} board comment needs you waiting inbox`,
    });
  }
  for (const row of brainWaiting) {
    items.push({
      id: "needs-you:brain",
      title: row.title,
      hint: row.detail,
      group: "Needs you",
      keywords: `${row.title} ${row.detail} brain inbox graph correction needs you waiting`,
    });
  }
  items.push({
    id: "section:automations",
    title: "Automations",
    hint: "Scheduled and event jobs",
    group: "Automations",
    keywords: "automation schedule cron webhook forge-push pull-request job inbox",
  });
  items.push({
    id: "new-automation",
    title: "New automation",
    hint: shortcutHint("new", "on Automations"),
    group: "Automations",
    keywords: "new automation create schedule job",
  });
  for (const row of input.automations ?? []) {
    items.push({
      id: `automation:${row.id}`,
      title: row.name,
      hint: `${row.enabled ? "On" : "Off"} · ${formatSchedule(row.schedule)}`,
      group: "Automations",
      keywords: `${row.name} ${row.prompt} ${row.schedule.kind} automation job`,
    });
  }
  for (const repo of input.repos ?? []) {
    items.push({
      id: `repo:${repo.id}`,
      title: repo.name,
      hint: forgeLabel(repo.checkout.forge),
      group: "Codebase",
      keywords: `${repo.name} ${repo.checkout.url} ${repo.checkout.forge} repo codebase github gitlab bitbucket pr`,
    });
  }
  items.push({
    id: "section:brain",
    title: "Brain",
    hint: "Services, APIs, and distilled memory",
    group: "Brain",
    keywords: "brain knowledge graph memory orient search remember flow catalog services apis",
  });
  items.push({
    id: "section:codebase",
    title: "Codebase",
    hint: "PR inbox and linked repos",
    group: "Codebase",
    keywords: "codebase pull request pr inbox stack walkthrough linked repos architecture analyse",
  });
  items.push({
    id: "section:slack",
    title: "Slack",
    hint: "Read as you · send as you or Locus",
    group: "Slack",
    keywords: "slack channel dm message ask locus thread",
  });
  items.push({
    id: "section:grafana",
    title: "Grafana",
    hint: "Dashboards, logs, trace into repos, investigate",
    group: "Grafana",
    keywords:
      "grafana dashboard logs explore lucene elasticsearch debug incident failure trace repo ops",
  });
  for (const row of input.slackConversations ?? []) {
    items.push({
      id: `slack:${row.id}`,
      title: conversationLabel(row),
      hint: row.kind === "im" || row.kind === "mpim" ? "Direct message" : "Channel",
      group: "Slack",
      keywords: `${row.name} ${row.topic ?? ""} slack channel dm ${conversationLabel(row)}`,
    });
  }
  items.push({
    id: "section:docker",
    title: "Docker containers",
    hint: "Stop, restart, or pull logs",
    group: "Docker",
    keywords: "docker container stop restart logs host engine bulk",
  });
  const live = (input.containers ?? []).filter((row) => dockerContainerLive(row.state));
  if (live.length >= 2) {
    items.push({
      id: "docker-stop-running",
      title: `Stop ${live.length} running containers`,
      hint:
        live.length <= 3
          ? live.map((row) => row.name).join(", ")
          : `${live
              .slice(0, 2)
              .map((row) => row.name)
              .join(", ")} +${live.length - 2}`,
      group: "Docker",
      keywords: "docker container stop bulk running all selected",
    });
  }
  for (const row of input.containers ?? []) {
    items.push({
      id: `container:${row.id}`,
      title: row.name,
      hint: `${row.state}${row.image ? ` · ${row.image}` : ""}`,
      group: "Docker",
      keywords: `${row.name} ${row.image} ${row.state} docker container ${row.sessionTitle ?? ""}`,
    });
  }
  if (input.session) {
    const running = Boolean(input.vm && RUNNING.has(input.vm.status));
    const runtime = sessionRuntime(input.session);
    items.push({
      id: running ? "guest-stop" : "guest-start",
      title: running ? "Stop guest" : "Start guest",
      hint: input.session.title,
      group: "Guest",
      keywords: "start stop vm container guest machine",
    });
    items.push({
      id: "chat-find",
      title: "Find in chat",
      hint: shortcutHint("find"),
      group: "Guest",
      keywords: "find search chat thread ctrl f command f",
    });
    if (input.session.status === "running") {
      items.push({
        id: "chat-stop",
        title: "Stop turn",
        hint: input.session.title,
        group: "Guest",
        keywords: "stop abort turn interrupt cancel",
      });
    }
    items.push({
      id: "chat-archive",
      title: input.session.archived ? "Unarchive chat" : "Archive chat",
      hint: input.session.title,
      group: "Guest",
      keywords: "archive unarchive hide chat session",
    });
    if (canClearChat(input.session)) {
      items.push({
        id: "chat-clear",
        title: "Clear chat",
        hint: "Drop messages and model context; keep repos",
        group: "Guest",
        keywords: "clear chat context reset thread new conversation repos",
      });
    }
    if (running && runtime !== "host") {
      if (isHumanDriving(input.session)) {
        items.push({
          id: "guest-handback",
          title: "Hand back",
          hint: "Let the agent drive again",
          group: "Guest",
          keywords: "handback hand back slash guest drive agent",
        });
      } else if (runtime !== "docker") {
        items.push({
          id: "guest-takeover",
          title: "Take over",
          hint: "Drive the guest yourself",
          group: "Guest",
          keywords: "takeover take over slash guest drive",
        });
      }
    }
    if (running) {
      items.push({
        id: "guest-save-image",
        title: "Save golden image",
        hint: runtime === "docker" ? "Snapshot /workspace" : "Skip the next install",
        group: "Guest",
        keywords: "golden image snapshot save",
      });
    }
    if (canReplay(input.session.messages)) {
      items.push({
        id: "guest-replay",
        title: "Replay run",
        hint: "Screenshot timeline",
        group: "Guest",
        keywords: "replay timeline screenshots run history",
      });
    }
    if (lastUserPrompt(input.session.messages) && !comparePeer(input.session, input.sessions)) {
      items.push({
        id: "guest-compare",
        title: "Compare models",
        hint: "Fork and replay the last prompt",
        group: "Guest",
        keywords: "compare models fork replay distrust a/b evaluation",
      });
    }
    if (input.session.messages.some((message) => !isHiddenChatMessage(message))) {
      items.push({
        id: "chat-export-html",
        title: "Export chat as HTML",
        hint: input.session.title,
        group: "Guest",
        keywords: "export html transcript chat save download",
      });
      items.push({
        id: "chat-export-pdf",
        title: "Export chat as PDF",
        hint: "Print dialog, then Save as PDF",
        group: "Guest",
        keywords: "export pdf transcript chat save print",
      });
    }
  }
  items.push({
    id: "design-systems",
    title: "Design systems",
    hint: "Create, import, or export brand tokens",
    group: "Design",
    keywords: "design system brand palette typography import export claude zip",
  });
  items.push({
    id: "asset-styles",
    title: "Asset styles",
    hint: "Save a look from a studio and reuse it",
    group: "Assets",
    keywords: "asset style look mesh sprite save reuse clay",
  });
  for (const group of SETTINGS_NAV_GROUPS) {
    for (const tab of group.items) {
      const label = settingsNavLabel(tab);
      const extra = tab === "notifications" ? " quiet hours alerts notify desktop" : "";
      const names = settingsTabKeywords(tab, input.config);
      items.push({
        id: `settings:${tab}`,
        title: `Settings · ${label}`,
        hint: group.label,
        group: "Settings",
        keywords:
          `settings ${label} ${tab} ${group.label} preferences page${extra} ${names}`.trim(),
      });
    }
  }
  for (const opt of THEME_OPTIONS) {
    items.push({
      id: `theme:${opt.id}`,
      title: `Theme · ${opt.name}`,
      hint: opt.summary,
      group: "Appearance",
      keywords: `theme ${opt.name} ${opt.id} appearance${opt.chatScene ? " space photo chat" : ""}${opt.gradient ? " gradient" : ""}${opt.contrast ? " contrast" : ""}`,
    });
  }
  items.push({
    id: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    hint: `${shortcutHint("new")}, K, F, comma, 1–9, F12`,
    group: "Help",
    keywords: "keyboard shortcuts cheat sheet keys help question ?",
  });
  if (input.setup && setupHasRemainingTodos(input.setup)) {
    items.push({
      id: "finish-setup",
      title: "Finish setup",
      hint: "Provider, optional Docker / VM",
      group: "Help",
      keywords: "finish setup wizard provider docker qemu skip remaining",
    });
  }
  items.push(...featurePaletteItems());
  return items;
}

function settingsTabKeywords(tab: SettingsTab, config?: LocusConfig | null): string {
  if (!config) return "";
  if (tab === "providers") {
    return config.providers.map((row) => `${row.name} ${row.kind}`).join(" ");
  }
  if (tab === "mcp") {
    return (config.mcpServers ?? [])
      .map((row) => `${row.name} ${row.command} ${row.url ?? ""}`)
      .join(" ");
  }
  if (tab === "skills") {
    return (config.skills ?? []).map((row) => `${row.name} ${row.title ?? ""}`).join(" ");
  }
  if (tab === "workers") {
    return (config.workers ?? []).map((row) => row.name).join(" ");
  }
  return "";
}

function textMatchesQuery(text: string, q: string): boolean {
  const lower = text.toLowerCase();
  let from = 0;
  while (from <= lower.length) {
    const idx = lower.indexOf(q, from);
    if (idx === -1) return false;
    if (idx === 0 || !/[a-z0-9]/.test(lower[idx - 1]!)) return true;
    from = idx + 1;
  }
  return false;
}

function paletteMatchScore(item: PaletteItem, q: string): number {
  const titleHit = textMatchesQuery(item.title, q);
  const hintHit = textMatchesQuery(item.hint, q);
  const keyHit = textMatchesQuery(item.keywords, q);
  if (!titleHit && !hintHit && !keyHit) return 0;
  const title = item.title.toLowerCase();
  if (title === q) return 100;
  const words = title.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => word === q)) return 96;
  if (title.startsWith(q)) return 90;
  if (words.some((word) => word.startsWith(q))) return 80;
  if (titleHit) return 60;
  if (keyHit) return 50;
  return 40;
}

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items
    .map((item, index) => ({ item, index, score: paletteMatchScore(item, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.item);
}

/** Pin recently run commands at the top when the query is empty. */
export function applyPaletteRecents(items: PaletteItem[], recents: string[]): PaletteItem[] {
  if (!recents.length) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const recentItems: PaletteItem[] = [];
  for (const id of recents) {
    const item = byId.get(id);
    if (item) recentItems.push({ ...item, group: "Recents" });
  }
  if (!recentItems.length) return items;
  const recentIds = new Set(recentItems.map((item) => item.id));
  return [...recentItems, ...items.filter((item) => !recentIds.has(item.id))];
}

const SWARM_HIDDEN_GROUPS = new Set<PaletteGroup>([
  "Design",
  "Games",
  "Board",
  "IDE",
  "Automations",
  "Codebase",
  "Brain",
  "Slack",
  "Grafana",
  "Docker",
]);

const SWARM_HIDDEN_IDS = new Set([
  "section:automations",
  "section:brain",
  "section:grafana",
  "feature:webhooks",
  "feature:memory",
]);

/** Swarm palette stays on teammates, teams, and configuration. */
export function paletteItemsForMode(items: PaletteItem[], mode: ProductMode): PaletteItem[] {
  if (parseProductMode(mode) !== "swarm") return items;
  return items.filter(
    (item) => !SWARM_HIDDEN_GROUPS.has(item.group) && !SWARM_HIDDEN_IDS.has(item.id),
  );
}
