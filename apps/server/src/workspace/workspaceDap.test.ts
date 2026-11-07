import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { listenOrKillDebugpy, parseDebugpyListen, waitDebugpyListen } from "./workspaceDap.js";

class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  killed: NodeJS.Signals | boolean | undefined;
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? true;
    return true;
  }
}

describe("parseDebugpyListen", () => {
  it("reads a labeled loopback listen line", () => {
    expect(parseDebugpyListen("Listening for debugpy client at 127.0.0.1:5678")).toEqual({
      host: "127.0.0.1",
      port: 5678,
    });
  });

  it("ignores a public IP:port in early logs", () => {
    expect(parseDebugpyListen("connecting 8.8.8.8:53")).toBeUndefined();
  });

  it("accepts a bare loopback endpoint as fallback", () => {
    expect(parseDebugpyListen("debug adapter 127.0.0.1:9123")).toEqual({
      host: "127.0.0.1",
      port: 9123,
    });
  });
});

describe("waitDebugpyListen", () => {
  it("resolves from stderr and times out without a listen line", async () => {
    const child = new FakeChild();
    const pending = waitDebugpyListen(
      child as unknown as Parameters<typeof waitDebugpyListen>[0],
      40,
    );
    child.stderr.emit("data", Buffer.from("Listening for debugpy client at 127.0.0.1:5999"));
    await expect(pending).resolves.toEqual({ host: "127.0.0.1", port: 5999 });

    const quiet = new FakeChild();
    await expect(
      waitDebugpyListen(quiet as unknown as Parameters<typeof waitDebugpyListen>[0], 30),
    ).rejects.toThrow(/did not start listening/);
  });

  it("kills the child when listen fails", async () => {
    const child = new FakeChild();
    await expect(
      listenOrKillDebugpy(child as unknown as Parameters<typeof listenOrKillDebugpy>[0], 20),
    ).rejects.toThrow(/did not start listening/);
    expect(child.killed).toBe("SIGKILL");
  });
});
