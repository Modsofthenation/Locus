import { createHash } from "node:crypto";

/**
 * Tamper-evident audit log records. Each record hashes its own canonical JSON together with the
 * previous record's hash, so editing, reordering, or deleting a line breaks the chain from that
 * point. Daily files link: the first record of a day carries the last hash of the day before.
 * Node-only (sha256); import from `@locus/shared/auditChain`.
 */

export const AUDIT_GENESIS_HASH = "0".repeat(64);
export const AUDIT_RECORD_VERSION = 1;

export const AUDIT_EVENT_TYPES = [
  "approval",
  "blocked",
  "git_push",
  "git_pr",
  "merge",
  "policy",
  "budget_stop",
  "budget_override",
  "credential",
  "integration",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditEventInput {
  type: AuditEventType;
  /** `operator`, `agent`, `automation:<id>`, `ci`, … */
  actor: string;
  sessionId?: string;
  tool?: string;
  /** approved / denied / cancelled / ok / failed / changed … */
  decision?: string;
  /** One short line. Never a secret value or file contents. */
  summary?: string;
  data?: Record<string, unknown>;
  /** ISO time; defaults to now. */
  t?: string;
}

export interface AuditRecord {
  v: number;
  seq: number;
  t: string;
  type: AuditEventType;
  actor: string;
  sessionId?: string;
  tool?: string;
  decision?: string;
  summary?: string;
  data?: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditHead {
  seq: number;
  hash: string;
}

/** JSON with recursively sorted object keys and no whitespace. `undefined` members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined && typeof obj[key] !== "function")
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashAuditRecord(record: Omit<AuditRecord, "hash"> | AuditRecord): string {
  const { hash: _hash, ...rest } = record as AuditRecord;
  void _hash;
  return sha256Hex(canonicalJson(rest));
}

export function sealAuditRecord(input: AuditEventInput, prev?: AuditHead): AuditRecord {
  const base: Omit<AuditRecord, "hash"> = {
    v: AUDIT_RECORD_VERSION,
    seq: (prev?.seq ?? 0) + 1,
    t: input.t ?? new Date().toISOString(),
    type: input.type,
    actor: input.actor || "operator",
    sessionId: input.sessionId || undefined,
    tool: input.tool || undefined,
    decision: input.decision || undefined,
    summary: input.summary ? input.summary.slice(0, 500) : undefined,
    data: input.data && Object.keys(input.data).length ? input.data : undefined,
    prevHash: prev?.hash ?? AUDIT_GENESIS_HASH,
  };
  return { ...base, hash: hashAuditRecord(base) };
}

/** UTC day file: `audit-YYYY-MM-DD.jsonl`. */
export function auditFileName(t: string | Date = new Date()): string {
  const iso = typeof t === "string" ? t : t.toISOString();
  return `audit-${iso.slice(0, 10)}.jsonl`;
}

export function isAuditFileName(name: string): boolean {
  return /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name);
}

export function formatAuditLine(record: AuditRecord): string {
  return `${canonicalJson(record)}\n`;
}

export interface AuditBreak {
  file: string;
  line: number;
  seq?: number;
  reason: string;
}

export interface AuditVerifyResult {
  ok: boolean;
  files: number;
  records: number;
  head?: AuditHead;
  firstBroken?: AuditBreak;
}

/**
 * Walk the chain across day files (sorted by name). Reports the first record that fails:
 * bad JSON, a recomputed hash mismatch, a prevHash that does not match the previous record,
 * a gap in `seq`, a record filed under the wrong day, or a head pointer the files fall short of.
 */
export function verifyAuditChain(
  files: Array<{ name: string; text: string }>,
  expectedHead?: AuditHead,
): AuditVerifyResult {
  const sorted = [...files]
    .filter((f) => isAuditFileName(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  let prev: AuditHead | undefined;
  let records = 0;
  const fail = (brk: AuditBreak): AuditVerifyResult => ({
    ok: false,
    files: sorted.length,
    records,
    head: prev,
    firstBroken: brk,
  });
  for (const file of sorted) {
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      if (!raw.trim()) {
        if (i === lines.length - 1) continue;
        return fail({ file: file.name, line: i + 1, reason: "blank line inside the log" });
      }
      let record: AuditRecord;
      try {
        record = JSON.parse(raw) as AuditRecord;
      } catch {
        return fail({ file: file.name, line: i + 1, reason: "line is not valid JSON" });
      }
      if (!record || typeof record !== "object" || typeof record.hash !== "string") {
        return fail({ file: file.name, line: i + 1, reason: "record has no hash" });
      }
      const expectedPrev = prev?.hash ?? AUDIT_GENESIS_HASH;
      if (record.prevHash !== expectedPrev) {
        return fail({
          file: file.name,
          line: i + 1,
          seq: record.seq,
          reason: prev
            ? `prevHash does not match record ${prev.seq} (deleted, reordered, or edited earlier record)`
            : "first record does not start from the genesis hash",
        });
      }
      if (hashAuditRecord(record) !== record.hash) {
        return fail({
          file: file.name,
          line: i + 1,
          seq: record.seq,
          reason: "hash mismatch (record was edited)",
        });
      }
      const expectedSeq = (prev?.seq ?? 0) + 1;
      if (record.seq !== expectedSeq) {
        return fail({
          file: file.name,
          line: i + 1,
          seq: record.seq,
          reason: `sequence gap (expected ${expectedSeq})`,
        });
      }
      if (auditFileName(record.t) !== file.name) {
        return fail({
          file: file.name,
          line: i + 1,
          seq: record.seq,
          reason: "record is filed under the wrong day",
        });
      }
      prev = { seq: record.seq, hash: record.hash };
      records += 1;
    }
  }
  if (expectedHead && (prev?.seq ?? 0) < expectedHead.seq) {
    return fail({
      file: sorted.at(-1)?.name ?? "(none)",
      line: 0,
      seq: (prev?.seq ?? 0) + 1,
      reason: `log ends at record ${prev?.seq ?? 0} but HEAD says ${expectedHead.seq} (records were truncated)`,
    });
  }
  if (expectedHead && prev && prev.seq === expectedHead.seq && prev.hash !== expectedHead.hash) {
    return fail({
      file: sorted.at(-1)?.name ?? "(none)",
      line: 0,
      seq: prev.seq,
      reason: "last record hash does not match HEAD",
    });
  }
  return { ok: true, files: sorted.length, records, head: prev };
}

export function parseAuditRecords(text: string): AuditRecord[] {
  const out: AuditRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as AuditRecord);
    } catch {
      /* verify reports bad lines; export skips them */
    }
  }
  return out;
}

/** Accepts `YYYY-MM-DD`, an ISO time, or a relative `7d` / `24h`. */
export function parseAuditSince(raw: string | undefined, nowMs = Date.now()): string | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const rel = text.match(/^(\d+)\s*([dhm])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    const ms = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
    return new Date(nowMs - n * ms).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00.000Z`;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`Cannot parse --since ${text}`);
  return new Date(parsed).toISOString();
}

const CSV_COLUMNS = [
  "seq",
  "t",
  "type",
  "actor",
  "sessionId",
  "tool",
  "decision",
  "summary",
  "data",
  "prevHash",
  "hash",
] as const;

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "object" ? canonicalJson(value) : String(value);
  // Neutralize spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function auditRecordsToCsv(records: AuditRecord[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    rows.push(CSV_COLUMNS.map((key) => csvCell(record[key])).join(","));
  }
  return `${rows.join("\n")}\n`;
}

export function auditRecordsToJsonl(records: AuditRecord[]): string {
  return records.map((record) => formatAuditLine(record)).join("");
}

export function filterAuditSince(records: AuditRecord[], since?: string): AuditRecord[] {
  if (!since) return records;
  return records.filter((record) => record.t >= since);
}
