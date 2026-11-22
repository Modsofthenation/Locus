/**
 * `locus audit …`, `locus budget …`, `locus config telemetry|budget`.
 * Kept out of commands.ts so that file only carries the route entries.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  OTLP_PROTOCOLS,
  formatDailySpendHint,
  isOtlpProtocol,
  parseBudgetSettings,
  type BudgetSettings,
  type DailyBudgetStatus,
  type LocusConfig,
  type TelemetrySettings,
} from "@locus/shared";
import {
  auditRecordsToCsv,
  auditRecordsToJsonl,
  filterAuditSince,
  isAuditFileName,
  parseAuditRecords,
  parseAuditSince,
  verifyAuditChain,
  type AuditHead,
  type AuditVerifyResult,
} from "@locus/shared/auditChain";
import { UsageError, flagBool, flagList, flagNum, flagStr } from "./args.js";
import type { Ctx } from "./commands.js";
import { CliExitError } from "./exit.js";
import { formatKv, formatTable, printJson } from "./format.js";

function done<T>(ctx: Ctx, value: T, text: () => string): void {
  if (ctx.json) printJson(ctx.writeln, value);
  else ctx.writeln(text());
}

function unreachable(err: unknown): boolean {
  return err instanceof Error && /Cannot reach Locus/.test(err.message);
}

export function localAuditDir(flags: Ctx["flags"]): string {
  const dir = flagStr(flags, "dir");
  if (dir) return resolve(dir);
  const home = process.env.LOCUS_HOME?.trim() || join(homedir(), ".locus");
  return join(home, "audit");
}

async function readLocalAudit(dir: string): Promise<{
  files: Array<{ name: string; text: string }>;
  head?: AuditHead;
}> {
  let names: string[] = [];
  try {
    names = (await readdir(dir)).filter(isAuditFileName).sort();
  } catch {
    throw new UsageError(`No audit log at ${dir}`);
  }
  const files = await Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(dir, name), "utf8") })),
  );
  let head: AuditHead | undefined;
  try {
    head = JSON.parse(await readFile(join(dir, "HEAD.json"), "utf8")) as AuditHead;
  } catch {
    head = undefined;
  }
  return { files, head };
}

/** `locus audit verify` — exit 0 when the chain holds, 1 with the first broken record. */
export async function cmdAuditVerify(ctx: Ctx): Promise<void> {
  let result: AuditVerifyResult & { dir?: string };
  const local = flagBool(ctx.flags, "local") || Boolean(flagStr(ctx.flags, "dir"));
  if (local) {
    const dir = localAuditDir(ctx.flags);
    const { files, head } = await readLocalAudit(dir);
    result = { ...verifyAuditChain(files, head), dir };
  } else {
    try {
      result = await ctx.client.get<AuditVerifyResult & { dir?: string }>("/api/audit/verify");
    } catch (err) {
      if (!unreachable(err)) throw err;
      const dir = localAuditDir(ctx.flags);
      const { files, head } = await readLocalAudit(dir);
      result = { ...verifyAuditChain(files, head), dir };
    }
  }
  if (ctx.json) printJson(ctx.writeln, result);
  else if (result.ok) {
    ctx.writeln(
      `Audit chain OK: ${result.records} records in ${result.files} file(s)${result.head ? ` · head ${result.head.seq} ${result.head.hash.slice(0, 16)}…` : ""}`,
    );
  } else {
    const brk = result.firstBroken!;
    ctx.writeln(
      formatKv([
        ["status", "BROKEN"],
        ["file", brk.file],
        ["line", brk.line],
        ["seq", brk.seq],
        ["reason", brk.reason],
        ["verified before break", result.records],
      ]),
    );
  }
  if (!result.ok) throw new CliExitError(1);
}

/** `locus audit export [--since 7d|YYYY-MM-DD|ISO] [--format jsonl|csv] [--out file]`. */
export async function cmdAuditExport(ctx: Ctx): Promise<void> {
  const format = flagStr(ctx.flags, "format") ?? "jsonl";
  if (format !== "jsonl" && format !== "csv") throw new UsageError("--format must be jsonl or csv");
  let since: string | undefined;
  try {
    since = parseAuditSince(flagStr(ctx.flags, "since"));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : "Bad --since");
  }
  const local = flagBool(ctx.flags, "local") || Boolean(flagStr(ctx.flags, "dir"));
  let body: string | undefined;
  if (!local) {
    try {
      const qs = new URLSearchParams({ format, ...(since ? { since } : {}) });
      const res = await fetch(ctx.client.url(`/api/audit/log?${qs}`), {
        headers: ctx.client.authHeaders(),
      });
      if (!res.ok) throw new Error(`Audit export failed: HTTP ${res.status}`);
      body = await res.text();
    } catch (err) {
      if (!(err instanceof TypeError) && !unreachable(err)) throw err;
    }
  }
  if (body === undefined) {
    const { files } = await readLocalAudit(localAuditDir(ctx.flags));
    const records = filterAuditSince(
      files.flatMap((file) => parseAuditRecords(file.text)),
      since,
    );
    body = format === "csv" ? auditRecordsToCsv(records) : auditRecordsToJsonl(records);
  }
  const out = flagStr(ctx.flags, "out");
  if (out) {
    await writeFile(resolve(out), body, { mode: 0o600 });
    ctx.writeln(`Wrote ${resolve(out)}`);
    return;
  }
  ctx.write(body);
}

interface BudgetsResponse {
  status: DailyBudgetStatus;
  overrides: Array<{ scope: string; id?: string; by: string; reason?: string; t: string }>;
}

function usd(value?: number): string {
  return value == null ? "—" : `$${value.toFixed(2)}`;
}

function formatBudget(row: BudgetsResponse): string {
  const s = row.status;
  const lines = [
    formatKv([
      ["day", s.day],
      ["spent", `${usd(s.spentUsd)} · ${s.spentTokens.toLocaleString("en-US")} tokens`],
      ["daily cap", s.capUsd != null ? usd(s.capUsd) : "none"],
      ["daily token cap", s.capTokens != null ? s.capTokens.toLocaleString("en-US") : "none"],
      ["override", s.overridden ? "yes (today)" : "no"],
      ["summary", formatDailySpendHint(s) ?? "no caps set"],
    ]),
  ];
  const scoped = [
    ...s.automations.map((r) => ({ ...r, scope: "automation" })),
    ...s.projects.map((r) => ({ ...r, scope: "project" })),
  ];
  if (scoped.length) {
    lines.push(
      "",
      formatTable(scoped, [
        { key: "scope", header: "SCOPE", value: (r) => r.scope },
        { key: "id", header: "ID", value: (r) => r.id },
        { key: "spent", header: "SPENT", value: (r) => usd(r.spentUsd) },
        { key: "cap", header: "CAP", value: (r) => (r.dailyUsd != null ? usd(r.dailyUsd) : "—") },
        {
          key: "tokens",
          header: "TOKENS",
          value: (r) => `${r.spentTokens}${r.dailyTokens != null ? ` / ${r.dailyTokens}` : ""}`,
        },
      ]),
    );
  }
  return lines.join("\n");
}

export async function cmdBudgetStatus(ctx: Ctx): Promise<void> {
  const row = await ctx.client.get<BudgetsResponse>("/api/budgets");
  done(ctx, row, () => formatBudget(row));
}

/** `locus budget override [--scope global|automation|project] [--id] --reason "…"` (audited). */
export async function cmdBudgetOverride(ctx: Ctx): Promise<void> {
  const scope =
    flagStr(ctx.flags, "scope") ??
    (flagStr(ctx.flags, "automation")
      ? "automation"
      : flagStr(ctx.flags, "project")
        ? "project"
        : "global");
  const id =
    flagStr(ctx.flags, "id") ?? flagStr(ctx.flags, "automation") ?? flagStr(ctx.flags, "project");
  const reason = flagStr(ctx.flags, "reason") ?? ctx.args.join(" ").trim();
  if (!reason) throw new UsageError('Pass --reason "why" — overrides are audited');
  const row = await ctx.client.post<{ status: DailyBudgetStatus }>("/api/budgets/override", {
    scope,
    id,
    reason,
    by: process.env.USER || "operator",
  });
  done(ctx, row, () => `Override recorded for today (${scope}${id ? ` ${id}` : ""}).`);
}

function capFlags(ctx: Ctx): { dailyUsd?: number; dailyTokens?: number } {
  const dailyUsd = flagNum(ctx.flags, "daily-usd");
  const dailyTokens = flagNum(ctx.flags, "daily-tokens");
  if (dailyUsd == null && dailyTokens == null) {
    throw new UsageError("Pass --daily-usd and/or --daily-tokens (0 clears)");
  }
  return { dailyUsd, dailyTokens };
}

function applyCap(
  current: { dailyUsd?: number; dailyTokens?: number } | undefined,
  next: { dailyUsd?: number; dailyTokens?: number },
) {
  return {
    dailyUsd: next.dailyUsd == null ? current?.dailyUsd : next.dailyUsd || undefined,
    dailyTokens: next.dailyTokens == null ? current?.dailyTokens : next.dailyTokens || undefined,
  };
}

/** `locus budget set [--daily-usd N] [--daily-tokens N] [--automation id | --project id]`. */
export async function cmdBudgetSet(ctx: Ctx): Promise<void> {
  const config = await ctx.client.get<LocusConfig>("/api/config");
  const caps = capFlags(ctx);
  const budgets: BudgetSettings = { ...(config.budgets ?? {}) };
  const automation = flagStr(ctx.flags, "automation");
  const project = flagStr(ctx.flags, "project");
  if (automation) {
    budgets.automations = {
      ...budgets.automations,
      [automation]: applyCap(budgets.automations?.[automation], caps),
    };
  } else if (project) {
    budgets.projects = {
      ...budgets.projects,
      [project]: applyCap(budgets.projects?.[project], caps),
    };
  } else {
    Object.assign(budgets, applyCap(budgets, caps));
  }
  const saved = await ctx.client.put<LocusConfig>("/api/config", {
    ...config,
    budgets: parseBudgetSettings(budgets) ?? null,
  });
  done(ctx, saved.budgets ?? {}, () => JSON.stringify(saved.budgets ?? {}, null, 2));
}

export async function cmdConfigBudget(ctx: Ctx): Promise<void> {
  if (flagStr(ctx.flags, "daily-usd") || flagStr(ctx.flags, "daily-tokens")) {
    return cmdBudgetSet(ctx);
  }
  const config = await ctx.client.get<LocusConfig>("/api/config");
  done(ctx, config.budgets ?? {}, () =>
    config.budgets ? JSON.stringify(config.budgets, null, 2) : "No daily caps set.",
  );
}

function formatTelemetry(t: TelemetrySettings | undefined): string {
  return formatKv([
    ["enabled", t?.enabled ? "yes" : "no"],
    ["endpoint", t?.endpoint ?? ""],
    ["protocol", t?.protocol ?? "http/json"],
    ["serviceName", t?.serviceName ?? "locus"],
    ["sampleRatio", t?.sampleRatio ?? 1],
    ["traces", t?.traces === false ? "off" : "on"],
    ["metrics", t?.metrics === false ? "off" : "on"],
    ["includeContent", t?.includeContent ? "yes" : "no"],
    ["headers", Object.keys(t?.headers ?? {}).join(", ")],
  ]);
}

export async function cmdConfigTelemetry(ctx: Ctx): Promise<void> {
  const config = await ctx.client.get<LocusConfig>("/api/config");
  done(ctx, config.telemetry ?? { enabled: false }, () => formatTelemetry(config.telemetry));
}

function parseHeaders(raw: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of raw) {
    const eq = item.indexOf("=");
    if (eq <= 0) throw new UsageError(`--header must be name=value (got ${item})`);
    out[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return out;
}

/**
 * `locus config telemetry enable --endpoint URL [--protocol] [--header k=v]… [--service-name]
 * [--sample 0-1] [--include-content] [--no-traces] [--no-metrics]` / `disable`.
 */
export async function cmdConfigTelemetrySet(ctx: Ctx, enabled: boolean): Promise<void> {
  const config = await ctx.client.get<LocusConfig>("/api/config");
  const current: TelemetrySettings = { ...(config.telemetry ?? {}) };
  const next: TelemetrySettings = { ...current, enabled };
  const endpoint = flagStr(ctx.flags, "endpoint");
  if (endpoint) next.endpoint = endpoint;
  const protocol = flagStr(ctx.flags, "protocol");
  if (protocol) {
    if (!isOtlpProtocol(protocol))
      throw new UsageError(`--protocol must be ${OTLP_PROTOCOLS.join(" or ")}`);
    next.protocol = protocol;
  }
  const headers = flagList(ctx.flags, "header");
  if (headers.length) next.headers = { ...(current.headers ?? {}), ...parseHeaders(headers) };
  const service = flagStr(ctx.flags, "service-name");
  if (service) next.serviceName = service;
  const sample = flagNum(ctx.flags, "sample");
  if (sample != null) {
    if (sample < 0 || sample > 1) throw new UsageError("--sample must be between 0 and 1");
    next.sampleRatio = sample;
  }
  if (flagBool(ctx.flags, "include-content")) next.includeContent = true;
  if (flagBool(ctx.flags, "no-traces")) next.traces = false;
  if (flagBool(ctx.flags, "no-metrics")) next.metrics = false;
  if (enabled && !next.endpoint) throw new UsageError("Pass --endpoint http://collector:4318");
  const saved = await ctx.client.put<LocusConfig>("/api/config", { ...config, telemetry: next });
  done(ctx, saved.telemetry, () => formatTelemetry(saved.telemetry));
}

export async function cmdConfigTelemetryTest(ctx: Ctx): Promise<void> {
  const result = await ctx.client.post<{ ok: boolean; error?: string }>("/api/telemetry/test", {});
  done(ctx, result, () =>
    result.ok ? "Collector accepted an empty export." : `Failed: ${result.error}`,
  );
  if (!result.ok) throw new CliExitError(1);
}
