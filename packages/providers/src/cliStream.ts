export type CliExit = { code: number; stderr: string };

export type CliProcessHandle = {
  lines: AsyncIterable<string>;
  wait(): Promise<CliExit>;
  kill?: () => void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export async function reapCliProcess(
  handle: Pick<CliProcessHandle, "wait" | "kill">,
  killAfterMs: number,
  hungMessage: string,
): Promise<CliExit> {
  const exited = handle.wait();
  const winner = await Promise.race([exited, delay(killAfterMs).then(() => "timeout" as const)]);
  if (winner !== "timeout") return winner;
  handle.kill?.();
  return Promise.race([exited, delay(2_000).then(() => ({ code: 1, stderr: hungMessage }))]);
}

/** Shared spawn → lines → reap → done harness. Per-CLI parse stays in the adapter. */
export async function* streamCliLines<TEvent>(opts: {
  command: string;
  handle: Pick<CliProcessHandle, "lines" | "kill">;
  signal?: AbortSignal;
  rewriteError: (err: unknown, command: string) => unknown;
  onLine: (line: string) => { events: TEvent[]; stop?: boolean };
  reap: () => Promise<CliExit>;
  failedExit?: (done: CliExit) => TEvent | undefined;
  doneEvent: TEvent;
}): AsyncGenerator<TEvent> {
  let sawTerminal = false;
  try {
    for await (const line of opts.handle.lines) {
      if (opts.signal?.aborted) break;
      const { events, stop } = opts.onLine(line);
      for (const event of events) yield event;
      if (stop) {
        sawTerminal = true;
        break;
      }
    }
    const done = await opts.reap();
    if (!sawTerminal && !opts.signal?.aborted) {
      const fail = opts.failedExit?.(done);
      if (fail) yield fail;
    }
    yield opts.doneEvent;
  } catch (err) {
    throw opts.rewriteError(err, opts.command);
  } finally {
    opts.handle.kill?.();
  }
}
