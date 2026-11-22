import { describe, expect, it } from "vitest";
import {
  AUDIT_GENESIS_HASH,
  auditFileName,
  auditRecordsToCsv,
  canonicalJson,
  formatAuditLine,
  parseAuditRecords,
  parseAuditSince,
  sealAuditRecord,
  verifyAuditChain,
  type AuditHead,
  type AuditRecord,
} from "./auditChain.js";

function chain(times: string[]): Array<{ name: string; text: string }> {
  const files = new Map<string, string>();
  let head: AuditHead | undefined;
  for (const [i, t] of times.entries()) {
    const record = sealAuditRecord(
      {
        type: "approval",
        actor: "operator",
        tool: "git_push",
        decision: "approved",
        t,
        data: { i },
      },
      head,
    );
    head = { seq: record.seq, hash: record.hash };
    const name = auditFileName(t);
    files.set(name, (files.get(name) ?? "") + formatAuditLine(record));
  }
  return [...files].map(([name, text]) => ({ name, text }));
}

describe("audit hash chain", () => {
  it("canonical JSON sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [1, "x"] } })).toBe(
      '{"a":{"c":[1,"x"]},"b":1}',
    );
  });

  it("appends records linked by prevHash", () => {
    const files = chain(["2026-11-14T10:00:00.000Z", "2026-11-14T11:00:00.000Z"]);
    const records = parseAuditRecords(files[0]!.text);
    expect(records[0]!.prevHash).toBe(AUDIT_GENESIS_HASH);
    expect(records[1]!.prevHash).toBe(records[0]!.hash);
    expect(records.map((r) => r.seq)).toEqual([1, 2]);
    expect(verifyAuditChain(files)).toMatchObject({ ok: true, records: 2, files: 1 });
  });

  it("links across daily rotation", () => {
    const files = chain([
      "2026-11-13T23:59:00.000Z",
      "2026-11-14T00:01:00.000Z",
      "2026-11-15T08:00:00.000Z",
    ]);
    expect(files.map((f) => f.name)).toEqual([
      "audit-2026-11-13.jsonl",
      "audit-2026-11-14.jsonl",
      "audit-2026-11-15.jsonl",
    ]);
    const first = parseAuditRecords(files[0]!.text)[0]!;
    const second = parseAuditRecords(files[1]!.text)[0]!;
    expect(second.prevHash).toBe(first.hash);
    expect(verifyAuditChain(files)).toMatchObject({ ok: true, records: 3, files: 3 });
  });

  it("detects an edited record", () => {
    const files = chain(["2026-11-14T10:00:00.000Z", "2026-11-14T11:00:00.000Z"]);
    files[0]!.text = files[0]!.text.replace('"decision":"approved"', '"decision":"denied"');
    const result = verifyAuditChain(files);
    expect(result.ok).toBe(false);
    expect(result.firstBroken).toMatchObject({
      line: 1,
      seq: 1,
      reason: expect.stringMatching(/edited/),
    });
  });

  it("detects a deleted record", () => {
    const files = chain([
      "2026-11-14T10:00:00.000Z",
      "2026-11-14T11:00:00.000Z",
      "2026-11-14T12:00:00.000Z",
    ]);
    const lines = files[0]!.text.split("\n");
    lines.splice(1, 1);
    files[0]!.text = lines.join("\n");
    const result = verifyAuditChain(files);
    expect(result.firstBroken).toMatchObject({ line: 2, seq: 3 });
  });

  it("detects a removed day file across rotation", () => {
    const files = chain([
      "2026-11-13T10:00:00.000Z",
      "2026-11-14T10:00:00.000Z",
      "2026-11-15T10:00:00.000Z",
    ]);
    const result = verifyAuditChain([files[0]!, files[2]!]);
    expect(result.firstBroken).toMatchObject({ file: "audit-2026-11-15.jsonl", line: 1 });
  });

  it("detects a re-hashed forgery that skips a sequence number", () => {
    const files = chain(["2026-11-14T10:00:00.000Z"]);
    const first = parseAuditRecords(files[0]!.text)[0]!;
    const forged = sealAuditRecord(
      { type: "policy", actor: "x", t: "2026-11-14T10:30:00.000Z" },
      { seq: first.seq + 5, hash: first.hash },
    );
    files[0]!.text += formatAuditLine(forged);
    expect(verifyAuditChain(files).firstBroken?.reason).toMatch(/sequence gap/);
  });

  it("detects truncation against HEAD", () => {
    const files = chain(["2026-11-14T10:00:00.000Z", "2026-11-14T11:00:00.000Z"]);
    const records = parseAuditRecords(files[0]!.text);
    const head = { seq: records[1]!.seq, hash: records[1]!.hash };
    files[0]!.text = formatAuditLine(records[0]!);
    expect(verifyAuditChain(files, head).firstBroken?.reason).toMatch(/truncated/);
    expect(verifyAuditChain(chain(["2026-11-14T10:00:00.000Z"]), undefined).ok).toBe(true);
  });

  it("rejects invalid JSON lines", () => {
    const files = chain(["2026-11-14T10:00:00.000Z"]);
    files[0]!.text += "{not json\n";
    expect(verifyAuditChain(files).firstBroken).toMatchObject({
      line: 2,
      reason: "line is not valid JSON",
    });
  });

  it("exports CSV with formula injection neutralized", () => {
    const record = sealAuditRecord({
      type: "credential",
      actor: "operator",
      summary: '=HYPERLINK("x")',
      t: "2026-11-14T10:00:00.000Z",
    });
    const csv = auditRecordsToCsv([record as AuditRecord]);
    expect(csv.split("\n")[0]).toBe(
      "seq,t,type,actor,sessionId,tool,decision,summary,data,prevHash,hash",
    );
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it("parses --since forms", () => {
    expect(parseAuditSince("2026-11-01")).toBe("2026-11-01T00:00:00.000Z");
    expect(parseAuditSince("7d", Date.parse("2026-11-14T00:00:00.000Z"))).toBe(
      "2026-11-07T00:00:00.000Z",
    );
    expect(() => parseAuditSince("nope")).toThrow();
  });
});
