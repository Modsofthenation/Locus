import { mkdirSync } from "node:fs";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_BRAIN_ID,
  emptyBrain,
  type BrainActivity,
  type BrainCorpusRow,
  type BrainDocument,
  type BrainEdge,
  type BrainIndexedRepo,
  type BrainCorrection,
  type BrainJournalRow,
  type BrainMemory,
  type BrainNode,
} from "@locus/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  claim TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS corpus (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journal (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repos (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  id UNINDEXED,
  text,
  source UNINDEXED
);
`;

export class BrainSqliteStore {
  private db: DatabaseSync | undefined;
  private readonly sqlitePath: string;
  private readonly jsonPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly id = DEFAULT_BRAIN_ID,
  ) {
    const dir = join(dataDir, "brain", id);
    this.sqlitePath = join(dir, "brain.sqlite");
    this.jsonPath = join(dir, "brain.json");
  }

  private open(): DatabaseSync {
    if (this.db) return this.db;
    mkdirSync(dirname(this.sqlitePath), { recursive: true });
    const db = new DatabaseSync(this.sqlitePath);
    try {
      db.exec(SCHEMA);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/fts5|no such module/i.test(message)) {
        throw new Error(
          `Brain needs Node.js with SQLite FTS5 (22.22 or newer). This process is ${process.version}. ${message}`,
        );
      }
      throw err;
    }
    this.db = db;
    return db;
  }

  async load(): Promise<BrainDocument> {
    await mkdir(dirname(this.sqlitePath), { recursive: true });
    const db = this.open();
    const title = metaGet(db, "title");
    const updatedAt = metaGet(db, "updatedAt");
    const nodeCount = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM nodes").get() as { n?: number } | undefined)?.n ?? 0,
    );
    const memoryCount = Number(
      (db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n?: number } | undefined)?.n ??
        0,
    );
    if (!nodeCount && !memoryCount && !updatedAt) {
      const migrated = await this.migrateJsonIfPresent();
      if (migrated) return migrated;
      return emptyBrain(this.id);
    }
    return {
      id: this.id,
      title: title || (this.id === DEFAULT_BRAIN_ID ? "Brain" : this.id),
      nodes: rowsJson<BrainNode>(db, "SELECT json FROM nodes"),
      edges: rowsJson<BrainEdge>(db, "SELECT json FROM edges"),
      memories: rowsJson<BrainMemory>(db, "SELECT json FROM memories"),
      corpus: (
        db.prepare("SELECT id, text, source, created_at AS createdAt FROM corpus").all() as Array<
          Record<string, unknown>
        >
      ).map(
        (row) =>
          ({
            id: String(row.id ?? ""),
            text: String(row.text ?? ""),
            source: String(row.source ?? ""),
            createdAt: String(row.createdAt ?? ""),
          }) satisfies BrainCorpusRow,
      ),
      journal: rowsJson<BrainJournalRow>(db, "SELECT json FROM journal ORDER BY seq"),
      activity: rowsJson<BrainActivity>(db, "SELECT json FROM activity ORDER BY at DESC"),
      repos: rowsJson<BrainIndexedRepo>(db, "SELECT json FROM repos"),
      corrections: rowsJson<BrainCorrection>(db, "SELECT json FROM corrections"),
      updatedAt: updatedAt || new Date().toISOString(),
    };
  }

  async save(doc: BrainDocument): Promise<void> {
    await mkdir(dirname(this.sqlitePath), { recursive: true });
    const db = this.open();
    // v1: full snapshot rewrite. Prefer incremental upserts when brains grow large.
    db.exec("BEGIN");
    try {
      db.exec(
        "DELETE FROM nodes; DELETE FROM edges; DELETE FROM memories; DELETE FROM corpus; DELETE FROM journal; DELETE FROM activity; DELETE FROM repos; DELETE FROM corrections;",
      );
      db.exec("DELETE FROM search_fts;");
      metaSet(db, "title", doc.title);
      metaSet(db, "updatedAt", doc.updatedAt);
      metaSet(db, "id", doc.id);
      const insertNode = db.prepare("INSERT INTO nodes(id, json) VALUES (?, ?)");
      for (const row of doc.nodes) insertNode.run(row.id, JSON.stringify(row));
      const insertEdge = db.prepare("INSERT INTO edges(id, json) VALUES (?, ?)");
      for (const row of doc.edges) insertEdge.run(row.id, JSON.stringify(row));
      const insertMem = db.prepare("INSERT INTO memories(id, claim, json) VALUES (?, ?, ?)");
      for (const row of doc.memories) insertMem.run(row.id, row.claim, JSON.stringify(row));
      const insertCorpus = db.prepare(
        "INSERT INTO corpus(id, text, source, created_at) VALUES (?, ?, ?, ?)",
      );
      for (const row of doc.corpus) {
        insertCorpus.run(row.id, row.text, row.source, row.createdAt);
      }
      const insertJournal = db.prepare("INSERT INTO journal(json) VALUES (?)");
      for (const row of doc.journal) insertJournal.run(JSON.stringify(row));
      const insertActivity = db.prepare("INSERT INTO activity(id, at, json) VALUES (?, ?, ?)");
      for (const row of doc.activity) insertActivity.run(row.id, row.at, JSON.stringify(row));
      const insertRepo = db.prepare("INSERT INTO repos(key, json) VALUES (?, ?)");
      for (const row of doc.repos) {
        const key = row.path || row.url || `${row.indexedAt}:${row.head ?? ""}`;
        insertRepo.run(key, JSON.stringify(row));
      }
      const insertCorrection = db.prepare("INSERT INTO corrections(id, json) VALUES (?, ?)");
      for (const row of doc.corrections ?? []) insertCorrection.run(row.id, JSON.stringify(row));
      const insertFts = db.prepare("INSERT INTO search_fts(id, text, source) VALUES (?, ?, ?)");
      for (const row of doc.corpus) insertFts.run(row.id, row.text, row.source);
      for (const row of doc.nodes) {
        const text = [row.name, row.description, row.evidence, ...(row.aliases ?? [])]
          .filter(Boolean)
          .join(" ");
        if (text.trim()) insertFts.run(row.id, text, `node:${row.type}`);
      }
      for (const row of doc.memories) insertFts.run(row.id, row.claim, `memory:${row.kind}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  searchFts(q: string, limit = 24): Array<{ id: string; text: string; source: string }> {
    const match = toFtsQuery(q);
    if (!match) return [];
    const db = this.open();
    try {
      return db
        .prepare(
          "SELECT id, text, source FROM search_fts WHERE search_fts MATCH ? ORDER BY rank LIMIT ?",
        )
        .all(match, limit) as Array<{ id: string; text: string; source: string }>;
    } catch {
      return [];
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = undefined;
  }

  private async migrateJsonIfPresent(): Promise<BrainDocument | undefined> {
    try {
      const raw = JSON.parse(await readFile(this.jsonPath, "utf8")) as BrainDocument;
      if (!raw || typeof raw !== "object") return undefined;
      const doc: BrainDocument = {
        ...emptyBrain(this.id),
        ...raw,
        id: raw.id || this.id,
        nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
        edges: Array.isArray(raw.edges) ? raw.edges : [],
        memories: Array.isArray(raw.memories) ? raw.memories : [],
        corpus: Array.isArray(raw.corpus) ? raw.corpus : [],
        journal: Array.isArray(raw.journal) ? raw.journal : [],
        activity: Array.isArray(raw.activity) ? raw.activity : [],
        repos: Array.isArray(raw.repos) ? raw.repos : [],
        corrections: Array.isArray(raw.corrections) ? raw.corrections : [],
      };
      await this.save(doc);
      try {
        await rename(this.jsonPath, `${this.jsonPath}.migrated`);
      } catch {
        await unlink(this.jsonPath).catch(() => undefined);
      }
      return doc;
    } catch {
      return undefined;
    }
  }
}

function metaGet(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
    { value?: string } | undefined;
  return typeof row?.value === "string" ? row.value : undefined;
}

function metaSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function rowsJson<T>(db: DatabaseSync, sql: string): T[] {
  const rows = db.prepare(sql).all() as Array<{ json?: string }>;
  const out: T[] = [];
  for (const row of rows) {
    if (typeof row.json !== "string") continue;
    try {
      out.push(JSON.parse(row.json) as T);
    } catch {
      /* skip */
    }
  }
  return out;
}

function toFtsQuery(q: string): string | undefined {
  const tokens = q
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
  if (!tokens.length) return undefined;
  return tokens.map((token) => `"${token.replace(/"/g, "")}"*`).join(" AND ");
}
