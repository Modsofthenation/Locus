import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  clipTraceDetail,
  evalCaseFromTrace,
  formatTraceLine,
  redactKnownSecrets,
  redactedTraceArgs,
  replayTrace,
  type TraceEvalCase,
  type TraceEvent,
} from "@locus/shared";

const queues = new Map<string, Promise<void>>();

function enqueue(path: string, work: () => Promise<void>): Promise<void> {
  const prev = queues.get(path) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(work);
  queues.set(path, next);
  return next;
}

export function tracePath(dataDir: string, sessionId: string): string {
  const id = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "session";
  return join(dataDir, "traces", `${id}.jsonl`);
}

export class SessionTraceLog {
  constructor(private readonly dataDir: string) {}

  async write(event: TraceEvent): Promise<void> {
    const path = tracePath(this.dataDir, event.sessionId);
    const line = formatTraceLine({
      ...event,
      t: event.t || new Date().toISOString(),
      detail: event.detail ? clipTraceDetail(redactKnownSecrets(event.detail)) : undefined,
      args: event.args ? redactedTraceArgs(event.args) : undefined,
    });
    await enqueue(path, async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await appendFile(path, line, { mode: 0o600 });
    });
  }

  async readAll(): Promise<TraceEvent[]> {
    const listed = await this.list();
    const events: TraceEvent[] = [];
    for (const row of listed) {
      events.push(...(await this.read(row.sessionId)));
    }
    return events;
  }

  async read(sessionId: string): Promise<TraceEvent[]> {
    const path = tracePath(this.dataDir, sessionId);
    try {
      return replayTrace(await readFile(path, "utf8"));
    } catch {
      return [];
    }
  }

  async list(): Promise<Array<{ sessionId: string; path: string; bytes: number; mtime: string }>> {
    const dir = join(this.dataDir, "traces");
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return [];
    }
    const rows: Array<{ sessionId: string; path: string; bytes: number; mtime: string }> = [];
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const sessionId = name.slice(0, -".jsonl".length);
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (!info.isFile()) continue;
        rows.push({
          sessionId,
          path,
          bytes: info.size,
          mtime: info.mtime.toISOString(),
        });
      } catch {
        /* skip unreadable files */
      }
    }
    return rows.sort((a, b) => b.mtime.localeCompare(a.mtime));
  }
}

export function evalFixturePath(dataDir: string, sessionId: string, stamp = Date.now()): string {
  const id = sessionId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "session";
  return join(dataDir, "evals", `${id}-${stamp}.json`);
}

export async function writeEvalFixture(
  dataDir: string,
  events: TraceEvent[],
  opts?: { path?: string },
): Promise<{ path: string; fixture: TraceEvalCase }> {
  const fixture = evalCaseFromTrace(events);
  const path = opts?.path ?? evalFixturePath(dataDir, fixture.sessionId || "session");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  return { path, fixture };
}

export async function saveFailedEval(
  dataDir: string,
  sessionId: string,
  events: TraceEvent[],
): Promise<{ path: string; fixture: TraceEvalCase } | undefined> {
  const turnEvents = events.filter((event) => event.sessionId === sessionId);
  const fixture = evalCaseFromTrace(turnEvents);
  if (!fixture.failed) return undefined;
  return writeEvalFixture(dataDir, turnEvents, { path: evalFixturePath(dataDir, sessionId) });
}
