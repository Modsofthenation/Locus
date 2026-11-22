/**
 * `locus ci run` — headless agent run for CI. Starts an ephemeral control plane when none is
 * reachable, creates one agent from a recipe or prompt, auto-denies approvals unless `--allow`
 * rules match, streams progress, writes a JSON result, and exits 0 pass / 1 fail / 2 approval /
 * 3 error.
 */
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DOCKER_IMAGE,
  ciAllowRuleFor,
  ciCostUsd,
  ciExitCode,
  ciOutcome,
  ciPendingApproval,
  ciTestsFromSession,
  formatCiComment,
  isCiRecipe,
  parsePullUrl,
  recipeById,
  resolveUsageRates,
  type AgentSession,
  type CiOutcome,
  type CiResult,
  type CreateSessionInput,
  type LinkedRepo,
  type LocusConfig,
  type ParsedPullUrl,
  type ToolCall,
} from "@locus/shared";
import { UsageError, flagBool, flagList, flagNum, flagStr } from "./args.js";
import { LocusClient } from "./client.js";
import type { Ctx } from "./commands.js";
import { CliExitError } from "./exit.js";
import { printJson } from "./format.js";

export interface CiPlane {
  client: LocusClient;
  ephemeral: boolean;
  stop: () => Promise<void>;
}

async function healthy(client: LocusClient): Promise<boolean> {
  try {
    await client.get("/api/health");
    return true;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

/** Reuse a running control plane (or `--api`), else spawn one on a free loopback port. */
export async function ensureCiPlane(ctx: Ctx, log: (line: string) => void): Promise<CiPlane> {
  const explicit = Boolean(flagStr(ctx.flags, "api"));
  if (!flagBool(ctx.flags, "ephemeral") && (await healthy(ctx.client))) {
    log(`Using control plane at ${ctx.client.baseUrl}`);
    return { client: ctx.client, ephemeral: false, stop: async () => undefined };
  }
  if (explicit) throw new Error(`Cannot reach Locus at ${ctx.client.baseUrl}`);
  const homeFlag = flagStr(ctx.flags, "home");
  const home = homeFlag ? resolve(homeFlag) : await mkdtemp(join(tmpdir(), "locus-ci-"));
  const port = await freePort();
  // The ephemeral plane has its own LOCUS_HOME; hand it a token rather than read the user's file.
  const operatorToken = `op_${randomBytes(32).toString("hex")}`;
  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");
  const entry = fileURLToPath(new URL("../../server/src/index.ts", import.meta.url));
  log(`Starting an ephemeral control plane on 127.0.0.1:${port} (LOCUS_HOME=${home})`);
  const child: ChildProcess = spawn(process.execPath, [tsxCli, entry], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      LOCUS_HOME: home,
      PORT: String(port),
      LOCUS_CI: "1",
      LOCUS_OPERATOR_TOKEN: operatorToken,
    },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  const client = new LocusClient(`http://127.0.0.1:${port}`, () => operatorToken);
  const stop = async () => {
    if (child.exitCode == null) {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode == null) child.kill("SIGKILL");
    }
    if (!homeFlag && !flagBool(ctx.flags, "keep-home")) {
      await rm(home, { recursive: true, force: true }).catch(() => undefined);
    }
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      await stop();
      throw new Error(`Control plane exited (${child.exitCode}). ${stderr.trim().slice(-800)}`);
    }
    if (await healthy(client)) return { client, ephemeral: true, stop };
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error("Control plane did not become healthy within 120s");
}

/**
 * On an ephemeral plane only: seed provider keys and a GitHub token from the CI environment
 * (ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN / GH_TOKEN). A shared plane is never changed.
 */
async function seedEphemeralConfig(
  client: LocusClient,
  log: (line: string) => void,
): Promise<void> {
  const config = await client.get<LocusConfig>("/api/config");
  let changed = false;
  const envKeys: Array<[string, string | undefined]> = [
    ["anthropic", process.env.ANTHROPIC_API_KEY],
    ["openai", process.env.OPENAI_API_KEY],
  ];
  for (const [kind, key] of envKeys) {
    if (!key?.trim()) continue;
    const provider = config.providers.find((row) => row.kind === kind);
    if (!provider) continue;
    provider.apiKey = key.trim();
    provider.enabled = true;
    changed = true;
    log(`Using ${kind} key from the environment`);
  }
  const gh = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)?.trim();
  if (gh) {
    const forge = config.forges.find((row) => row.kind === "github");
    if (forge) {
      forge.token = gh;
      changed = true;
      log("Using GITHUB_TOKEN for the GitHub forge");
    }
  }
  if (changed) await client.put("/api/config", config);
}

function normalizeRepoUrl(url: string): string {
  return url
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

async function linkRepo(client: LocusClient, url: string): Promise<LinkedRepo> {
  const repos = await client.get<LinkedRepo[]>("/api/repos");
  const want = normalizeRepoUrl(url);
  const hit = repos.find((row) => normalizeRepoUrl(row.checkout.url) === want);
  if (hit) return hit;
  return client.post<LinkedRepo>("/api/repos", { url });
}

function pickProvider(config: LocusConfig, flag?: string) {
  if (flag) {
    const hit = config.providers.find((row) => row.id === flag || row.name === flag);
    if (!hit) throw new UsageError(`Unknown provider ${flag}`);
    return hit;
  }
  return (
    config.providers.find((row) => row.enabled && row.apiKey?.trim()) ??
    config.providers.find((row) => row.enabled) ??
    config.providers[0]
  );
}

async function isLocalPath(value: string): Promise<boolean> {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^git@/.test(value)) return false;
  try {
    return (await stat(resolve(value))).isDirectory();
  } catch {
    return false;
  }
}

interface CiPlan {
  recipe?: string;
  pr?: ParsedPullUrl & { url: string };
  repoId?: string;
}

async function createCiSession(
  ctx: Ctx,
  client: LocusClient,
  config: LocusConfig,
  log: (line: string) => void,
): Promise<{ session: AgentSession; plan: CiPlan }> {
  const recipeId = flagStr(ctx.flags, "recipe");
  if (recipeId && !isCiRecipe(recipeId)) {
    throw new UsageError("--recipe must be pr-reviewer or repo-fixer");
  }
  const prUrl = flagStr(ctx.flags, "pr");
  const pr = prUrl ? parsePullUrl(prUrl) : undefined;
  if (prUrl && !pr) throw new UsageError(`Cannot parse --pr ${prUrl}`);
  const promptFlag = flagStr(ctx.flags, "prompt") ?? (ctx.args.join(" ").trim() || undefined);
  const recipeName = recipeId ?? (pr && !promptFlag ? "pr-reviewer" : undefined);
  if (!recipeName && !promptFlag) throw new UsageError("Pass --recipe or --prompt");
  const recipe = recipeName ? recipeById(recipeName) : undefined;
  const provider = pickProvider(config, flagStr(ctx.flags, "provider"));
  if (!provider) throw new UsageError("No model provider configured");
  const model = flagStr(ctx.flags, "model") || provider.defaultModel;
  const maxUsd = flagNum(ctx.flags, "max-usd");
  const plan: CiPlan = { recipe: recipeName, pr: pr && prUrl ? { ...pr, url: prUrl } : undefined };

  if (recipeName === "pr-reviewer" && pr) {
    const repo = await linkRepo(client, pr.repoUrl);
    plan.repoId = repo.id;
    log(`Reviewing ${pr.owner}/${pr.repo}#${pr.number} with ${model}`);
    const session = await client.post<AgentSession>(
      `/api/repos/${repo.id}/pulls/${pr.number}/review-session`,
      { providerId: provider.id, model, maxUsd },
    );
    return { session, plan };
  }

  const repoFlag = flagStr(ctx.flags, "repo");
  const local = repoFlag ? await isLocalPath(repoFlag) : false;
  const runtimeFlag = flagStr(ctx.flags, "runtime");
  if (runtimeFlag && runtimeFlag !== "host" && runtimeFlag !== "docker") {
    throw new UsageError("--runtime must be host or docker");
  }
  const runtime = (runtimeFlag ?? (local ? "host" : (recipe?.runtime ?? "docker"))) as
    "host" | "docker";
  if (local && runtime === "docker") {
    throw new UsageError("--repo <path> runs on --runtime host; pass a clone URL for docker");
  }
  if (!local && repoFlag) {
    const repo = await linkRepo(client, repoFlag);
    plan.repoId = repo.id;
  } else if (!repoFlag && pr) {
    const repo = await linkRepo(client, pr.repoUrl);
    plan.repoId = repo.id;
  }
  const template =
    config.templates.find((row) => row.os === "ubuntu")?.id ?? config.templates[0]?.id ?? "";
  const promptParts = [promptFlag ?? recipe?.prompt ?? ""];
  if (pr) promptParts.push(`Pull request: ${pr.repoUrl}/pull/${pr.number}`);
  const input: CreateSessionInput = {
    title: `CI · ${recipeName ?? "prompt"}${pr ? ` #${pr.number}` : ""}`,
    os: "ubuntu",
    templateId: template,
    kind: recipe?.kind ?? "agent",
    runtime,
    providerId: provider.id,
    model,
    startVm: runtime !== "host",
    prompt: promptParts.filter(Boolean).join("\n\n"),
    dockerImage: runtime === "docker" ? recipe?.dockerImage || DEFAULT_DOCKER_IMAGE : undefined,
    hostDir: local && repoFlag ? resolve(repoFlag) : undefined,
    repoId: plan.repoId,
    playbook: recipe?.playbook,
    allowedTools: recipe?.allowedTools,
    maxUsd: maxUsd && maxUsd > 0 ? maxUsd : undefined,
  };
  log(`Starting ${recipeName ?? "agent"} on ${runtime} with ${model}`);
  const session = await client.post<AgentSession>("/api/sessions", input);
  return { session, plan };
}

function describeCall(call: ToolCall): string {
  const args = call.arguments ?? {};
  const hint =
    (typeof args.command === "string" && args.command) ||
    (typeof args.path === "string" && args.path) ||
    (typeof args.branch === "string" && args.branch) ||
    "";
  return hint ? `${call.name} ${hint.replace(/\s+/g, " ").slice(0, 80)}` : call.name;
}

/** Print tool starts/finishes and system notes the first time they show up. */
export class CiProgress {
  private started = new Set<string>();
  private finished = new Set<string>();
  private notes = new Set<string>();

  constructor(private readonly log: (line: string) => void) {}

  update(session: AgentSession): void {
    for (const message of session.messages) {
      if (message.role === "system" && !message.hidden && !this.notes.has(message.id)) {
        this.notes.add(message.id);
        this.log(`· ${message.content.split("\n")[0]!.slice(0, 200)}`);
      }
      for (const call of message.toolCalls ?? []) {
        if (message.role === "tool") continue;
        if (!this.started.has(call.id)) {
          this.started.add(call.id);
          this.log(`→ ${describeCall(call)}`);
        }
        const over = call.result !== undefined || call.error !== undefined;
        if (over && !this.finished.has(call.id)) {
          this.finished.add(call.id);
          this.log(`${call.error ? "✗" : "✓"} ${call.name}`);
        }
      }
    }
  }
}

function lastAssistant(session: AgentSession): string | undefined {
  return [...session.messages].reverse().find((m) => m.role === "assistant" && m.content.trim())
    ?.content;
}

/** Turn ended: not working, no queued prompt, and the agent replied after the last user turn. */
export function ciTurnSettled(session: AgentSession, sawRunning: boolean): boolean {
  if (session.status === "running" || session.status === "provisioning") return false;
  if (session.status === "error") return true;
  if (session.queue?.length) return false;
  const lastUser = session.messages.map((m) => m.role).lastIndexOf("user");
  const replied = session.messages.slice(lastUser + 1).some((m) => m.role === "assistant");
  return sawRunning || (lastUser >= 0 && replied);
}

export async function cmdCiRun(ctx: Ctx): Promise<void> {
  const startedAt = new Date().toISOString();
  const quiet = ctx.json;
  const log = (line: string) => {
    if (!quiet) ctx.writeln(line);
    else ctx.err(line);
  };
  const allow = flagList(ctx.flags, "allow");
  const stopOnApproval = flagBool(ctx.flags, "no-auto-deny");
  const timeoutMs = (flagNum(ctx.flags, "timeout") ?? 1800) * 1000;
  let plane: CiPlane | undefined;
  let session: AgentSession | undefined;
  let plan: CiPlan = {};
  let error: string | undefined;
  let pending: ToolCall | undefined;
  let config: LocusConfig | undefined;
  const denied: CiResult["deniedApprovals"] = [];
  const allowed: CiResult["allowedApprovals"] = [];
  try {
    plane = await ensureCiPlane(ctx, log);
    if (plane.ephemeral) await seedEphemeralConfig(plane.client, log);
    config = await plane.client.get<LocusConfig>("/api/config");
    const created = await createCiSession(ctx, plane.client, config, log);
    plan = created.plan;
    session = created.session;
    log(`Session ${session.id}`);
    const progress = new CiProgress(log);
    const deadline = Date.now() + timeoutMs;
    const answered = new Set<string>();
    let sawRunning = false;
    for (;;) {
      session = await plane.client.get<AgentSession>(`/api/sessions/${session.id}`);
      progress.update(session);
      if (session.status === "running" || session.status === "provisioning") sawRunning = true;
      const waiting = ciPendingApproval(session);
      if (waiting && !answered.has(waiting.id)) {
        const rule = ciAllowRuleFor(allow, waiting);
        if (rule) {
          answered.add(waiting.id);
          allowed.push({ tool: waiting.name, callId: waiting.id, rule });
          log(`✔ allow ${describeCall(waiting)} (${rule})`);
          await plane.client.post(`/api/sessions/${session.id}/approvals`, {
            toolCallId: waiting.id,
            decision: "approved",
          });
        } else if (stopOnApproval) {
          pending = waiting;
          log(`⏸ ${describeCall(waiting)} needs approval; stopping (--no-auto-deny)`);
          await plane.client.post(`/api/sessions/${session.id}/chat/abort`).catch(() => undefined);
          break;
        } else {
          answered.add(waiting.id);
          denied.push({ tool: waiting.name, callId: waiting.id });
          log(`✖ deny ${describeCall(waiting)} (no --allow rule matched)`);
          await plane.client.post(`/api/sessions/${session.id}/approvals`, {
            toolCallId: waiting.id,
            decision: "denied",
          });
        }
        continue;
      }
      if (!waiting && ciTurnSettled(session, sawRunning)) break;
      if (Date.now() > deadline) {
        error = `Timed out after ${Math.round(timeoutMs / 1000)}s`;
        await plane.client.post(`/api/sessions/${session.id}/chat/abort`).catch(() => undefined);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const reply = session ? lastAssistant(session) : undefined;
    if (reply && !quiet) ctx.writeln(`\n${reply.trim()}\n`);
  } catch (err) {
    if (err instanceof UsageError) {
      await plane?.stop();
      throw err;
    }
    error = err instanceof Error ? err.message : String(err);
  }

  const outcome = ciOutcome({ session, error, pending: Boolean(pending) });
  const provider = config?.providers.find((row) => row.id === session?.providerId);
  const result: CiResult = {
    ...outcome,
    exitCode: ciExitCode(outcome.outcome),
    sessionId: session?.id,
    recipe: plan.recipe,
    model: session?.model,
    costUsd: session ? ciCostUsd(session, resolveUsageRates(provider, session.model)) : undefined,
    tokens: session?.usage
      ? { input: session.usage.inputTokens, output: session.usage.outputTokens }
      : undefined,
    tests: session ? ciTestsFromSession(session) : { ran: 0 },
    deniedApprovals: denied,
    allowedApprovals: allowed,
    pendingApproval: pending ? { tool: pending.name, callId: pending.id } : undefined,
    pr: plan.pr?.url,
    startedAt,
    finishedAt: new Date().toISOString(),
  };

  if (
    flagBool(ctx.flags, "post-comment") &&
    plane &&
    plan.pr &&
    plan.repoId &&
    result.verdict !== "NONE"
  ) {
    try {
      const posted = await plane.client.post<{ url?: string; htmlUrl?: string }>(
        `/api/repos/${plan.repoId}/pulls/${plan.pr.number}/comments`,
        { body: formatCiComment(result) },
      );
      result.commentUrl = posted?.htmlUrl ?? posted?.url;
      log(`Posted verdict comment on ${plan.pr.url}`);
    } catch (err) {
      log(`Could not post PR comment: ${err instanceof Error ? err.message : err}`);
    }
  }

  await plane?.stop();
  const out = flagStr(ctx.flags, "out");
  if (out) await writeFile(resolve(out), `${JSON.stringify(result, null, 2)}\n`);
  if (ctx.json) printJson(ctx.writeln, result);
  else ctx.writeln(formatCiSummary(result));
  if (result.exitCode !== 0) throw new CliExitError(result.exitCode);
}

export function formatCiSummary(result: CiResult): string {
  const label: Record<CiOutcome, string> = {
    pass: "PASS",
    fail: "FAIL",
    approval: "WAITING FOR APPROVAL",
    error: "ERROR",
  };
  const lines = [
    `Locus CI: ${label[result.outcome]}${result.verdict !== "NONE" ? ` (verdict ${result.verdict}${result.risk ? `, risk ${result.risk}` : ""})` : ""}`,
    ...result.reasons.map((reason) => `  - ${reason.split("\n")[0]}`),
  ];
  const facts = [
    result.sessionId ? `session ${result.sessionId}` : undefined,
    typeof result.costUsd === "number" ? `$${result.costUsd.toFixed(4)}` : undefined,
    result.tokens ? `${result.tokens.input + result.tokens.output} tokens` : undefined,
    result.tests.ran ? `tests ${result.tests.passed ? "passed" : "failed"}` : undefined,
    result.deniedApprovals.length ? `${result.deniedApprovals.length} approvals denied` : undefined,
  ].filter(Boolean);
  if (facts.length) lines.push(`  ${facts.join(" · ")}`);
  return lines.join("\n");
}
