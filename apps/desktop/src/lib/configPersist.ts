import type { AgentSkill, LocusConfig } from "@locus/shared";

export function blankSkill(skill: AgentSkill): boolean {
  return !skill.name.trim() && !skill.body.trim() && !skill.title.trim() && !skill.hint.trim();
}

/** Drop empty skill rows before Config save. */
export function configForSave(config: LocusConfig): LocusConfig {
  const skills = (config.skills ?? []).filter((skill) => !blankSkill(skill));
  if (skills.length === (config.skills ?? []).length) return config;
  return { ...config, skills };
}

export function configIsDirty(draft: LocusConfig | null, saved: LocusConfig | null): boolean {
  if (!draft || !saved) return false;
  return JSON.stringify(configForSave(draft)) !== JSON.stringify(saved);
}
