import { setTimeout as delay } from "node:timers/promises";
import {
  WORKER_CLI_HEARTBEAT,
  WORKER_CLI_STREAM_END,
  WorkerCliStartError,
  type WorkerClient,
} from "@locus/worker";

const RECONNECT_WINDOW_MS = 2 * 60_000;
const STREAM_IDLE_MS = 25_000;

export class WorkerCliDisconnectError extends Error {}

export async function* workerCliLines(input: {
  client: Pick<WorkerClient, "openCursorCli" | "replayCursorCli">;
  guestId: string;
  runId: string;
  request: { command: string; args: string[]; apiKey?: string };
  signal: AbortSignal;
  reconnecting: (active: boolean) => void;
  retryDelayMs?: number;
}): AsyncGenerator<string> {
  const { client, guestId, runId, signal } = input;
  let replay = true;
  let connecting = true;
  let offset = 0;
  let reconnectUntil: number | undefined;
  let buf = "";
  const decoder = new TextDecoder();
  try {
    while (!signal.aborted) {
      const connection = new AbortController();
      const combined = AbortSignal.any([signal, connection.signal]);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let idle: ReturnType<typeof setTimeout> | undefined;
      let unavailable = false;
      const resetIdle = () => {
        clearTimeout(idle);
        if (replay) idle = setTimeout(() => connection.abort(), STREAM_IDLE_MS);
      };
      try {
        resetIdle();
        if (connecting) {
          connecting = false;
          const opened = await client.openCursorCli(guestId, { ...input.request, runId }, combined);
          replay = opened.replay;
          reader = opened.stream.getReader();
        } else {
          const opened = await client.replayCursorCli(guestId, runId, offset, combined);
          if (!opened.stream) {
            unavailable = true;
          } else {
            reader = opened.stream.getReader();
          }
        }
        if (reader) {
          while (!signal.aborted) {
            resetIdle();
            const { value, done } = await reader.read();
            clearTimeout(idle);
            if (done) break;
            if (reconnectUntil !== undefined) {
              reconnectUntil = undefined;
              input.reconnecting(false);
            }
            offset += value.byteLength;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split(/\r?\n/);
            buf = parts.pop() ?? "";
            for (const line of parts) {
              if (replay && line === WORKER_CLI_STREAM_END) return;
              if (!replay || line !== WORKER_CLI_HEARTBEAT) yield line;
            }
          }
        }
        if (!replay) {
          buf += decoder.decode();
          if (buf && !signal.aborted) yield buf;
          return;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (!replay || error instanceof WorkerCliStartError) throw error;
      } finally {
        clearTimeout(idle);
        await reader?.cancel().catch(() => undefined);
      }
      if (signal.aborted) return;
      if (unavailable)
        throw new WorkerCliDisconnectError(
          "The worker can no longer replay this CLI turn. Check the worker connection to recover.",
        );
      reconnectUntil ??= Date.now() + RECONNECT_WINDOW_MS;
      if (Date.now() >= reconnectUntil)
        throw new WorkerCliDisconnectError(
          "The worker did not reconnect. Check the worker connection to recover.",
        );
      input.reconnecting(true);
      await delay(input.retryDelayMs ?? 2000, undefined, { signal }).catch(() => undefined);
    }
  } finally {
    input.reconnecting(false);
  }
}
