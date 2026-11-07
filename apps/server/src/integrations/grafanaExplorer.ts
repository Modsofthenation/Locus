import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { replaceFile } from "../core/atomic.js";
import {
  DEFAULT_DOCKER_IMAGE,
  extractLogSignals,
  formatGrafanaBriefPrompt,
  formatGrafanaInvestigatePrompt,
  grafanaInvestigateAsLucene,
  heuristicGrafanaBriefing,
  integrationHasToken,
  matchSignalsToRepos,
  parseGrafanaBriefing,
  recipeById,
  resolveSlackRunProvider,
  shortRepoName,
  suggestedGrafanaQueries,
  type GrafanaAlert,
  type GrafanaBriefing,
  type GrafanaDashboardHit,
  type GrafanaDashboardQueryResult,
  type GrafanaDashboardView,
  type GrafanaDatasourceSummary,
  type GrafanaExplorerStatus,
  type GrafanaLogHitLite,
  type GrafanaLogSignal,
  type GrafanaPin,
  type GrafanaRecentQuery,
  type GrafanaRepoLink,
  type GrafanaTraceHop,
  type GrafanaTraceResult,
  type IntegrationAccount,
  type LinkedRepo,
} from "@locus/shared";
import { collectText, completeChat, type ChatEvent, type CompleteRequest } from "@locus/providers";
import { brainDistillerProvider } from "../brain/distiller.js";
import type { JsonStore } from "../core/store.js";
import type { SessionService } from "../session/sessions.js";
import type { BrainService } from "../brain/brain.js";
import { loadGrafanaDashboard, queryGrafanaDashboard } from "./grafanaDashboard.js";
import { listGrafanaAlerts, queryGrafanaTrace } from "./grafanaLive.js";
import {
  grafanaJson,
  grafanaVersion,
  listDatasources,
  queryGrafanaLogs,
  type GrafanaQueryResult,
} from "./grafanaQuery.js";

const MAX_RECENTS = 20;
const WALK_LIMIT = 4_000;
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  ".locus",
  "out",
]);

export type GrafanaComplete = (req: CompleteRequest) => AsyncIterable<ChatEvent>;

export interface GrafanaLogExploration {
  trace: GrafanaTraceResult;
  traceHop?: GrafanaTraceHop;
  links: GrafanaRepoLink[];
}

export interface GrafanaQueryBody {
  query?: string;
  from?: string;
  to?: string;
  mode?: string;
  limit?: number;
  datasource?: string;
  explore_url_only?: boolean;
  /** When set, the log query also returns trace, trace hop, and merged repo links. */
  enrich?: boolean;
}

export interface GrafanaTraceBody {
  logs?: GrafanaLogHitLite[];
  query?: string;
}

export interface GrafanaInvestigateBody {
  query?: string;
  from?: string;
  to?: string;
  note?: string;
  logs?: GrafanaLogHitLite[];
  links?: GrafanaRepoLink[];
  exploreUrl?: string;
  repoId?: string;
  providerId?: string;
  model?: string;
  asLucene?: boolean;
  /** Panel type from the dashboard grid. Decides Lucene vs expression copy. */
  panelType?: string;
}

export class GrafanaExplorer {
  constructor(
    private readonly store: JsonStore,
    private readonly sessions: SessionService,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly brain?: BrainService,
    private readonly complete: GrafanaComplete = completeChat,
  ) {}

  async status(): Promise<GrafanaExplorerStatus> {
    const account = await this.account();
    if (!account) {
      return { connected: false, datasources: [], error: "Add Grafana in Settings → Integrations" };
    }
    try {
      const [version, rows] = await Promise.all([
        grafanaVersion(account, this.fetchFn),
        listDatasources(account, this.fetchFn),
      ]);
      return {
        connected: true,
        baseUrl: account.baseUrl.replace(/\/+$/, ""),
        name: account.name,
        version: version || undefined,
        datasources: rows.map(toDatasourceSummary),
      };
    } catch (err) {
      return {
        connected: true,
        baseUrl: account.baseUrl.replace(/\/+$/, ""),
        name: account.name,
        datasources: [],
        error: err instanceof Error ? err.message : "Grafana is unreachable",
      };
    }
  }

  async query(
    body: GrafanaQueryBody,
  ): Promise<GrafanaQueryResult & Partial<GrafanaLogExploration>> {
    const account = await this.requireAccount();
    const result = await queryGrafanaLogs(
      account,
      {
        query: body.query,
        from: body.from,
        to: body.to,
        mode: body.mode,
        limit: body.limit,
        datasource: body.datasource,
        explore_url_only: body.explore_url_only,
      },
      this.fetchFn,
    );
    if (!body.explore_url_only && result.lucene) {
      await this.pushRecent({
        query: result.lucene,
        from: result.from,
        to: result.to,
        datasource: result.datasource?.name || body.datasource,
        count: result.count,
      });
    }
    if (!body.enrich || body.explore_url_only) return result;
    try {
      const traced = await this.trace({
        logs: result.logs ?? [],
        query: result.lucene || body.query,
      });
      let traceHop: GrafanaTraceHop | undefined;
      const traceId = traced.signals.find((row) => row.kind === "trace")?.value;
      if (traceId) {
        try {
          const hop = await this.traceHop(traceId);
          if (Array.isArray(hop.spans)) traceHop = hop;
        } catch (err) {
          traceHop = {
            traceId,
            spans: [],
            links: [],
            error: err instanceof Error ? err.message : "Trace lookup failed",
          };
        }
      }
      return {
        ...result,
        trace: traced,
        traceHop,
        links: mergeRepoLinks([...(traced.links ?? []), ...(traceHop?.links ?? [])]),
      };
    } catch {
      return result;
    }
  }

  async dashboards(query = ""): Promise<GrafanaDashboardHit[]> {
    const account = await this.requireAccount();
    const url = new URL(joinUrl(account.baseUrl, "/api/search"));
    if (query.trim()) url.searchParams.set("query", query.trim());
    url.searchParams.set("type", "dash-db");
    const body = await grafanaJson(account, this.fetchFn, `${url.pathname}${url.search}`);
    return parseDashboardHits(body, account.baseUrl);
  }

  async dashboard(uid: string): Promise<GrafanaDashboardView> {
    const account = await this.requireAccount();
    const next = uid.trim();
    if (!next) throw new Error("uid is required");
    return loadGrafanaDashboard(account, next, this.fetchFn);
  }

  async queryDashboard(
    uid: string,
    body: { from?: string; to?: string; panelId?: number; variables?: Record<string, string> } = {},
  ): Promise<GrafanaDashboardQueryResult> {
    const account = await this.requireAccount();
    const next = uid.trim();
    if (!next) throw new Error("uid is required");
    const result = await queryGrafanaDashboard(account, next, body, this.fetchFn);
    if (!result.annotations?.length) return result;
    const repos = await this.store.loadRepos();
    const files = await repoFileIndex(repos);
    return {
      ...result,
      annotations: result.annotations.map((row) => ({
        ...row,
        links: linksForIndexedRepos(row.signals, repos, files).slice(0, 6),
      })),
    };
  }

  async alerts(): Promise<GrafanaAlert[]> {
    const account = await this.requireAccount();
    return listGrafanaAlerts(account, this.fetchFn);
  }

  async pins(): Promise<GrafanaPin[]> {
    return this.loadPins();
  }

  async pin(uid: string, title?: string): Promise<GrafanaPin[]> {
    const next = uid.trim();
    if (!next) throw new Error("uid is required");
    const row: GrafanaPin = {
      uid: next,
      title: title?.trim() || next,
      at: new Date().toISOString(),
    };
    const prev = await this.loadPins();
    const rows = [row, ...prev.filter((item) => item.uid !== row.uid)].slice(0, MAX_RECENTS);
    await this.writePins(rows);
    return rows;
  }

  async unpin(uid: string): Promise<GrafanaPin[]> {
    const next = uid.trim();
    const rows = (await this.loadPins()).filter((row) => row.uid !== next);
    await this.writePins(rows);
    return rows;
  }

  async traceHop(traceId: string): Promise<GrafanaTraceHop> {
    const account = await this.requireAccount();
    const hop = await queryGrafanaTrace(account, traceId, this.fetchFn);
    const signals: GrafanaLogSignal[] = [];
    for (const span of hop.spans) {
      if (span.service) signals.push({ kind: "service", value: span.service });
      if (span.operation) {
        signals.push(
          ...extractLogSignals([{ message: span.operation }]).filter(
            (row) => row.kind === "file" || row.kind === "stack",
          ),
        );
      }
    }
    const repos = await this.store.loadRepos();
    return { ...hop, links: await linkSignalsToRepos(signals, repos) };
  }

  async recents(): Promise<GrafanaRecentQuery[]> {
    return this.loadRecents();
  }

  async trace(body: GrafanaTraceBody): Promise<GrafanaTraceResult> {
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const signals = extractLogSignals(logs);
    const repos = await this.store.loadRepos();
    const links = await linkSignalsToRepos(signals, repos);
    return {
      signals,
      links,
      suggestedQueries: suggestedGrafanaQueries(logs),
    };
  }

  async brief(body: GrafanaTraceBody & GrafanaQueryBody): Promise<GrafanaBriefing> {
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "*";
    const from = typeof body.from === "string" && body.from.trim() ? body.from.trim() : "now-1h";
    const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : "now";
    const config = await this.store.loadConfig();
    const picked = brainDistillerProvider(config);
    if (!picked) return heuristicGrafanaBriefing(logs);
    try {
      const text = await collectText(
        this.complete({
          provider: picked.provider,
          model: picked.model,
          system: "You investigate production failures from Grafana logs. Reply with JSON only.",
          messages: [
            {
              id: "grafana-brief",
              role: "user",
              content: formatGrafanaBriefPrompt(logs, query, from, to),
              createdAt: new Date().toISOString(),
            },
          ],
          allowedTools: [],
          stream: false,
          maxTokens: 800,
          signal: AbortSignal.timeout(30_000),
        }),
      );
      return parseGrafanaBriefing(text, logs);
    } catch {
      return heuristicGrafanaBriefing(logs);
    }
  }

  async investigate(
    body: GrafanaInvestigateBody,
  ): Promise<{ sessionId: string; created: boolean }> {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) throw new Error("query is required");
    const logs = Array.isArray(body.logs) ? body.logs : [];
    const trace = await this.trace({ logs, query });
    const links = body.links?.length ? body.links : trace.links;
    let orient = "";
    if (this.brain) {
      try {
        const repoUrl = links[0]?.url;
        orient = await this.brain.orient(repoUrl);
      } catch {
        orient = "";
      }
    }
    const recipe = recipeById("ops-loop");
    if (!recipe) throw new Error("Ops loop recipe is missing");
    const prompt = formatGrafanaInvestigatePrompt({
      instruction:
        body.note?.trim() ||
        "Investigate these Grafana errors. Trace from logs into the linked repos and propose a fix.",
      query,
      from: body.from,
      to: body.to,
      exploreUrl: body.exploreUrl,
      logs,
      links,
      signals: trace.signals,
      orient: orient || undefined,
      asLucene: grafanaInvestigateAsLucene({
        panelType: body.panelType,
        asLucene: body.asLucene,
      }),
    });
    const config = await this.store.loadConfig();
    const { provider, model } = resolveSlackRunProvider(config.providers, {
      providerId: body.providerId,
      model: body.model,
    });
    const template = config.templates.find((row) => row.os === "ubuntu") ?? config.templates[0];
    if (!template) throw new Error("No guest template configured");
    const repos = await this.store.loadRepos();
    const preferred =
      (body.repoId ? repos.find((row) => row.id === body.repoId) : undefined) ??
      (links[0] ? repos.find((row) => row.id === links[0]!.repoId) : undefined);
    const extraRepoIds = unique(
      links.map((row) => row.repoId).filter((id) => id && id !== preferred?.id),
    ).slice(0, 6);
    const runtime = recipe.runtime ?? "docker";
    const session = await this.sessions.create({
      title: `Grafana: ${query.slice(0, 48)}`.trim(),
      os: recipe.os ?? "ubuntu",
      templateId: template.id,
      kind: recipe.kind,
      runtime,
      dockerImage: recipe.dockerImage || DEFAULT_DOCKER_IMAGE,
      vision: recipe.vision,
      playbook: recipe.playbook,
      allowedTools: recipe.allowedTools,
      providerId: provider.id,
      model,
      repoId: preferred?.id,
      extraRepoIds,
      startVm: runtime !== "host",
      prompt,
    });
    return { sessionId: session.id, created: true };
  }

  private async account(): Promise<IntegrationAccount | undefined> {
    const config = await this.store.loadConfig();
    return (config.integrations ?? []).find(
      (row) => row.kind === "grafana" && integrationHasToken(row),
    );
  }

  private async requireAccount(): Promise<IntegrationAccount> {
    const account = await this.account();
    if (!account) throw new Error("Add a Grafana token in Settings → Integrations");
    return account;
  }

  private recentsPath(): string {
    return join(this.store.dataDir, "grafana", "recents.json");
  }

  private pinsPath(): string {
    return join(this.store.dataDir, "grafana", "pins.json");
  }

  private async loadPins(): Promise<GrafanaPin[]> {
    try {
      const raw = await readFile(this.pinsPath(), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isPin).slice(0, MAX_RECENTS);
    } catch {
      return [];
    }
  }

  private async writePins(rows: GrafanaPin[]): Promise<void> {
    await mkdir(join(this.store.dataDir, "grafana"), { recursive: true, mode: 0o700 });
    await replaceFile(this.pinsPath(), `${JSON.stringify(rows, null, 2)}\n`);
  }

  private async loadRecents(): Promise<GrafanaRecentQuery[]> {
    try {
      const raw = await readFile(this.recentsPath(), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRecent).slice(0, MAX_RECENTS);
    } catch {
      return [];
    }
  }

  private async pushRecent(input: {
    query: string;
    from: string;
    to: string;
    datasource?: string;
    count?: number;
  }): Promise<void> {
    const next: GrafanaRecentQuery = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      query: input.query,
      from: input.from,
      to: input.to,
      datasource: input.datasource,
      at: new Date().toISOString(),
      count: input.count,
    };
    const prev = await this.loadRecents();
    const rows = [
      next,
      ...prev.filter(
        (row) =>
          row.query !== next.query || row.from !== next.from || row.datasource !== next.datasource,
      ),
    ].slice(0, MAX_RECENTS);
    await mkdir(join(this.store.dataDir, "grafana"), { recursive: true, mode: 0o700 });
    await replaceFile(this.recentsPath(), `${JSON.stringify(rows, null, 2)}\n`);
  }
}

export async function linkSignalsToRepos(
  signals: GrafanaLogSignal[],
  repos: LinkedRepo[],
): Promise<GrafanaRepoLink[]> {
  return linksForIndexedRepos(signals, repos, await repoFileIndex(repos));
}

async function repoFileIndex(repos: LinkedRepo[]): Promise<Map<string, string[]>> {
  const cache = new Map<string, string[]>();
  for (const repo of repos) {
    const dest = repo.checkout.dest?.trim();
    if (!dest || cache.has(dest)) continue;
    cache.set(dest, await listRepoFiles(dest));
  }
  return cache;
}

function linksForIndexedRepos(
  signals: GrafanaLogSignal[],
  repos: LinkedRepo[],
  files: Map<string, string[]>,
): GrafanaRepoLink[] {
  return dedupeLinks([
    ...fileLinksFromIndex(signals, repos, files),
    ...matchSignalsToRepos(signals, repos),
  ]);
}

function fileLinksFromIndex(
  signals: GrafanaLogSignal[],
  repos: LinkedRepo[],
  files: Map<string, string[]>,
): GrafanaRepoLink[] {
  const out: GrafanaRepoLink[] = [];
  const paths = signals.filter((row) => row.kind === "file" || row.kind === "stack");
  for (const repo of repos) {
    const dest = repo.checkout.dest?.trim();
    if (!dest) continue;
    const listed = files.get(dest);
    if (!listed) continue;
    for (const signal of paths) {
      const hit = bestFileMatch(listed, dest, signal.value);
      if (!hit) continue;
      out.push({
        repoId: repo.id,
        repoName: shortRepoName(repo.checkout.url, repo.name),
        url: repo.checkout.url,
        dest,
        path: hit,
        line: signal.line,
        score: 14,
        reason: `file ${hit}${signal.line != null ? `:${signal.line}` : ""}`,
      });
    }
  }
  return out;
}

export async function listRepoFiles(dest: string, limit = WALK_LIMIT): Promise<string[]> {
  const info = await stat(dest).catch(() => undefined);
  if (!info?.isDirectory()) return [];
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".") || IGNORE_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  await walk(dest);
  return out;
}

export function bestFileMatch(files: string[], dest: string, needle: string): string | undefined {
  const want = needle
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
  const base = want.split("/").filter(Boolean).at(-1);
  const rels = files.map((file) => ({
    file,
    rel: relative(dest, file).split(sep).join("/"),
  }));
  const suffix = rels.find(
    (row) => row.rel.toLowerCase() === want || row.rel.toLowerCase().endsWith(`/${want}`),
  );
  if (suffix) return suffix.rel;
  if (!base) return undefined;
  const bases = rels.filter((row) => row.rel.split("/").pop()?.toLowerCase() === base);
  if (bases.length === 1) return bases[0]!.rel;
  const scored = bases
    .map((row) => {
      const segs = want.split("/").filter(Boolean);
      const have = row.rel.toLowerCase().split("/");
      let n = 0;
      for (const seg of segs) if (have.includes(seg)) n += 1;
      return { row, n };
    })
    .sort((a, b) => b.n - a.n);
  return scored[0] && scored[0].n >= 2 ? scored[0].row.rel : undefined;
}

function parseDashboardHits(body: unknown, baseUrl: string): GrafanaDashboardHit[] {
  const rows = Array.isArray(body) ? body : [];
  const origin = baseUrl.replace(/\/+$/, "");
  const out: GrafanaDashboardHit[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const uid = typeof rec.uid === "string" ? rec.uid : "";
    const title = typeof rec.title === "string" ? rec.title : "";
    if (!uid || !title) continue;
    const url =
      typeof rec.url === "string"
        ? rec.url.startsWith("http")
          ? rec.url
          : `${origin}${rec.url.startsWith("/") ? rec.url : `/${rec.url}`}`
        : `${origin}/d/${encodeURIComponent(uid)}`;
    out.push({
      uid,
      title,
      url,
      type: typeof rec.type === "string" ? rec.type : undefined,
      tags: Array.isArray(rec.tags)
        ? rec.tags.filter((tag): tag is string => typeof tag === "string")
        : undefined,
      folderTitle: typeof rec.folderTitle === "string" ? rec.folderTitle : undefined,
      folderUid: typeof rec.folderUid === "string" ? rec.folderUid : undefined,
    });
  }
  return out;
}

function toDatasourceSummary(row: {
  id?: number;
  uid?: string;
  name: string;
  type: string;
  isDefault?: boolean;
}): GrafanaDatasourceSummary {
  return {
    id: row.id,
    uid: row.uid,
    name: row.name,
    type: row.type,
    isDefault: row.isDefault,
  };
}

function isPin(value: unknown): value is GrafanaPin {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.uid === "string" && typeof row.title === "string" && typeof row.at === "string";
}

function isRecent(value: unknown): value is GrafanaRecentQuery {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" && typeof row.query === "string" && typeof row.from === "string"
  );
}

function mergeRepoLinks(links: GrafanaRepoLink[]): GrafanaRepoLink[] {
  const seen = new Set<string>();
  const out: GrafanaRepoLink[] = [];
  for (const link of links) {
    const key = `${link.repoId}:${link.path ?? ""}:${link.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out;
}

function dedupeLinks(links: GrafanaRepoLink[]): GrafanaRepoLink[] {
  const seen = new Set<string>();
  const out: GrafanaRepoLink[] = [];
  for (const link of links.sort((a, b) => b.score - a.score)) {
    const key = `${link.repoId}:${link.path ?? ""}:${link.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
  }
  return out.slice(0, 24);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
