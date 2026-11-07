import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { containedPath } from "@locus/guest-agent";
import {
  brainAutoIndexEnabled,
  brainIngestPaused,
  brainSummary,
  consolidateObservations,
  distillSessionText,
  emptyBrain,
  extractBrainClaims,
  findEntities,
  formatFindEntities,
  getEntity,
  queueBrainCorrection,
  rememberObservation,
  renderOrientDoc,
  resolveBrainCorrection,
  searchKnowledge,
  upsertEdge,
  upsertNode,
  type BrainCorpusRow,
  WORKSPACE_SKIP_DIR_SET,
  looksLikeRememberedSecret,
  isSensitivePath,
  redactHookSecrets,
  wrapUntrusted,
  type BrainDocument,
  type BrainSummary,
  type LocusConfig,
  DEFAULT_BRAIN_ID,
} from "@locus/shared";
import type { Hub } from "../core/hub.js";
import type { JsonStore } from "../core/store.js";
import { getWorkspaceIndex } from "../workspace/repoIndex.js";
import { distillSessionBlob, type DistillerComplete } from "./distiller.js";
import { BrainSqliteStore } from "./store.js";

const INDEX_FILE_CAP = 2_000;
const INDEX_FILE_MAX_BYTES = 256_000;
const INDEX_TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rb",
  ".json",
  ".yml",
  ".yaml",
]);

export class BrainService {
  private sqlite: BrainSqliteStore | undefined;
  private distillComplete: DistillerComplete | undefined;
  private corpusCollectors: Array<() => Promise<BrainCorpusRow[]>> = [];

  constructor(
    private readonly store: JsonStore,
    private readonly hub: Hub,
  ) {}

  setCorpusCollectors(collectors: Array<() => Promise<BrainCorpusRow[]>>): void {
    this.corpusCollectors = collectors;
  }

  private db(): BrainSqliteStore {
    if (!this.sqlite) this.sqlite = new BrainSqliteStore(this.store.dataDir);
    return this.sqlite;
  }

  setDistillerComplete(complete: DistillerComplete | undefined): void {
    this.distillComplete = complete;
  }

  async get(id = DEFAULT_BRAIN_ID): Promise<BrainDocument> {
    if (id !== DEFAULT_BRAIN_ID) return emptyBrain(id);
    return this.db().load();
  }

  async summary(id = DEFAULT_BRAIN_ID): Promise<BrainSummary> {
    return brainSummary(await this.get(id));
  }

  async save(doc: BrainDocument): Promise<BrainDocument> {
    await this.db().save(doc);
    this.hub.broadcast({ type: "brain.updated", brain: brainSummary(doc) });
    return doc;
  }

  async orient(repo?: string, id = DEFAULT_BRAIN_ID): Promise<string> {
    return renderOrientDoc(await this.get(id), repo);
  }

  async find(args: Record<string, unknown>, id = DEFAULT_BRAIN_ID): Promise<string> {
    const doc = await this.get(id);
    const q = typeof args.q === "string" ? args.q : "";
    const type = typeof args.type === "string" ? args.type : undefined;
    const limit = typeof args.limit === "number" ? args.limit : Number(args.limit);
    return formatFindEntities(
      findEntities(doc, { q, type, limit: Number.isFinite(limit) ? limit : undefined }),
    );
  }

  async entity(id: string, brainId = DEFAULT_BRAIN_ID): Promise<string> {
    return getEntity(await this.get(brainId), id);
  }

  async search(q: string, brainId = DEFAULT_BRAIN_ID): Promise<string> {
    const hits = this.db().searchFts(q);
    if (hits.length) {
      return hits.map((row) => `- ${row.text} (${row.source} · ${row.id})`).join("\n");
    }
    return searchKnowledge(await this.get(brainId), q);
  }

  private async brainSettings(): Promise<LocusConfig["brain"]> {
    return (await this.store.loadConfig()).brain;
  }

  async remember(
    input: { text: string; repo?: string; sessionId?: string; actor?: string },
    id = DEFAULT_BRAIN_ID,
  ): Promise<{ output: string; ok: boolean }> {
    if (brainIngestPaused(await this.brainSettings())) {
      return { ok: false, output: "Brain ingest is paused in Settings." };
    }
    if (looksLikeRememberedSecret(input.text)) {
      return { ok: false, output: "Refusing to store a secret. Keep tokens in Settings." };
    }
    const doc = await this.get(id);
    const next = rememberObservation(doc, {
      text: input.text,
      source: "user_stated",
      ambient: true,
      repo: input.repo,
      sessionId: input.sessionId,
      actor: input.actor ?? "session",
    });
    if (!next.ok) return { ok: false, output: next.output };
    const withActivity = noteActivity(next.doc, "remember", next.output, input.repo);
    await this.save(withActivity);
    return { ok: true, output: next.output };
  }

  async correct(
    input: { nodeId?: string; memoryId?: string; reason: string; claim?: string; actor?: string },
    id = DEFAULT_BRAIN_ID,
  ): Promise<{ output: string; ok: boolean }> {
    const doc = await this.get(id);
    const next = queueBrainCorrection(doc, input);
    if (!next.ok) return { ok: false, output: next.output };
    const withActivity = noteActivity(next.doc, "correct", next.output);
    await this.save(withActivity);
    return { ok: true, output: next.output };
  }

  async resolveCorrection(
    correctionId: string,
    action: "accepted" | "dismissed",
    id = DEFAULT_BRAIN_ID,
  ): Promise<{ output: string; ok: boolean }> {
    const doc = await this.get(id);
    const next = resolveBrainCorrection(doc, correctionId, action);
    if (!next.ok) return { ok: false, output: next.output };
    const withActivity = noteActivity(next.doc, "correct", next.output);
    await this.save(withActivity);
    return { ok: true, output: next.output };
  }

  async ingestCorpus(id = DEFAULT_BRAIN_ID): Promise<{ output: string; added: number }> {
    if (brainIngestPaused(await this.brainSettings())) {
      return { output: "Brain ingest is paused.", added: 0 };
    }
    const incoming: BrainCorpusRow[] = [];
    for (const collect of this.corpusCollectors) {
      try {
        incoming.push(...(await collect()));
      } catch {
        /* fail open */
      }
    }
    const doc = await this.get(id);
    const seen = new Set(doc.corpus.map((row) => row.id));
    const extra = incoming.filter((row) => row.id && row.text.trim() && !seen.has(row.id));
    if (!extra.length) return { output: "Corpus already current.", added: 0 };
    const next = {
      ...doc,
      corpus: [...doc.corpus, ...extra].slice(-2000),
      updatedAt: new Date().toISOString(),
    };
    await this.save(noteActivity(next, "index", `Ingested ${extra.length} corpus row(s).`));
    return { output: `Ingested ${extra.length} corpus row(s).`, added: extra.length };
  }

  async distillText(
    text: string,
    opts: { repo?: string; sessionId?: string; actor?: string } = {},
    id = DEFAULT_BRAIN_ID,
  ): Promise<{ output: string; count: number }> {
    const settings = await this.brainSettings();
    if (brainIngestPaused(settings)) {
      return { output: "Brain ingest is paused.", count: 0 };
    }
    const config = await this.store.loadConfig();
    const doc = await this.get(id);
    let rows: Array<{
      text: string;
      kind: import("@locus/shared").BrainMemoryKind;
      ambient: boolean;
      source: "user_stated" | "agent" | "session" | "indexer";
      contradictId?: string;
    }>;
    try {
      rows = await distillSessionBlob({
        text,
        config,
        complete: this.distillComplete,
      });
    } catch {
      rows = distillSessionText(text);
    }
    if (!rows.length) rows = distillSessionText(text);
    const consolidated = consolidateObservations(doc, rows, {
      repo: opts.repo,
      sessionId: opts.sessionId,
      actor: opts.actor ?? "distiller",
    });
    if (consolidated.count) {
      await this.save(
        noteActivity(
          consolidated.doc,
          "distill",
          `Distilled ${consolidated.count} observation(s)${
            consolidated.contradicted ? ` · contradicted ${consolidated.contradicted}` : ""
          }`,
          opts.repo,
        ),
      );
    }
    void this.ingestCorpus(id).catch(() => undefined);
    return {
      output: consolidated.count
        ? `Distilled ${consolidated.count} observation(s).`
        : "Nothing durable to keep.",
      count: consolidated.count,
    };
  }

  /** Distill a transcript tail from a CLI hook. The distiller is the only writer. */
  async ingestTranscript(
    input: { text: string; source?: string; repo?: string },
    id = DEFAULT_BRAIN_ID,
  ): Promise<{ output: string; ok: boolean; count: number }> {
    const source = (input.source ?? "hook").trim().slice(0, 40) || "hook";
    const text = redactHookSecrets(input.text ?? "").trim();
    if (!text) return { ok: false, output: "Empty transcript.", count: 0 };
    if (looksLikeRememberedSecret(text) && text.length < 240) {
      return {
        ok: false,
        output: "Refusing to store a secret. Keep tokens in Settings.",
        count: 0,
      };
    }
    const fenced = wrapUntrusted({
      kind: "operator-notes",
      source: `hook:${source}`,
      text,
      maxBytes: 12_000,
    });
    const repo = input.repo?.trim().slice(0, 500) || undefined;
    const result = await this.distillText(fenced, { repo, actor: `hook:${source}` }, id);
    return { ok: true, output: result.output, count: result.count };
  }

  async indexPath(
    root: string,
    opts: { repo?: string; actor?: string; force?: boolean } = {},
    id = DEFAULT_BRAIN_ID,
  ): Promise<{ output: string; nodeCount: number }> {
    const resolved = await resolveIndexRoot(root);
    const cacheDir = join(this.store.dataDir, "indexes", "brain", hashPath(resolved));
    const files = await loadBrainSourceFiles(resolved, cacheDir);
    const head = await gitHead(resolved);
    const remote =
      (typeof opts.repo === "string" && opts.repo.trim()) ||
      (await gitOriginUrl(resolved)) ||
      undefined;
    // Tag claims with remote when known, else the checkout path, so the graph can filter by repo.
    const scope = remote || resolved;
    let doc = await this.get(id);
    const existing = doc.repos.find(
      (row) => row.path === resolved || (remote && row.url && sameRepoUrl(row.url, remote)),
    );
    if (
      !opts.force &&
      existing?.head &&
      head &&
      existing.head === head &&
      (existing.fileCount ?? 0) === files.length
    ) {
      return { output: `Unchanged HEAD ${head.slice(0, 8)}.`, nodeCount: doc.nodes.length };
    }
    const actor = opts.actor ?? "indexer:build";
    const journalBefore = doc.journal.length;
    const claims = extractBrainClaims(files, { repo: scope });
    const serviceIds = new Map<string, string>();
    for (const claim of claims) {
      const result = upsertNode(doc, {
        type: claim.type,
        name: claim.name,
        aliases: claim.aliases,
        description: claim.description,
        repo: scope,
        provenance: { actor, evidence: claim.evidence, confidence: claim.confidence ?? "medium" },
      });
      if (result.ok) {
        doc = result.doc;
        if (claim.type === "Service") {
          serviceIds.set(claim.name, result.doc.nodes.find((n) => n.name === claim.name)?.id ?? "");
        }
      }
    }
    for (const claim of claims) {
      if (claim.type !== "APIEndpoint" || !claim.owns) continue;
      const owner = serviceIds.get(claim.owns);
      const endpoint = doc.nodes.find(
        (row) => row.type === "APIEndpoint" && row.name === claim.name,
      );
      if (!owner || !endpoint) continue;
      const linked = upsertEdge(doc, {
        type: "OWNS",
        from: owner,
        to: endpoint.id,
        provenance: { actor, evidence: claim.evidence, confidence: "high" },
      });
      if (linked.ok) doc = linked.doc;
    }
    // Path-only builds omit `url`; do not treat every missing url as the same repo.
    const repos = [
      ...doc.repos.filter((row) => {
        if (row.path === resolved) return false;
        if (remote && row.url && sameRepoUrl(row.url, remote)) return false;
        return true;
      }),
      {
        url: remote,
        path: resolved,
        head,
        indexedAt: new Date().toISOString(),
        fileCount: files.length,
      },
    ];
    doc = { ...doc, repos, updatedAt: new Date().toISOString() };
    if (doc.journal.length !== journalBefore || claims.length > 0) {
      doc = noteActivity(
        doc,
        "index",
        `Indexed ${files.length} files → ${claims.length} claims`,
        scope,
      );
    }
    await this.save(doc);
    void this.ingestCorpus(id).catch(() => undefined);
    return {
      output: `Indexed ${claims.length} claims from ${files.length} files.`,
      nodeCount: doc.nodes.length,
    };
  }

  async buildCwd(id = DEFAULT_BRAIN_ID, repo?: string): Promise<{ output: string }> {
    const cwd = process.cwd();
    try {
      await readFile(join(cwd, ".git", "HEAD"), "utf8");
    } catch {
      return {
        output:
          "No folder to index. Run `locus brain build /path/to/repo` or Build from a Host workspace.",
      };
    }
    const result = await this.indexPath(cwd, { repo, actor: "indexer:build" }, id);
    return { output: result.output };
  }

  async buildForRepo(repoUrl: string): Promise<{ output: string; ok: boolean }> {
    const doc = await this.get();
    const known = doc.repos.find((row) => row.url && sameRepoUrl(row.url, repoUrl) && row.path);
    if (known?.path) {
      const result = await this.indexPath(known.path, {
        repo: repoUrl,
        actor: "indexer:codebase",
        force: true,
      });
      return { ok: true, output: result.output };
    }
    return {
      ok: false,
      output:
        "No indexed checkout path for this remote yet. Open a Host agent on the repo, or Build from More → Brain with a folder path.",
    };
  }

  async exportJson(id = DEFAULT_BRAIN_ID): Promise<string> {
    const doc = await this.get(id);
    const path = join(this.store.dataDir, "brain", id, `brain-export-${Date.now()}.json`);
    await mkdir(join(this.store.dataDir, "brain", id), { recursive: true });
    await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    return path;
  }

  async setIngestPaused(paused: boolean): Promise<LocusConfig> {
    const config = await this.store.loadConfig();
    await this.store.saveConfig({
      ...config,
      brain: {
        ...config.brain,
        ingestPaused: paused,
      },
    });
    return this.store.loadConfig();
  }

  shouldAutoIndex(): Promise<boolean> {
    return this.brainSettings().then((settings) => brainAutoIndexEnabled(settings));
  }

  close(): void {
    this.sqlite?.close();
    this.sqlite = undefined;
  }
}

function noteActivity(
  doc: BrainDocument,
  kind: "index" | "remember" | "distill" | "build" | "correct",
  text: string,
  repo?: string,
): BrainDocument {
  const scope = typeof repo === "string" ? repo.trim() : "";
  return {
    ...doc,
    activity: [
      {
        id: `a${Date.now().toString(36)}`,
        kind,
        text,
        at: new Date().toISOString(),
        ...(scope ? { repo: scope } : {}),
      },
      ...doc.activity,
    ].slice(0, 80),
  };
}

function sameRepoUrl(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\.git$/, "") === b.toLowerCase().replace(/\.git$/, "");
}

async function gitOriginUrl(root: string): Promise<string | undefined> {
  try {
    const config = await readFile(join(root, ".git", "config"), "utf8");
    const match = config.match(/\[remote\s+"origin"\][^[]*?\burl\s*=\s*(.+)/is);
    const url = match?.[1]?.trim();
    return url || undefined;
  } catch {
    return undefined;
  }
}

async function gitHead(root: string): Promise<string | undefined> {
  try {
    const head = (await readFile(join(root, ".git", "HEAD"), "utf8")).trim();
    if (head.startsWith("ref: ")) {
      return (await readFile(join(root, ".git", head.slice(5).trim()), "utf8")).trim();
    }
    return head || undefined;
  } catch {
    return undefined;
  }
}

async function resolveIndexRoot(root: string): Promise<string> {
  const resolved = resolve(root);
  try {
    const info = await stat(resolved);
    if (!info.isDirectory()) throw new Error("Brain index root must be a directory");
  } catch (err) {
    if (err instanceof Error && /must be a directory/.test(err.message)) throw err;
    throw new Error(`Brain index root not found: ${root}`);
  }
  try {
    return await realpath(resolved);
  } catch {
    return resolved;
  }
}

function hashPath(root: string): string {
  let h = 2166136261;
  for (let i = 0; i < root.length; i += 1) {
    h ^= root.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Prefer the persistent workspace index; fall back to a jailed walk. */
export async function loadBrainSourceFiles(
  root: string,
  cacheDir?: string,
): Promise<Array<{ path: string; text: string }>> {
  try {
    const built = await getWorkspaceIndex(root, { cacheDir });
    const out: Array<{ path: string; text: string }> = [];
    for (const file of built.map.files) {
      if (out.length >= INDEX_FILE_CAP) break;
      const name = file.path.split("/").pop() ?? "";
      const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
      if (
        !INDEX_TEXT_EXT.has(ext.toLowerCase()) &&
        !/^docker-compose\.ya?ml$/i.test(name) &&
        name !== "package.json"
      ) {
        continue;
      }
      if ((file.bytes ?? 0) <= 0 || (file.bytes ?? 0) > INDEX_FILE_MAX_BYTES) continue;
      if (isSensitivePath(file.path) || isSensitivePath(name)) continue;
      const abs = join(root, ...file.path.split("/"));
      const real = await containedPath(root, abs);
      if (!real) continue;
      try {
        const text = await readFile(real, "utf8");
        out.push({ path: file.path.split(sep).join("/"), text });
      } catch {
        /* skip unreadable */
      }
    }
    if (out.length) return out;
  } catch {
    /* fall through to walk */
  }
  return walkSourceFiles(root);
}

async function walkSourceFiles(root: string): Promise<Array<{ path: string; text: string }>> {
  const out: Array<{ path: string; text: string }> = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= INDEX_FILE_CAP) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= INDEX_FILE_CAP) return;
      const name = entry.name;
      if (name.startsWith(".") && name !== ".github") continue;
      if (WORKSPACE_SKIP_DIR_SET.has(name)) continue;
      const full = join(dir, name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitivePath(name) || isSensitivePath(full)) continue;
      const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";
      if (
        !INDEX_TEXT_EXT.has(ext.toLowerCase()) &&
        !/^docker-compose\.ya?ml$/i.test(name) &&
        name !== "package.json"
      ) {
        continue;
      }
      const real = await containedPath(root, full);
      if (!real) continue;
      let size = 0;
      try {
        size = (await stat(real)).size;
      } catch {
        continue;
      }
      if (size <= 0 || size > INDEX_FILE_MAX_BYTES) continue;
      try {
        const text = await readFile(real, "utf8");
        out.push({ path: relative(root, real).split(sep).join("/"), text });
      } catch {
        /* skip */
      }
    }
  }
  await walk(root);
  return out;
}

export type { BrainDocument, BrainSummary };
