import { describe, expect, it, vi } from "vitest";
import { WORKER_CLI_HEARTBEAT, WORKER_CLI_STREAM_END } from "@locus/worker";
import { workerCliLines } from "./workerCliConnection.js";

describe("worker CLI reconnect", () => {
  it("resumes byte-exactly through a split UTF-8 character and starts the command once", async () => {
    const first = Buffer.from("abc\ncafé\n");
    const offset = first.indexOf(0xc3) + 1;
    let read = false;
    const openCursorCli = vi.fn(async () => ({
      replay: true,
      stream: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (!read) controller.enqueue(first.subarray(0, offset));
            else controller.error(new Error("temporary disconnect"));
            read = true;
          },
        },
        { highWaterMark: 0 },
      ),
    }));
    const replayCursorCli = vi.fn(async () => ({
      stream: new Blob([
        Uint8Array.from(first.subarray(offset)),
        `${WORKER_CLI_HEARTBEAT}\n${WORKER_CLI_STREAM_END}\n`,
      ]).stream(),
    }));
    const reconnecting = vi.fn();
    const lines: string[] = [];
    for await (const line of workerCliLines({
      client: { openCursorCli, replayCursorCli },
      guestId: "guest",
      runId: "run",
      request: { command: "codex", args: [] },
      signal: new AbortController().signal,
      reconnecting,
      retryDelayMs: 0,
    }))
      lines.push(line);

    expect(lines).toEqual(["abc", "café"]);
    expect(openCursorCli).toHaveBeenCalledTimes(1);
    expect(replayCursorCli).toHaveBeenCalledWith("guest", "run", offset, expect.any(AbortSignal));
    expect(reconnecting).toHaveBeenCalledWith(true);
    expect(reconnecting).toHaveBeenLastCalledWith(false);
  });
});
