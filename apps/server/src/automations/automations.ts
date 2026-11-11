import { randomBytes, randomUUID } from "node:crypto";
import {
  CANCELLED_TURN_NOTE,
  automationLifetimeSpendUsd,
  automationRunReason,
  automationScheduleOpts,
  cloneAutomationInput,
  clipFact,
  automationRunUsd,
  computeNextRunAt,
  formatAutomationPrompt,
  INTERRUPTED_AUTOMATION_RUN_NOTE,
  LIFETIME_CAP_SKIP_REASON,
  normalizeBlackoutDates,
  normalizeNotify,
  normalizeOverlap,
  normalizeTimeZone,
  OVERLAP_SKIP_REASON,
  overLifetimeCap,
  RUN_SUMMARY_MAX,
  invalidHttpUrl,
  isAutonomyTier,
  isEventSchedule,
  nextCloneName,
  TEST_WEBHOOK_SKIP_REASON,
  isSlackIncomingWebhookUrl,
  isWindows,
  canRewind,
  lastAssistantText,
  attachLinkedCheckout,
  automationChatIdsToPrune,
  automationChatLimit,
  normalizeMemories,
  looksLikeRememberedSecret,
  MAX_WEBHOOK_BYTES,
  parseAllowHosts,
  parseDockerImage,
  parseMcpToolNames,
  parseOwnerRepo,
  resolveForgeAccount,
  runtimeNeedsGuest,
  sessionRuntime,
  shouldNotifyAutomationOutcome,
  slackChannelAllowed,
  slackClientReady,
  slackNotifyBody,
  validateHardwareOverride,
  validateSchedule,
  isNetworkJail,
  namedEnvironmentById,
  policyAllowsAutonomous,
  policyAllowsHostAutomations,
  policyForcedJail,
  namedEnvironmentSessionFields,
  isMaskedSecret,
  webhookTimestampValid,
  type Automation,
  type AutomationEvent,
  type AutomationRun,
  type AutomationTrigger,
  type CreateAutomationInput,
  type PatchAutomationInput,
  type SessionStatus,
} from "@locus/shared";
import type { Hub } from "../core/hub.js";
import type { SessionService } from "../session/sessions.js";
import { slackSignatureValid } from "../slack/slack.js";
import { SlackApi } from "../slack/slackApi.js";
import type { JsonStore } from "../core/store.js";
import { ForgeClient } from "../git/forge.js";
import { withFreshForgeToken } from "../git/forgeOauth.js";
import { resolveOptionalHostDir } from "../workspace/hostWorkspace.js";
import { createRateLimiter } from "../core/rateLimit.js";
import { decideWebhook, forgeRunEvent, locusWebhookAuthorized } from "./automationWebhook.js";

function stamp(date = new Date()): string {
  return date.toISOString();
}

interface FollowUp {
  trigger: AutomationTrigger;
  event?: AutomationEvent;
  run?: AutomationRun;
}

export class AutomationService {
  private inFlight = new Set<string>();
  private followUp = new Map<string, FollowUp>();
  private cancelled = new Set<string>();
  private removed = new Set<string>();
  private ticking = false;
  private writes: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private halted = false;

  private readonly forge: ForgeClient;
  private readonly hookLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: SessionService,
    private readonly hub: Hub,
    private readonly opts: {
      now?: () => Date;
      waitMs?: number;
      pollMs?: number;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.forge = new ForgeClient(opts.fetch ?? fetch);
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private runWrite<T>(work: () => Promise<T>): Promise<T> {
    const done = this.writes.then(work, work);
    this.writes = done.then(
      () => undefined,
      () => undefined,
    );
    return done;
  }

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.halted = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  pause(): boolean {
    const running = Boolean(this.timer);
    this.stop();
    this.halted = true;
    return running;
  }

  resume(running: boolean): void {
    this.halted = false;
    if (running) this.start();
  }

  async list(): Promise<Automation[]> {
    const items = await this.store.loadAutomations();
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<Automation | undefined> {
    return (await this.store.loadAutomations()).find((a) => a.id === id);
  }

  async listRuns(
    automationId?: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<AutomationRun[]> {
    const runs = await this.store.loadRuns();
    const filtered = automationId ? runs.filter((r) => r.automationId === automationId) : runs;
    const sorted = filtered.sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
    );
    const offset =
      typeof opts?.offset === "number" && Number.isFinite(opts.offset) && opts.offset > 0
        ? Math.floor(opts.offset)
        : 0;
    const limit =
      typeof opts?.limit === "number" && Number.isFinite(opts.limit) && opts.limit > 0
        ? Math.floor(opts.limit)
        : undefined;
    return limit != null ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
  }

  /** The automation's linked repo id, or undefined when that linked repo has been removed. */
  private async liveRepoId(repoId: string | undefined): Promise<string | undefined> {
    if (!repoId) return undefined;
    const repos = await this.store.loadRepos();
    return repos.some((row) => row.id === repoId) ? repoId : undefined;
  }

  private async assertNamedEnvironment(item: Automation): Promise<void> {
    if (!item.namedEnvironmentId) return;
    const config = await this.store.loadConfig();
    if (!namedEnvironmentById(config.namedEnvironments, item.namedEnvironmentId)) {
      throw new Error("Unknown environment");
    }
    if (item.placement === "worker" && !item.backendId) {
      throw new Error("Pick a worker for this environment");
    }
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    return this.runWrite(() => this.createUnlocked(input));
  }

  private async createUnlocked(input: CreateAutomationInput): Promise<Automation> {
    const config = await this.store.loadConfig();
    const runtime = sessionRuntime(input);
    if (runtime === "host" && !policyAllowsHostAutomations(config.managedPolicy)) {
      throw new Error("Managed policy does not allow Host automations");
    }
    if (input.autonomy === "autonomous" && !policyAllowsAutonomous(config.managedPolicy)) {
      throw new Error("Managed policy does not allow Autonomous mode");
    }
    const forcedJail = policyForcedJail(config.managedPolicy);
    if (forcedJail) input.network = forcedJail;
    const template = config.templates.find((t) => t.id === input.templateId);
    if (runtime !== "host" && !template) throw new Error(`Unknown template: ${input.templateId}`);
    if (runtime === "docker") {
      if (isWindows(input.os) || isWindows(template!.os))
        throw new Error("Docker jobs are Linux-only");
      if (!parseDockerImage(input.dockerImage ?? "")) {
        throw new Error("Enter a Docker image such as ubuntu:24.04");
      }
    } else if (runtime === "vm" && template!.os !== input.os) {
      throw new Error("Template OS does not match job OS");
    }
    if (!input.name.trim()) throw new Error("Name is required");
    if (!input.prompt.trim()) throw new Error("Prompt is required");
    const scheduleError = validateSchedule(input.schedule);
    if (scheduleError) throw new Error(scheduleError);
    const hwError = input.hardware ? validateHardwareOverride(input.hardware) : undefined;
    if (hwError) throw new Error(hwError);

    const created = this.now();
    const gitEvent = input.schedule.kind === "forge" || input.schedule.kind === "pull_request";
    const attached = attachLinkedCheckout(await this.store.loadRepos(), {
      repoId: input.repoId,
      repo: input.repo,
    });
    if (gitEvent && !attached.repo?.url) {
      throw new Error(
        "Attach a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps repository to run on git events",
      );
    }
    if (
      input.notifyWebhook?.trim() &&
      invalidHttpUrl(input.notifyWebhook.trim(), "Notify webhook")
    ) {
      throw new Error(invalidHttpUrl(input.notifyWebhook.trim(), "Notify webhook"));
    }
    const eventDriven = isEventSchedule(input.schedule);
    const item: Automation = {
      id: randomUUID(),
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      prompt: input.prompt.trim(),
      os: runtime === "host" && isWindows(input.os) ? "ubuntu" : input.os,
      templateId: template?.id ?? (input.templateId || "host"),
      runtime: runtime === "vm" ? undefined : runtime,
      dockerImage: runtime === "docker" ? parseDockerImage(input.dockerImage ?? "") : undefined,
      hostDir:
        runtime === "host"
          ? await resolveOptionalHostDir(input.hostDir, this.store.dataDir)
          : undefined,
      providerId: input.providerId,
      model: input.model,
      repo: attached.repo,
      repoId: attached.repoId,
      hardware: runtime === "vm" ? input.hardware : undefined,
      startVm: runtime === "host" ? false : (input.startVm ?? true),
      reuseSession: input.reuseSession ?? Boolean(input.namedEnvironmentId?.trim()),
      ownerSessionId: input.ownerSessionId?.trim() || undefined,
      persistMemory:
        input.persistMemory === true ||
        (input.persistMemory === undefined && Boolean(input.namedEnvironmentId?.trim()))
          ? true
          : undefined,
      imageId: runtime === "host" ? undefined : input.imageId,
      namedEnvironmentId: input.namedEnvironmentId?.trim() || undefined,
      placement: input.placement === "worker" ? "worker" : undefined,
      backendId: input.placement === "worker" ? input.backendId?.trim() || undefined : undefined,
      network:
        runtime === "host" ? undefined : isNetworkJail(input.network) ? input.network : undefined,
      schedule: input.schedule,
      notifyWebhook: input.notifyWebhook?.trim() || undefined,
      notifyChannel: input.notifyChannel?.trim() || undefined,
      allowedMcpTools: parseMcpToolNames(input.allowedMcpTools),
      allowHosts: parseAllowHosts(input.allowHosts),
      maxUsd: typeof input.maxUsd === "number" && input.maxUsd > 0 ? input.maxUsd : undefined,
      lifetimeMaxUsd:
        typeof input.lifetimeMaxUsd === "number" && input.lifetimeMaxUsd > 0
          ? input.lifetimeMaxUsd
          : undefined,
      overlap: normalizeOverlap(input.overlap),
      timeZone: normalizeTimeZone(input.timeZone),
      blackoutDates: normalizeBlackoutDates(input.blackoutDates),
      notify: normalizeNotify(input.notify),
      autonomy: isAutonomyTier(input.autonomy) ? input.autonomy : undefined,
      webhookSecret: eventDriven ? newSecret() : undefined,
      nextRunAt: eventDriven
        ? undefined
        : computeNextRunAt(input.schedule, created, {
            timeZone: normalizeTimeZone(input.timeZone),
            blackoutDates: normalizeBlackoutDates(input.blackoutDates),
          }).toISOString(),
      createdAt: stamp(created),
      updatedAt: stamp(created),
    };
    await this.assertNamedEnvironment(item);
    await this.store.replaceAutomation(item);
    this.hub.broadcast({ type: "automation.updated", automation: item });
    return item;
  }

  async clone(id: string): Promise<Automation> {
    const item = await this.get(id);
    if (!item) throw new Error("Job not found");
    const names = (await this.list()).map((row) => row.name);
    const copy = await this.create(cloneAutomationInput(item, nextCloneName(item.name, names)));
    if (item.slackSigningSecret) {
      return this.patch(copy.id, { slackSigningSecret: item.slackSigningSecret });
    }
    return copy;
  }

  async testWebhook(id: string): Promise<AutomationRun> {
    const item = await this.get(id);
    if (!item) throw new Error("Job not found");
    if (!isEventSchedule(item.schedule)) {
      throw new Error("This automation is not triggered by webhooks");
    }
    if (!item.enabled) throw new Error("Job is paused");
    const now = this.now();
    const trigger: AutomationTrigger =
      item.schedule.kind === "pull_request"
        ? "pull_request"
        : item.schedule.kind === "forge"
          ? "forge"
          : "webhook";
    const run: AutomationRun = {
      id: randomUUID(),
      automationId: id,
      status: "skipped",
      trigger,
      error: TEST_WEBHOOK_SKIP_REASON,
      startedAt: stamp(now),
      finishedAt: stamp(now),
    };
    await this.persistRun(run);
    return run;
  }

  async patch(id: string, input: PatchAutomationInput): Promise<Automation> {
    return this.runWrite(() => this.patchUnlocked(id, input));
  }

  private async patchUnlocked(id: string, input: PatchAutomationInput): Promise<Automation> {
    const item = await this.get(id);
    if (!item) throw new Error("Job not found");
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error("Name is required");
      item.name = input.name.trim();
    }
    if (input.prompt !== undefined) {
      if (!input.prompt.trim()) throw new Error("Prompt is required");
      item.prompt = input.prompt.trim();
    }
    if (input.os) item.os = input.os;
    if (input.templateId) item.templateId = input.templateId;
    if (input.runtime)
      item.runtime = sessionRuntime(input) === "vm" ? undefined : sessionRuntime(input);
    if (input.dockerImage !== undefined) {
      item.dockerImage = input.dockerImage ? parseDockerImage(input.dockerImage) : undefined;
    }
    if (input.hostDir !== undefined) {
      item.hostDir =
        input.hostDir === null
          ? undefined
          : await resolveOptionalHostDir(input.hostDir, this.store.dataDir);
    }
    const config = await this.store.loadConfig();
    const runtime = sessionRuntime(item);
    const template = config.templates.find((t) => t.id === item.templateId);
    if (runtime !== "host" && !template) throw new Error(`Unknown template: ${item.templateId}`);
    if (runtime === "docker") {
      if (isWindows(item.os) || isWindows(template!.os))
        throw new Error("Docker jobs are Linux-only");
      if (!parseDockerImage(item.dockerImage ?? "")) {
        throw new Error("Enter a Docker image such as ubuntu:24.04");
      }
    } else if (runtime === "vm" && template!.os !== item.os) {
      throw new Error("Template OS does not match job OS");
    }
    if (input.providerId) item.providerId = input.providerId;
    if (input.model) item.model = input.model;
    if (input.repo !== undefined || input.repoId !== undefined) {
      const repos = await this.store.loadRepos();
      // `repo: null` with no explicit repoId means "clear the repo" — do not re-attach the
      // previously linked checkout. A stored repoId whose linked repo was since removed is
      // dropped (the checkout is re-matched by URL) instead of failing every save.
      const storedRepoId =
        input.repo === null || !repos.some((row) => row.id === item.repoId)
          ? undefined
          : item.repoId;
      // Older clients echo the stored (possibly stale) repoId back on every save.
      const requestedRepoId =
        input.repoId === undefined || input.repoId === item.repoId
          ? storedRepoId
          : input.repoId || undefined;
      const attached = attachLinkedCheckout(repos, {
        repoId: requestedRepoId,
        repo: input.repo === undefined ? item.repo : (input.repo ?? undefined),
      });
      item.repo = attached.repo;
      item.repoId = attached.repoId;
    }
    if (input.hardware !== undefined) {
      if (input.hardware) {
        const hwError = validateHardwareOverride(input.hardware);
        if (hwError) throw new Error(hwError);
      }
      item.hardware = input.hardware ?? undefined;
    }
    if (input.startVm !== undefined) item.startVm = input.startVm;
    if (input.reuseSession !== undefined) item.reuseSession = input.reuseSession;
    if (input.ownerSessionId !== undefined) {
      item.ownerSessionId = input.ownerSessionId?.trim() || undefined;
    }
    if (input.persistMemory !== undefined)
      item.persistMemory = input.persistMemory ? true : undefined;
    if (input.memories !== undefined) {
      const next = input.memories === null ? [] : normalizeMemories(input.memories);
      if (next.some((row) => looksLikeRememberedSecret(row.text))) {
        throw new Error("Refusing to store a secret. Keep tokens in Settings.");
      }
      item.memories = next.length ? next : undefined;
    }
    if (input.imageId !== undefined) item.imageId = input.imageId || undefined;
    if (input.namedEnvironmentId !== undefined)
      item.namedEnvironmentId = input.namedEnvironmentId?.trim() || undefined;
    if (input.placement !== undefined) {
      item.placement = input.placement === "worker" ? "worker" : undefined;
    }
    if (input.backendId !== undefined) item.backendId = input.backendId?.trim() || undefined;
    if (item.placement !== "worker") item.backendId = undefined;
    if (input.network !== undefined)
      item.network = input.network && isNetworkJail(input.network) ? input.network : undefined;
    if (input.notifyWebhook !== undefined) {
      const url = input.notifyWebhook?.trim() || undefined;
      if (url) {
        const invalid = invalidHttpUrl(url, "Notify webhook");
        if (invalid) throw new Error(invalid);
      }
      item.notifyWebhook = url;
    }
    if (input.slackSigningSecret !== undefined) {
      if (input.slackSigningSecret === null || input.slackSigningSecret === "") {
        item.slackSigningSecret = undefined;
      } else if (!isMaskedSecret(input.slackSigningSecret)) {
        item.slackSigningSecret = input.slackSigningSecret.trim() || undefined;
      }
    }
    if (input.notifyChannel !== undefined)
      item.notifyChannel = input.notifyChannel?.trim() || undefined;
    if (input.allowedMcpTools !== undefined)
      item.allowedMcpTools = parseMcpToolNames(input.allowedMcpTools);
    if (input.allowHosts !== undefined) item.allowHosts = parseAllowHosts(input.allowHosts);
    if (input.maxUsd !== undefined)
      item.maxUsd = input.maxUsd && input.maxUsd > 0 ? input.maxUsd : undefined;
    if (input.lifetimeMaxUsd !== undefined) {
      item.lifetimeMaxUsd =
        input.lifetimeMaxUsd && input.lifetimeMaxUsd > 0 ? input.lifetimeMaxUsd : undefined;
    }
    if (input.overlap !== undefined) item.overlap = normalizeOverlap(input.overlap);
    if (input.timeZone !== undefined) item.timeZone = normalizeTimeZone(input.timeZone);
    if (input.blackoutDates !== undefined) {
      item.blackoutDates = normalizeBlackoutDates(input.blackoutDates);
    }
    if (input.notify !== undefined) item.notify = normalizeNotify(input.notify);
    if (input.autonomy === null) item.autonomy = undefined;
    else if (input.autonomy !== undefined) {
      if (!isAutonomyTier(input.autonomy)) throw new Error("Unknown autonomy tier");
      item.autonomy = input.autonomy;
    }
    if (input.schedule) {
      const scheduleError = validateSchedule(input.schedule);
      if (scheduleError) throw new Error(scheduleError);
      item.schedule = input.schedule;
      if (isEventSchedule(item.schedule)) {
        item.nextRunAt = undefined;
        item.webhookSecret = item.webhookSecret || newSecret();
      } else if (item.enabled) {
        item.nextRunAt = computeNextRunAt(
          item.schedule,
          this.now(),
          automationScheduleOpts(item),
        ).toISOString();
      }
    }
    if (input.rotateWebhookSecret) {
      if (!isEventSchedule(item.schedule)) {
        throw new Error("Only webhook and git-event jobs have a secret to rotate");
      }
      item.webhookSecret = newSecret();
    }
    if (input.enabled !== undefined) {
      item.enabled = input.enabled;
      if (item.enabled && !isEventSchedule(item.schedule)) {
        item.nextRunAt = computeNextRunAt(
          item.schedule,
          this.now(),
          automationScheduleOpts(item),
        ).toISOString();
      }
    }
    if (
      (input.timeZone !== undefined || input.blackoutDates !== undefined) &&
      item.enabled &&
      !isEventSchedule(item.schedule)
    ) {
      item.nextRunAt = computeNextRunAt(
        item.schedule,
        this.now(),
        automationScheduleOpts(item),
      ).toISOString();
    }
    if (
      (item.schedule.kind === "forge" || item.schedule.kind === "pull_request") &&
      !item.repo?.url
    ) {
      throw new Error(
        "Attach a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps repository to run on git events",
      );
    }
    if (runtime === "host") {
      if (isWindows(item.os)) item.os = "ubuntu";
      item.dockerImage = undefined;
      item.hardware = undefined;
      item.imageId = undefined;
      item.startVm = false;
      if (!template) item.templateId = item.templateId || "host";
    } else if (runtime !== "docker") {
      item.dockerImage = undefined;
      item.hostDir = undefined;
    } else {
      item.hostDir = undefined;
      item.hardware = undefined;
    }
    if (runtime === "host") {
      item.placement = undefined;
      item.backendId = undefined;
      item.network = undefined;
    }
    await this.assertNamedEnvironment(item);
    item.updatedAt = stamp(this.now());
    await this.store.replaceAutomation(item);
    this.hub.broadcast({ type: "automation.updated", automation: item });
    return item;
  }

  async remove(id: string): Promise<void> {
    await this.runWrite(async () => {
      this.removed.add(id);
      await this.store.deleteAutomation(id);
      this.hub.broadcast({ type: "automation.deleted", id });
    });
  }

  async tick(): Promise<void> {
    if (this.halted || this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const item of await this.list()) {
        try {
          if (!item.enabled) continue;
          const dueClock =
            !isEventSchedule(item.schedule) &&
            Boolean(item.nextRunAt) &&
            Date.parse(item.nextRunAt!) <= now.getTime();
          if (this.inFlight.has(item.id)) {
            if (dueClock) {
              await this.bumpNextRunAt(item.id);
              if (item.overlap === "coalesce" || item.overlap === "queue") {
                await this.stashFollowUp(item, "schedule");
              }
            }
            continue;
          }
          if (item.schedule.kind === "forge" || item.schedule.kind === "pull_request") {
            void this.pollForge(item).catch(() => undefined);
            continue;
          }
          if (item.schedule.kind === "webhook") continue;
          if (!dueClock) continue;
          void this.execute(item.id, "schedule", undefined, { wait: false }).catch(() => undefined);
        } catch {
          /* one job must not fail the rest of the fleet */
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  async execute(
    id: string,
    trigger: AutomationTrigger,
    event?: AutomationEvent,
    opts?: { wait?: boolean; held?: boolean; promote?: AutomationRun },
  ): Promise<AutomationRun> {
    const { run, owner } = await this.beginRun(id, trigger, event, opts);
    // A coalesced or queued follow-up can observe the live run. Only the
    // caller that opened it may finish it.
    if (!owner || run.status !== "running") {
      if (opts?.held) this.inFlight.delete(id);
      return run;
    }
    const done = this.completeRun(id, event ?? run.event, run);
    if (opts?.wait === false) {
      void done.catch(() => undefined);
      return run;
    }
    return done;
  }

  async replay(id: string, runId: string): Promise<AutomationRun> {
    const prior = (await this.listRuns(id)).find((row) => row.id === runId);
    if (!prior) throw new Error("Run not found");
    const trigger = prior.event && prior.trigger !== "schedule" ? prior.trigger : "manual";
    return this.execute(id, trigger, prior.event, { wait: false });
  }

  async abort(id: string): Promise<AutomationRun | undefined> {
    if (this.inFlight.has(id)) this.cancelled.add(id);
    const follow = this.followUp.get(id);
    this.followUp.delete(id);
    if (follow?.run && (follow.run.status === "queued" || follow.run.status === "running")) {
      const dropped: AutomationRun = {
        ...follow.run,
        status: "failed",
        error: "Stopped",
        finishedAt: stamp(this.now()),
      };
      await this.persistRun(dropped);
    }
    const live = (await this.listRuns(id)).find(
      (row) => row.status === "running" || row.status === "queued",
    );
    if (live?.sessionId) {
      await this.sessions.abortChat(live.sessionId).catch(() => undefined);
    }
    if (!live || (live.status !== "running" && live.status !== "queued")) return live;
    const stopped: AutomationRun = {
      ...live,
      status: "failed",
      error: "Stopped",
      finishedAt: stamp(this.now()),
    };
    await this.persistRun(stopped);
    return stopped;
  }

  async recoverInterruptedRuns(): Promise<number> {
    const now = this.now();
    const runs = await this.store.loadRuns();
    let recovered = 0;
    for (const run of runs) {
      if (run.status !== "running" && run.status !== "queued") continue;
      run.status = "failed";
      run.error = run.error?.trim() || INTERRUPTED_AUTOMATION_RUN_NOTE;
      run.finishedAt = stamp(now);
      await this.persistRun(run);
      recovered += 1;
    }
    return recovered;
  }

  private async bumpNextRunAt(id: string): Promise<void> {
    await this.runWrite(async () => {
      const current = await this.get(id);
      if (!current || isEventSchedule(current.schedule)) return;
      current.nextRunAt = computeNextRunAt(
        current.schedule,
        this.now(),
        automationScheduleOpts(current),
      ).toISOString();
      current.updatedAt = stamp(this.now());
      await this.store.replaceAutomation(current);
      this.hub.broadcast({ type: "automation.updated", automation: current });
    });
  }

  private skippedRun(
    id: string,
    trigger: AutomationTrigger,
    error: string,
    started = this.now(),
  ): AutomationRun {
    return {
      id: randomUUID(),
      automationId: id,
      status: "skipped",
      trigger,
      error,
      startedAt: stamp(started),
      finishedAt: stamp(started),
    };
  }

  private async beginRun(
    id: string,
    trigger: AutomationTrigger,
    event?: AutomationEvent,
    opts?: { held?: boolean; promote?: AutomationRun },
  ): Promise<{ run: AutomationRun; owner: boolean }> {
    if (this.halted) {
      return { run: this.skippedRun(id, trigger, "Locus data was reset"), owner: false };
    }
    const started = this.now();
    if (this.inFlight.has(id) && !opts?.held) {
      const item = await this.get(id);
      const policy = item?.overlap ?? "skip";
      if (item && policy !== "skip") {
        if (trigger === "schedule") await this.bumpNextRunAt(id);
        const queued = await this.stashFollowUp(item, trigger, event);
        if (queued) return { run: queued, owner: false };
        const live = (await this.listRuns(id)).find((row) => row.status === "running");
        return {
          run: live ?? this.skippedRun(id, trigger, OVERLAP_SKIP_REASON, started),
          owner: false,
        };
      }
      const skipped = this.skippedRun(id, trigger, OVERLAP_SKIP_REASON, started);
      if (trigger === "schedule") await this.bumpNextRunAt(id);
      else await this.persistRun(skipped);
      return { run: skipped, owner: false };
    }

    if (!opts?.held) this.inFlight.add(id);
    let run: AutomationRun | undefined;
    try {
      const item = await this.get(id);
      if (!item) throw new Error("Job not found");
      if (!item.enabled) throw new Error("Job is paused");
      const spent = automationLifetimeSpendUsd(await this.listRuns(id), id);
      if (overLifetimeCap(item.lifetimeMaxUsd, spent)) {
        if (!opts?.held) this.inFlight.delete(id);
        const skipped = this.skippedRun(id, trigger, LIFETIME_CAP_SKIP_REASON, started);
        skipped.reason = automationRunReason(trigger, event, item.schedule);
        if (trigger === "schedule") await this.bumpNextRunAt(id);
        await this.persistRun(skipped);
        return { run: skipped, owner: false };
      }
      run = opts?.promote
        ? {
            ...opts.promote,
            status: "running",
            trigger,
            event: event ?? opts.promote.event,
            reason: automationRunReason(trigger, event ?? opts.promote.event, item.schedule),
            error: undefined,
            finishedAt: undefined,
            startedAt: stamp(started),
          }
        : {
            id: randomUUID(),
            automationId: id,
            status: "running",
            trigger,
            event,
            reason: automationRunReason(trigger, event, item.schedule),
            startedAt: stamp(started),
          };
      await this.persistRun(run);
      if (trigger === "schedule" && !opts?.held) await this.bumpNextRunAt(id);

      const config = await this.store.loadConfig();
      const env = namedEnvironmentById(config.namedEnvironments, item.namedEnvironmentId);
      const fields = namedEnvironmentSessionFields(item, env);
      const runtime = sessionRuntime(fields);
      const needsGuest = runtimeNeedsGuest(runtime);
      let session = item.reuseSession
        ? (await this.sessions.list()).find(
            (s) =>
              s.automationId === item.id &&
              (needsGuest ? Boolean(s.vmId) : sessionRuntime(s) === "host"),
          )
        : undefined;
      if (!session) {
        session = await this.sessions.create({
          title: item.name,
          os: fields.os ?? item.os,
          templateId: fields.templateId ?? item.templateId,
          runtime,
          dockerImage: runtime === "docker" ? fields.dockerImage : undefined,
          hostDir: runtime === "host" ? item.hostDir : undefined,
          providerId: item.providerId,
          model: item.model,
          repo: item.repo,
          repoId: await this.liveRepoId(item.repoId),
          hardware: runtime === "vm" ? item.hardware : undefined,
          imageId: needsGuest ? fields.imageId : undefined,
          startVm: needsGuest && item.startVm,
          automationId: item.id,
          automationRunId: run.id,
          persistMemory: item.persistMemory ? true : undefined,
          maxUsd: fields.maxUsd,
          autonomy: item.autonomy,
          allowedMcpTools: item.allowedMcpTools ?? [],
          allowHosts: fields.allowHosts,
          network: needsGuest ? fields.network : undefined,
          placement: fields.placement,
          backendId: fields.backendId,
          instructions: fields.instructions,
          playbook: fields.playbook,
          allowedTools: fields.allowedTools,
          vision: fields.vision,
          kind: fields.kind,
        });
      } else {
        session =
          (await this.store.mutateSession(session.id, (current) => {
            current.allowedMcpTools = item.allowedMcpTools ?? [];
            current.allowHosts = fields.allowHosts;
            current.maxUsd = fields.maxUsd;
            current.autonomy = item.autonomy;
            current.persistMemory = item.persistMemory ? true : undefined;
          })) ?? session;
        if (needsGuest && item.startVm) {
          await this.sessions.startVm(session.id).catch(() => undefined);
        }
      }
      run.sessionId = session.id;
      await this.persistRun(run);
      await this.pruneOldChats(item.id, session.id);
      return { run, owner: true };
    } catch (err) {
      this.inFlight.delete(id);
      if (run && run.status === "running") {
        run.status = "failed";
        run.error = err instanceof Error ? err.message : "Run failed";
        run.finishedAt = stamp(this.now());
        await this.persistRun(run);
      }
      throw err;
    }
  }

  private async completeRun(
    id: string,
    event: AutomationEvent | undefined,
    run: AutomationRun,
  ): Promise<AutomationRun> {
    const item = await this.get(id);
    try {
      if (!item) throw new Error("Job not found");
      if (this.cancelled.has(id) || this.removed.has(id)) throw new Error("Stopped");
      const live = (await this.listRuns(id)).find((row) => row.id === run.id);
      if (live && live.status !== "running" && live.status !== "queued") {
        throw new Error(live.error || "Stopped");
      }
      const config = await this.store.loadConfig();
      const env = namedEnvironmentById(config.namedEnvironments, item.namedEnvironmentId);
      const fields = namedEnvironmentSessionFields(item, env);
      const runtime = sessionRuntime(fields);
      const needsGuest = runtimeNeedsGuest(runtime);
      const sessionId = run.sessionId;
      if (!sessionId) throw new Error("Run has no session");

      if (needsGuest && item.startVm) {
        await this.waitForSession(
          sessionId,
          (status) => status === "idle" || status === "error",
          "Guest did not become ready",
          id,
        );
      }
      const ready = await this.sessions.get(sessionId);
      if (ready?.status === "error") {
        if (item.reuseSession && canRewind(ready)) {
          await this.sessions.rewind(sessionId);
          const recovered = await this.sessions.get(sessionId);
          if (recovered?.status === "error") {
            throw new Error(recovered.error || "Guest entered an error state");
          }
        } else {
          throw new Error(ready.error || "Guest entered an error state");
        }
      }

      if (this.cancelled.has(id) || this.removed.has(id)) throw new Error("Stopped");
      const again = (await this.listRuns(id)).find((row) => row.id === run.id);
      if (again && again.status !== "running" && again.status !== "queued") {
        throw new Error(again.error || "Stopped");
      }

      await this.sessions.sendChat(sessionId, formatAutomationPrompt(item.prompt, event));
      await this.waitForSession(
        sessionId,
        (status) => status !== "running",
        "Agent turn did not finish",
        id,
      );
      const finished = await this.sessions.get(sessionId);
      if (
        finished?.messages?.some(
          (message) => message.role === "system" && message.content === CANCELLED_TURN_NOTE,
        )
      ) {
        throw new Error("Stopped");
      }
      if (finished?.needsHuman) {
        run.status = "needs_you";
        run.summary = clipFact(finished.needsHuman, RUN_SUMMARY_MAX);
        run.error = undefined;
        run.finishedAt = stamp(this.now());
        await this.stampSpend(run);
        await this.markFinished(item, run);
      } else {
        run.status = "succeeded";
        run.finishedAt = stamp(this.now());
        await this.stampSpend(run);
        const text = finished ? lastAssistantText(finished.messages) : undefined;
        if (text) run.summary = clipFact(text, RUN_SUMMARY_MAX);
        await this.markFinished(item, run);
      }
    } catch (err) {
      run.status = "failed";
      run.error = err instanceof Error ? err.message : "Run failed";
      run.finishedAt = stamp(this.now());
      await this.stampSpend(run);
      if (item) await this.markFinished(item, run);
    } finally {
      this.cancelled.delete(id);
      const follow = this.followUp.get(id);
      this.followUp.delete(id);
      if (follow && !this.removed.has(id) && !this.halted) {
        void this.finishFollowUp(id, follow).catch(() => {
          this.inFlight.delete(id);
        });
      } else {
        this.inFlight.delete(id);
      }
    }

    await this.persistRun(run);
    return run;
  }

  private async finishFollowUp(id: string, follow: FollowUp): Promise<void> {
    const item = await this.get(id);
    if (!item?.enabled) {
      this.inFlight.delete(id);
      if (follow.run) {
        const skipped: AutomationRun = {
          ...follow.run,
          status: "skipped",
          error: "Job is paused",
          finishedAt: stamp(this.now()),
        };
        await this.persistRun(skipped);
      }
      return;
    }
    await this.execute(id, follow.trigger, follow.event, {
      wait: false,
      held: true,
      promote: follow.run,
    });
  }

  private async stashFollowUp(
    item: Automation,
    trigger: AutomationTrigger,
    event?: AutomationEvent,
  ): Promise<AutomationRun | undefined> {
    const policy = item.overlap ?? "skip";
    if (policy === "skip") return undefined;
    const reason = automationRunReason(trigger, event, item.schedule);
    const existing = this.followUp.get(item.id);
    if (policy === "coalesce") {
      this.followUp.set(item.id, { trigger, event, run: existing?.run });
      if (existing?.run) {
        const next: AutomationRun = {
          ...existing.run,
          trigger,
          event,
          reason,
          startedAt: stamp(this.now()),
        };
        this.followUp.set(item.id, { trigger, event, run: next });
        await this.persistRun(next);
        return next;
      }
      return undefined;
    }
    if (existing?.run) {
      const next: AutomationRun = {
        ...existing.run,
        trigger,
        event,
        reason,
        startedAt: stamp(this.now()),
      };
      this.followUp.set(item.id, { trigger, event, run: next });
      await this.persistRun(next);
      return next;
    }
    const queued: AutomationRun = {
      id: randomUUID(),
      automationId: item.id,
      status: "queued",
      trigger,
      event,
      reason,
      startedAt: stamp(this.now()),
    };
    this.followUp.set(item.id, { trigger, event, run: queued });
    await this.persistRun(queued);
    return queued;
  }

  private async stampSpend(run: AutomationRun): Promise<void> {
    if (!run.sessionId) return;
    const session = await this.sessions.get(run.sessionId);
    if (!session?.usage) return;
    const config = await this.store.loadConfig();
    const provider = config.providers.find((row) => row.id === session.providerId);
    const usd = automationRunUsd({
      usage: session.usage,
      provider,
      model: session.model,
    });
    if (usd != null) run.spendUsd = usd;
  }

  private async pruneOldChats(automationId: string, keepId: string): Promise<void> {
    const max = automationChatLimit((await this.store.loadConfig()).advanced.maxAutomationChats);
    const drop = automationChatIdsToPrune(await this.sessions.list(), automationId, keepId, max);
    for (const id of drop) {
      await this.sessions.remove(id).catch(() => undefined);
    }
  }

  private async persistRun(run: AutomationRun): Promise<void> {
    await this.runWrite(async () => {
      if (this.removed.has(run.automationId)) return;
      await this.store.replaceRun(run);
      this.hub.broadcast({ type: "automation.run", run });
    });
  }

  private async markFinished(item: Automation, run: AutomationRun): Promise<void> {
    await this.runWrite(async () => {
      if (this.removed.has(item.id)) return;
      const current = await this.get(item.id);
      if (!current) return;
      current.lastRunAt = run.finishedAt;
      current.updatedAt = run.finishedAt ?? stamp(this.now());
      await this.store.replaceAutomation(current);
      this.hub.broadcast({ type: "automation.updated", automation: current });
      await this.notifyDone(current, run);
    });
  }

  async handleWebhook(
    id: string,
    input: {
      secret?: string;
      signature?: string;
      timestamp?: string;
      event?: string;
      raw: string;
      contentType?: string;
      slackSignature?: string;
      slackTimestamp?: string;
      slackRetry?: string;
      peer?: string;
    },
  ): Promise<{ ok: true; ping?: boolean; queued?: boolean; challenge?: string }> {
    const limitKey = input.peer?.trim() || "unknown";
    const item = await this.get(id);
    if (!item) {
      if (!this.hookLimiter.allow(limitKey)) throw new Error("Too many webhook attempts");
      throw new Error("Job not found");
    }
    if (!isEventSchedule(item.schedule)) {
      throw new Error("This automation is not triggered by webhooks");
    }
    if (input.raw.length > MAX_WEBHOOK_BYTES) throw new Error("Webhook payload is too large");
    const config = await this.store.loadConfig();
    const slackOk = slackSignatureValid(
      item.slackSigningSecret || config.advanced.slackSigningSecret,
      input.slackTimestamp,
      input.raw,
      input.slackSignature,
    );
    const timestampOk = webhookTimestampValid(input.timestamp);
    const locusOk = locusWebhookAuthorized(item.webhookSecret, input, timestampOk);
    if (!slackOk && !locusOk) {
      if (!this.hookLimiter.allow(limitKey)) throw new Error("Too many webhook attempts");
      throw new Error("Invalid webhook secret");
    }
    if (!item.enabled) throw new Error("Job is paused");
    const decision = decideWebhook({
      item,
      raw: input.raw,
      contentType: input.contentType,
      headerEvent: input.event,
    });
    if (decision.kind === "reject") throw new Error(decision.message);
    if (decision.kind === "challenge") return { ok: true, challenge: decision.challenge };
    if (decision.kind === "ping") return { ok: true, ping: true };
    if (decision.kind === "skip") return { ok: true };
    if (decision.sha) await this.rememberSha(item.id, decision.sha);
    if (decision.eventId) await this.rememberWebhookEvent(item.id, decision.eventId);
    void this.execute(item.id, decision.trigger, decision.event).catch(() => undefined);
    return { ok: true, queued: true };
  }

  private async pollForge(item: Automation): Promise<void> {
    if (!item.repo?.url) return;
    const config = await this.store.loadConfig();
    const forge = resolveForgeAccount(config.forges, {
      accountId: item.repo.accountId,
      kind: item.repo.forge,
      url: item.repo.url,
    });
    if (!forge?.token) return;
    const fresh = await withFreshForgeToken(this.store, forge, this.opts.fetch ?? fetch);
    if (!fresh.token) return;
    const parsed = parseOwnerRepo(item.repo.url);
    if (!parsed) return;
    const sha =
      item.schedule.kind === "pull_request"
        ? await this.forge.latestOpenPullCursor(fresh, parsed.owner, parsed.repo)
        : await this.forge.latestCommitSha(fresh, parsed.owner, parsed.repo, item.repo.ref);
    if (!sha) return;
    if (!item.lastForgeSha) {
      await this.rememberSha(item.id, sha);
      return;
    }
    if (sha === item.lastForgeSha) return;
    await this.rememberSha(item.id, sha);
    const kind = item.schedule.kind === "pull_request" ? "pull_request" : "forge";
    await this.execute(item.id, kind, forgeRunEvent(kind, { sha }), { wait: false });
  }

  private async rememberSha(id: string, sha: string): Promise<void> {
    await this.runWrite(async () => {
      const current = await this.get(id);
      if (!current) return;
      current.lastForgeSha = sha;
      current.updatedAt = stamp(this.now());
      await this.store.replaceAutomation(current);
      this.hub.broadcast({ type: "automation.updated", automation: current });
    });
  }

  private async rememberWebhookEvent(id: string, eventId: string): Promise<void> {
    await this.runWrite(async () => {
      const current = await this.get(id);
      if (!current) return;
      current.lastWebhookEventId = eventId;
      current.updatedAt = stamp(this.now());
      await this.store.replaceAutomation(current);
      this.hub.broadcast({ type: "automation.updated", automation: current });
    });
  }

  private async notifyDone(item: Automation, run: AutomationRun): Promise<void> {
    const config = await this.store.loadConfig();
    if (
      !shouldNotifyAutomationOutcome(run, Boolean(config.notifyAutomationsFailedOnly), item.notify)
    ) {
      return;
    }
    const session = run.sessionId ? await this.sessions.get(run.sessionId) : undefined;
    const summary =
      run.summary?.trim() || (session ? lastAssistantText(session.messages) : undefined);
    const fetchFn = this.opts.fetch ?? fetch;
    const channel = item.notifyChannel?.trim();
    const slackAccount = (config.integrations ?? []).find((row) => slackClientReady(row));
    if (channel && slackAccount && slackChannelAllowed(slackAccount, channel)) {
      try {
        const body = slackNotifyBody({
          name: item.name,
          status: run.status,
          trigger: run.trigger,
          error: run.error,
          summary,
        });
        await new SlackApi(fetchFn).postMessage(slackAccount, {
          channel,
          text: body.text,
          as: "user",
        });
        return;
      } catch {
        /* fall through to webhook */
      }
    }
    const url = item.notifyWebhook?.trim() || config.advanced.notifyWebhook?.trim();
    if (!url || invalidNotifyUrl(url)) return;
    const slack = isSlackIncomingWebhookUrl(url);
    const body = slack
      ? slackNotifyBody({
          name: item.name,
          status: run.status,
          trigger: run.trigger,
          error: run.error,
          summary,
        })
      : {
          automation: item.name,
          automationId: item.id,
          status: run.status,
          trigger: run.trigger,
          sessionId: run.sessionId,
          error: run.error,
          finishedAt: run.finishedAt,
          summary,
          channel: item.notifyChannel,
        };
    try {
      await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = `Notify failed: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(message, item.id);
      if (run.status !== "succeeded") {
        run.error = [run.error, message].filter(Boolean).join(" · ");
        await this.persistRun(run).catch(() => undefined);
      }
    }
  }

  private async waitForSession(
    sessionId: string,
    done: (status: SessionStatus) => boolean,
    timeoutMessage: string,
    automationId?: string,
  ): Promise<void> {
    const timeoutMs = this.opts.waitMs ?? 600_000;
    const pollMs = this.opts.pollMs ?? 200;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (automationId && (this.cancelled.has(automationId) || this.removed.has(automationId))) {
        throw new Error("Stopped");
      }
      const session = await this.sessions.get(sessionId);
      if (session && done(session.status)) return;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new Error(
      `${timeoutMessage} after ${Math.round(timeoutMs / 1000)}s. Check the agent chat or raise the wait in Settings → Advanced.`,
    );
  }
}

function newSecret(): string {
  return randomBytes(16).toString("hex");
}

function invalidNotifyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol !== "http:" && parsed.protocol !== "https:";
  } catch {
    return true;
  }
}
