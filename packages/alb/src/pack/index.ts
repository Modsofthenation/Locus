import type { EvalCase, Skill, SkillChain, SkillLink } from '../schema/index.js';
import { toSkillSlug, portablePortKey, uniqueSlugs } from '../ids.js';
import { isSupervisorSkill } from '../skills/index.js';
import { normalizeSkill, normalizeSkillChain } from '../normalize.js';

export interface PortableSkillRef {
  slug: string;
  name: string;
  role: 'member' | 'supervisor';
  version: string;
  versionRange?: string;
}

export interface PortableSkillLink {
  source: string;
  target: string;
  condition?: string;
  mappings: Array<{ from: string; to: string }>;
}

export interface SkillPackManifest {
  kind: 'alb.skill_pack';
  version: 1;
  name: string;
  slug: string;
  description?: string;
  supervisorSlug?: string;
  skills: PortableSkillRef[];
  links: PortableSkillLink[];
  evalCases: EvalCase[];
}

export interface SkillPack {
  manifest: SkillPackManifest;
  /** Path → file contents, ready to write into another repo. */
  files: Record<string, string>;
}

function skillById(skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((s) => [s.id, s]));
}

function slugOf(skill: Skill): string {
  return toSkillSlug(skill.slug || skill.name);
}

function redactSecretDefaults<T extends { variables?: { secret?: boolean; defaultValue?: unknown }[] }>(
  value: T,
): T {
  if (!value.variables?.length) return value;
  return {
    ...value,
    variables: value.variables.map((v) => (v.secret ? { ...v, defaultValue: undefined } : v)),
  };
}

function redactSkill(skill: Skill): Skill {
  return {
    ...skill,
    internalWorkflow: skill.internalWorkflow
      ? redactSecretDefaults(skill.internalWorkflow)
      : skill.internalWorkflow,
  };
}

function portById(skill: Skill, portId: string): { id: string; name: string } | undefined {
  return skill.inputs?.find((p) => p.id === portId) ?? skill.outputs?.find((p) => p.id === portId);
}

function portableLink(link: SkillLink, byId: Map<string, Skill>): PortableSkillLink | null {
  const source = byId.get(link.source);
  const target = byId.get(link.target);
  if (!source || !target) return null;
  const mappings = (link.mappings ?? []).map((m) => {
    const fromPort = portById(source, m.sourcePort);
    const toPort = portById(target, m.targetPort);
    return {
      from: fromPort ? portablePortKey(fromPort) : m.sourcePort,
      to: toPort ? portablePortKey(toPort) : m.targetPort,
    };
  });
  return {
    source: slugOf(source),
    target: slugOf(target),
    condition: link.condition,
    mappings,
  };
}

function yamlEscape(value: string): string {
  if (/[:#\n]/.test(value) || value.includes('"')) {
    return JSON.stringify(value);
  }
  return value;
}

function renderSkillMarkdown(skill: Skill, manifest: SkillPackManifest): string {
  const lines: string[] = [
    '---',
    `name: ${yamlEscape(slugOf(skill))}`,
    `description: ${yamlEscape(skill.description || skill.name)}`,
    '---',
    '',
    `# ${skill.name}`,
    '',
  ];
  const instructions =
    skill.instructions?.trim() ||
    (isSupervisorSkill(skill)
      ? `Orchestrate the ${manifest.name} member skills in graph order. Do not authorize side effects yourself — member gates still apply.`
      : skill.description || `Reusable skill: ${skill.name}.`);
  lines.push(instructions, '');

  if (skill.inputs?.length) {
    lines.push('## Inputs', '');
    for (const port of skill.inputs) {
      lines.push(
        `- \`${portablePortKey(port)}\` (${port.type}${port.required ? ', required' : ''})${port.description ? ` — ${port.description}` : ''}`,
      );
    }
    lines.push('');
  }
  if (skill.outputs?.length) {
    lines.push('## Outputs', '');
    for (const port of skill.outputs) {
      lines.push(
        `- \`${portablePortKey(port)}\` (${port.type})${port.description ? ` — ${port.description}` : ''}`,
      );
    }
    lines.push('');
  }
  if (skill.tools.length) {
    lines.push('## Tools', '');
    for (const tool of skill.tools) lines.push(`- \`${tool}\``);
    lines.push('');
  }
  if (skill.gates.length) {
    lines.push('## Gates', '');
    for (const gate of skill.gates) {
      lines.push(`- ${gate.kind} \`${gate.nodeType}\` (${gate.label})`);
    }
    lines.push('');
  }
  if (skill.privilegedTools.length) {
    lines.push('## Privileged tools', '');
    for (const tool of skill.privilegedTools) {
      const extra = tool.url ? ` ${tool.url}` : '';
      lines.push(`- \`${tool.nodeType}\` ${tool.label}${extra}`);
    }
    lines.push('');
  }

  const memberLinks = manifest.links.filter(
    (l) => l.source === slugOf(skill) || l.target === slugOf(skill),
  );
  if (isSupervisorSkill(skill) || memberLinks.length) {
    lines.push('## Chain', '');
    lines.push(
      `This skill is a **${skill.role ?? 'member'}** of \`${manifest.slug}\`${manifest.supervisorSlug ? ` (supervisor: \`${manifest.supervisorSlug}\`)` : ''}.`,
      '',
    );
    if (memberLinks.length) {
      lines.push('### Links', '');
      for (const link of memberLinks) {
        const cond = link.condition ? ` [${link.condition}]` : '';
        const maps = link.mappings.map((m) => `${m.from}→${m.to}`).join(', ');
        lines.push(`- \`${link.source}\`${cond} → \`${link.target}\`${maps ? ` (${maps})` : ''}`);
      }
      lines.push('');
    }
  }

  lines.push(
    '## Runtime',
    '',
    'Execute the companion `runtime/chain.json` with `@alb/core` (`importBundle` + `executeSkillChain` / `evaluateSkillChain`).',
    '',
  );
  return lines.join('\n');
}

function renderPackReadme(manifest: SkillPackManifest): string {
  const skillList = manifest.skills
    .map((s) => `- \`${s.slug}\` (${s.role}) v${s.version}`)
    .join('\n');
  return [
    `# ${manifest.name}`,
    '',
    manifest.description ?? 'Portable linked skill chain exported from Agent Loop Builder.',
    '',
    '## Drop into another repo',
    '',
    '```text',
    'skills/<slug>/SKILL.md           ← copy into .cursor/skills/<slug>/SKILL.md',
    'runtime/chain.json              ← executable ALB bundle',
    'eval/cases.json                 ← effectiveness fixtures',
    'skill-pack.json                 ← portable manifest (slugs + links)',
    '```',
    '',
    'Copy `skills/<slug>/SKILL.md` to `.cursor/skills/<slug>/SKILL.md` (or your agent skills folder).',
    '',
    '## Skills',
    '',
    skillList,
    '',
    '## Measure effectiveness',
    '',
    '```ts',
    "import { importBundle, evaluateSkillChain } from '@alb/core';",
    "import fs from 'node:fs';",
    '',
    "const pack = JSON.parse(fs.readFileSync('<slug>.skill-pack.json', 'utf8'));",
    "const runtime = pack.files['runtime/chain.json'];",
    'const { chain, skills } = importBundle(runtime);',
    'const suite = await evaluateSkillChain(chain, skills);',
    'console.log(suite.passed, suite.score, suite.cases);',
    '```',
    '',
  ].join('\n');
}

/** Build a directory-shaped pack other repos can vendor. */
export function exportSkillPack(chain: SkillChain, skills: Skill[]): SkillPack {
  const normalizedSkills = skills.map((skill) => normalizeSkill(skill));
  const slugs = uniqueSlugs(normalizedSkills.map((s) => s.slug || s.name));
  const packedSkills = normalizedSkills.map((skill, i) => redactSkill({ ...skill, slug: slugs[i] }));
  const safeChain = redactSecretDefaults(normalizeSkillChain(chain));
  const byId = skillById(packedSkills);
  const supervisor = safeChain.supervisorSkillId ? byId.get(safeChain.supervisorSkillId) : undefined;
  const slug = toSkillSlug(safeChain.slug || safeChain.name);
  const portableSkills: PortableSkillRef[] = (safeChain.skills ?? []).flatMap((ref) => {
    const skill = byId.get(ref.skillId);
    if (!skill) return [];
    return [
      {
        slug: slugOf(skill),
        name: skill.name,
        role: skill.role ?? 'member',
        version: ref.version,
        versionRange: ref.versionRange,
      },
    ];
  });
  const links = (safeChain.links ?? [])
    .map((link) => portableLink(link, byId))
    .filter((l): l is PortableSkillLink => Boolean(l));

  const manifest: SkillPackManifest = {
    kind: 'alb.skill_pack',
    version: 1,
    name: safeChain.name,
    slug,
    description: safeChain.description,
    supervisorSlug: supervisor ? slugOf(supervisor) : undefined,
    skills: portableSkills,
    links,
    evalCases: safeChain.evalCases ?? [],
  };

  const runtime = JSON.stringify(
    { kind: 'alb.skill_chain', version: 1, chain: safeChain, skills: packedSkills },
    null,
    2,
  );
  const files: Record<string, string> = {
    'skill-pack.json': JSON.stringify(manifest, null, 2),
    'runtime/chain.json': runtime,
    'eval/cases.json': JSON.stringify(safeChain.evalCases ?? [], null, 2),
    'README.md': renderPackReadme(manifest),
  };
  for (const skill of packedSkills) {
    files[`skills/${slugOf(skill)}/SKILL.md`] = renderSkillMarkdown(skill, manifest);
  }

  return { manifest, files };
}

export function exportSkillPackBundle(chain: SkillChain, skills: Skill[]): {
  format: 'skill_pack';
  content: string;
  filename: string;
} {
  const pack = exportSkillPack(chain, skills);
  const safeName = pack.manifest.slug || toSkillSlug(chain.name);
  return {
    format: 'skill_pack',
    content: JSON.stringify(
      { kind: 'alb.skill_pack', version: 1, files: pack.files },
      null,
      2,
    ),
    filename: `${safeName}.skill-pack.json`,
  };
}

export function parseSkillPackFiles(
  raw: unknown,
): { ok: true; files: Record<string, string> } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Skill pack is not an object'] };
  const rec = raw as { kind?: string; files?: unknown };
  if (rec.kind !== 'alb.skill_pack') return { ok: false, errors: ['Not an alb.skill_pack'] };
  if (!rec.files || typeof rec.files !== 'object' || Array.isArray(rec.files)) {
    return { ok: false, errors: ['Skill pack is missing files'] };
  }
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(rec.files as Record<string, unknown>)) {
    if (typeof content !== 'string') {
      return { ok: false, errors: [`Pack file ${path} is not a string`] };
    }
    files[path] = content;
  }
  return { ok: true, files };
}
