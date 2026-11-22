/**
 * Structured test results shared by the publish gate, benchmarks, and UI.
 *
 * Every parser here is pure and tolerant: it returns `undefined` when the input
 * does not look like output from its framework, and never throws on malformed
 * input. Counts are per test case (not per file); `failures` lists one entry
 * per failing case, capped at {@link MAX_REPORT_FAILURES}.
 */

/** Which parser produced a report. `junit` covers pytest --junitxml, surefire, Gradle, and others. */
export type TestFramework =
  "junit" | "go" | "cargo" | "vitest" | "jest" | "pytest" | "mixed" | "unknown";

export interface TestFailure {
  /** Test name as the framework prints it (`suite > case`, `pkg.TestName/sub`, `mod::case`). */
  name: string;
  /** Source or test file, relative to the run's cwd when the framework reports one. */
  file?: string;
  /** First lines of the assertion / panic / error message. */
  message?: string;
}

export interface TestReport {
  framework: TestFramework;
  passed: number;
  /** Failed and errored cases. */
  failed: number;
  /** Skipped, ignored, todo, and xfail cases. */
  skipped: number;
  durationMs?: number;
  failures: TestFailure[];
}

export const MAX_REPORT_FAILURES = 50;
const MAX_MESSAGE_CHARS = 600;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function clean(text: string): string {
  return text.replace(ANSI, "").replace(/\r\n?/g, "\n");
}

function clipMessage(text: string | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed;
}

function pushFailure(failures: TestFailure[], failure: TestFailure): void {
  if (failures.length >= MAX_REPORT_FAILURES) return;
  const message = clipMessage(failure.message);
  failures.push({
    name: failure.name,
    ...(failure.file ? { file: failure.file } : {}),
    ...(message ? { message } : {}),
  });
}

function toMs(value: number, unit: string): number {
  if (unit === "ms") return Math.round(value);
  if (unit === "m" || unit === "min") return Math.round(value * 60_000);
  return Math.round(value * 1000);
}

/** One-line label per failure: `file > name` when the name does not already carry the file. */
export function testFailureLabel(failure: TestFailure): string {
  if (!failure.file || failure.name.includes(failure.file)) return failure.name;
  return `${failure.file} > ${failure.name}`;
}

/** Failure labels for `WorkspaceScriptResult.failedTests`. */
export function testReportFailedTests(report: TestReport | undefined, max = 20): string[] {
  if (!report) return [];
  return [...new Set(report.failures.map(testFailureLabel))].slice(0, max);
}

/** Sum several reports (one per workspace or project) into one. */
export function mergeTestReports(reports: Array<TestReport | undefined>): TestReport | undefined {
  const rows = reports.filter((report): report is TestReport => Boolean(report));
  if (!rows.length) return undefined;
  if (rows.length === 1) return rows[0];
  const frameworks = new Set(rows.map((row) => row.framework));
  const durations = rows.map((row) => row.durationMs).filter((ms): ms is number => ms != null);
  return {
    framework: frameworks.size === 1 ? rows[0]!.framework : "mixed",
    passed: rows.reduce((sum, row) => sum + row.passed, 0),
    failed: rows.reduce((sum, row) => sum + row.failed, 0),
    skipped: rows.reduce((sum, row) => sum + row.skipped, 0),
    ...(durations.length ? { durationMs: durations.reduce((a, b) => a + b, 0) } : {}),
    failures: rows.flatMap((row) => row.failures).slice(0, MAX_REPORT_FAILURES),
  };
}

/** Short human summary: counts line plus up to `maxFailures` failure labels with messages. */
export function formatTestReport(report: TestReport, maxFailures = 10): string {
  const counts = [
    `${report.failed} failed`,
    `${report.passed} passed`,
    report.skipped ? `${report.skipped} skipped` : undefined,
  ].filter(Boolean);
  const duration = report.durationMs != null ? ` in ${(report.durationMs / 1000).toFixed(1)}s` : "";
  const lines = [`Test report (${report.framework}): ${counts.join(", ")}${duration}.`];
  for (const failure of report.failures.slice(0, maxFailures)) {
    const firstLine = failure.message?.split("\n").find((line) => line.trim());
    lines.push(`- ${testFailureLabel(failure)}${firstLine ? `: ${firstLine.trim()}` : ""}`);
  }
  const more = report.failures.length - maxFailures;
  if (more > 0) lines.push(`- … ${more} more`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JUnit XML
// ---------------------------------------------------------------------------

interface XmlTag {
  name: string;
  attrs: Record<string, string>;
  kind: "open" | "close" | "self";
  /** Index just after the tag. */
  end: number;
  /** Index where the tag starts. */
  start: number;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return XML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function parseXmlAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    attrs[match[1]!] = decodeXmlEntities(match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Tokenize tags, skipping comments, processing instructions, doctype, and CDATA bodies. */
function xmlTags(xml: string): XmlTag[] {
  const tags: XmlTag[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      i = end < 0 ? xml.length : end + 1;
      continue;
    }
    // Find the closing '>' while respecting quoted attribute values.
    let j = lt + 1;
    let quote = "";
    while (j < xml.length) {
      const c = xml[j]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j += 1;
    }
    if (j >= xml.length) break;
    const body = xml.slice(lt + 1, j);
    if (body.startsWith("/")) {
      tags.push({ name: body.slice(1).trim(), attrs: {}, kind: "close", start: lt, end: j + 1 });
    } else {
      const self = body.endsWith("/");
      const inner = self ? body.slice(0, -1) : body;
      const nameMatch = /^([A-Za-z_:][\w:.-]*)/.exec(inner);
      if (nameMatch) {
        tags.push({
          name: nameMatch[1]!,
          attrs: parseXmlAttrs(inner.slice(nameMatch[1]!.length)),
          kind: self ? "self" : "open",
          start: lt,
          end: j + 1,
        });
      }
    }
    i = j + 1;
  }
  return tags;
}

/** Text content between two indexes: CDATA sections unwrapped, tags dropped, entities decoded. */
function xmlText(xml: string, from: number, to: number): string {
  const slice = xml.slice(from, to);
  let out = "";
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]*>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(slice))) {
    if (match[1] !== undefined) out += match[1];
    else if (match[2] !== undefined) out += decodeXmlEntities(match[2]);
  }
  return out;
}

function numberAttr(attrs: Record<string, string>, key: string): number | undefined {
  const raw = attrs[key];
  if (raw == null || raw.trim() === "") return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse JUnit / xUnit XML (pytest `--junitxml`, Maven surefire, Gradle, Jest
 * junit reporters, go-junit-report, …). Accepts `<testsuites>`, a bare
 * `<testsuite>`, or concatenated documents.
 */
export function parseJUnitXml(xml: string): TestReport | undefined {
  if (!/<testsuites?\b|<testcase\b/.test(xml)) return undefined;
  const tags = xmlTags(xml);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let caseSeconds = 0;
  let sawCase = false;
  let suiteSeconds = 0;
  let suiteDepth = 0;
  const suiteCounts = { tests: 0, failures: 0, errors: 0, skipped: 0 };
  const failures: TestFailure[] = [];
  const suiteFiles: string[] = [];

  for (let t = 0; t < tags.length; t += 1) {
    const tag = tags[t]!;
    if (tag.name === "testsuite") {
      if (tag.kind === "close") {
        suiteDepth = Math.max(0, suiteDepth - 1);
        suiteFiles.pop();
        continue;
      }
      // Only outermost suites contribute aggregate counts (nested suites repeat them).
      if (suiteDepth === 0) {
        suiteSeconds += numberAttr(tag.attrs, "time") ?? 0;
        suiteCounts.tests += numberAttr(tag.attrs, "tests") ?? 0;
        suiteCounts.failures += numberAttr(tag.attrs, "failures") ?? 0;
        suiteCounts.errors += numberAttr(tag.attrs, "errors") ?? 0;
        suiteCounts.skipped +=
          (numberAttr(tag.attrs, "skipped") ?? 0) + (numberAttr(tag.attrs, "disabled") ?? 0);
      }
      if (tag.kind === "open") {
        suiteDepth += 1;
        suiteFiles.push(tag.attrs.file ?? "");
      }
      continue;
    }
    if (tag.name !== "testcase" || tag.kind === "close") continue;
    sawCase = true;
    caseSeconds += numberAttr(tag.attrs, "time") ?? 0;
    const classname = tag.attrs.classname ?? "";
    const caseName = tag.attrs.name ?? "(unnamed)";
    const name =
      classname && !caseName.startsWith(classname) ? `${classname}.${caseName}` : caseName;
    const file = tag.attrs.file || [...suiteFiles].reverse().find((f) => f) || undefined;
    if (tag.kind === "self") {
      passed += 1;
      continue;
    }
    // Walk children until the matching </testcase>.
    let outcome: "pass" | "fail" | "skip" = "pass";
    let message: string | undefined;
    let depth = 1;
    let k = t + 1;
    for (; k < tags.length && depth > 0; k += 1) {
      const child = tags[k]!;
      if (child.name === "testcase") {
        depth += child.kind === "open" ? 1 : child.kind === "close" ? -1 : 0;
        continue;
      }
      if (depth !== 1 || child.kind === "close") continue;
      if (child.name === "failure" || child.name === "error") {
        outcome = "fail";
        if (message === undefined) {
          let body = "";
          if (child.kind === "open") {
            const close = tags.findIndex(
              (row, idx) => idx > k && row.kind === "close" && row.name === child.name,
            );
            if (close > k) body = xmlText(xml, child.end, tags[close]!.start);
          }
          const head = child.attrs.message?.trim();
          message = [head, body.trim()].filter(Boolean).join("\n") || child.attrs.type || "";
        }
      } else if (child.name === "skipped" && outcome !== "fail") {
        outcome = "skip";
      }
    }
    t = k - 1;
    if (outcome === "fail") {
      failed += 1;
      pushFailure(failures, { name, ...(file ? { file } : {}), message });
    } else if (outcome === "skip") skipped += 1;
    else passed += 1;
  }

  if (!sawCase) {
    if (!suiteCounts.tests) return undefined;
    const bad = suiteCounts.failures + suiteCounts.errors;
    return {
      framework: "junit",
      passed: Math.max(0, suiteCounts.tests - bad - suiteCounts.skipped),
      failed: bad,
      skipped: suiteCounts.skipped,
      ...(suiteSeconds ? { durationMs: Math.round(suiteSeconds * 1000) } : {}),
      failures,
    };
  }
  const seconds = suiteSeconds || caseSeconds;
  return {
    framework: "junit",
    passed,
    failed,
    skipped,
    ...(seconds ? { durationMs: Math.round(seconds * 1000) } : {}),
    failures,
  };
}

// ---------------------------------------------------------------------------
// go test -json
// ---------------------------------------------------------------------------

interface GoTestEvent {
  Action?: string;
  Package?: string;
  /** `build-output` / `build-fail` events (Go 1.24+) name the package here. */
  ImportPath?: string;
  Test?: string;
  Elapsed?: number;
  Output?: string;
}

function goEvents(text: string): { events: GoTestEvent[]; other: string[] } {
  const events: GoTestEvent[] = [];
  const other: string[] = [];
  for (const line of clean(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && "Action" in parsed) {
          events.push(parsed as GoTestEvent);
          continue;
        }
      } catch {
        /* not an event */
      }
    }
    other.push(line);
  }
  return { events, other };
}

/** Rebuild the plain `go test` transcript from `-json` events (for logs and models). */
export function goTestJsonToText(text: string): string {
  const { events, other } = goEvents(text);
  if (!events.length) return text;
  const body = events
    .filter((event) => event.Action === "output" || event.Action === "build-output")
    .map((event) => event.Output ?? "")
    .join("");
  return [other.join("\n"), body].filter((part) => part.trim()).join("\n");
}

/** Parse `go test -json` output. Non-JSON lines (build errors on older Go) are tolerated. */
export function parseGoTestJson(text: string): TestReport | undefined {
  const { events, other } = goEvents(text);
  if (!events.length) return undefined;
  const outputs = new Map<string, string[]>();
  const results = new Map<string, { pkg: string; test: string; action: string }>();
  const pkgFailed = new Set<string>();
  const pkgOutput = new Map<string, string[]>();
  let durationSec = 0;
  for (const event of events) {
    const pkg = event.Package ?? event.ImportPath ?? "";
    if (event.Action === "output" || event.Action === "build-output") {
      const key = event.Test ? `${pkg}\u0000${event.Test}` : pkg;
      const bucket = event.Test ? outputs : pkgOutput;
      const rows = bucket.get(key) ?? [];
      if (rows.length < 200) rows.push(event.Output ?? "");
      bucket.set(key, rows);
      continue;
    }
    if (event.Action === "build-fail") {
      pkgFailed.add(pkg);
      continue;
    }
    if (event.Action !== "pass" && event.Action !== "fail" && event.Action !== "skip") continue;
    if (!event.Test) {
      if (typeof event.Elapsed === "number") durationSec += event.Elapsed;
      if (event.Action === "fail") pkgFailed.add(pkg);
      continue;
    }
    results.set(`${pkg}\u0000${event.Test}`, { pkg, test: event.Test, action: event.Action });
  }
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: TestFailure[] = [];
  const failedKeys = [...results.entries()].filter(([, row]) => row.action === "fail");
  const pkgsWithTestFailures = new Set<string>();
  for (const [key, row] of results) {
    if (row.action === "pass") passed += 1;
    else if (row.action === "skip") skipped += 1;
    else {
      failed += 1;
      pkgsWithTestFailures.add(row.pkg);
      // A parent fails whenever a subtest fails; list only the leaf.
      const hasFailingChild = failedKeys.some(
        ([other]) => other !== key && other.startsWith(`${key}/`),
      );
      if (hasFailingChild) continue;
      const lines = (outputs.get(key) ?? [])
        .map((line) => line.replace(/\n$/, ""))
        .filter(
          (line) => !/^\s*(?:=== (?:RUN|PAUSE|CONT|NAME)|--- (?:FAIL|PASS|SKIP))\b/.test(line),
        );
      const fileMatch = lines.map((line) => /^\s*([\w./-]+_test\.go):\d+/.exec(line)).find(Boolean);
      pushFailure(failures, {
        name: `${row.pkg ? `${row.pkg}.` : ""}${row.test}`,
        ...(fileMatch ? { file: fileMatch[1] } : {}),
        message: lines.join("\n"),
      });
    }
  }
  for (const pkg of pkgFailed) {
    if (pkgsWithTestFailures.has(pkg)) continue;
    failed += 1;
    const lines = (pkgOutput.get(pkg) ?? [])
      .map((line) => line.replace(/\n$/, ""))
      .filter((line) => line.trim() && !/^(?:FAIL|ok)\s/.test(line));
    pushFailure(failures, {
      name: pkg || "(build)",
      message: (lines.length ? lines : other).join("\n") || "package failed to build or run",
    });
  }
  return {
    framework: "go",
    passed,
    failed,
    skipped,
    ...(durationSec ? { durationMs: Math.round(durationSec * 1000) } : {}),
    failures,
  };
}

// ---------------------------------------------------------------------------
// cargo test
// ---------------------------------------------------------------------------

/** Parse libtest output from `cargo test` (all test binaries and doc-tests). */
export function parseCargoTestOutput(text: string): TestReport | undefined {
  const lines = clean(text).split("\n");
  const summaries = lines
    .map((line) =>
      /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;.*?(?:finished in ([\d.]+)s)?$/.exec(
        line.trim(),
      ),
    )
    .filter((match): match is RegExpExecArray => Boolean(match));
  const caseLines = lines
    .map((line) => /^test (.+?) \.\.\. (ok|FAILED|ignored|bench)\b/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match));
  if (!summaries.length && !caseLines.length) return undefined;

  // `---- name stdout ----` blocks carry panic messages.
  const messages = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines) {
    const header = /^---- (.+?) stdout ----$/.exec(line.trim());
    if (header) {
      current = header[1]!;
      messages.set(current, []);
      continue;
    }
    if (!current) continue;
    if (/^(?:failures:|test result:|---- )/.test(line.trim())) {
      current = undefined;
      continue;
    }
    messages.get(current)!.push(line);
  }

  const failures: TestFailure[] = [];
  for (const match of caseLines) {
    if (match[2] !== "FAILED") continue;
    const name = match[1]!.replace(/ - should panic$/, "");
    const body = (messages.get(match[1]!) ?? messages.get(name) ?? []).join("\n");
    const file =
      /panicked at (?:'.*?', )?([^\s:]+\.rs):\d+/.exec(body)?.[1] ??
      /^\s*([\w./-]+\.rs) - /.exec(name)?.[1];
    const bodyLines = body.split("\n");
    const backtrace = bodyLines.findIndex((line) => /^stack backtrace:/.test(line.trim()));
    const message = (backtrace >= 0 ? bodyLines.slice(0, backtrace) : bodyLines)
      .filter((line) => !/^note: (?:run with `RUST_BACKTRACE|Some details are omitted)/.test(line))
      .join("\n");
    pushFailure(failures, { name, ...(file ? { file } : {}), message });
  }

  if (summaries.length) {
    const sum = (index: number) =>
      summaries.reduce((total, match) => total + Number(match[index] ?? 0), 0);
    const seconds = summaries.reduce((total, match) => total + Number(match[4] ?? 0), 0);
    return {
      framework: "cargo",
      passed: sum(1),
      failed: sum(2),
      skipped: sum(3),
      ...(seconds ? { durationMs: Math.round(seconds * 1000) } : {}),
      failures,
    };
  }
  return {
    framework: "cargo",
    passed: caseLines.filter((match) => match[2] === "ok").length,
    failed: caseLines.filter((match) => match[2] === "FAILED").length,
    skipped: caseLines.filter((match) => match[2] === "ignored").length,
    failures,
  };
}

// ---------------------------------------------------------------------------
// vitest / jest
// ---------------------------------------------------------------------------

function countFrom(segment: string, word: RegExp): number {
  const match = new RegExp(`(\\d+)\\s+${word.source}`, "i").exec(segment);
  return match ? Number(match[1]) : 0;
}

function parseDurationToken(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /([\d.]+)\s*(ms|s|m)\b/.exec(raw);
  return match ? toMs(Number(match[1]), match[2]!) : undefined;
}

/** First non-empty, non-decoration line after `index`. */
function messageAfter(lines: string[], index: number, stop: RegExp): string | undefined {
  const out: string[] = [];
  for (let i = index + 1; i < lines.length && out.length < 4; i += 1) {
    const line = lines[i]!;
    if (stop.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed || /^[⎯─-]{3,}/.test(trimmed)) {
      if (out.length) break;
      continue;
    }
    out.push(trimmed);
  }
  return out.join("\n") || undefined;
}

/** Parse vitest's default reporter (`FAIL  file > suite > case`, `Tests  1 failed | 3 passed`). */
export function parseVitestOutput(text: string): TestReport | undefined {
  const lines = clean(text).split("\n");
  const summary = lines.map((line) => /^\s*Tests\s{2,}(.+)$/.exec(line)).find(Boolean);
  const failLines = lines
    .map((line, index) => ({ index, match: /^\s*FAIL\s+(\S.*)$/.exec(line) }))
    .filter((row) => row.match);
  if (!summary && !failLines.length) return undefined;
  if (!summary && !lines.some((line) => /\bvitest\b|Test Files\s/i.test(line))) {
    // Bare FAIL lines without any vitest marker could be jest; let jest handle them.
    if (lines.some((line) => /^\s*●\s/.test(line))) return undefined;
  }
  const failures: TestFailure[] = [];
  const seen = new Set<string>();
  for (const { index, match } of failLines) {
    const raw = match![1]!.trim().replace(/\s+\[[^\]]*\]$/, "");
    if (seen.has(raw)) continue;
    seen.add(raw);
    const parts = raw.split(" > ");
    const file = parts.length > 1 || /\.[cm]?[jt]sx?$/.test(parts[0]!) ? parts[0] : undefined;
    const name = parts.length > 1 ? parts.slice(1).join(" > ") : raw;
    pushFailure(failures, {
      name,
      ...(file ? { file } : {}),
      message: messageAfter(lines, index, /^\s*FAIL\s/),
    });
  }
  const seg = summary?.[1] ?? "";
  const failed = summary ? countFrom(seg, /failed/) : failures.length;
  const durationLine = lines.map((line) => /^\s*Duration\s+(\S+)/.exec(line)).find(Boolean);
  const durationMs = parseDurationToken(durationLine?.[1]);
  return {
    framework: "vitest",
    passed: countFrom(seg, /passed/),
    failed: Math.max(failed, summary ? 0 : failures.length),
    skipped: countFrom(seg, /skipped/) + countFrom(seg, /todo/),
    ...(durationMs != null ? { durationMs } : {}),
    failures,
  };
}

/** Parse Jest's default reporter (`FAIL path`, `● suite › case`, `Tests: 1 failed, 2 passed`). */
export function parseJestOutput(text: string): TestReport | undefined {
  const lines = clean(text).split("\n");
  const summary = lines.map((line) => /^\s*Tests:\s+(.+)$/.exec(line)).find(Boolean);
  const bullets = lines.some((line) => /^\s*●\s/.test(line));
  if (!summary && !bullets) return undefined;
  const failures: TestFailure[] = [];
  const seen = new Set<string>();
  let file: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fileMatch = /^\s*FAIL\s+(\S+)/.exec(line);
    if (fileMatch) {
      file = fileMatch[1];
      continue;
    }
    if (/^\s*PASS\s+\S/.test(line)) {
      file = undefined;
      continue;
    }
    const bullet = /^\s*●\s+(.+)$/.exec(line);
    if (!bullet) continue;
    const name = bullet[1]!.trim();
    if (/^Console$/.test(name)) continue;
    const key = `${file ?? ""}\u0000${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pushFailure(failures, {
      name,
      ...(file ? { file } : {}),
      message: messageAfter(lines, i, /^\s*(?:●|FAIL|PASS)\s/),
    });
  }
  const seg = summary?.[1] ?? "";
  const timeLine = lines
    .map((line) => /^\s*Time:\s+([\d.]+\s*(?:ms|s|m))/.exec(line))
    .find(Boolean);
  const durationMs = parseDurationToken(timeLine?.[1]);
  return {
    framework: "jest",
    passed: countFrom(seg, /passed/),
    failed: summary ? countFrom(seg, /failed/) : failures.length,
    skipped: countFrom(seg, /skipped/) + countFrom(seg, /todo/),
    ...(durationMs != null ? { durationMs } : {}),
    failures,
  };
}

// ---------------------------------------------------------------------------
// pytest
// ---------------------------------------------------------------------------

const PYTEST_SUMMARY =
  /^(?:=+\s*)?((?:\d+ (?:passed|failed|errors?|skipped|xfailed|xpassed|deselected|warnings?|rerun)(?:, )?)+) in ([\d.]+)s(?: \([^)]*\))?(?:\s*=+)?$/;

/** Parse pytest's terminal summary (`FAILED a.py::t - msg`, `1 failed, 2 passed in 0.1s`). */
export function parsePytestOutput(text: string): TestReport | undefined {
  const lines = clean(text).split("\n");
  const summary = lines
    .map((line) => PYTEST_SUMMARY.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .at(-1);
  const failLines = lines
    .map((line) => /^(FAILED|ERROR)\s+(\S+?)(?:\s+-\s+(.*))?$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match));
  if (!summary && !failLines.some((match) => match[2]!.includes("::") || /\.py\b/.test(match[2]!)))
    return undefined;
  const failures: TestFailure[] = [];
  const seen = new Set<string>();
  for (const match of failLines) {
    const id = match[2]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const sep = id.indexOf("::");
    const file = sep > 0 ? id.slice(0, sep) : /\.py$/.test(id) ? id : undefined;
    const name = sep > 0 ? id.slice(sep + 2) : id;
    pushFailure(failures, {
      name: match[1] === "ERROR" && sep < 0 ? `${name} (collection error)` : name,
      ...(file ? { file } : {}),
      message: match[3],
    });
  }
  const seg = summary?.[1] ?? "";
  const failed = summary ? countFrom(seg, /failed/) + countFrom(seg, /errors?/) : failures.length;
  return {
    framework: "pytest",
    passed: countFrom(seg, /passed/) + countFrom(seg, /xpassed/),
    failed,
    skipped: countFrom(seg, /skipped/) + countFrom(seg, /xfailed/),
    ...(summary ? { durationMs: toMs(Number(summary[2]), "s") } : {}),
    failures,
  };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type TestOutputFormat = "go-json" | "cargo" | "vitest" | "jest" | "pytest" | "junit";

const TEXT_PARSERS: Array<[TestOutputFormat, (text: string) => TestReport | undefined]> = [
  ["go-json", parseGoTestJson],
  ["cargo", parseCargoTestOutput],
  ["pytest", parsePytestOutput],
  ["jest", parseJestOutput],
  ["vitest", parseVitestOutput],
  ["junit", parseJUnitXml],
];

/**
 * Parse captured test output. With `hint`, only that parser runs (falling
 * back to sniffing when it finds nothing); without it, the first parser that
 * recognizes the text wins.
 */
export function parseTestOutput(text: string, hint?: TestOutputFormat): TestReport | undefined {
  if (!text.trim()) return undefined;
  if (hint) {
    const parser = TEXT_PARSERS.find(([format]) => format === hint)?.[1];
    const report = parser?.(text);
    if (report) return report;
  }
  for (const [format, parser] of TEXT_PARSERS) {
    if (format === hint) continue;
    const report = parser(text);
    if (report) return report;
  }
  return undefined;
}
