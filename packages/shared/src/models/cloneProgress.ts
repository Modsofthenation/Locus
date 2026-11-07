export interface CloneProgress {
  percent: number;
  phase: string;
  done?: boolean;
  /** Git's own percent for the current phase (0–100). */
  phasePercent?: number;
  received?: number;
  total?: number;
  size?: string;
  rate?: string;
}

export const CLONE_WAIT_STATUS = "Waiting for the clone…";
export const CLONE_WAIT_HINT = "The agent is waiting for this clone before it starts";

export type CloneProgressDetail = Pick<
  CloneProgress,
  "received" | "rate" | "phasePercent" | "size" | "total"
>;

export function sameCloneProgressDetail(
  prev: CloneProgressDetail,
  next: CloneProgressDetail,
): boolean {
  return (
    next.received === prev.received &&
    (next.rate ?? "") === (prev.rate ?? "") &&
    next.phasePercent === prev.phasePercent &&
    (next.size ?? "") === (prev.size ?? "") &&
    next.total === prev.total
  );
}

const PHASE_WEIGHTS: Record<string, { start: number; span: number }> = {
  "Enumerating objects": { start: 0, span: 4 },
  "Counting objects": { start: 4, span: 6 },
  "Compressing objects": { start: 0, span: 10 },
  "Receiving objects": { start: 0, span: 80 },
  "Resolving deltas": { start: 80, span: 10 },
  "Filtering content": { start: 90, span: 10 },
  "Checking out files": { start: 90, span: 10 },
  "Updating files": { start: 90, span: 10 },
};

const PHASES =
  "Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Checking out files|Updating files|Filtering content";

const PHASE_RE = new RegExp(
  `(?:remote:\\s+)?(${PHASES}):\\s+(?:(\\d+)%(?:\\s+\\((\\d+)/(\\d+)\\))?(?:,\\s*(.+))?|(\\d+)(?:,\\s*done\\.?)?)`,
  "i",
);

const THROUGHPUT_RE = /([\d.]+\s+[KMGTPE]?i?B)\s*\|\s*([\d.]+\s+[KMGTPE]?i?B\/s)/i;

export function parseGitCloneProgress(chunk: string): CloneProgress | undefined {
  if (!chunk) return undefined;
  let last: CloneProgress | undefined;
  for (const line of chunk.replace(/\r/g, "\n").split("\n")) {
    const parsed = parseGitCloneProgressLine(line);
    if (!parsed) continue;
    last = {
      ...parsed,
      percent: last ? Math.max(last.percent, parsed.percent) : parsed.percent,
    };
  }
  return last;
}

function parseGitCloneProgressLine(line: string): CloneProgress | undefined {
  const match = line.trim().match(PHASE_RE);
  if (!match) return undefined;
  const phase = canonicalPhase(match[1]!);
  const weight = PHASE_WEIGHTS[phase];
  const countOnly = match[6];
  if (countOnly != null && match[2] == null) {
    const total = Number(countOnly);
    const mapped = weight ? Math.max(1, weight.start) : 1;
    return {
      percent: mapped,
      phase,
      total: Number.isFinite(total) ? total : undefined,
    };
  }
  const phasePercent = Math.min(100, Math.max(0, Number(match[2])));
  const received = match[3] != null ? Number(match[3]) : undefined;
  const total = match[4] != null ? Number(match[4]) : undefined;
  const mapped = weight
    ? Math.min(100, Math.round(weight.start + (phasePercent / 100) * weight.span))
    : phasePercent;
  const throughput = parseThroughput(match[5]);
  return {
    percent: mapped,
    phase,
    phasePercent,
    received: Number.isFinite(received) ? received : undefined,
    total: Number.isFinite(total) ? total : undefined,
    size: throughput?.size,
    rate: throughput?.rate,
  };
}

function canonicalPhase(raw: string): string {
  for (const name of Object.keys(PHASE_WEIGHTS)) {
    if (name.toLowerCase() === raw.toLowerCase()) return name;
  }
  return raw;
}

function parseThroughput(rest: string | undefined): { size?: string; rate?: string } | undefined {
  if (!rest) return undefined;
  const cleaned = rest.replace(/,?\s*done\.?\s*$/i, "").trim();
  if (!cleaned) return undefined;
  const match = cleaned.match(THROUGHPUT_RE);
  if (!match) return undefined;
  return {
    size: match[1]!.replace(/\s+/g, " ").trim(),
    rate: match[2]!.replace(/\s+/g, " ").trim(),
  };
}

export function formatCloneProgressPhase(progress: CloneProgress): string {
  if (progress.done) return "Done";
  const parts: string[] = [
    progress.phasePercent != null ? `${progress.phase} ${progress.phasePercent}%` : progress.phase,
  ];
  if (progress.received != null && progress.total != null && progress.total > 0) {
    parts.push(`${formatCloneCount(progress.received)}/${formatCloneCount(progress.total)}`);
  } else if (progress.total != null && progress.total > 0 && progress.received == null) {
    parts.push(`${formatCloneCount(progress.total)} objects`);
  }
  if (progress.size) parts.push(progress.size);
  if (progress.rate) parts.push(progress.rate);
  return parts.join(" · ");
}

function formatCloneCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function isCloneWaiting(progress: CloneProgress | undefined): boolean {
  return Boolean(progress && !progress.done);
}

export function isCloneStartNote(content: string): boolean {
  return content.startsWith("Cloning ");
}

export function latestCloneStartMessageId(
  messages: Array<{ id: string; role: string; content: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "system" && isCloneStartNote(message.content)) return message.id;
  }
  return undefined;
}

export function cloneStartProgress(): CloneProgress {
  return { percent: 0, phase: "Starting" };
}

export function cloneDoneProgress(): CloneProgress {
  return { percent: 100, phase: "Done", done: true };
}
