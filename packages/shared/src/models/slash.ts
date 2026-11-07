import type { AgentRuntime } from "./vm.js";
import { enabledSkills, skillSlashName, type AgentSkill } from "./skill.js";

export type SlashCommandId =
  | "takeover"
  | "handback"
  | "undo"
  | "fork"
  | "clear"
  | "record"
  | "vision"
  | "websearch"
  | "chrome"
  | "plan"
  | "workers"
  | "roles";

export interface SlashCommand {
  id: SlashCommandId;
  name: string;
  title: string;
  hint: string;
  runtime?: AgentRuntime;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "takeover", name: "takeover", title: "Take over", hint: "Drive the guest yourself" },
  { id: "handback", name: "handback", title: "Hand back", hint: "Let the agent drive again" },
  { id: "undo", name: "undo", title: "Undo last turn", hint: "Restore chat and the guest disk" },
  { id: "fork", name: "fork", title: "Duplicate", hint: "New session from the current workspace" },
  {
    id: "clear",
    name: "clear",
    title: "Clear chat",
    hint: "Drop messages and model context; keep repos",
  },
  {
    id: "workers",
    name: "workers",
    title: "Workers",
    hint: "Spawn parallel Docker workers",
    runtime: "docker",
  },
  { id: "record", name: "record", title: "Record", hint: "Start or save a guest recording" },
  { id: "vision", name: "vision", title: "Vision", hint: "Toggle screenshots to the model" },
  {
    id: "websearch",
    name: "websearch",
    title: "Web search",
    hint: "Toggle host web search for the model",
  },
  {
    id: "chrome",
    name: "chrome",
    title: "Use my Chrome",
    hint: "Toggle live Chrome tabs for this host agent",
    runtime: "host",
  },
  { id: "plan", name: "plan", title: "Plan", hint: "Outline steps first, then you hit Run" },
  { id: "roles", name: "roles", title: "Roles", hint: "Cycle planner → implementer → reviewer" },
];

const HOST_SLASH = new Set<SlashCommandId>([
  "undo",
  "fork",
  "clear",
  "websearch",
  "chrome",
  "plan",
  "roles",
]);

/** Slash commands in the composer overflow, in display order. */
export const COMPOSER_OVERFLOW_IDS: readonly SlashCommandId[] = [
  "plan",
  "websearch",
  "chrome",
  "vision",
  "record",
  "roles",
  "undo",
  "fork",
  "clear",
];

export function composerOverflowCommands(runtime: AgentRuntime = "vm"): SlashCommand[] {
  const byId = new Map(matchSlashCommands("/", runtime).map((cmd) => [cmd.id, cmd]));
  return COMPOSER_OVERFLOW_IDS.flatMap((id) => {
    const cmd = byId.get(id);
    return cmd ? [cmd] : [];
  });
}

export function matchSlashCommands(text: string, runtime: AgentRuntime = "vm"): SlashCommand[] {
  const line = text.split("\n")[0] ?? "";
  if (!line.startsWith("/")) return [];
  if (/\s/.test(line.trim())) return [];
  const q = line.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => {
    if (runtime === "host" && !HOST_SLASH.has(cmd.id)) return false;
    if (cmd.runtime && cmd.runtime !== runtime) return false;
    return !q || cmd.name.startsWith(q);
  });
}

export function slashCommandFromInput(
  text: string,
  runtime: AgentRuntime = "vm",
): SlashCommand | undefined {
  const trimmed = text.trim();
  const match = trimmed.match(/^\/([a-z][\w-]*)$/i);
  if (!match) return undefined;
  const name = match[1]!.toLowerCase();
  return matchSlashCommands(`/${name}`, runtime).find((cmd) => cmd.name === name);
}

export const BUILTIN_SLASH_NAMES: string[] = SLASH_COMMANDS.map((cmd) => cmd.name);

export type SlashMenuItem =
  { kind: "command"; command: SlashCommand } | { kind: "skill"; skill: AgentSkill };

export function matchSlashMenu(
  text: string,
  runtime: AgentRuntime = "vm",
  skills: AgentSkill[] | undefined = [],
): SlashMenuItem[] {
  const line = text.split("\n")[0] ?? "";
  if (!line.startsWith("/")) return [];
  if (/\s/.test(line.trim())) return [];
  const items: SlashMenuItem[] = matchSlashCommands(text, runtime).map((command) => ({
    kind: "command",
    command,
  }));
  const q = line.slice(1).toLowerCase();
  for (const skill of enabledSkills(skills)) {
    const name = skillSlashName(skill.name);
    if (!name || BUILTIN_SLASH_NAMES.includes(name)) continue;
    if (q && !name.startsWith(q)) continue;
    items.push({ kind: "skill", skill });
  }
  return items;
}
