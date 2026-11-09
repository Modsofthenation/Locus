import { mkdir, readFile, chmod, readdir, unlink, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_ADVANCED,
  MAX_LOAD_PATH_NOTES,
  mergeBuiltinProviders,
  mergeBuiltinSkills,
  mergeDefaultForges,
  normalizeSkills,
  normalizePlugins,
  parseDesignSystem,
  parseAssetStyle,
  parseGameStyle,
  parseIntegrationAccounts,
  parseLinkedRepos,
  parseLoadPathNotes,
  parseChangeStack,
  safeChangeStackHeadSha,
  parseIssueDetailCache,
  parseIssueListCache,
  parseIssueListState,
  parsePullDetailCache,
  parsePullListCache,
  parsePullListState,
  parseWorkerBackends,
  parseWorkerPlaneId,
  createWorkerPlaneId,
  parseLocale,
  parseNamedEnvironments,
  parseDesktopNotifyPrefs,
  editorFontSize,
  parseFormatOnSave,
  parseShowMinimap,
  parseDiffLayout,
  parseChatDensity,
  parseBrainSettings,
  resolveTheme,
  stampIntegrationToken,
  inspectIntegrationToken,
  stripManagedPolicy,
  type AgentSession,
  type Automation,
  type AutomationRun,
  type DesignSystem,
  type AssetStyle,
  type GameStyle,
  type GoldenImage,
  type LinkedRepo,
  type LoadPathNotes,
  type ChangeStack,
  type ChangeStackRevision,
  type LocusConfig,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
  type VmInstance,
} from "@locus/shared";
import { replaceFile } from "./atomic.js";
import {
  assertWipeableDataDir,
  builtinProviders,
  builtinTemplates,
  defaultConfig,
  defaultDataDir,
} from "../defaults.js";
import {
  applySecrets,
  extractSecrets,
  hasExtractableSecrets,
  loadOrCreateMasterKey,
  readVaultFile,
  writeVaultFile,
} from "./vault.js";
import { configWithManagedPolicy } from "./policy.js";

function withTokenHygiene(config: LocusConfig): LocusConfig {
  const now = new Date().toISOString();
  return {
    ...config,
    integrations: (config.integrations ?? []).map((row) => {
      const stamped = stampIntegrationToken(row, now);
      return { ...stamped, tokenWarning: inspectIntegrationToken(stamped).warning };
    }),
  };
}

function stripTokenWarnings(config: LocusConfig): LocusConfig {
  return {
    ...config,
    integrations: (config.integrations ?? []).map((row) => {
      const { tokenWarning: _ignored, ...rest } = row;
      return rest;
    }),
  };
}

const queues = new Map<string, Promise<void>>();

/** Coalesce streaming session JSON writes so each token does not hit disk. */
export const SESSION_FLUSH_MS = 100;

export type SessionPersist = "now" | "later";

function enqueue(key: string, work: () => Promise<void>): Promise<void> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  queues.set(key, next);
  return next;
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await enqueue(path, () => replaceFile(path, data));
}

/** Newest runs kept for one job. */
export const MAX_AUTOMATION_RUNS_PER_JOB = 500;
/** Newest runs kept across the fleet. */
export const MAX_AUTOMATION_RUNS = 5000;

function trimAutomationRuns(runs: AutomationRun[]): AutomationRun[] {
  const sorted = [...runs].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
  );
  const kept: AutomationRun[] = [];
  const perJob = new Map<string, number>();
  for (const run of sorted) {
    const n = perJob.get(run.automationId) ?? 0;
    if (n >= MAX_AUTOMATION_RUNS_PER_JOB) continue;
    perJob.set(run.automationId, n + 1);
    kept.push(run);
    if (kept.length >= MAX_AUTOMATION_RUNS) break;
  }
  return kept;
}

export class JsonStore {
  readonly dataDir: string;
  private configPath: string;
  private sessionsDir: string;
  private sessionsLegacyPath: string;
  private vmsPath: string;
  private automationsPath: string;
  private runsPath: string;
  private imagesPath: string;
  private reposPath: string;
  private designSystemsPath: string;
  private assetStylesPath: string;
  private gameStylesPath: string;
  private configCache: LocusConfig | undefined;
  private configEpoch = 0;
  private configSave: Promise<void> | undefined;
  private sessionCache = new Map<string, AgentSession>();
  private sessionDirty = new Set<string>();
  private sessionWriteHash = new Map<string, string>();
  private sessionFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private discarding = false;
  private inflightWrites = 0;
  private writeEpoch = 0;

  constructor(dataDir = defaultDataDir()) {
    this.dataDir = dataDir;
    this.configPath = join(dataDir, "config.json");
    this.sessionsDir = join(dataDir, "sessions");
    this.sessionsLegacyPath = join(dataDir, "sessions.json");
    this.vmsPath = join(dataDir, "vms.json");
    this.automationsPath = join(dataDir, "automations.json");
    this.runsPath = join(dataDir, "automation-runs.json");
    this.imagesPath = join(dataDir, "images.json");
    this.reposPath = join(dataDir, "repos.json");
    this.designSystemsPath = join(dataDir, "design-systems.json");
    this.assetStylesPath = join(dataDir, "asset-styles.json");
    this.gameStylesPath = join(dataDir, "game-styles.json");
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700).catch(() => undefined);
    await mkdir(join(this.dataDir, "disks"), { recursive: true });
    await mkdir(join(this.dataDir, "logs"), { recursive: true });
    await mkdir(join(this.dataDir, "images"), { recursive: true });
    await mkdir(join(this.dataDir, "checkpoints"), { recursive: true });
    await mkdir(join(this.dataDir, "share"), { recursive: true });
    await mkdir(join(this.dataDir, "recordings"), { recursive: true });
    await mkdir(join(this.dataDir, "screenshots"), { recursive: true });
    await mkdir(this.sessionsDir, { recursive: true, mode: 0o700 });
    await this.migrateLegacySessions();
    if (!(await this.exists(this.configPath))) {
      await this.saveConfig(defaultConfig(this.dataDir));
    }
    if (!(await this.exists(this.vmsPath))) {
      await atomicWrite(this.vmsPath, "[]");
    }
    if (!(await this.exists(this.automationsPath))) {
      await atomicWrite(this.automationsPath, "[]");
    }
    if (!(await this.exists(this.runsPath))) {
      await atomicWrite(this.runsPath, "[]");
    }
    if (!(await this.exists(this.imagesPath))) {
      await atomicWrite(this.imagesPath, "[]");
    }
    if (!(await this.exists(this.reposPath))) {
      await atomicWrite(this.reposPath, "[]");
    }
    if (!(await this.exists(this.designSystemsPath))) {
      await atomicWrite(this.designSystemsPath, "[]");
    }
    await mkdir(join(this.dataDir, "repos"), { recursive: true, mode: 0o700 });
  }

  async wipe(): Promise<void> {
    this.writeEpoch += 1;
    this.discarding = true;
    this.clearSessionCache();
    this.configCache = undefined;
    this.configEpoch += 1;
    while (this.inflightWrites > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const root = assertWipeableDataDir(this.dataDir);
    const entries = await readdir(root).catch(() => [] as string[]);
    await Promise.all(
      entries.map((name) => rm(join(root, name), { recursive: true, force: true })),
    );
    this.discarding = false;
    await this.init();
  }

  async loadConfig(): Promise<LocusConfig> {
    if (this.configSave) await this.configSave;
    if (this.configCache) return structuredClone(this.configCache);
    const epoch = this.configEpoch;
    const raw = JSON.parse(await readFile(this.configPath, "utf8")) as LocusConfig;
    const merged = this.hydrateConfig(raw);
    try {
      const key = await loadOrCreateMasterKey(this.dataDir);
      const vault = await readVaultFile(this.dataDir, key);
      const result = vault ? applySecrets(merged, vault) : merged;
      const withPolicy = withTokenHygiene(await configWithManagedPolicy(result, this.dataDir));
      if (hasExtractableSecrets(merged) || !parseWorkerPlaneId(raw.workerPlaneId)) {
        await this.saveConfig(withPolicy);
      }
      if (this.configSave) await this.configSave;
      if (this.configCache) return structuredClone(this.configCache);
      if (this.configEpoch !== epoch) return this.loadConfig();
      this.configCache = structuredClone(withPolicy);
      return structuredClone(withPolicy);
    } catch (err) {
      console.error("Could not read secrets vault:", err instanceof Error ? err.message : err);
    }
    if (this.configEpoch !== epoch && this.configCache) return structuredClone(this.configCache);
    return withTokenHygiene(await configWithManagedPolicy(merged, this.dataDir));
  }

  async saveConfig(config: LocusConfig): Promise<void> {
    this.configEpoch += 1;
    this.configCache = undefined;
    const work = this.persistConfig(config);
    this.configSave = work;
    try {
      await work;
      this.configCache = structuredClone(
        withTokenHygiene(await configWithManagedPolicy(this.hydrateConfig(config), this.dataDir)),
      );
    } finally {
      if (this.configSave === work) this.configSave = undefined;
    }
  }

  /** Merge builtins/defaults so a cached save still looks like a disk load. */
  private hydrateConfig(raw: LocusConfig): LocusConfig {
    const templates = [...(raw.templates ?? [])];
    for (const builtin of builtinTemplates({ randomPasswords: true })) {
      if (!templates.some((t) => t.id === builtin.id)) templates.push(builtin);
    }
    return {
      ...raw,
      theme: resolveTheme(raw.theme),
      providers: mergeBuiltinProviders(raw.providers ?? [], builtinProviders()),
      templates,
      hardwareProfiles: raw.hardwareProfiles ?? [],
      mcpServers: raw.mcpServers ?? [],
      skills: mergeBuiltinSkills(normalizeSkills(raw.skills)),
      forges: mergeDefaultForges(raw.forges ?? []),
      integrations: parseIntegrationAccounts(raw.integrations),
      integrationPlugins: normalizePlugins(raw.integrationPlugins),
      workers: parseWorkerBackends(raw.workers),
      workerPlaneId: parseWorkerPlaneId(raw.workerPlaneId) ?? createWorkerPlaneId(),
      locale: parseLocale(raw.locale),
      setupFirstTask:
        raw.setupFirstTask === "pending" ||
        raw.setupFirstTask === "done" ||
        raw.setupFirstTask === "dismissed"
          ? raw.setupFirstTask
          : undefined,
      namedEnvironments: parseNamedEnvironments(raw.namedEnvironments),
      setupCompleted: Boolean(raw.setupCompleted),
      editorFontSize: editorFontSize(raw.editorFontSize),
      formatOnSave: parseFormatOnSave(raw.formatOnSave),
      showMinimap: parseShowMinimap(raw.showMinimap),
      diffLayout: parseDiffLayout(raw.diffLayout),
      chatDensity: parseChatDensity(raw.chatDensity),
      brain: parseBrainSettings(raw.brain),
      ...parseDesktopNotifyPrefs(raw),
      advanced: {
        ...DEFAULT_ADVANCED,
        ...raw.advanced,
        dataDir: raw.advanced?.dataDir || this.dataDir,
        hostSharePath: raw.advanced?.hostSharePath?.trim() || join(this.dataDir, "share"),
      },
    };
  }

  private async persistConfig(config: LocusConfig): Promise<void> {
    const key = await loadOrCreateMasterKey(this.dataDir);
    try {
      await readVaultFile(this.dataDir, key);
    } catch {
      throw new Error(
        "Secrets vault is unreadable; refusing to overwrite it. Check LOCUS_MASTER_KEY.",
      );
    }
    const { config: stripped, secrets } = extractSecrets(
      stripTokenWarnings(stripManagedPolicy(config) as LocusConfig),
    );
    await writeVaultFile(this.dataDir, key, secrets);
    await atomicWrite(this.configPath, JSON.stringify(stripped, null, 2));
  }

  private sessionPath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  private async migrateLegacySessions(): Promise<void> {
    if (!(await this.exists(this.sessionsLegacyPath))) return;
    let legacy: AgentSession[] = [];
    try {
      legacy = JSON.parse(await readFile(this.sessionsLegacyPath, "utf8")) as AgentSession[];
    } catch {
      return;
    }
    if (!Array.isArray(legacy)) return;
    for (const session of legacy) {
      if (!session?.id || !isSessionFileId(session.id)) continue;
      const dest = this.sessionPath(session.id);
      if (await this.exists(dest)) continue;
      await replaceFile(dest, serializeSession(persistableSession(session)));
    }
    await rename(this.sessionsLegacyPath, `${this.sessionsLegacyPath}.bak`).catch(async () => {
      await unlink(this.sessionsLegacyPath).catch(() => undefined);
    });
  }

  async loadSessions(): Promise<AgentSession[]> {
    await this.migrateLegacySessions();
    await this.flushSessions();
    let names: string[] = [];
    try {
      names = (await readdir(this.sessionsDir)).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
    const seen = new Set<string>();
    const loaded = await Promise.all(
      names.map(async (name) => {
        const id = name.slice(0, -5);
        if (!isSessionFileId(id)) return undefined;
        seen.add(id);
        const cached = this.sessionCache.get(id);
        if (cached) return cached;
        try {
          const raw = await readFile(this.sessionPath(id), "utf8");
          const row = JSON.parse(raw) as AgentSession;
          if (!row?.id) return undefined;
          this.sessionCache.set(id, row);
          this.sessionWriteHash.set(id, hashSessionBody(raw));
          return row;
        } catch {
          return undefined;
        }
      }),
    );
    const sessions = loaded.filter((row): row is AgentSession => Boolean(row));
    for (const id of this.sessionCache.keys()) {
      if (!seen.has(id)) this.dropSessionCache(id);
    }
    return sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getSession(id: string): Promise<AgentSession | undefined> {
    if (!isSessionFileId(id)) return undefined;
    let result: AgentSession | undefined;
    await enqueue(this.sessionPath(id), async () => {
      const cached = this.sessionCache.get(id);
      if (cached) {
        result = cached;
        return;
      }
      try {
        const row = JSON.parse(await readFile(this.sessionPath(id), "utf8")) as AgentSession;
        if (!row?.id) return;
        this.sessionCache.set(id, row);
        result = row;
      } catch {
        /* missing or unreadable */
      }
    });
    return result;
  }

  async saveSessions(sessions: AgentSession[]): Promise<void> {
    await enqueue("sessions", async () => {
      const epoch = this.writeEpoch;
      const keep = new Set<string>();
      for (const session of sessions) {
        if (!isSessionFileId(session.id)) continue;
        keep.add(session.id);
        const stored = persistableSession(session);
        this.sessionCache.set(session.id, stored);
        this.sessionDirty.delete(session.id);
        this.clearSessionFlushTimer(session.id);
        if (!(await this.writeSessionFile(session.id, stored, epoch))) {
          this.sessionCache.delete(session.id);
        }
      }
      let names: string[] = [];
      try {
        names = await readdir(this.sessionsDir);
      } catch {
        return;
      }
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -5);
        if (!keep.has(id)) {
          this.dropSessionCache(id);
          await unlink(this.sessionPath(id)).catch(() => undefined);
        }
      }
    });
  }

  async replaceSession(session: AgentSession): Promise<void> {
    if (!isSessionFileId(session.id)) throw new Error("Invalid session id");
    await enqueue(this.sessionPath(session.id), async () => {
      const epoch = this.writeEpoch;
      const stored = persistableSession(session);
      this.sessionCache.set(session.id, stored);
      this.sessionDirty.delete(session.id);
      this.clearSessionFlushTimer(session.id);
      if (!(await this.writeSessionFile(session.id, stored, epoch))) {
        this.sessionCache.delete(session.id);
      }
    });
  }

  async deleteSession(id: string): Promise<void> {
    if (!isSessionFileId(id)) return;
    await enqueue(this.sessionPath(id), async () => {
      this.dropSessionCache(id);
      await unlink(this.sessionPath(id)).catch(() => undefined);
    });
  }

  async loadVms(): Promise<VmInstance[]> {
    return JSON.parse(await readFile(this.vmsPath, "utf8")) as VmInstance[];
  }

  async saveVms(vms: VmInstance[]): Promise<void> {
    await atomicWrite(this.vmsPath, JSON.stringify(vms, null, 2));
  }

  async deleteVm(id: string): Promise<void> {
    const vms = (await this.loadVms()).filter((v) => v.id !== id);
    await this.saveVms(vms);
  }

  async upsertVm(vm: VmInstance): Promise<void> {
    await enqueue(this.vmsPath, async () => {
      let vms: VmInstance[] = [];
      try {
        vms = JSON.parse(await readFile(this.vmsPath, "utf8")) as VmInstance[];
      } catch {
        vms = [];
      }
      const idx = vms.findIndex((v) => v.id === vm.id);
      if (idx >= 0) vms[idx] = vm;
      else vms.push(vm);
      await replaceFile(this.vmsPath, JSON.stringify(vms, null, 2));
    });
  }

  async mutateSession(
    id: string,
    mut: (session: AgentSession) => void,
    opts: { persist?: SessionPersist } = {},
  ): Promise<AgentSession | undefined> {
    if (!isSessionFileId(id)) return undefined;
    const persist = opts.persist ?? "now";
    let result: AgentSession | undefined;
    await enqueue(this.sessionPath(id), async () => {
      if (this.discarding) return;
      let session = this.sessionCache.get(id);
      if (!session) {
        try {
          session = JSON.parse(await readFile(this.sessionPath(id), "utf8")) as AgentSession;
        } catch {
          return;
        }
      }
      if (this.discarding) return;
      if (!session?.id) return;
      mut(session);
      session.updatedAt = new Date().toISOString();
      this.sessionCache.set(id, session);
      result = session;
      if (persist === "later") {
        this.sessionDirty.add(id);
        return;
      }
      this.sessionDirty.delete(id);
      this.clearSessionFlushTimer(id);
      const epoch = this.writeEpoch;
      const stored = persistableSession(session);
      if (!(await this.writeSessionFile(id, stored, epoch))) return;
      this.sessionCache.set(id, stored);
      result = stored;
    });
    if (persist === "later" && result) this.scheduleSessionFlush(id);
    return result;
  }

  async flushSession(id: string): Promise<void> {
    if (!isSessionFileId(id)) return;
    this.clearSessionFlushTimer(id);
    await enqueue(this.sessionPath(id), async () => {
      if (!this.sessionDirty.has(id)) return;
      const session = this.sessionCache.get(id);
      if (!session) {
        this.sessionDirty.delete(id);
        return;
      }
      if (this.discarding) {
        this.sessionDirty.delete(id);
        return;
      }
      const epoch = this.writeEpoch;
      const stored = persistableSession(session);
      if (!(await this.writeSessionFile(id, stored, epoch))) {
        this.sessionDirty.delete(id);
        return;
      }
      this.sessionCache.set(id, stored);
      this.sessionDirty.delete(id);
    });
  }

  async flushSessions(): Promise<void> {
    await Promise.all([...this.sessionDirty].map((id) => this.flushSession(id)));
  }

  private scheduleSessionFlush(id: string): void {
    if (this.sessionFlushTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.sessionFlushTimers.delete(id);
      void this.flushSession(id);
    }, SESSION_FLUSH_MS);
    timer.unref?.();
    this.sessionFlushTimers.set(id, timer);
  }

  private async writeSessionFile(
    id: string,
    stored: AgentSession,
    epoch = this.writeEpoch,
  ): Promise<boolean> {
    this.inflightWrites += 1;
    try {
      if (this.discarding || this.writeEpoch !== epoch) return false;
      const body = serializeSession(stored);
      const hash = hashSessionBody(body);
      if (this.sessionWriteHash.get(id) === hash) return true;
      await replaceFile(this.sessionPath(id), body);
      this.sessionWriteHash.set(id, hash);
      if (this.discarding || this.writeEpoch !== epoch) {
        await unlink(this.sessionPath(id)).catch(() => undefined);
        return false;
      }
      return true;
    } finally {
      this.inflightWrites -= 1;
    }
  }

  private clearSessionFlushTimer(id: string): void {
    const timer = this.sessionFlushTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.sessionFlushTimers.delete(id);
  }

  private dropSessionCache(id: string): void {
    this.sessionCache.delete(id);
    this.sessionDirty.delete(id);
    this.sessionWriteHash.delete(id);
    this.clearSessionFlushTimer(id);
  }

  private clearSessionCache(): void {
    for (const id of [...this.sessionFlushTimers.keys()]) this.clearSessionFlushTimer(id);
    this.sessionCache.clear();
    this.sessionDirty.clear();
    this.sessionWriteHash.clear();
  }

  async loadAutomations(): Promise<Automation[]> {
    return JSON.parse(await readFile(this.automationsPath, "utf8")) as Automation[];
  }

  async saveAutomations(items: Automation[]): Promise<void> {
    await atomicWrite(this.automationsPath, JSON.stringify(items, null, 2));
  }

  async replaceAutomation(item: Automation): Promise<void> {
    await enqueue(this.automationsPath, async () => {
      let items: Automation[] = [];
      try {
        items = JSON.parse(await readFile(this.automationsPath, "utf8")) as Automation[];
      } catch {
        items = [];
      }
      const idx = items.findIndex((a) => a.id === item.id);
      if (idx < 0) items.push(item);
      else items[idx] = item;
      await replaceFile(this.automationsPath, JSON.stringify(items, null, 2));
    });
  }

  async mutateAutomation(
    id: string,
    mut: (item: Automation) => void,
  ): Promise<Automation | undefined> {
    let result: Automation | undefined;
    await enqueue(this.automationsPath, async () => {
      let items: Automation[] = [];
      try {
        items = JSON.parse(await readFile(this.automationsPath, "utf8")) as Automation[];
      } catch {
        items = [];
      }
      const idx = items.findIndex((a) => a.id === id);
      if (idx < 0) return;
      const item = items[idx]!;
      mut(item);
      item.updatedAt = new Date().toISOString();
      result = item;
      await replaceFile(this.automationsPath, JSON.stringify(items, null, 2));
    });
    return result;
  }

  async deleteAutomation(id: string): Promise<void> {
    await enqueue(this.automationsPath, async () => {
      let items: Automation[] = [];
      try {
        items = JSON.parse(await readFile(this.automationsPath, "utf8")) as Automation[];
      } catch {
        items = [];
      }
      await replaceFile(
        this.automationsPath,
        JSON.stringify(
          items.filter((a) => a.id !== id),
          null,
          2,
        ),
      );
    });
    await enqueue(this.runsPath, async () => {
      let runs: AutomationRun[] = [];
      try {
        runs = JSON.parse(await readFile(this.runsPath, "utf8")) as AutomationRun[];
      } catch {
        runs = [];
      }
      await replaceFile(
        this.runsPath,
        JSON.stringify(
          runs.filter((r) => r.automationId !== id),
          null,
          2,
        ),
      );
    });
  }

  async loadRuns(): Promise<AutomationRun[]> {
    return JSON.parse(await readFile(this.runsPath, "utf8")) as AutomationRun[];
  }

  async saveRuns(runs: AutomationRun[]): Promise<void> {
    await atomicWrite(this.runsPath, JSON.stringify(runs, null, 2));
  }

  async replaceRun(run: AutomationRun): Promise<void> {
    await enqueue(this.runsPath, async () => {
      let runs: AutomationRun[] = [];
      try {
        runs = JSON.parse(await readFile(this.runsPath, "utf8")) as AutomationRun[];
      } catch {
        runs = [];
      }
      const idx = runs.findIndex((r) => r.id === run.id);
      if (idx < 0) runs.push(run);
      else runs[idx] = run;
      await replaceFile(this.runsPath, JSON.stringify(trimAutomationRuns(runs), null, 2));
    });
  }

  async loadImages(): Promise<GoldenImage[]> {
    try {
      return JSON.parse(await readFile(this.imagesPath, "utf8")) as GoldenImage[];
    } catch {
      return [];
    }
  }

  async saveImages(images: GoldenImage[]): Promise<void> {
    await atomicWrite(this.imagesPath, JSON.stringify(images, null, 2));
  }

  async replaceImage(image: GoldenImage): Promise<void> {
    const images = await this.loadImages();
    const idx = images.findIndex((i) => i.id === image.id);
    if (idx < 0) images.push(image);
    else images[idx] = image;
    await this.saveImages(images);
  }

  async deleteImage(id: string): Promise<GoldenImage | undefined> {
    const images = await this.loadImages();
    const found = images.find((i) => i.id === id);
    await this.saveImages(images.filter((i) => i.id !== id));
    return found;
  }

  async loadRepos(): Promise<LinkedRepo[]> {
    try {
      return parseLinkedRepos(JSON.parse(await readFile(this.reposPath, "utf8")));
    } catch {
      return [];
    }
  }

  async saveRepos(items: LinkedRepo[]): Promise<void> {
    await atomicWrite(this.reposPath, JSON.stringify(items, null, 2));
  }

  async replaceRepo(item: LinkedRepo): Promise<void> {
    await enqueue(this.reposPath, async () => {
      let items: LinkedRepo[] = [];
      try {
        items = parseLinkedRepos(JSON.parse(await readFile(this.reposPath, "utf8")));
      } catch {
        items = [];
      }
      const idx = items.findIndex((row) => row.id === item.id);
      if (idx < 0) items.push(item);
      else items[idx] = item;
      await replaceFile(this.reposPath, JSON.stringify(parseLinkedRepos(items), null, 2));
    });
  }

  async deleteRepo(id: string): Promise<void> {
    const items = (await this.loadRepos()).filter((row) => row.id !== id);
    await this.saveRepos(items);
    const dirId = safeRepoStorageId(id);
    if (dirId) await rm(join(this.dataDir, "repos", dirId), { recursive: true, force: true });
  }

  async loadDesignSystems(): Promise<DesignSystem[]> {
    try {
      const raw = JSON.parse(await readFile(this.designSystemsPath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw
        .map((row) => parseDesignSystem(row))
        .filter((row): row is DesignSystem => Boolean(row));
    } catch {
      return [];
    }
  }

  async saveDesignSystems(items: DesignSystem[]): Promise<void> {
    await atomicWrite(this.designSystemsPath, JSON.stringify(items, null, 2));
  }

  async replaceDesignSystem(item: DesignSystem): Promise<void> {
    await enqueue(this.designSystemsPath, async () => {
      let items: DesignSystem[] = [];
      try {
        const raw = JSON.parse(await readFile(this.designSystemsPath, "utf8")) as unknown;
        items = Array.isArray(raw)
          ? raw
              .map((row) => parseDesignSystem(row))
              .filter((row): row is DesignSystem => Boolean(row))
          : [];
      } catch {
        items = [];
      }
      const idx = items.findIndex((row) => row.id === item.id);
      if (idx < 0) items.push(item);
      else items[idx] = item;
      await replaceFile(this.designSystemsPath, JSON.stringify(items, null, 2));
    });
  }

  async deleteDesignSystem(id: string): Promise<void> {
    await enqueue(this.designSystemsPath, async () => {
      let items: DesignSystem[] = [];
      try {
        const raw = JSON.parse(await readFile(this.designSystemsPath, "utf8")) as unknown;
        items = Array.isArray(raw)
          ? raw
              .map((row) => parseDesignSystem(row))
              .filter((row): row is DesignSystem => Boolean(row))
          : [];
      } catch {
        items = [];
      }
      await replaceFile(
        this.designSystemsPath,
        JSON.stringify(
          items.filter((row) => row.id !== id),
          null,
          2,
        ),
      );
    });
  }

  async loadAssetStyles(): Promise<AssetStyle[]> {
    try {
      const raw = JSON.parse(await readFile(this.assetStylesPath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw
        .map((row) => parseAssetStyle(row))
        .filter((row): row is AssetStyle => Boolean(row));
    } catch {
      return [];
    }
  }

  async saveAssetStyles(items: AssetStyle[]): Promise<void> {
    await atomicWrite(this.assetStylesPath, JSON.stringify(items, null, 2));
  }

  async replaceAssetStyle(item: AssetStyle): Promise<void> {
    await enqueue(this.assetStylesPath, async () => {
      let items: AssetStyle[] = [];
      try {
        const raw = JSON.parse(await readFile(this.assetStylesPath, "utf8")) as unknown;
        items = Array.isArray(raw)
          ? raw.map((row) => parseAssetStyle(row)).filter((row): row is AssetStyle => Boolean(row))
          : [];
      } catch {
        items = [];
      }
      const idx = items.findIndex((row) => row.id === item.id);
      if (idx < 0) items.push(item);
      else items[idx] = item;
      await replaceFile(this.assetStylesPath, JSON.stringify(items, null, 2));
    });
  }

  async loadGameStyles(): Promise<GameStyle[]> {
    try {
      const raw = JSON.parse(await readFile(this.gameStylesPath, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.map((row) => parseGameStyle(row)).filter((row): row is GameStyle => Boolean(row));
    } catch {
      return [];
    }
  }

  async saveGameStyles(items: GameStyle[]): Promise<void> {
    await atomicWrite(this.gameStylesPath, JSON.stringify(items, null, 2));
  }

  async replaceGameStyle(item: GameStyle): Promise<void> {
    await enqueue(this.gameStylesPath, async () => {
      let items: GameStyle[] = [];
      try {
        const raw = JSON.parse(await readFile(this.gameStylesPath, "utf8")) as unknown;
        items = Array.isArray(raw)
          ? raw.map((row) => parseGameStyle(row)).filter((row): row is GameStyle => Boolean(row))
          : [];
      } catch {
        items = [];
      }
      const idx = items.findIndex((row) => row.id === item.id);
      if (idx < 0) items.push(item);
      else items[idx] = item;
      await replaceFile(this.gameStylesPath, JSON.stringify(items, null, 2));
    });
  }

  async deleteGameStyle(id: string): Promise<void> {
    await enqueue(this.gameStylesPath, async () => {
      let items: GameStyle[] = [];
      try {
        const raw = JSON.parse(await readFile(this.gameStylesPath, "utf8")) as unknown;
        items = Array.isArray(raw)
          ? raw.map((row) => parseGameStyle(row)).filter((row): row is GameStyle => Boolean(row))
          : [];
      } catch {
        items = [];
      }
      await replaceFile(
        this.gameStylesPath,
        JSON.stringify(
          items.filter((row) => row.id !== id),
          null,
          2,
        ),
      );
    });
  }

  async deleteAssetStyle(id: string): Promise<void> {
    await enqueue(this.assetStylesPath, async () => {
      let items: AssetStyle[] = [];
      try {
        const raw = JSON.parse(await readFile(this.assetStylesPath, "utf8")) as unknown;
        items = Array.isArray(raw)
          ? raw.map((row) => parseAssetStyle(row)).filter((row): row is AssetStyle => Boolean(row))
          : [];
      } catch {
        items = [];
      }
      await replaceFile(
        this.assetStylesPath,
        JSON.stringify(
          items.filter((row) => row.id !== id),
          null,
          2,
        ),
      );
    });
  }

  private repoPullsDir(repoId: string, invalidMessage = "Invalid pull cache path"): string {
    const id = safeRepoStorageId(repoId);
    if (!id) throw new Error(invalidMessage);
    const dest = join(this.dataDir, "repos", id, "pulls");
    const rel = relative(resolve(this.dataDir), resolve(dest));
    if (rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error(invalidMessage);
    return dest;
  }

  pullCachePath(repoId: string, number: number): string {
    const n = safePullNumber(number);
    if (n == null) throw new Error("Invalid pull cache path");
    return join(this.repoPullsDir(repoId), `${n}.json`);
  }

  pullListCachePath(repoId: string, state: PullListState): string {
    return join(this.repoPullsDir(repoId), `list-${parsePullListState(state)}.json`);
  }

  loadPathNotesPath(repoId: string, number: number): string {
    const n = safePullNumber(number);
    if (n == null) throw new Error("Invalid load path notes path");
    return join(this.repoPullsDir(repoId, "Invalid load path notes path"), `${n}.loadpath.json`);
  }

  changeStackPath(repoId: string, number: number): string {
    const n = safePullNumber(number);
    if (n == null) throw new Error("Invalid change stack path");
    return join(this.repoPullsDir(repoId, "Invalid change stack path"), `${n}.changestack.json`);
  }

  changeStackRevisionPath(repoId: string, number: number, headSha: string): string {
    const n = safePullNumber(number);
    const sha = safeChangeStackHeadSha(headSha);
    if (n == null || !sha) throw new Error("Invalid change stack revision path");
    return join(
      this.repoPullsDir(repoId, "Invalid change stack path"),
      `${n}.${sha}.changestack.json`,
    );
  }

  async savePullCache(
    repoId: string,
    number: number,
    pull: PullRequestDetail,
    fetchedAt = new Date().toISOString(),
  ): Promise<void> {
    const path = this.pullCachePath(repoId, number);
    await mkdir(this.repoPullsDir(repoId), { recursive: true, mode: 0o700 });
    await atomicWrite(path, JSON.stringify({ fetchedAt, pull }, null, 2));
  }

  async loadPullCache(
    repoId: string,
    number: number,
  ): Promise<{ fetchedAt: string; pull: PullRequestDetail } | undefined> {
    try {
      return parsePullDetailCache(
        JSON.parse(await readFile(this.pullCachePath(repoId, number), "utf8")),
        repoId,
      );
    } catch {
      return undefined;
    }
  }

  async savePullListCache(
    repoId: string,
    state: PullListState,
    pulls: PullRequestRef[],
    fetchedAt = new Date().toISOString(),
  ): Promise<void> {
    const path = this.pullListCachePath(repoId, state);
    await mkdir(this.repoPullsDir(repoId), { recursive: true, mode: 0o700 });
    await atomicWrite(
      path,
      JSON.stringify({ fetchedAt, state: parsePullListState(state), pulls }, null, 2),
    );
  }

  async loadPullListCache(
    repoId: string,
    state: PullListState,
  ): Promise<{ fetchedAt: string; state: PullListState; pulls: PullRequestRef[] } | undefined> {
    try {
      return parsePullListCache(
        JSON.parse(await readFile(this.pullListCachePath(repoId, state), "utf8")),
        repoId,
      );
    } catch {
      return undefined;
    }
  }

  async clearPullListCache(repoId: string): Promise<void> {
    for (const state of ["open", "draft", "all"] as const) {
      await unlink(this.pullListCachePath(repoId, state)).catch(() => undefined);
    }
  }

  private repoIssuesDir(repoId: string, invalidMessage = "Invalid issue cache path"): string {
    const id = safeRepoStorageId(repoId);
    if (!id) throw new Error(invalidMessage);
    const dest = join(this.dataDir, "repos", id, "issues");
    const rel = relative(resolve(this.dataDir), resolve(dest));
    if (rel.startsWith("..") || rel.split(sep).includes("..")) throw new Error(invalidMessage);
    return dest;
  }

  issueCachePath(repoId: string, number: number): string {
    const n = safePullNumber(number);
    if (n == null) throw new Error("Invalid issue cache path");
    return join(this.repoIssuesDir(repoId), `${n}.json`);
  }

  issueListCachePath(repoId: string, state: IssueListState): string {
    return join(this.repoIssuesDir(repoId), `list-${parseIssueListState(state)}.json`);
  }

  async saveIssueCache(
    repoId: string,
    number: number,
    issue: IssueDetail,
    fetchedAt = new Date().toISOString(),
  ): Promise<void> {
    const path = this.issueCachePath(repoId, number);
    await mkdir(this.repoIssuesDir(repoId), { recursive: true, mode: 0o700 });
    await atomicWrite(path, JSON.stringify({ fetchedAt, issue }, null, 2));
  }

  async loadIssueCache(
    repoId: string,
    number: number,
  ): Promise<{ fetchedAt: string; issue: IssueDetail } | undefined> {
    try {
      return parseIssueDetailCache(
        JSON.parse(await readFile(this.issueCachePath(repoId, number), "utf8")),
        repoId,
      );
    } catch {
      return undefined;
    }
  }

  async saveIssueListCache(
    repoId: string,
    state: IssueListState,
    issues: IssueRef[],
    fetchedAt = new Date().toISOString(),
  ): Promise<void> {
    const path = this.issueListCachePath(repoId, state);
    await mkdir(this.repoIssuesDir(repoId), { recursive: true, mode: 0o700 });
    await atomicWrite(
      path,
      JSON.stringify({ fetchedAt, state: parseIssueListState(state), issues }, null, 2),
    );
  }

  async loadIssueListCache(
    repoId: string,
    state: IssueListState,
  ): Promise<{ fetchedAt: string; state: IssueListState; issues: IssueRef[] } | undefined> {
    try {
      return parseIssueListCache(
        JSON.parse(await readFile(this.issueListCachePath(repoId, state), "utf8")),
        repoId,
      );
    } catch {
      return undefined;
    }
  }

  async clearIssueListCache(repoId: string): Promise<void> {
    for (const state of ["open", "closed", "all"] as const) {
      await unlink(this.issueListCachePath(repoId, state)).catch(() => undefined);
    }
  }

  async saveLoadPathNotes(repoId: string, number: number, notes: LoadPathNotes): Promise<void> {
    const path = this.loadPathNotesPath(repoId, number);
    await mkdir(this.repoPullsDir(repoId, "Invalid load path notes path"), {
      recursive: true,
      mode: 0o700,
    });
    await atomicWrite(
      path,
      JSON.stringify(
        { notes: notes.notes.slice(0, MAX_LOAD_PATH_NOTES), updatedAt: notes.updatedAt },
        null,
        2,
      ),
    );
  }

  async loadLoadPathNotes(repoId: string, number: number): Promise<LoadPathNotes | undefined> {
    try {
      return parseLoadPathNotes(
        JSON.parse(await readFile(this.loadPathNotesPath(repoId, number), "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  async saveChangeStack(repoId: string, number: number, stack: ChangeStack): Promise<void> {
    const path = this.changeStackPath(repoId, number);
    await mkdir(this.repoPullsDir(repoId, "Invalid change stack path"), {
      recursive: true,
      mode: 0o700,
    });
    const previous = await this.loadChangeStack(repoId, number);
    if (
      previous?.headSha &&
      previous.headSha !== stack.headSha &&
      safeChangeStackHeadSha(previous.headSha)
    ) {
      await atomicWrite(
        this.changeStackRevisionPath(repoId, number, previous.headSha),
        JSON.stringify(previous, null, 2),
      );
    }
    await atomicWrite(path, JSON.stringify(stack, null, 2));
  }

  async loadChangeStack(repoId: string, number: number): Promise<ChangeStack | undefined> {
    try {
      return parseChangeStack(
        JSON.parse(await readFile(this.changeStackPath(repoId, number), "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  async loadChangeStackRevision(
    repoId: string,
    number: number,
    headSha: string,
  ): Promise<ChangeStack | undefined> {
    const sha = safeChangeStackHeadSha(headSha);
    if (!sha) return undefined;
    const current = await this.loadChangeStack(repoId, number);
    if (current && safeChangeStackHeadSha(current.headSha) === sha) return current;
    try {
      return parseChangeStack(
        JSON.parse(await readFile(this.changeStackRevisionPath(repoId, number, sha), "utf8")),
      );
    } catch {
      return undefined;
    }
  }

  async listChangeStackRevisions(repoId: string, number: number): Promise<ChangeStackRevision[]> {
    const n = safePullNumber(number);
    if (n == null) throw new Error("Invalid change stack path");
    const items: ChangeStackRevision[] = [];
    const current = await this.loadChangeStack(repoId, number);
    const currentSha = current ? safeChangeStackHeadSha(current.headSha) : undefined;
    if (current) {
      items.push({
        headSha: current.headSha,
        generatedAt: current.generatedAt,
        source: current.source,
        current: true,
      });
    }
    let names: string[] = [];
    try {
      names = await readdir(this.repoPullsDir(repoId, "Invalid change stack path"));
    } catch {
      return items;
    }
    const prefix = `${n}.`;
    const suffix = ".changestack.json";
    for (const name of names) {
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
      const mid = name.slice(prefix.length, name.length - suffix.length);
      if (!mid || !safeChangeStackHeadSha(mid)) continue;
      if (currentSha && mid.toLowerCase() === currentSha) continue;
      try {
        const parsed = parseChangeStack(
          JSON.parse(
            await readFile(
              join(this.repoPullsDir(repoId, "Invalid change stack path"), name),
              "utf8",
            ),
          ),
        );
        if (!parsed) continue;
        items.push({
          headSha: parsed.headSha,
          generatedAt: parsed.generatedAt,
          source: parsed.source,
        });
      } catch {
        /* skip unreadable revision */
      }
    }
    items.sort(
      (a, b) => b.generatedAt.localeCompare(a.generatedAt) || a.headSha.localeCompare(b.headSha),
    );
    return items;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }
}

export function serializeSession(session: AgentSession): string {
  return JSON.stringify(session);
}

function hashSessionBody(body: string): string {
  return createHash("sha1").update(body).digest("hex");
}

function persistableSession(session: AgentSession): AgentSession {
  let next: AgentSession = session;
  if (next.listView) {
    const { listView: _drop, ...rest } = next;
    next = rest;
  }
  const needsStrip = next.messages.some(
    (message) => message.screenshotBase64 || message.images?.some((img) => img.base64),
  );
  if (!needsStrip) return next;
  return {
    ...next,
    messages: next.messages.map((message) => {
      let row = message;
      if (row.screenshotBase64) {
        const { screenshotBase64: _drop, ...rest } = row;
        row = rest;
      }
      if (row.images?.some((img) => img.base64)) {
        row = {
          ...row,
          images: row.images.map(({ base64: _b, ...img }) => img),
        };
      }
      return row;
    }),
  };
}

function isSessionFileId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id);
}

function safeRepoStorageId(repoId: string): string | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(repoId))
    return undefined;
  return repoId;
}

function safePullNumber(number: number): number | undefined {
  if (!Number.isInteger(number) || number <= 0 || number > 1_000_000_000) return undefined;
  return number;
}
