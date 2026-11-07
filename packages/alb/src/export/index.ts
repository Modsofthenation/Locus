import type { Skill, SkillChain, Workflow } from '../schema/index.js';
import { WorkflowSchema, SkillSchema, SkillChainSchema } from '../schema/index.js';
import { skillScriptsIntegrityError } from '../scripts.js';
import { isSupervisorSkill, supervisorChainError } from '../skills/index.js';
import { validateWorkflow } from '../validation/index.js';
import { parseSkillPackFiles } from '../pack/index.js';

export type ExportFormat = 'json' | 'yaml' | 'native' | 'skill_package' | 'skill_chain' | 'skill_pack';

export interface ExportBundle {
  format: ExportFormat;
  content: string;
  filename: string;
}

function toYamlLike(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    if (value.includes('\n') || value.includes(':') || value.includes('#')) {
      return `|-\n${value
        .split('\n')
        .map((l) => pad + '  ' + l)
        .join('\n')}`;
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return (
      '\n' +
      value
        .map((item) => {
          const rendered = toYamlLike(item, indent + 1);
          if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
            const lines = rendered.trimStart().split('\n');
            return `${pad}- ${lines[0]}\n${lines
              .slice(1)
              .map((l) => pad + '  ' + l.trimStart())
              .join('\n')}`.trimEnd();
          }
          return `${pad}- ${rendered}`;
        })
        .join('\n')
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return (
      '\n' +
      entries
        .map(([k, v]) => {
          const rendered = toYamlLike(v, indent + 1);
          if (rendered.startsWith('\n')) {
            return `${pad}${k}:${rendered}`;
          }
          return `${pad}${k}: ${rendered}`;
        })
        .join('\n')
    );
  }
  return JSON.stringify(value);
}

export function redactSecrets<T extends { variables?: { secret?: boolean; defaultValue?: unknown }[] }>(
  value: T,
): T {
  if (!value.variables?.length) return value;
  return {
    ...value,
    variables: value.variables.map((v) =>
      v.secret ? { ...v, defaultValue: undefined } : v,
    ),
  };
}

export function exportWorkflow(workflow: Workflow, format: ExportFormat = 'json'): ExportBundle {
  const safeWorkflow = redactSecrets(workflow);
  const safeName = workflow.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  if (format === 'yaml') {
    return {
      format,
      content:
        `# Agent Loop Builder workflow export\nname: ${workflow.name}\n` +
        toYamlLike(safeWorkflow).trimStart(),
      filename: `${safeName}.yaml`,
    };
  }
  return {
    format: format === 'native' ? 'native' : 'json',
    content: JSON.stringify({ kind: 'alb.workflow', version: 1, workflow: safeWorkflow }, null, 2),
    filename: `${safeName}.alb.json`,
  };
}

export function exportSkill(skill: Skill, format: ExportFormat = 'json'): ExportBundle {
  const safeName = skill.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  if (format === 'yaml') {
    return {
      format,
      content: toYamlLike({ kind: 'alb.skill', skill }).trimStart(),
      filename: `${safeName}.skill.yaml`,
    };
  }
  return {
    format: 'skill_package',
    content: JSON.stringify({ kind: 'alb.skill', version: 1, skill }, null, 2),
    filename: `${safeName}.skill.json`,
  };
}

export function exportSkillChain(chain: SkillChain, skills: Skill[]): ExportBundle {
  const safeName = chain.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  return {
    format: 'skill_chain',
    content: JSON.stringify({ kind: 'alb.skill_chain', version: 1, chain, skills }, null, 2),
    filename: `${safeName}.chain.json`,
  };
}

function importSkillChainPayload(chainRaw: unknown, skillsRaw: unknown[] | undefined): ImportResult {
  const chain = SkillChainSchema.safeParse(chainRaw);
  if (!chain.success) {
    return { ok: false, errors: chain.error.issues.map((i) => i.message) };
  }
  const skills: Skill[] = [];
  for (const s of skillsRaw ?? []) {
    const parsedSkill = SkillSchema.safeParse(s);
    if (!parsedSkill.success) {
      return { ok: false, errors: parsedSkill.error.issues.map((i) => i.message) };
    }
    const scriptsError = skillScriptsIntegrityError(parsedSkill.data);
    if (scriptsError) return { ok: false, errors: [scriptsError] };
    skills.push(parsedSkill.data);
  }
  const supervisorError = supervisorChainError(chain.data, skills);
  if (supervisorError) return { ok: false, errors: [supervisorError] };
  for (const skill of skills) {
    const embedded = embeddedWorkflowError(skill);
    if (embedded) return { ok: false, errors: [embedded] };
  }
  return { ok: true, kind: 'skill_chain', chain: chain.data, skills, errors: [] };
}

export interface ImportResult {
  ok: boolean;
  kind?: 'workflow' | 'skill' | 'skill_chain';
  workflow?: Workflow;
  skill?: Skill;
  chain?: SkillChain;
  skills?: Skill[];
  errors: string[];
}

export function importBundle(raw: string): ImportResult {
  try {
    const parsed = JSON.parse(raw) as {
      kind?: string;
      workflow?: unknown;
      skill?: unknown;
      chain?: unknown;
      skills?: unknown[];
    };

    // Bare workflow
    if (!parsed.kind && parsed && typeof parsed === 'object' && 'nodes' in (parsed as object)) {
      const wf = WorkflowSchema.safeParse(parsed);
      if (!wf.success) {
        return { ok: false, errors: wf.error.issues.map((i) => i.message) };
      }
      return { ok: true, kind: 'workflow', workflow: wf.data, errors: [] };
    }

    if (parsed.kind === 'alb.workflow' || parsed.workflow) {
      const wf = WorkflowSchema.safeParse(parsed.workflow ?? parsed);
      if (!wf.success) {
        return { ok: false, errors: wf.error.issues.map((i) => i.message) };
      }
      return { ok: true, kind: 'workflow', workflow: wf.data, errors: [] };
    }

    if (parsed.kind === 'alb.skill' || parsed.skill) {
      const skill = SkillSchema.safeParse(parsed.skill ?? parsed);
      if (!skill.success) {
        return { ok: false, errors: skill.error.issues.map((i) => i.message) };
      }
      const scriptsError = skillScriptsIntegrityError(skill.data);
      if (scriptsError) return { ok: false, errors: [scriptsError] };
      return { ok: true, kind: 'skill', skill: skill.data, errors: [] };
    }

    if (parsed.kind === 'alb.skill_chain') {
      return importSkillChainPayload(parsed.chain, parsed.skills);
    }

    if (parsed.kind === 'alb.skill_pack') {
      const pack = parseSkillPackFiles(parsed);
      if (!pack.ok) return { ok: false, errors: pack.errors };
      const runtime = pack.files['runtime/chain.json'];
      if (!runtime) return { ok: false, errors: ['Skill pack is missing runtime/chain.json'] };
      return importBundle(runtime);
    }

    return { ok: false, errors: ['Unrecognized import format'] };
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : 'Failed to parse import'],
    };
  }
}

function embeddedWorkflowError(skill: Skill): string | null {
  const wf = skill.internalWorkflow;
  if (!wf) return null;
  if (wf.limits.requireGateBeforeSideEffects === false) {
    return `${skill.name} disables requireGateBeforeSideEffects`;
  }
  const issues = validateWorkflow(wf).filter((i) => i.severity === 'error');
  const filtered = isSupervisorSkill(skill)
    ? issues
    : issues.filter(
        (i) => i.code !== 'UNGATED_SIDE_EFFECT' && i.code !== 'SIDE_EFFECT_ON_FAIL_BRANCH',
      );
  if (filtered.length === 0) return null;
  return `${skill.name}: ${filtered.map((i) => i.message).join('; ')}`;
}
