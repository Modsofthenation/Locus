import type { ProductMode } from "@locus/shared";
import { settingsNavLabel, type SettingsTab } from "@/lib/settingsNav";
import type { UiSection } from "@/state/store";

export function countPhrase(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function sidebarBrandSubtitle(opts: {
  inboxOpen: boolean;
  inboxCount: number;
  section: UiSection;
  mode: ProductMode;
  settingsTab: SettingsTab;
  dockerKind?: string | null;
  slackTeam?: string | null;
  agentCount: number;
  needsCount: number;
  designCount: number;
  gameCount: number;
  assetCount: number;
  ideCount: number;
  repoCount: number;
  boardCount: number;
  projectCount: number;
  automationCount: number;
  brainNodes?: number | null;
  brainMemories?: number | null;
}): string {
  if (opts.inboxOpen) {
    return opts.inboxCount ? `${opts.inboxCount} waiting` : "Caught up";
  }
  if (opts.section === "settings") return settingsNavLabel(opts.settingsTab);
  if (opts.section === "docker") {
    return `Docker · ${opts.dockerKind === "docker" ? "local" : "mock"}`;
  }
  if (opts.section === "slack") {
    return opts.slackTeam?.trim() ? `Slack · ${opts.slackTeam.trim()}` : "Slack";
  }
  if (opts.section === "grafana") return "Grafana";
  const swarm = opts.mode === "swarm";
  if (opts.section === "agents") {
    const noun = swarm
      ? countPhrase(opts.agentCount, "teammate")
      : countPhrase(opts.agentCount, "agent");
    return opts.needsCount > 0 ? `${noun} · ${opts.needsCount} needs you` : noun;
  }
  if (opts.section === "design") return countPhrase(opts.designCount, "design");
  if (opts.section === "games") return countPhrase(opts.gameCount, "game");
  if (opts.section === "assets") return countPhrase(opts.assetCount, "asset");
  if (opts.section === "ide") return countPhrase(opts.ideCount, "workspace");
  if (opts.section === "codebase") return countPhrase(opts.repoCount, "repo");
  if (opts.section === "board") return countPhrase(opts.boardCount, "board");
  if (opts.section === "project") {
    return swarm
      ? countPhrase(opts.projectCount, "team")
      : countPhrase(opts.projectCount, "project");
  }
  if (opts.section === "automations") {
    return swarm
      ? countPhrase(opts.automationCount, "routine")
      : countPhrase(opts.automationCount, "job");
  }
  if (opts.section === "brain") {
    if (opts.brainNodes == null) return "Empty brain";
    return `${opts.brainNodes} nodes · ${opts.brainMemories ?? 0} memories`;
  }
  return "";
}
