import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  formatMemoriesPrompt,
  memoriesForRepo,
  mergeMemoryPrompts,
  normalizeMemories,
  parseJsonc,
  parseWorkspaceEnvironment,
  parseSkillMarkdown,
  type AgentSkill,
  type LocusEnvironment,
  type RepoMemory,
} from "@locus/shared";

/**
 * Repo skill folders, highest priority first. `.locus/skills` is Locus's own; `.agents/skills`
 * and `.claude/skills` hold Agent Skills-standard folders other tools already use.
 */
export const REPO_SKILL_DIRS = [
  join(".locus", "skills"),
  join(".agents", "skills"),
  join(".claude", "skills"),
] as const;

async function loadSkillDir(workspaceRoot: string, rel: string): Promise<AgentSkill[]> {
  let entries: Dirent[] = [];
  try {
    entries = await readdir(join(workspaceRoot, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: AgentSkill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      if (entry.name.toLowerCase().endsWith(".md") && entry.isFile()) {
        const skill = parseSkillMarkdown(
          entry.name,
          await readFile(join(workspaceRoot, rel, entry.name), "utf8"),
        );
        if (skill) out.push(skill);
        continue;
      }
      // Folder skill: <name>/SKILL.md. Symlinked folders count (stat follows the link).
      const folder = join(rel, entry.name);
      const file = join(workspaceRoot, folder, "SKILL.md");
      if (!(await stat(file)).isFile()) continue;
      const skill = parseSkillMarkdown(`${entry.name}.md`, await readFile(file, "utf8"), {
        folder: folder.split(sep).join("/"),
      });
      if (skill) out.push(skill);
    } catch {
      /* skip unreadable or non-skill entries */
    }
  }
  return out;
}

export async function loadRepoSkills(workspaceRoot?: string): Promise<AgentSkill[]> {
  if (!workspaceRoot) return [];
  const out: AgentSkill[] = [];
  for (const rel of REPO_SKILL_DIRS) {
    for (const skill of await loadSkillDir(workspaceRoot, rel)) {
      if (!out.some((row) => row.name === skill.name)) out.push(skill);
    }
  }
  return out;
}

export async function loadWorkspaceEnvironment(
  workspaceRoot?: string,
): Promise<LocusEnvironment | undefined> {
  if (!workspaceRoot) return undefined;
  for (const rel of [
    join(".locus", "environment.json"),
    join(".cursor", "environment.json"),
    join(".devcontainer", "devcontainer.json"),
    ".devcontainer.json",
    "environment.json",
  ]) {
    try {
      const env = parseWorkspaceEnvironment(
        parseJsonc(await readFile(join(workspaceRoot, rel), "utf8")),
      );
      if (env) return env;
    } catch {
      /* try the next path */
    }
  }
  return undefined;
}

export async function loadWorkspaceMemoryRows(workspaceRoot?: string): Promise<RepoMemory[]> {
  if (!workspaceRoot) return [];
  try {
    return normalizeMemories(
      JSON.parse(await readFile(join(workspaceRoot, ".locus", "memories.json"), "utf8")),
    );
  } catch {
    return [];
  }
}

export async function saveWorkspaceMemories(
  workspaceRoot: string,
  memories: RepoMemory[],
): Promise<void> {
  const dir = join(workspaceRoot, ".locus");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "memories.json"), `${JSON.stringify(memories, null, 2)}\n`);
}

export async function loadWorkspaceMemories(
  workspaceRoot?: string,
  repoUrl?: string,
): Promise<string> {
  if (!workspaceRoot) return "";
  const chunks: string[] = [];
  try {
    const text = (await readFile(join(workspaceRoot, ".locus", "memory.md"), "utf8")).trim();
    if (text) chunks.push(`Known facts from this workspace:\n${text.slice(0, 4000)}`);
  } catch {
    /* optional */
  }
  const json = formatMemoriesPrompt(
    memoriesForRepo(await loadWorkspaceMemoryRows(workspaceRoot), repoUrl),
  );
  if (json) chunks.push(json);
  return mergeMemoryPrompts(...chunks);
}

export function parseMemoriesFile(raw: unknown): RepoMemory[] {
  return normalizeMemories(raw);
}

const NAMED_RULE_FILES = new Set(["Locus.md", "AGENTS.md", "CLAUDE.md"]);
const RULE_FILES = [
  "Locus.md",
  "AGENTS.md",
  "CLAUDE.md",
  join(".locus", "rules.md"),
  join(".locus", "rules"),
];
const RULES_CHAR_BUDGET = 4_000;

function ruleFileLabel(rel: string): string {
  return NAMED_RULE_FILES.has(rel) ? rel : ".locus/rules";
}

export async function loadWorkspaceRules(workspaceRoot?: string): Promise<string> {
  if (!workspaceRoot) return "";
  const chunks: string[] = [];
  let used = 0;
  for (const rel of RULE_FILES) {
    if (used >= RULES_CHAR_BUDGET) break;
    try {
      const text = (await readFile(join(workspaceRoot, rel), "utf8")).trim();
      if (!text) continue;
      const body = text.slice(0, RULES_CHAR_BUDGET - used);
      chunks.push(`${ruleFileLabel(rel)}:\n${body}`);
      used += body.length;
    } catch {
      /* optional */
    }
  }
  return chunks.join("\n\n");
}
