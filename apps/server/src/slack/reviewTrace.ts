import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  appendSlackReviewTraceStep,
  finishSlackReviewTraceTool,
  isSlackReviewTraceId,
  slackReviewTraceArgs,
  SLACK_REVIEW_TRACE_LIMITS,
  type SlackReviewTrace,
} from "@locus/shared";
import type { ChatEvent, OneShotTraceEvent } from "@locus/providers";

/**
 * Collects one run's trace while it runs. Settings reads it live through the service; when the run
 * ends it is written to `<dir>/<id>.json` and the oldest files past the cap are removed.
 */
export class SlackReviewTraceRecorder {
  readonly trace: SlackReviewTrace;

  constructor(
    init: Pick<SlackReviewTrace, "reviewerId" | "pr" | "kind">,
    private readonly now: () => number = Date.now,
  ) {
    this.trace = { id: randomUUID(), ...init, startedAt: this.stamp(), steps: [] };
  }

  get id(): string {
    return this.trace.id;
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  setModel(model: string): void {
    this.trace.model = model;
  }

  prompt(text: string): void {
    appendSlackReviewTraceStep(this.trace, { kind: "prompt", text, at: this.stamp() });
  }

  note(text: string): void {
    appendSlackReviewTraceStep(this.trace, { kind: "note", text, at: this.stamp() });
  }

  /** A provider event from an API model: reasoning and reply text. Tool calls go through `toolCall`. */
  event(event: ChatEvent): void {
    if (event.type === "reasoning" && event.text) {
      appendSlackReviewTraceStep(this.trace, {
        kind: "thinking",
        text: event.text,
        at: this.stamp(),
      });
    } else if (event.type === "text" && event.text) {
      appendSlackReviewTraceStep(this.trace, { kind: "text", text: event.text, at: this.stamp() });
    }
  }

  /** A CLI agent's reasoning and tool activity, from `completeOneShot`'s `onTrace`. */
  cli(event: OneShotTraceEvent): void {
    if (event.type === "reasoning") {
      this.event(event);
    } else if (event.type === "tool_call") {
      this.toolCall(event);
    } else {
      this.toolResult({ id: event.id, tool: event.name, output: event.output });
    }
  }

  toolCall(call: { id: string; name: string; arguments?: Record<string, unknown> }): void {
    const args = slackReviewTraceArgs(call.arguments);
    appendSlackReviewTraceStep(this.trace, {
      kind: "tool",
      id: call.id,
      tool: call.name,
      ...(args ? { args } : {}),
      at: this.stamp(),
    });
  }

  toolResult(result: { id: string; tool?: string; output: string; refused?: boolean }): void {
    finishSlackReviewTraceTool(this.trace, { ...result, at: this.stamp() });
  }

  finish(): SlackReviewTrace {
    this.trace.finishedAt ??= this.stamp();
    return this.trace;
  }
}

/** Write a finished trace and keep at most `maxFiles` on disk, dropping the oldest. */
export async function saveSlackReviewTrace(
  dir: string,
  trace: SlackReviewTrace,
  maxFiles: number = SLACK_REVIEW_TRACE_LIMITS.maxFiles,
): Promise<void> {
  if (!isSlackReviewTraceId(trace.id)) return;
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${trace.id}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  const { live: _live, ...row } = trace;
  await writeFile(tmp, JSON.stringify(row));
  await rename(tmp, path);
  await pruneSlackReviewTraces(dir, maxFiles).catch(() => undefined);
}

async function pruneSlackReviewTraces(dir: string, maxFiles: number): Promise<void> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  if (names.length <= maxFiles) return;
  const dated = await Promise.all(
    names.map(async (name) => ({
      name,
      mtime: await stat(join(dir, name))
        .then((row) => row.mtimeMs)
        .catch(() => 0),
    })),
  );
  dated.sort((a, b) => a.mtime - b.mtime);
  for (const row of dated.slice(0, dated.length - maxFiles)) {
    await unlink(join(dir, row.name)).catch(() => undefined);
  }
}

/** A saved trace, or undefined when the id is malformed, unknown, or pruned. */
export async function loadSlackReviewTrace(
  dir: string,
  id: string,
): Promise<SlackReviewTrace | undefined> {
  if (!isSlackReviewTraceId(id)) return undefined;
  try {
    const raw = JSON.parse(await readFile(join(dir, `${id}.json`), "utf8")) as SlackReviewTrace;
    return raw && Array.isArray(raw.steps) ? raw : undefined;
  } catch {
    return undefined;
  }
}
