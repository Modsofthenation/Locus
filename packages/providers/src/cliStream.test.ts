import { describe, expect, it } from "vitest";
import { reapCliProcess, streamCliLines, type CliProcessHandle } from "./cliStream.js";

function handle(
  lines: string[],
  exit: { code: number; stderr: string } = { code: 0, stderr: "" },
): CliProcessHandle {
  return {
    lines: (async function* () {
      for (const line of lines) yield line;
    })(),
    wait: async () => exit,
  };
}

describe("CLI Turn stream harness", () => {
  it("yields parsed events, then done", async () => {
    const events: string[] = [];
    for await (const event of streamCliLines({
      command: "cursor",
      handle: handle(["a", "b"]),
      rewriteError: (err) => err,
      onLine: (line) => ({ events: [line], stop: line === "b" }),
      reap: async () => ({ code: 0, stderr: "" }),
      doneEvent: "done",
    })) {
      events.push(event);
    }
    expect(events).toEqual(["a", "b", "done"]);
  });

  it("emits a failed-exit event when the process dies without a terminal line", async () => {
    type StreamEvent = { type: string; message?: string };
    const events: StreamEvent[] = [];
    for await (const event of streamCliLines<StreamEvent>({
      command: "cursor",
      handle: handle(["noise"], { code: 1, stderr: "boom" }),
      rewriteError: (err) => err,
      onLine: (line) => ({ events: [{ type: "text", message: line }] }),
      reap: async () => ({ code: 1, stderr: "boom" }),
      failedExit: (done) => ({ type: "error", message: done.stderr }),
      doneEvent: { type: "done" },
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "text", message: "noise" },
      { type: "error", message: "boom" },
      { type: "done" },
    ]);
  });

  it("reaps a process that already exited", async () => {
    const proc = handle([], { code: 0, stderr: "" });
    await expect(reapCliProcess(proc, 50, "did not exit")).resolves.toEqual({
      code: 0,
      stderr: "",
    });
  });
});
