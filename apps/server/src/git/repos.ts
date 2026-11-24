import { randomUUID } from "node:crypto";
import { completeChat } from "@locus/providers";
import {
  AGENT_RECIPES,
  DEFAULT_DOCKER_IMAGE,
  MAX_LOAD_PATH_NOTES,
  ARCHITECTURE_PLAYBOOK,
  analyzeArchitecture,
  architectureSection,
  architectureSessionTitle,
  buildLoadPath,
  buildChangeStack,
  DEFAULT_FORGE_SPECS,
  emptyArchitectureAnalysis,
  formatArchitectureSuggestPrompt,
  isArchScope,
  findBoundAgent,
  forgesWithTokens,
  formatFixPrompt,
  formatCiFixPrompt,
  isFailingCheckStatus,
  type CiFailureReport,
  formatReviewPrompt,
  formatSetupPrompt,
  parseAnyReviewVerdict,
  matchLinkedRepo,
  isOpenInboxPull,
  parseRepoUrl,
  repoDisplayName,
  resolveForgeAccount,
  isPullCacheFresh,
  mergeRepoBranches,
  normalizeRepoReviewPrompt,
  sessionKind,
  namedEnvironmentById,
  applyNamedEnvironment,
  safeChangeStackHeadSha,
  type AgentRuntime,
  type ArchScope,
  type ArchitectureAnalysis,
  type CreateLinkedRepoInput,
  type CreateSessionInput,
  type ForgeImportAccount,
  type GitForgeAccount,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
  type LinkedRepo,
  type LoadPathReview,
  type ChangeStack,
  type ChangeStackRevision,
  type PatchLinkedRepoInput,
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
  type RepoAbout,
  type RepoBranchList,
  type RiskGate,
} from "@locus/shared";
import { ForgeClient, requireOwnerRepo, type ForgeFetcher } from "./forge.js";
import { withFreshForgeToken } from "./forgeOauth.js";
import type { Hub } from "../core/hub.js";
import type { SessionService } from "../session/sessions.js";
import type { JsonStore } from "../core/store.js";
import { summarizeChangeStack, type ChangeStackSummarizer } from "./changeStackSummaries.js";
import { readArchitectureSources, resolveArchitectureRoot } from "./architectureCheckout.js";
import { pullMergeGate, RiskGateError } from "../session/riskGate.js";

const DEFAULT_BRANCH_TIMEOUT_MS = 5_000;
/** Condensed CI log budget across failing checks in a fix prompt. */
const CI_FIX_LOG_CHARS = 9_000;

/** A fix started for failing CI (checks subscription or a red pull). */
export interface CiFixRequest {
  headSha?: string;
  /** Failing check names to focus on. */
  checks?: string[];
  attempt?: number;
  maxAttempts?: number;
}

function stamp(): string {
  return new Date().toISOString();
}

export class RepoService {
  private readonly forge: ForgeClient;
  private readonly fetchFn: ForgeFetcher;
  private readonly listInflight = new Map<string, Promise<PullRequestRef[]>>();
  private readonly pullInflight = new Map<string, Promise<PullRequestDetail>>();
  private readonly issueListInflight = new Map<string, Promise<IssueRef[]>>();
  private readonly issueInflight = new Map<string, Promise<IssueDetail>>();
  private readonly changeStackSummaries = new Map<string, Promise<ChangeStack>>();

  constructor(
    private readonly store: JsonStore,
    private readonly sessions: SessionService,
    private readonly hub: Hub,
    fetchFn: ForgeFetcher = fetch,
    private readonly summarizer: ChangeStackSummarizer | null = (input) =>
      summarizeChangeStack({ ...input, complete: sessions.budgets.trackCompletion(completeChat) }),
  ) {
    this.fetchFn = fetchFn;
    this.forge = new ForgeClient(fetchFn);
  }

  async list(): Promise<LinkedRepo[]> {
    return this.store.loadRepos();
  }

  async get(id: string): Promise<LinkedRepo | undefined> {
    return (await this.list()).find((row) => row.id === id);
  }

  async require(id: string): Promise<LinkedRepo> {
    const repo = await this.get(id);
    if (!repo) throw new Error("Unknown linked repo");
    return repo;
  }

  async link(input: CreateLinkedRepoInput): Promise<LinkedRepo> {
    const parsed = parseRepoUrl(input.url);
    if (!parsed)
      throw new Error("Enter a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps URL");
    const config = await this.store.loadConfig();
    const account = resolveForgeAccount(config.forges, {
      accountId: input.accountId,
      kind: parsed.forge,
      url: parsed.url,
    });
    const existing = matchLinkedRepo(await this.list(), parsed.url, account?.id);
    if (existing) {
      const next: LinkedRepo = {
        ...existing,
        checkout: {
          ...existing.checkout,
          accountId: account?.id ?? existing.checkout.accountId,
          ref: input.ref?.trim() || existing.checkout.ref,
        },
        name: input.name?.trim() || existing.name,
        updatedAt: stamp(),
      };
      await this.store.replaceRepo(next);
      this.hub.broadcast({ type: "repo.updated", repo: next });
      return next;
    }
    const now = stamp();
    const created: LinkedRepo = {
      id: randomUUID(),
      name: input.name?.trim() || repoDisplayName(parsed.url),
      checkout: {
        forge: parsed.forge,
        url: parsed.url,
        ref: input.ref?.trim() || undefined,
        accountId: account?.id,
      },
      createdAt: now,
      updatedAt: now,
    };
    if (!created.checkout.ref) created.checkout.ref = await this.lookupDefaultBranch(created);
    await this.store.replaceRepo(created);
    this.hub.broadcast({ type: "repo.updated", repo: created });
    return created;
  }

  async importFromForges(): Promise<ForgeImportAccount[]> {
    const config = await this.store.loadConfig();
    const accounts = forgesWithTokens(config.forges);
    if (!accounts.length)
      throw new Error(
        "Sign in or add a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps token in Settings → Git",
      );
    const results = await Promise.all(
      accounts.map(async (account) => {
        try {
          const fresh = await withFreshForgeToken(this.store, account, this.fetchFn);
          const repos = await this.forge.listRepos(fresh);
          return {
            accountId: account.id,
            accountName: account.name,
            kind: account.kind,
            repos,
          } satisfies ForgeImportAccount;
        } catch (err) {
          return {
            accountId: account.id,
            accountName: account.name,
            kind: account.kind,
            error: err instanceof Error ? err.message : "Import failed",
            repos: [],
          } satisfies ForgeImportAccount;
        }
      }),
    );
    return results;
  }

  async patch(id: string, input: PatchLinkedRepoInput): Promise<LinkedRepo> {
    const current = await this.require(id);
    const next: LinkedRepo = { ...current, checkout: { ...current.checkout }, updatedAt: stamp() };
    if (typeof input.name === "string") {
      const name = input.name.trim();
      if (!name) throw new Error("Name is required");
      next.name = name;
    }
    if (typeof input.ref === "string") next.checkout.ref = input.ref.trim() || undefined;
    if (typeof input.accountId === "string")
      next.checkout.accountId = input.accountId.trim() || undefined;
    if (input.defaultRuntime === null) next.defaultRuntime = undefined;
    else if (input.defaultRuntime === "docker" || input.defaultRuntime === "vm")
      next.defaultRuntime = input.defaultRuntime;
    if (input.dockerImage === null) next.dockerImage = undefined;
    else if (typeof input.dockerImage === "string")
      next.dockerImage = input.dockerImage.trim() || undefined;
    if (input.os === null) next.os = undefined;
    else if (input.os) next.os = input.os;
    if (input.playbook === null) next.playbook = undefined;
    else if (typeof input.playbook === "string") next.playbook = input.playbook.trim() || undefined;
    if (input.reviewPrompt === null) next.reviewPrompt = undefined;
    else if (typeof input.reviewPrompt === "string")
      next.reviewPrompt = normalizeRepoReviewPrompt(input.reviewPrompt);
    if (typeof input.autoReview === "boolean") next.autoReview = input.autoReview;
    if (input.namedEnvironmentId === null) next.namedEnvironmentId = undefined;
    else if (typeof input.namedEnvironmentId === "string")
      next.namedEnvironmentId = input.namedEnvironmentId.trim() || undefined;
    await this.store.replaceRepo(next);
    this.hub.broadcast({ type: "repo.updated", repo: next });
    return next;
  }

  async delete(id: string): Promise<void> {
    await this.require(id);
    await this.store.deleteRepo(id);
    this.hub.broadcast({ type: "repo.deleted", id });
  }

  async refresh(id: string): Promise<LinkedRepo> {
    const repo = await this.require(id);
    const pulls = await this.listPulls(id, "open", { fresh: true });
    let openIssueCount = repo.openIssueCount;
    try {
      const issues = await this.listIssues(id, "open", { fresh: true });
      openIssueCount = issues.length;
    } catch {
      /* Issues tracker may be off; keep the last known count. */
    }
    const ref = repo.checkout.ref || (await this.lookupDefaultBranch(repo));
    const next: LinkedRepo = {
      ...repo,
      checkout: { ...repo.checkout, ref },
      openPullCount: pulls.filter(isOpenInboxPull).length,
      openIssueCount,
      lastFetchAt: stamp(),
      updatedAt: stamp(),
    };
    await this.store.replaceRepo(next);
    this.hub.broadcast({ type: "repo.updated", repo: next });
    return next;
  }

  private readonly aboutCache = new Map<string, { at: number; about: RepoAbout }>();

  /** Description, license, stars, README excerpt. Cached 10 minutes: tokenless reads are scarce. */
  async about(id: string): Promise<RepoAbout> {
    const hit = this.aboutCache.get(id);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.about;
    const repo = await this.require(id);
    const account = await this.readAccountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const about = (await this.forge.about(account, parsed.owner, parsed.repo)) ?? {};
    this.aboutCache.set(id, { at: Date.now(), about });
    return about;
  }

  async listBranches(id: string): Promise<RepoBranchList> {
    const repo = await this.require(id);
    const account = await this.readAccountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const listed = await this.forge.listBranches(account, parsed.owner, parsed.repo);
    return mergeRepoBranches(listed.branches, listed.defaultBranch || repo.checkout.ref);
  }

  async listPulls(
    id: string,
    state: PullListState = "open",
    opts: { fresh?: boolean } = {},
  ): Promise<PullRequestRef[]> {
    const key = `${id}:${state}`;
    if (!opts.fresh) {
      const cached = await this.store.loadPullListCache(id, state);
      if (cached && isPullCacheFresh(cached.fetchedAt))
        return this.withListSessions(id, cached.pulls);
      const pending = this.listInflight.get(key);
      if (pending) return pending;
    }
    const pending = this.fetchListPulls(id, state).then(async (rows) => {
      if (this.listInflight.get(key) === pending)
        await this.store.savePullListCache(id, state, rows);
      return rows;
    });
    this.listInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.listInflight.get(key) === pending) this.listInflight.delete(key);
    }
  }

  async getPull(
    id: string,
    number: number,
    opts: { fresh?: boolean } = {},
  ): Promise<PullRequestDetail> {
    const key = `${id}:${number}`;
    if (!opts.fresh) {
      const cached = await this.store.loadPullCache(id, number);
      if (cached && isPullCacheFresh(cached.fetchedAt))
        return this.withDetailSessions(id, number, cached.pull);
      const pending = this.pullInflight.get(key);
      if (pending) return pending;
    }
    const pending = this.fetchPull(id, number).then(async (pull) => {
      if (this.pullInflight.get(key) === pending) {
        await this.store.savePullCache(id, number, pull);
        this.hub.broadcast({ type: "pull.updated", pull });
      }
      return pull;
    });
    this.pullInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.pullInflight.get(key) === pending) this.pullInflight.delete(key);
    }
  }

  async listIssues(
    id: string,
    state: IssueListState = "open",
    opts: { fresh?: boolean } = {},
  ): Promise<IssueRef[]> {
    const key = `${id}:${state}`;
    if (!opts.fresh) {
      const cached = await this.store.loadIssueListCache(id, state);
      if (cached && isPullCacheFresh(cached.fetchedAt)) return cached.issues;
      const pending = this.issueListInflight.get(key);
      if (pending) return pending;
    }
    const pending = this.fetchListIssues(id, state).then(async (rows) => {
      if (this.issueListInflight.get(key) === pending)
        await this.store.saveIssueListCache(id, state, rows);
      return rows;
    });
    this.issueListInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.issueListInflight.get(key) === pending) this.issueListInflight.delete(key);
    }
  }

  async getIssue(id: string, number: number, opts: { fresh?: boolean } = {}): Promise<IssueDetail> {
    const key = `${id}:${number}`;
    if (!opts.fresh) {
      const cached = await this.store.loadIssueCache(id, number);
      if (cached && isPullCacheFresh(cached.fetchedAt)) return cached.issue;
      const pending = this.issueInflight.get(key);
      if (pending) return pending;
    }
    const pending = this.fetchIssue(id, number).then(async (issue) => {
      if (this.issueInflight.get(key) === pending) {
        await this.store.saveIssueCache(id, number, issue);
        this.hub.broadcast({ type: "issue.updated", issue });
      }
      return issue;
    });
    this.issueInflight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.issueInflight.get(key) === pending) this.issueInflight.delete(key);
    }
  }

  async commentIssue(id: string, number: number, input: { body: string }): Promise<IssueDetail> {
    const body = input.body.trim();
    if (!body) throw new Error("body is required");
    const repo = await this.require(id);
    const account = await this.accountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const result = await this.forge.postIssueComment(account, parsed.owner, parsed.repo, number, {
      body,
    });
    if (!result.ok) throw new Error(result.output || "Comment failed");
    await this.store.clearIssueListCache(id);
    return this.getIssue(id, number, { fresh: true });
  }

  async comment(
    id: string,
    number: number,
    input: { body: string; path?: string; line?: number; side?: "LEFT" | "RIGHT" },
  ): Promise<PullRequestDetail> {
    const body = input.body.trim();
    if (!body) throw new Error("body is required");
    const repo = await this.require(id);
    const account = await this.accountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const result = await this.forge.postComment(account, parsed.owner, parsed.repo, number, {
      ...input,
      body,
    });
    if (!result.ok) throw new Error(result.output || "Comment failed");
    await this.store.clearPullListCache(id);
    return this.getPull(id, number, { fresh: true });
  }

  async review(
    id: string,
    number: number,
    input: { body: string; event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" },
  ): Promise<PullRequestDetail> {
    const body = input.body.trim();
    if (!body) throw new Error("body is required");
    const repo = await this.require(id);
    const account = await this.accountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const result = await this.forge.postReview(account, parsed.owner, parsed.repo, number, {
      body,
      event:
        input.event === "APPROVE" || input.event === "REQUEST_CHANGES" ? input.event : "COMMENT",
    });
    if (!result.ok) throw new Error(result.output || "Review failed");
    await this.store.clearPullListCache(id);
    return this.getPull(id, number, { fresh: true });
  }

  async getLoadPath(id: string, number: number): Promise<LoadPathReview> {
    const pull = await this.getPull(id, number);
    const stored = await this.store.loadLoadPathNotes(id, number);
    return buildLoadPath(pull.files, { notes: stored?.notes, notesUpdatedAt: stored?.updatedAt });
  }

  async patchLoadPathNotes(id: string, number: number, notes: string): Promise<LoadPathReview> {
    const pull = await this.getPull(id, number);
    await this.store.saveLoadPathNotes(id, number, {
      notes: notes.slice(0, MAX_LOAD_PATH_NOTES),
      updatedAt: stamp(),
    });
    const stored = await this.store.loadLoadPathNotes(id, number);
    return buildLoadPath(pull.files, { notes: stored?.notes, notesUpdatedAt: stored?.updatedAt });
  }

  async getChangeStack(
    id: string,
    number: number,
    opts: { fresh?: boolean; sha?: string; summarize?: boolean } = {},
  ): Promise<ChangeStack> {
    const pull = await this.getPull(id, number);
    const wantSha = opts.sha ? safeChangeStackHeadSha(opts.sha) : undefined;
    if (wantSha && wantSha !== safeChangeStackHeadSha(pull.headSha)) {
      const stored = await this.store.loadChangeStackRevision(id, number, wantSha);
      if (!stored) throw new Error("Unknown change stack revision");
      return stored;
    }
    if (!opts.fresh) {
      const stored = await this.store.loadChangeStack(id, number);
      if (stored && stored.headSha === pull.headSha) {
        if (opts.summarize && stored.source === "heuristic") {
          return this.summarizeAndSave(id, number, pull.files, stored);
        }
        return stored;
      }
    }
    const loadpath = buildLoadPath(pull.files);
    let stack = buildChangeStack(pull.files, loadpath, {
      repoId: id,
      number,
      headSha: pull.headSha,
      comments: pull.comments,
    });
    await this.store.saveChangeStack(id, number, stack);
    if (opts.summarize) stack = await this.summarizeAndSave(id, number, pull.files, stack);
    return stack;
  }

  async listChangeStackRevisions(id: string, number: number): Promise<ChangeStackRevision[]> {
    await this.require(id);
    return this.store.listChangeStackRevisions(id, number);
  }

  private async summarizeAndSave(
    id: string,
    number: number,
    files: PullRequestDetail["files"],
    stack: ChangeStack,
  ): Promise<ChangeStack> {
    if (!this.summarizer) return stack;
    const key = `${id}:${number}:${stack.headSha}`;
    const pending = this.changeStackSummaries.get(key);
    if (pending) return pending;
    const work = this.runChangeStackSummary(id, number, files, stack).finally(() => {
      this.changeStackSummaries.delete(key);
    });
    this.changeStackSummaries.set(key, work);
    return work;
  }

  private async runChangeStackSummary(
    id: string,
    number: number,
    files: PullRequestDetail["files"],
    stack: ChangeStack,
  ): Promise<ChangeStack> {
    try {
      const config = await this.store.loadConfig();
      const next = await this.summarizer!({ stack, files, config });
      if (next.source !== stack.source || next.markdown !== stack.markdown) {
        await this.store.saveChangeStack(id, number, next);
        return next;
      }
    } catch {
      /* keep heuristic snapshot */
    }
    return stack;
  }

  /**
   * Merge a pull on the forge. When the latest review verdict is at or above
   * `review.requireApprovalAtRisk`, throws `RiskGateError` unless `approveRisk` (an explicit
   * human confirm) is set; `requestApproval` instead queues a Needs-you approval.
   */
  async merge(
    id: string,
    number: number,
    opts: { approveRisk?: boolean } = {},
  ): Promise<PullRequestDetail> {
    const repo = await this.require(id);
    if (!opts.approveRisk) {
      const gate = await this.mergeGate(repo, number);
      if (gate.gated) throw new RiskGateError(gate);
    }
    const account = await this.accountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const result = await this.forge.merge(account, parsed.owner, parsed.repo, number);
    if (!result.ok) throw new Error(result.output || "Merge failed");
    await this.store.clearPullListCache(id);
    return this.getPull(id, number, { fresh: true });
  }

  async mergeGate(repo: LinkedRepo, number: number): Promise<RiskGate> {
    const [sessions, config] = await Promise.all([
      this.store.loadSessions(),
      this.store.loadConfig(),
    ]);
    return pullMergeGate(sessions, config, { repoId: repo.id, repoUrl: repo.checkout.url, number });
  }

  /**
   * Queue a risk-gated merge as a Needs-you approval on the PR's bound agent (else the
   * review session that gave the verdict). Approve merges; Deny records the refusal.
   */
  async requestMergeApproval(
    id: string,
    number: number,
  ): Promise<{ sessionId: string; toolCallId: string; gate: RiskGate }> {
    const repo = await this.require(id);
    const gate = await this.mergeGate(repo, number);
    const sessions = await this.store.loadSessions();
    const host =
      findBoundAgent(sessions, { repoId: repo.id, pullNumber: number })?.id ?? gate.sourceId;
    if (!host) throw new Error("No agent or review session for this pull request");
    const { toolCallId } = await this.sessions.requestOperatorApproval(
      host,
      {
        name: "git_pr_merge",
        arguments: { pull_number: number, repo: repo.name, riskGate: gate.reason ?? "" },
      },
      async () => {
        const merged = await this.merge(id, number, { approveRisk: true });
        return { ok: true, output: `Merged #${merged.number} ${merged.title}` };
      },
    );
    return { sessionId: host, toolCallId, gate };
  }

  async setFileViewed(
    id: string,
    number: number,
    path: string,
    viewed: boolean,
  ): Promise<PullRequestDetail> {
    const rel = path.trim();
    if (!rel) throw new Error("path is required");
    const repo = await this.require(id);
    const account = await this.accountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const result = await this.forge.setFileViewed(
      account,
      parsed.owner,
      parsed.repo,
      number,
      rel,
      viewed,
    );
    if (!result.ok) throw new Error(result.output || "Could not update viewed file");
    const pull = await this.getPull(id, number, { fresh: true });
    return {
      ...pull,
      files: pull.files.map((file) => (file.path === rel ? { ...file, viewed } : file)),
    };
  }

  async startAgent(
    id: string,
    input: Partial<CreateSessionInput> & { reuse?: boolean } = {},
  ): Promise<{ session: Awaited<ReturnType<SessionService["create"]>> }> {
    const repo = await this.require(id);
    if (input.reuse) {
      const bound = findBoundAgent(await this.store.loadSessions(), { repoId: repo.id });
      if (bound) {
        if (
          input.startVm !== false &&
          bound.status !== "running" &&
          bound.status !== "provisioning"
        ) {
          await this.sessions.startVm(bound.id).catch(() => undefined);
        }
        const prompt = input.prompt?.trim();
        if (prompt) await this.sessions.sendChat(bound.id, prompt);
        return { session: (await this.sessions.get(bound.id)) ?? bound };
      }
    }
    const config = await this.store.loadConfig();
    const env = namedEnvironmentById(config.namedEnvironments, repo.namedEnvironmentId);
    const applied = env ? applyNamedEnvironment(env) : {};
    const runtime: AgentRuntime =
      input.runtime ?? applied.runtime ?? repo.defaultRuntime ?? "docker";
    const os =
      input.os ??
      applied.os ??
      repo.os ??
      (runtime === "docker" ? "ubuntu" : (config.templates[0]?.os ?? "ubuntu"));
    const template =
      config.templates.find((row) => row.id === (input.templateId ?? applied.templateId)) ??
      config.templates.find((row) => row.os === os) ??
      config.templates[0];
    if (!template) throw new Error("Unknown template");
    const provider =
      config.providers.find((row) => row.id === input.providerId) ??
      config.providers.find((row) => row.enabled) ??
      config.providers[0];
    if (!provider) throw new Error("Add a provider in Settings");
    const worker = (input.placement ?? applied.placement) === "worker";
    const session = await this.sessions.create({
      title: input.title,
      os: runtime === "docker" && (os === "windows-11" || os === "windows-10") ? "ubuntu" : os,
      templateId: template.id,
      runtime,
      dockerImage:
        runtime === "docker"
          ? (input.dockerImage ?? applied.dockerImage ?? repo.dockerImage ?? DEFAULT_DOCKER_IMAGE)
          : undefined,
      imageId: runtime === "host" ? undefined : (input.imageId ?? applied.imageId),
      network: runtime === "host" ? undefined : (input.network ?? applied.network),
      maxUsd: input.maxUsd ?? applied.maxUsd,
      placement: worker ? "worker" : undefined,
      backendId: worker ? (input.backendId ?? applied.backendId) : undefined,
      allowHosts: input.allowHosts ?? applied.allowHosts,
      providerId: provider.id,
      model: input.model ?? provider.defaultModel,
      repo: { ...repo.checkout, ...input.repo },
      repoId: repo.id,
      pull: input.pull,
      playbook: input.playbook ?? repo.playbook,
      startVm: input.startVm ?? true,
      prompt: input.prompt,
      hostDir: input.hostDir,
    });
    return { session };
  }

  async startSetupSession(
    id: string,
  ): Promise<{ session: Awaited<ReturnType<SessionService["create"]>> }> {
    const repo = await this.require(id);
    const recipe = AGENT_RECIPES.find((row) => row.id === "env-setup");
    const config = await this.store.loadConfig();
    const provider = config.providers.find((row) => row.enabled) ?? config.providers[0];
    if (!provider) throw new Error("Add a provider in Settings");
    const template = config.templates.find((row) => row.os === "ubuntu") ?? config.templates[0];
    if (!template) throw new Error("Unknown template");
    const session = await this.sessions.create({
      title: `Setup environment · ${repo.name}`,
      os: "ubuntu",
      templateId: template.id,
      kind: "setup",
      runtime: "docker",
      dockerImage: recipe?.dockerImage ?? DEFAULT_DOCKER_IMAGE,
      providerId: provider.id,
      model: provider.defaultModel,
      repo: { ...repo.checkout },
      repoId: repo.id,
      playbook: recipe?.playbook,
      allowedTools: recipe?.allowedTools,
      startVm: true,
    });
    await this.sessions.sendChat(
      session.id,
      formatSetupPrompt({
        prompt: recipe?.prompt ?? "Set up this repository.",
        repoName: repo.name,
        repoUrl: repo.checkout.url,
      }),
    );
    return { session: (await this.sessions.get(session.id)) ?? session };
  }

  async architecture(id: string): Promise<ArchitectureAnalysis> {
    const repo = await this.require(id);
    const generatedAt = stamp();
    const sessions = await this.sessions.list();
    const checkout = await resolveArchitectureRoot(this.store.dataDir, sessions, repo.id);
    if (!checkout) {
      return {
        ...emptyArchitectureAnalysis(
          repo.name,
          "No Host or Docker checkout for this repo yet. Open it in the IDE, or start an agent, then Analyse again.",
          generatedAt,
        ),
        repoId: repo.id,
      };
    }
    const read = await readArchitectureSources(checkout.root);
    if (!read.files.length) {
      return {
        ...emptyArchitectureAnalysis(
          repo.name,
          "That checkout has no source files yet.",
          generatedAt,
        ),
        repoId: repo.id,
        checkout: {
          sessionId: checkout.sessionId,
          runtime: checkout.runtime,
          label: checkout.label,
        },
      };
    }
    return {
      ...analyzeArchitecture({
        repoName: repo.name,
        files: read.files,
        truncated: read.truncated,
        generatedAt,
      }),
      repoId: repo.id,
      checkout: {
        sessionId: checkout.sessionId,
        runtime: checkout.runtime,
        label: checkout.label,
      },
    };
  }

  async startArchitectureSession(
    id: string,
    input: { scope?: unknown; target?: unknown },
  ): Promise<{ session: Awaited<ReturnType<SessionService["create"]>> }> {
    if (!isArchScope(input.scope)) throw new Error("Scope must be repo, feature, or code");
    const scope: ArchScope = input.scope;
    const target = typeof input.target === "string" ? input.target.trim() : "";
    if ((scope === "feature" || scope === "code") && !target) {
      throw new Error("Pick a feature or file to improve");
    }
    if (target.includes("..") || target.startsWith("/") || target.includes("\\")) {
      throw new Error("Target must be a path inside the checkout");
    }
    const repo = await this.require(id);
    const analysis = await this.architecture(id);
    const section = architectureSection(analysis, scope, target || repo.name);
    const prompt = formatArchitectureSuggestPrompt({
      repoName: repo.name,
      scope,
      target: target || undefined,
      section,
      unavailable: analysis.unavailable,
    });
    const host =
      analysis.checkout?.runtime === "host"
        ? await this.hostDirFor(analysis.checkout.sessionId)
        : undefined;
    return this.startAgent(id, {
      title: architectureSessionTitle(repo.name, scope, target || undefined),
      runtime: host ? "host" : "docker",
      hostDir: host,
      playbook: ARCHITECTURE_PLAYBOOK,
      prompt,
      startVm: true,
    });
  }

  private async hostDirFor(sessionId: string): Promise<string | undefined> {
    const session = await this.sessions.get(sessionId);
    return session?.hostDir?.trim() || undefined;
  }

  async startReviewSession(
    id: string,
    number: number,
    opts: { providerId?: string; model?: string; maxUsd?: number } = {},
  ): Promise<{ session: Awaited<ReturnType<SessionService["create"]>> }> {
    const repo = await this.require(id);
    const pull = await this.getPull(id, number);
    const recipe = AGENT_RECIPES.find((row) => row.id === "pr-reviewer");
    const stored = await this.store.loadLoadPathNotes(repo.id, number);
    const loadpath = buildLoadPath(pull.files, {
      notes: stored?.notes,
      notesUpdatedAt: stored?.updatedAt,
    });
    let changestack: ChangeStack | undefined;
    try {
      changestack = await this.getChangeStack(id, number);
    } catch {
      changestack = undefined;
    }
    const config = await this.store.loadConfig();
    const provider =
      (opts.providerId && config.providers.find((row) => row.id === opts.providerId)) ||
      config.providers.find((row) => row.enabled) ||
      config.providers[0];
    if (!provider) throw new Error("Add a provider in Settings");
    const template = config.templates.find((row) => row.os === "ubuntu") ?? config.templates[0];
    if (!template) throw new Error("Unknown template");
    const session = await this.sessions.create({
      maxUsd: typeof opts.maxUsd === "number" && opts.maxUsd > 0 ? opts.maxUsd : undefined,
      title: `Review #${number} · ${repo.name}`,
      os: "ubuntu",
      templateId: template.id,
      kind: "review",
      runtime: "docker",
      dockerImage: recipe?.dockerImage ?? DEFAULT_DOCKER_IMAGE,
      providerId: provider.id,
      model: opts.model?.trim() || provider.defaultModel,
      repo: { ...repo.checkout, ref: pull.headRef || repo.checkout.ref },
      repoId: repo.id,
      pull: {
        number: pull.number,
        url: pull.url,
        title: pull.title,
        state: pull.state,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
      },
      playbook: recipe?.playbook,
      allowedTools: recipe?.allowedTools,
      startVm: true,
    });
    await this.sessions.sendChat(
      session.id,
      formatReviewPrompt({
        prompt: recipe?.prompt ?? "Review this pull request.",
        pull,
        number,
        loadpath,
        changestack,
        comments: pull.comments,
      }),
    );
    return { session: (await this.sessions.get(session.id)) ?? session };
  }

  async startFixSession(
    id: string,
    number: number,
    opts: { ci?: CiFixRequest } = {},
  ): Promise<{ session: Awaited<ReturnType<SessionService["create"]>> }> {
    const repo = await this.require(id);
    const pull = await this.getPull(id, number, opts.ci ? { fresh: true } : {});
    const ci = await this.ciFixSection(repo, pull, opts.ci);
    const stored = await this.store.loadLoadPathNotes(repo.id, number);
    const loadpath = buildLoadPath(pull.files, {
      notes: stored?.notes,
      notesUpdatedAt: stored?.updatedAt,
    });
    const sessions = await this.store.loadSessions();
    const review = sessions
      .filter(
        (row) =>
          row.repoId === repo.id &&
          sessionKind(row) === "review" &&
          row.pull?.number === number &&
          !row.archived,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const verdict = parseAnyReviewVerdict(review?.messages ?? []);
    const prompt = formatFixPrompt({
      pull: {
        url: pull.url,
        title: pull.title,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
      },
      number,
      verdict,
      loadpath,
      ci,
    });
    const bound = findBoundAgent(sessions, { repoId: repo.id, pullNumber: number });
    if (bound) {
      if (bound.status !== "running" && bound.status !== "provisioning") {
        await this.sessions.startVm(bound.id).catch(() => undefined);
      }
      await this.sessions.sendChat(bound.id, prompt);
      return { session: (await this.sessions.get(bound.id)) ?? bound };
    }
    const created = await this.startAgent(id, {
      title: `Fix #${number} · ${repo.name}`,
      repo: { ...repo.checkout, ref: pull.headRef || repo.checkout.ref },
      pull: {
        number: pull.number,
        url: pull.url,
        title: pull.title,
        state: pull.state,
        headRef: pull.headRef,
        baseRef: pull.baseRef,
      },
      startVm: true,
      prompt,
    });
    return created;
  }

  /**
   * CI section for a fix prompt: failing check names, condensed logs, and the head SHA.
   * Runs when the caller names failing checks (checks subscription) or the pull is red.
   * A forge or log failure degrades to check names only; it never blocks the fix.
   */
  private async ciFixSection(
    repo: LinkedRepo,
    pull: PullRequestDetail,
    request?: CiFixRequest,
  ): Promise<string | undefined> {
    const red = pull.checks.filter((row) => isFailingCheckStatus(row.status));
    if (!request && !red.length) return undefined;
    const headSha = request?.headSha || pull.headSha;
    const wanted = request?.checks?.length ? new Set(request.checks) : undefined;
    let report: CiFailureReport;
    try {
      const account = await this.readAccountFor(repo);
      const parsed = requireOwnerRepo(repo.checkout.url);
      report = await this.forge.ciReport(account, parsed.owner, parsed.repo, {
        number: pull.number,
        headSha,
        checks: pull.checks,
        maxChars: CI_FIX_LOG_CHARS,
        maxLogs: 3,
      });
    } catch {
      report = {
        headSha,
        pending: [],
        failures: red.map((row) => ({
          name: row.name,
          status: row.status,
          url: row.url,
          source: "other" as const,
          logAvailable: false,
          note: "Could not read CI logs; call git_ci_logs.",
        })),
      };
    }
    if (wanted) {
      const picked = report.failures.filter((row) => wanted.has(row.name));
      if (picked.length) report = { ...report, failures: picked };
    }
    if (!report.failures.length) return undefined;
    return formatCiFixPrompt({
      pull: { url: pull.url, title: pull.title, headRef: pull.headRef, baseRef: pull.baseRef },
      number: pull.number,
      report,
      attempt: request?.attempt,
      maxAttempts: request?.maxAttempts,
    });
  }

  async accountFor(repo: LinkedRepo): Promise<GitForgeAccount> {
    const config = await this.store.loadConfig();
    const account = resolveForgeAccount(config.forges, {
      accountId: repo.checkout.accountId,
      kind: repo.checkout.forge,
      url: repo.checkout.url,
    });
    if (!account) throw new Error("Add a forge account in Settings → Git");
    const fresh = await withFreshForgeToken(this.store, account, this.fetchFn);
    if (!fresh.token?.trim()) {
      throw new Error(`Sign in or add a ${fresh.name} token in Settings → Git`);
    }
    return fresh;
  }

  /**
   * Account for reads. Without a token this returns a tokenless account so public repos load
   * unauthenticated; the forge adapters throw `ForgeAccessError` when that is refused.
   */
  async readAccountFor(repo: LinkedRepo): Promise<GitForgeAccount> {
    const config = await this.store.loadConfig();
    const account = resolveForgeAccount(config.forges, {
      accountId: repo.checkout.accountId,
      kind: repo.checkout.forge,
      url: repo.checkout.url,
    });
    if (account) return withFreshForgeToken(this.store, account, this.fetchFn);
    const spec = DEFAULT_FORGE_SPECS.find((row) => row.kind === repo.checkout.forge);
    if (!spec) throw new Error("Add a forge account in Settings → Git");
    return { id: `anonymous-${spec.kind}`, ...spec };
  }

  /** Default branch from the forge, or undefined when it can't be reached. Never throws. */
  private async lookupDefaultBranch(repo: LinkedRepo): Promise<string | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const account = await this.readAccountFor(repo);
      const parsed = requireOwnerRepo(repo.checkout.url);
      const listed = await Promise.race([
        this.forge.listBranches(account, parsed.owner, parsed.repo),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), DEFAULT_BRANCH_TIMEOUT_MS);
        }),
      ]);
      return listed?.defaultBranch?.trim() || undefined;
    } catch {
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async fetchListPulls(id: string, state: PullListState): Promise<PullRequestRef[]> {
    const repo = await this.require(id);
    const account = await this.readAccountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const rows = await this.forge.listPulls(account, parsed.owner, parsed.repo, state);
    const mapped = await this.withListSessions(
      repo.id,
      rows.map((row) => ({ ...row, repoId: repo.id })),
    );
    return mapped;
  }

  private async fetchPull(id: string, number: number): Promise<PullRequestDetail> {
    const repo = await this.require(id);
    const account = await this.readAccountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const detail = await this.forge.getPull(account, parsed.owner, parsed.repo, number);
    return this.withDetailSessions(repo.id, number, { ...detail, repoId: repo.id });
  }

  private async fetchListIssues(id: string, state: IssueListState): Promise<IssueRef[]> {
    const repo = await this.require(id);
    const account = await this.readAccountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const rows = await this.forge.listIssues(account, parsed.owner, parsed.repo, state);
    return rows.map((row) => ({ ...row, repoId: repo.id }));
  }

  private async fetchIssue(id: string, number: number): Promise<IssueDetail> {
    const repo = await this.require(id);
    const account = await this.readAccountFor(repo);
    const parsed = requireOwnerRepo(repo.checkout.url);
    const detail = await this.forge.getIssue(account, parsed.owner, parsed.repo, number);
    return { ...detail, repoId: repo.id };
  }

  private async withListSessions(
    repoId: string,
    rows: PullRequestRef[],
  ): Promise<PullRequestRef[]> {
    const sessions = await this.sessions.list();
    return rows.map((row) => ({
      ...row,
      repoId,
      sessionIds: sessions
        .filter((session) => session.repoId === repoId && session.pull?.number === row.number)
        .map((session) => session.id),
    }));
  }

  private async withDetailSessions(
    repoId: string,
    number: number,
    pull: PullRequestDetail,
  ): Promise<PullRequestDetail> {
    const sessions = await this.sessions.list();
    return {
      ...pull,
      repoId,
      sessionIds: sessions
        .filter((session) => session.repoId === repoId && session.pull?.number === number)
        .map((session) => session.id),
    };
  }
}

export function parseCreateLinkedRepo(raw: unknown): CreateLinkedRepoInput {
  if (!raw || typeof raw !== "object") throw new Error("URL is required");
  const value = raw as Record<string, unknown>;
  const url = typeof value.url === "string" ? value.url : "";
  if (!url.trim()) throw new Error("URL is required");
  return {
    url,
    name: typeof value.name === "string" ? value.name : undefined,
    ref: typeof value.ref === "string" ? value.ref : undefined,
    accountId: typeof value.accountId === "string" ? value.accountId : undefined,
  };
}

export function parsePatchLinkedRepo(raw: unknown): PatchLinkedRepoInput {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const out: PatchLinkedRepoInput = {};
  if (typeof value.name === "string") out.name = value.name;
  if (typeof value.ref === "string") out.ref = value.ref;
  if (typeof value.accountId === "string") out.accountId = value.accountId;
  if (
    value.defaultRuntime === null ||
    value.defaultRuntime === "docker" ||
    value.defaultRuntime === "vm"
  ) {
    out.defaultRuntime = value.defaultRuntime;
  }
  if (value.dockerImage === null || typeof value.dockerImage === "string")
    out.dockerImage = value.dockerImage;
  if (
    value.os === null ||
    value.os === "ubuntu" ||
    value.os === "debian" ||
    value.os === "windows-11" ||
    value.os === "windows-10"
  ) {
    out.os = value.os;
  }
  if (value.playbook === null || typeof value.playbook === "string") out.playbook = value.playbook;
  if (value.reviewPrompt === null || typeof value.reviewPrompt === "string")
    out.reviewPrompt = value.reviewPrompt;
  if (typeof value.autoReview === "boolean") out.autoReview = value.autoReview;
  if (value.namedEnvironmentId === null) out.namedEnvironmentId = null;
  else if (typeof value.namedEnvironmentId === "string")
    out.namedEnvironmentId = value.namedEnvironmentId;
  return out;
}
