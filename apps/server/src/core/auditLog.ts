import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LocusConfig, TraceEvent } from "@locus/shared";
import {
  auditFileName,
  auditRecordsToCsv,
  auditRecordsToJsonl,
  canonicalJson,
  filterAuditSince,
  formatAuditLine,
  isAuditFileName,
  parseAuditRecords,
  sealAuditRecord,
  verifyAuditChain,
  type AuditEventInput,
  type AuditHead,
  type AuditRecord,
  type AuditVerifyResult,
} from "@locus/shared/auditChain";

export function auditDir(dataDir: string): string {
  return join(dataDir, "audit");
}

/**
 * Append-only, hash-chained JSONL audit log under `<dataDir>/audit/`. One file per UTC day;
 * `HEAD.json` holds the last seq/hash so truncating the newest file is also detected.
 * Tamper-evident, not tamper-proof: anyone who can write `~/.locus` can rewrite the whole chain,
 * so ship exports (or the HEAD hash) somewhere else when that matters.
 */
export class AuditLog {
  private head: AuditHead | undefined;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  get dir(): string {
    return auditDir(this.dataDir);
  }

  private headPath(): string {
    return join(this.dir, "HEAD.json");
  }

  append(input: AuditEventInput): Promise<AuditRecord> {
    const work = this.queue.catch(() => undefined).then(() => this.appendNow(input));
    this.queue = work;
    return work;
  }

  /** Fire-and-forget append for hooks that must never fail a turn. */
  record(input: AuditEventInput): void {
    void this.append(input).catch((err) => {
      console.warn("Audit log append failed:", err instanceof Error ? err.message : err);
    });
  }

  private async appendNow(input: AuditEventInput): Promise<AuditRecord> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    if (!this.loaded) {
      this.head = await this.loadHead();
      this.loaded = true;
    }
    const record = sealAuditRecord(input, this.head);
    await appendFile(join(this.dir, auditFileName(record.t)), formatAuditLine(record), {
      mode: 0o600,
    });
    this.head = { seq: record.seq, hash: record.hash };
    const tmp = `${this.headPath()}.tmp`;
    await writeFile(tmp, `${canonicalJson(this.head)}\n`, { mode: 0o600 });
    await rename(tmp, this.headPath());
    return record;
  }

  /**
   * Continue from HEAD when it is ahead of the newest file (a truncated tail), so the next record
   * points at the missing hash and `verify` keeps failing instead of silently re-anchoring.
   */
  private async loadHead(): Promise<AuditHead | undefined> {
    const stored = await this.readHeadFile();
    const files = await this.listFiles();
    let tail: AuditHead | undefined;
    for (const name of [...files].reverse()) {
      const records = parseAuditRecords(await readFile(join(this.dir, name), "utf8"));
      const last = records.at(-1);
      if (last) {
        tail = { seq: last.seq, hash: last.hash };
        break;
      }
    }
    if (stored && (!tail || stored.seq > tail.seq)) return stored;
    return tail;
  }

  private async readHeadFile(): Promise<AuditHead | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.headPath(), "utf8")) as AuditHead;
      if (typeof parsed?.seq === "number" && typeof parsed.hash === "string") return parsed;
    } catch {
      /* no head yet */
    }
    return undefined;
  }

  async listFiles(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter(isAuditFileName).sort();
    } catch {
      return [];
    }
  }

  private async readFiles(): Promise<Array<{ name: string; text: string }>> {
    await this.queue.catch(() => undefined);
    const names = await this.listFiles();
    return Promise.all(
      names.map(async (name) => ({ name, text: await readFile(join(this.dir, name), "utf8") })),
    );
  }

  async verify(): Promise<AuditVerifyResult & { dir: string }> {
    const files = await this.readFiles();
    return { ...verifyAuditChain(files, await this.readHeadFile()), dir: this.dir };
  }

  async read(since?: string): Promise<AuditRecord[]> {
    const files = await this.readFiles();
    const day = since?.slice(0, 10);
    const records: AuditRecord[] = [];
    for (const file of files) {
      if (day && file.name < `audit-${day}.jsonl`) continue;
      records.push(...parseAuditRecords(file.text));
    }
    return filterAuditSince(records, since);
  }

  async export(since: string | undefined, format: "jsonl" | "csv"): Promise<string> {
    const records = await this.read(since);
    return format === "csv" ? auditRecordsToCsv(records) : auditRecordsToJsonl(records);
  }

  /** Map the redacted trace stream onto audit events. Content (prompts, args, output) stays out. */
  fromTrace(event: TraceEvent): void {
    const input = auditInputFromTrace(event);
    if (input) this.record(input);
  }
}

const PUBLISH_TYPES: Record<string, AuditEventInput["type"]> = {
  git_push: "git_push",
  git_pr: "git_pr",
  git_pr_merge: "merge",
};

function shortDetail(text: string | undefined, max = 240): string | undefined {
  const line = text?.split(/\r?\n/)[0]?.trim();
  if (!line) return undefined;
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function auditInputFromTrace(event: TraceEvent): AuditEventInput | undefined {
  if (event.kind === "approval") {
    const tool = (typeof event.args?.tool === "string" && event.args.tool) || event.id || "tool";
    const persist = event.args?.persist === true;
    const entry = typeof event.args?.entry === "string" ? event.args.entry : undefined;
    return {
      type: "approval",
      t: event.t,
      actor:
        typeof event.args?.by === "string" && event.args.by.trim() ? event.args.by : "operator",
      sessionId: event.sessionId,
      tool,
      decision: event.name || "approved",
      summary: persist ? `Always allow${entry ? ` ${entry}` : ""}` : undefined,
      data: { toolCallId: event.id, persist, ...(entry ? { entry } : {}) },
    };
  }
  if (event.kind === "blocked") {
    return {
      type: "blocked",
      t: event.t,
      actor: "harness",
      sessionId: event.sessionId,
      tool: event.name,
      decision: "blocked",
      summary: shortDetail(event.detail),
    };
  }
  if (event.kind === "tool.result" && event.name && PUBLISH_TYPES[event.name]) {
    return {
      type: PUBLISH_TYPES[event.name]!,
      t: event.t,
      actor: "agent",
      sessionId: event.sessionId,
      tool: event.name,
      decision: event.ok === false ? "failed" : "ok",
      summary: event.ok === false ? shortDetail(event.detail) : undefined,
      data: { toolCallId: event.id },
    };
  }
  if (event.kind === "governor" && event.args?.budget) {
    return {
      type: "budget_stop",
      t: event.t,
      actor: "harness",
      sessionId: event.sessionId,
      decision: "stopped",
      summary: shortDetail(event.detail),
      data: { scope: event.args.budget, id: event.args.budgetId },
    };
  }
  return undefined;
}

function changedIds<T extends { id: string }>(
  before: T[] | undefined,
  after: T[] | undefined,
  pick: (row: T) => unknown,
): { added: string[]; removed: string[]; changed: string[] } {
  const prev = new Map((before ?? []).map((row) => [row.id, canonicalJson(pick(row))]));
  const next = new Map((after ?? []).map((row) => [row.id, canonicalJson(pick(row))]));
  const added = [...next.keys()].filter((id) => !prev.has(id));
  const removed = [...prev.keys()].filter((id) => !next.has(id));
  const changed = [...next.keys()].filter((id) => prev.has(id) && prev.get(id) !== next.get(id));
  return { added, removed, changed };
}

function nonEmpty(diff: { added: string[]; removed: string[]; changed: string[] }): boolean {
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

/**
 * Audit records for a Settings save: policy knobs, credentials, and integrations that changed.
 * Records name what changed (ids, field names), never the values.
 */
export function auditConfigChanges(
  before: LocusConfig,
  after: LocusConfig,
  actor = "operator",
): AuditEventInput[] {
  const out: AuditEventInput[] = [];
  const policyFields: string[] = [];
  const adv = (key: keyof LocusConfig["advanced"]) => {
    if (!same(before.advanced?.[key], after.advanced?.[key])) policyFields.push(`advanced.${key}`);
  };
  adv("approvalPolicy");
  adv("autonomy");
  adv("maxUsdPerTurn");
  adv("maxMsPerTurn");
  adv("maxSubagentsPerTurn");
  adv("maxAgentRounds");
  adv("extraAllowHosts");
  adv("approvalTimeoutMs");
  adv("testGatePromptMs");
  adv("testGateSlowMs");
  adv("bindHost");
  if (!same(before.budgets, after.budgets)) policyFields.push("budgets");
  const telemetryShape = (config: LocusConfig) =>
    config.telemetry
      ? { ...config.telemetry, headers: Object.keys(config.telemetry.headers ?? {}).sort() }
      : undefined;
  if (!same(telemetryShape(before), telemetryShape(after))) policyFields.push("telemetry");
  if (!same(before.phoneRemote?.enabled, after.phoneRemote?.enabled)) {
    policyFields.push("phoneRemote.enabled");
  }
  if (!same(before.chromeExtension?.enabled, after.chromeExtension?.enabled)) {
    policyFields.push("chromeExtension.enabled");
  }
  if (policyFields.length) {
    out.push({
      type: "policy",
      actor,
      decision: "changed",
      summary: `Changed ${policyFields.join(", ")}`,
      data: {
        fields: policyFields,
        ...(policyFields.includes("budgets") ? { budgets: after.budgets ?? null } : {}),
      },
    });
  }

  const credentialChanges: Record<string, unknown> = {};
  const providers = changedIds(before.providers, after.providers, (row) => row.apiKey ?? "");
  if (nonEmpty(providers)) credentialChanges.providers = providers;
  const forges = changedIds(before.forges, after.forges, (row) => [
    row.token ?? "",
    row.refreshToken ?? "",
    row.oauthClientSecret ?? "",
  ]);
  if (nonEmpty(forges)) credentialChanges.forges = forges;
  const workers = changedIds(before.workers, after.workers, (row) => row.token ?? "");
  if (nonEmpty(workers)) credentialChanges.workers = workers;
  if (!same(before.phoneRemote?.token, after.phoneRemote?.token)) credentialChanges.phone = true;
  if (!same(before.chromeExtension?.token, after.chromeExtension?.token)) {
    credentialChanges.chromeExtension = true;
  }
  if (!same(before.advanced?.slackSigningSecret, after.advanced?.slackSigningSecret)) {
    credentialChanges.slackSigningSecret = true;
  }
  if (!same(before.telemetry?.headers, after.telemetry?.headers)) {
    credentialChanges.telemetryHeaders = true;
  }
  if (Object.keys(credentialChanges).length) {
    out.push({
      type: "credential",
      actor,
      decision: "changed",
      summary: `Credentials changed: ${Object.keys(credentialChanges).join(", ")}`,
      data: credentialChanges,
    });
  }

  const integrationChanges: Record<string, unknown> = {};
  const integrations = changedIds(before.integrations, after.integrations, (row) => {
    const {
      tokenWarning: _w,
      tokenSavedAt: _s,
      ...rest
    } = row as typeof row & {
      tokenWarning?: unknown;
      tokenSavedAt?: unknown;
    };
    void _w;
    void _s;
    return rest;
  });
  if (nonEmpty(integrations)) integrationChanges.integrations = integrations;
  const mcp = changedIds(before.mcpServers, after.mcpServers, (row) => row);
  if (nonEmpty(mcp)) integrationChanges.mcpServers = mcp;
  const plugins = changedIds(before.integrationPlugins, after.integrationPlugins, (row) => row);
  if (nonEmpty(plugins)) integrationChanges.plugins = plugins;
  if (Object.keys(integrationChanges).length) {
    out.push({
      type: "integration",
      actor,
      decision: "changed",
      summary: `Integrations changed: ${Object.keys(integrationChanges).join(", ")}`,
      data: integrationChanges,
    });
  }
  return out;
}
