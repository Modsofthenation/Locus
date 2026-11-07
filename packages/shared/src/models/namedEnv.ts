import { recipeById, type AgentRecipe } from "./recipes.js";
import { isAgentAutomationRun, type Automation, type AutomationRun } from "./automation.js";
import type { AgentPlacement } from "./placement.js";
import { isAgentPlacement, parseAgentPlacement, placementAllowsRuntime } from "./placement.js";
import type { CreateSessionInput } from "./session.js";
import type { AgentRuntime, GuestOs, NetworkJail } from "./vm.js";
import {
  isAgentRuntime,
  isGuestOs,
  isNetworkJail,
  parseAllowHosts,
  parseDockerImage,
  sessionRuntime,
} from "./vm.js";

/** Operator-named guest preset: golden image + jail + recipe + spend cap + Where. */
export interface NamedEnvironment {
  id: string;
  name: string;
  runtime: AgentRuntime;
  os: GuestOs;
  templateId?: string;
  dockerImage?: string;
  imageId?: string;
  network?: NetworkJail;
  recipeId?: string;
  maxUsd?: number;
  placement?: AgentPlacement;
  backendId?: string;
  allowHosts?: string[];
  createdAt: string;
  updatedAt: string;
}

export const NAMED_ENV_NAME_MAX = 64;

export function clipNamedEnvName(name: string, fallback = "product env"): string {
  const trimmed = name.trim() || fallback;
  return trimmed.length > NAMED_ENV_NAME_MAX ? trimmed.slice(0, NAMED_ENV_NAME_MAX) : trimmed;
}

export function parseNamedEnvironment(raw: unknown): NamedEnvironment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!id || !name || name.length > NAMED_ENV_NAME_MAX) return undefined;
  if (!isAgentRuntime(value.runtime)) return undefined;
  if (typeof value.os !== "string" || !isGuestOs(value.os)) return undefined;
  const dockerImage =
    typeof value.dockerImage === "string" ? parseDockerImage(value.dockerImage) : undefined;
  const imageId =
    typeof value.imageId === "string" && value.imageId.trim() ? value.imageId.trim() : undefined;
  const templateId =
    typeof value.templateId === "string" && value.templateId.trim()
      ? value.templateId.trim()
      : undefined;
  const recipeId =
    typeof value.recipeId === "string" && value.recipeId.trim() ? value.recipeId.trim() : undefined;
  const network = isNetworkJail(value.network) ? value.network : undefined;
  const maxUsd =
    typeof value.maxUsd === "number" && Number.isFinite(value.maxUsd) && value.maxUsd > 0
      ? value.maxUsd
      : undefined;
  const placement = isAgentPlacement(value.placement) ? value.placement : undefined;
  const backendId =
    typeof value.backendId === "string" && value.backendId.trim()
      ? value.backendId.trim()
      : undefined;
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt
      : new Date(0).toISOString();
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt : createdAt;
  const runtime = value.runtime;
  if (placement === "worker" && !placementAllowsRuntime("worker", runtime)) return undefined;
  return {
    id,
    name,
    runtime,
    os: value.os,
    templateId,
    dockerImage: runtime === "docker" ? dockerImage : undefined,
    imageId: runtime === "host" ? undefined : imageId,
    network: runtime === "host" ? undefined : network,
    recipeId,
    maxUsd,
    placement: placement === "worker" ? "worker" : undefined,
    backendId: placement === "worker" ? backendId : undefined,
    allowHosts: runtime === "host" ? undefined : parseAllowHosts(value.allowHosts),
    createdAt,
    updatedAt,
  };
}

export function parseNamedEnvironments(raw: unknown): NamedEnvironment[] {
  if (!Array.isArray(raw)) return [];
  const out: NamedEnvironment[] = [];
  const ids = new Set<string>();
  for (const row of raw) {
    const parsed = parseNamedEnvironment(row);
    if (!parsed || ids.has(parsed.id)) continue;
    ids.add(parsed.id);
    out.push(parsed);
  }
  return out;
}

export function namedEnvironmentById(
  items: NamedEnvironment[] | undefined,
  id: string | undefined,
): NamedEnvironment | undefined {
  const key = id?.trim();
  if (!key) return undefined;
  return (items ?? []).find((row) => row.id === key);
}

export function namedEnvironmentError(
  env: NamedEnvironment,
  opts?: { workerIds?: Iterable<string> },
): string | undefined {
  if (!env.name.trim()) return "Environment name is required";
  if (env.name.length > NAMED_ENV_NAME_MAX) return "Environment name is too long";
  if (env.runtime === "docker" && !parseDockerImage(env.dockerImage ?? "")) {
    return "Docker environments need an image such as locus/agent";
  }
  if (!placementAllowsRuntime(parseAgentPlacement(env.placement), env.runtime)) {
    return "Worker placement is Docker or Host";
  }
  if (env.placement === "worker") {
    if (!env.backendId) return "Pick a worker for this environment";
    const allowed = opts?.workerIds ? new Set(opts.workerIds) : undefined;
    if (allowed && !allowed.has(env.backendId)) return "Unknown worker for this environment";
  }
  return undefined;
}

export function namedEnvironmentsError(
  items: NamedEnvironment[],
  opts?: { workerIds?: Iterable<string> },
): string | undefined {
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const env of items) {
    if (ids.has(env.id)) return `Duplicate environment id: ${env.id}`;
    ids.add(env.id);
    const key = env.name.toLowerCase();
    if (names.has(key)) return `Duplicate environment name: ${env.name}`;
    names.add(key);
    const err = namedEnvironmentError(env, opts);
    if (err) return err;
  }
  return undefined;
}

export function snapshotNamedEnvironment(input: {
  id?: string;
  name: string;
  existing?: NamedEnvironment;
  runtime: AgentRuntime;
  os: GuestOs;
  templateId?: string;
  dockerImage?: string;
  imageId?: string;
  network?: NetworkJail;
  recipeId?: string | null;
  maxUsd?: number;
  placement?: AgentPlacement;
  backendId?: string;
  allowHosts?: string[];
  now?: string;
}): NamedEnvironment | undefined {
  const now = input.now ?? new Date().toISOString();
  const id = input.id?.trim() || input.existing?.id || "";
  const parsed = parseNamedEnvironment({
    id: id || "pending",
    name: input.name,
    runtime: input.runtime,
    os: input.os,
    templateId: input.templateId,
    dockerImage: input.dockerImage,
    imageId: input.imageId,
    network: input.network,
    recipeId: input.recipeId || undefined,
    maxUsd: input.maxUsd,
    placement: input.placement,
    backendId: input.backendId,
    allowHosts: input.allowHosts,
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  });
  if (!parsed) return undefined;
  if (!id) return undefined;
  return parsed;
}

export function upsertNamedEnvironment(
  items: NamedEnvironment[],
  next: NamedEnvironment,
): NamedEnvironment[] {
  const byId = items.findIndex((row) => row.id === next.id);
  if (byId >= 0) {
    const copy = [...items];
    copy[byId] = { ...next, createdAt: items[byId]!.createdAt };
    return copy;
  }
  const byName = items.findIndex((row) => row.name.toLowerCase() === next.name.toLowerCase());
  if (byName >= 0) {
    const copy = [...items];
    copy[byName] = { ...next, id: items[byName]!.id, createdAt: items[byName]!.createdAt };
    return copy;
  }
  return [...items, next];
}

export function applyNamedEnvironment(
  env: NamedEnvironment,
  recipe?: AgentRecipe,
): Partial<CreateSessionInput> & { recipeId?: string } {
  const resolved = recipe ?? (env.recipeId ? recipeById(env.recipeId) : undefined);
  const worker = env.placement === "worker";
  return {
    runtime: env.runtime,
    os: env.os,
    templateId: env.templateId,
    dockerImage: env.runtime === "docker" ? env.dockerImage : undefined,
    imageId: env.runtime === "host" ? undefined : env.imageId,
    network: env.runtime === "host" ? undefined : env.network,
    recipeId: env.recipeId,
    maxUsd: env.maxUsd,
    placement: worker ? "worker" : "local",
    backendId: worker ? env.backendId : undefined,
    allowHosts: env.allowHosts,
    instructions: resolved?.instructions,
    playbook: resolved?.playbook,
    allowedTools: resolved?.allowedTools,
    vision: resolved?.vision,
    kind: resolved?.kind,
  };
}

export function namedEnvironmentSummary(
  env: NamedEnvironment,
  opts?: { recipeTitle?: string; whereLabel?: string },
): string {
  const parts: string[] = [];
  parts.push(env.runtime === "host" ? "Host" : env.runtime === "docker" ? "Docker" : "VM");
  if (env.network === "restricted") parts.push("Restricted");
  else if (env.network === "none") parts.push("No internet");
  else if (env.network === "open") parts.push("Open");
  const recipe = opts?.recipeTitle ?? (env.recipeId ? recipeById(env.recipeId)?.title : undefined);
  if (recipe) parts.push(recipe);
  if (typeof env.maxUsd === "number") parts.push(`$${trimUsd(env.maxUsd)}`);
  if (opts?.whereLabel) parts.push(opts.whereLabel);
  else if (env.placement === "worker") parts.push("Worker");
  return parts.join(" · ");
}

function trimUsd(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function parseSpendUsd(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function clipFact(text: string, max = 72): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function automationLastFact(item: Pick<Automation, "memories">): string | undefined {
  const memories = item.memories ?? [];
  if (!memories.length) return undefined;
  return [...memories].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  )[0]?.text;
}

export function automationLatestRun(
  runs: AutomationRun[],
  automationId: string,
): AutomationRun | undefined {
  return runs
    .filter((run) => run.automationId === automationId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export function automationLatestAgentRun(
  runs: AutomationRun[],
  automationId: string,
): AutomationRun | undefined {
  return runs
    .filter((run) => run.automationId === automationId && isAgentAutomationRun(run))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export type AutomationHealth = "healthy" | "failing" | "paused" | "needs_you";

export function automationHealth(
  item: Pick<Automation, "id" | "enabled">,
  latest: AutomationRun | undefined,
): AutomationHealth {
  if (!item.enabled) return "paused";
  if (latest?.status === "needs_you") return "needs_you";
  if (latest?.status === "failed") return "failing";
  return "healthy";
}

export function automationHealthCounts(
  items: Pick<Automation, "id" | "enabled">[],
  runs: AutomationRun[],
): { healthy: number; failing: number; paused: number; needsYou: number } {
  let healthy = 0;
  let failing = 0;
  let paused = 0;
  let needsYou = 0;
  for (const item of items) {
    const health = automationHealth(item, automationLatestAgentRun(runs, item.id));
    if (health === "paused") paused += 1;
    else if (health === "failing") failing += 1;
    else if (health === "needs_you") needsYou += 1;
    else healthy += 1;
  }
  return { healthy, failing, paused, needsYou };
}

export function formatAutomationHealth(counts: {
  healthy: number;
  failing: number;
  paused: number;
  needsYou?: number;
}): string {
  const base = `${counts.healthy} healthy · ${counts.failing} failing · ${counts.paused} paused`;
  return counts.needsYou ? `${base} · ${counts.needsYou} needs you` : base;
}

export function formatNextFire(
  item: Pick<Automation, "enabled" | "schedule" | "nextRunAt">,
): string | undefined {
  if (!item.enabled) return undefined;
  if (
    item.schedule.kind === "forge" ||
    item.schedule.kind === "pull_request" ||
    item.schedule.kind === "webhook"
  ) {
    return item.schedule.kind === "webhook" ? "On webhook" : undefined;
  }
  return item.nextRunAt;
}

export function namedEnvironmentSessionFields(
  item: Pick<
    Automation,
    | "namedEnvironmentId"
    | "runtime"
    | "os"
    | "templateId"
    | "dockerImage"
    | "imageId"
    | "maxUsd"
    | "allowHosts"
    | "placement"
    | "backendId"
    | "network"
  >,
  env: NamedEnvironment | undefined,
): Pick<
  CreateSessionInput,
  | "runtime"
  | "os"
  | "templateId"
  | "dockerImage"
  | "imageId"
  | "maxUsd"
  | "allowHosts"
  | "placement"
  | "backendId"
  | "network"
  | "instructions"
  | "playbook"
  | "allowedTools"
  | "vision"
  | "kind"
> {
  const applied = env ? applyNamedEnvironment(env) : {};
  const runtime = applied.runtime ?? sessionRuntime(item);
  const worker = (applied.placement ?? item.placement) === "worker";
  return {
    runtime,
    os: applied.os ?? item.os,
    templateId: applied.templateId ?? item.templateId,
    dockerImage: runtime === "docker" ? (applied.dockerImage ?? item.dockerImage) : undefined,
    imageId: runtime === "host" ? undefined : (applied.imageId ?? item.imageId),
    maxUsd: applied.maxUsd ?? item.maxUsd,
    allowHosts: applied.allowHosts ?? item.allowHosts,
    placement: worker ? "worker" : undefined,
    backendId: worker ? (applied.backendId ?? item.backendId) : undefined,
    network:
      runtime === "host"
        ? undefined
        : (applied.network ??
          item.network ??
          (runtime === "docker" || runtime === "vm" ? "restricted" : undefined)),
    instructions: applied.instructions,
    playbook: applied.playbook,
    allowedTools: applied.allowedTools,
    vision: applied.vision,
    kind: applied.kind,
  };
}
