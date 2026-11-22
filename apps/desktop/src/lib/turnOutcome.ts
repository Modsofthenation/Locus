import {
  canonicalToolCall,
  isTestCommand,
  parseAnyReviewVerdict,
  type AgentVerdict,
  patchFilesFromTool,
  rewindTargets,
  toolCallCommand as commandOf,
  toolCallPassed as callPassed,
  workspaceChangesFromMessages,
  type AgentSession,
  type ChatMessage,
  type PatchFile,
  type TokenUsage,
  type WorkspaceFileChange,
} from "@locus/shared";
import { prUrlFromToolOutput } from "./markdown";

export type TurnTestRun = {
  command: string;
  passed: boolean;
};

export type TurnOutcome = {
  /** Last assistant message of the turn; the card renders under it. */
  assistantId: string;
  files: WorkspaceFileChange[];
  /** Parsed patches from this turn's edit calls, for the Change Stack walkthrough. */
  patches: PatchFile[];
  commands: number;
  tests: TurnTestRun[];
  prUrl?: string;
  /** Checkpoint taken just before this turn's prompt. Rewinding to it undoes the turn. */
  undoCheckpointId?: string;
  /** Tokens summed over every model call in the turn. */
  usage?: TokenUsage;
  /** Wall time from the prompt to the last reply or tool finish, in ms. */
  durationMs?: number;
  /** Review verdict `{ verdict, reasons, risk }` emitted this turn. */
  verdict?: AgentVerdict;
};

export { isTestCommand };

function lastUserIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

/**
 * What the latest finished turn did: files it changed, commands and tests it ran,
 * a PR it opened, and the checkpoint that undoes it. Undefined while the turn is
 * still running, or when the turn only talked (nothing worth a summary card).
 */
export function latestTurnOutcome(
  session: Pick<AgentSession, "messages" | "status" | "checkpoint" | "checkpoints">,
): TurnOutcome | undefined {
  if (session.status === "running" || session.status === "provisioning") return undefined;
  const messages = session.messages;
  const start = lastUserIndex(messages);
  if (start < 0) return undefined;
  const turn = messages.slice(start + 1);
  let assistantId: string | undefined;
  for (let i = turn.length - 1; i >= 0; i--) {
    const row = turn[i]!;
    if (row.role === "assistant" && (row.content.trim() || row.toolCalls?.length)) {
      assistantId = row.id;
      break;
    }
  }
  if (!assistantId) return undefined;

  let commands = 0;
  const tests: TurnTestRun[] = [];
  const patches: PatchFile[] = [];
  let prUrl: string | undefined;
  const seen = new Set<string>();
  let input = 0;
  let output = 0;
  let cached = 0;
  let lastAt = Date.parse(messages[start]!.createdAt);
  const startAt = lastAt;
  const later = (iso?: string) => {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(t) && t > lastAt) lastAt = t;
  };
  for (const message of turn) {
    later(message.createdAt);
    if (message.role === "assistant" && message.usage) {
      input += message.usage.inputTokens;
      output += message.usage.outputTokens;
      cached += message.usage.cachedInputTokens ?? 0;
    }
    for (const call of message.toolCalls ?? []) {
      // A tool-result message repeats its call; count each call id once.
      if (seen.has(call.id)) continue;
      seen.add(call.id);
      if (!call.finishedAt && call.result === undefined && !call.error) {
        // A call still waiting (approval or otherwise) means the turn is not done.
        return undefined;
      }
      const command = commandOf(call);
      if (command) {
        commands += 1;
        if (isTestCommand(command)) tests.push({ command, passed: callPassed(call) });
      }
      if (callPassed(call)) {
        const canon = canonicalToolCall(call.name, call.arguments);
        if (canon.name === "apply_patch") {
          patches.push(...patchFilesFromTool("apply_patch", canon.arguments, call.result));
        }
      }
      later(call.finishedAt);
      if (call.name === "git_pr") {
        prUrl = prUrlFromToolOutput(call.result ?? "") ?? prUrl;
      }
    }
  }
  const files = workspaceChangesFromMessages(turn);
  const verdict = parseAnyReviewVerdict(turn);
  if (!files.length && !tests.length && !prUrl && !verdict) return undefined;

  const checkpoint = rewindTargets(session)
    .filter((row) => row.messageCount === start)
    .at(-1);

  return {
    assistantId,
    files,
    patches,
    commands,
    tests,
    prUrl,
    undoCheckpointId: checkpoint?.id,
    usage:
      input || output
        ? {
            inputTokens: input,
            outputTokens: output,
            ...(cached ? { cachedInputTokens: cached } : {}),
          }
        : undefined,
    durationMs: Number.isFinite(startAt) && lastAt > startAt ? lastAt - startAt : undefined,
    ...(verdict ? { verdict } : {}),
  };
}

/** "42s", "3m 05s", "1h 02m" */
export function formatTurnDuration(ms?: number): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 1000) return undefined;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** "3 files changed · +40 −12" */
export function turnOutcomeHeadline(outcome: Pick<TurnOutcome, "files" | "verdict">): string {
  const n = outcome.files.length;
  if (!n) return outcome.verdict ? "Review" : "No file changes";
  let add = 0;
  let del = 0;
  for (const file of outcome.files) {
    add += file.additions ?? 0;
    del += file.deletions ?? 0;
  }
  const label = n === 1 ? "1 file changed" : `${n} files changed`;
  return add || del ? `${label} · +${add} −${del}` : label;
}

/** "Tests passed", "1 of 2 test runs failed", or undefined when no tests ran. */
export function turnTestsLabel(tests: TurnTestRun[]): { text: string; ok: boolean } | undefined {
  if (!tests.length) return undefined;
  // The last run of each command is the one that counts (agents re-run after a fix).
  const latest = new Map<string, boolean>();
  for (const run of tests) latest.set(run.command, run.passed);
  const runs = [...latest.values()];
  const failed = runs.filter((ok) => !ok).length;
  if (!failed)
    return {
      text: runs.length === 1 ? "Tests passed" : `${runs.length} test runs passed`,
      ok: true,
    };
  if (runs.length === 1) return { text: "Tests failed", ok: false };
  return { text: `${failed} of ${runs.length} test runs failed`, ok: false };
}

/**
 * Parent session a worktree worker merges into, for the summary card's Merge.
 * Parallel workers point at their parent through the compare group.
 */
export function worktreeMergeParent(
  session: Pick<AgentSession, "worktree" | "compare">,
): string | undefined {
  const group = session.compare;
  if (!session.worktree || group?.kind !== "workers" || group.role === "parent") return undefined;
  return group.parentId || undefined;
}
