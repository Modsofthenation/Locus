import {
  canonicalToolCall,
  parseExitCode,
  patchFilesFromTool,
  rewindTargets,
  workspaceChangesFromMessages,
  type AgentSession,
  type ChatMessage,
  type PatchFile,
  type ToolCall,
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
};

const TEST_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w-]+)?|npx\s+(?:vitest|jest|playwright\s+test)|vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|rspec|mix\s+test|phpunit|(?:\.\/)?gradlew?\s+(?:\S+\s+)*test|mvn\s+(?:\S+\s+)*test|make\s+(?:check|test))\b/i;

/** True when a shell command looks like it runs a test suite. */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

function commandOf(call: ToolCall): string | undefined {
  const canon = canonicalToolCall(call.name, call.arguments);
  if (canon.name !== "exec" && canon.name !== "powershell") return undefined;
  const command = canon.arguments.command;
  return typeof command === "string" && command.trim() ? command.trim() : undefined;
}

function callPassed(call: ToolCall): boolean {
  if (call.error) return false;
  if (call.approval === "denied") return false;
  const code = parseExitCode(call.result);
  return code === undefined || code === 0;
}

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
  for (const message of turn) {
    for (const call of message.toolCalls ?? []) {
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
      if (call.name === "git_pr") {
        prUrl = prUrlFromToolOutput(call.result ?? "") ?? prUrl;
      }
    }
  }
  const files = workspaceChangesFromMessages(turn);
  if (!files.length && !tests.length && !prUrl) return undefined;

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
  };
}

/** "3 files changed · +40 −12" */
export function turnOutcomeHeadline(outcome: Pick<TurnOutcome, "files">): string {
  const n = outcome.files.length;
  if (!n) return "No file changes";
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
