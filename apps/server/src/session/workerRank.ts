import { collectText, type ChatEvent, type CompleteRequest } from "@locus/providers";
import {
  evidenceWorkerRank,
  formatWorkerRankPrompt,
  parseWorkerRank,
  type AiProvider,
  type WorkerAttempt,
  type WorkerRanking,
} from "@locus/shared";

export const WORKER_RANK_TIMEOUT_MS = 60_000;

export type WorkerRankComplete = (req: CompleteRequest) => AsyncIterable<ChatEvent>;

/**
 * Order parallel attempts at one task by evidence first (tests, lint/typecheck, files
 * outside scope), then let a model break ties within a tier and explain the order.
 * Without an API model, or when the call fails or does not parse, ties fall to the
 * smaller diff, then the lower cost.
 */
export async function rankWorkerAttempts(input: {
  task: string;
  attempts: WorkerAttempt[];
  picked?: { provider: AiProvider; model: string };
  complete: WorkerRankComplete;
  signal?: AbortSignal;
}): Promise<WorkerRanking> {
  const { attempts, picked } = input;
  if (attempts.length < 2 || !picked) return evidenceWorkerRank(attempts);
  try {
    const text = await collectText(
      input.complete({
        provider: picked.provider,
        model: picked.model,
        system:
          "You review competing code changes for the same task and pick the best. Reply with JSON only.",
        messages: [
          {
            id: "worker-rank",
            role: "user",
            content: formatWorkerRankPrompt(input.task, attempts),
            createdAt: new Date().toISOString(),
          },
        ],
        allowedTools: [],
        stream: false,
        maxTokens: 800,
        signal: input.signal ?? AbortSignal.timeout(WORKER_RANK_TIMEOUT_MS),
      }),
    );
    return evidenceWorkerRank(attempts, parseWorkerRank(text, attempts));
  } catch {
    return evidenceWorkerRank(attempts);
  }
}
