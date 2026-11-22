import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentTerminalRegistry,
  type AgentTerminalClient,
  type AgentTerminalResolution,
  type AgentTerminalTarget,
} from "./agentTerminals.js";

type FakeChild = ChildProcess & {
  stdout: PassThrough;
  stdin: PassThrough;
  written: string[];
  emitOut(text: string): void;
};

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const written: string[] = [];
  stdin.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  Object.assign(child, {
    stdout,
    stderr: new PassThrough(),
    stdin,
    pid: undefined,
    killed: false,
    written,
    kill: vi.fn(() => {
      (child as { killed: boolean }).killed = true;
      return true;
    }),
    emitOut(text: string) {
      stdout.emit("data", Buffer.from(text));
    },
  });
  return child;
}

class FakeSocket extends EventEmitter implements AgentTerminalClient {
  readyState = 1;
  sent: string[] = [];
  closed?: { code?: number; reason?: string };
  send(data: Buffer | string) {
    this.sent.push(typeof data === "string" ? data : data.toString("utf8"));
  }
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closed = { code, reason };
  }
  type(text: string) {
    this.emit("message", Buffer.from(text));
  }
}

function setup(
  over: Partial<ConstructorParameters<typeof AgentTerminalRegistry>[0]> = {},
  resolution: AgentTerminalResolution = {
    target: { runtime: "host", cwd: "/tmp/ws" },
    defaultPreset: "claude",
  },
) {
  const children: FakeChild[] = [];
  const spawned: Array<{ target: AgentTerminalTarget; command: string | null }> = [];
  const attention = { flag: vi.fn(), clear: vi.fn() };
  const registry = new AgentTerminalRegistry({
    resolve: async () => resolution,
    spawn: (target, command) => {
      spawned.push({ target, command });
      const child = fakeChild();
      children.push(child);
      return child;
    },
    attention,
    cooked: false,
    ...over,
  });
  return { registry, children, spawned, attention };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AgentTerminalRegistry", () => {
  it("spawns the provider default in the workspace and honours a command override", async () => {
    const { registry, spawned } = setup();
    await registry.attach(new FakeSocket(), "s1", "a");
    await registry.attach(new FakeSocket(), "s1", "b", "aider --no-git");
    await registry.attach(new FakeSocket(), "s1", "c", "shell");
    expect(spawned).toEqual([
      { target: { runtime: "host", cwd: "/tmp/ws" }, command: "claude" },
      { target: { runtime: "host", cwd: "/tmp/ws" }, command: "aider --no-git" },
      { target: { runtime: "host", cwd: "/tmp/ws" }, command: null },
    ]);
    expect(registry.list("s1").map((row) => row.label)).toEqual([
      "Claude Code",
      "aider --no-git",
      "Shell",
    ]);
  });

  it("keeps the process across reconnects and replays scrollback", async () => {
    const { registry, children, spawned } = setup();
    const first = new FakeSocket();
    await registry.attach(first, "s1", "a");
    children[0]!.emitOut("hello ");
    children[0]!.emitOut("world");
    expect(first.sent.join("")).toBe("hello world");
    first.emit("close");

    const second = new FakeSocket();
    await registry.attach(second, "s1", "a", "codex");
    expect(spawned).toHaveLength(1);
    expect(second.sent.join("")).toBe("hello world");
    second.type("y\r");
    expect(children[0]!.written.join("")).toBe("y\r");
  });

  it("caps the replay buffer", async () => {
    const { registry, children } = setup({ historyBytes: 8 });
    await registry.attach(new FakeSocket(), "s1", "a");
    children[0]!.emitOut("0123456789abcdef");
    const late = new FakeSocket();
    await registry.attach(late, "s1", "a");
    expect(late.sent.join("")).toBe("89abcdef");
  });

  it("refuses a terminal past the per-session cap", async () => {
    const { registry, spawned } = setup({ max: 2 });
    await registry.attach(new FakeSocket(), "s1", "a");
    await registry.attach(new FakeSocket(), "s1", "b");
    const third = new FakeSocket();
    await registry.attach(third, "s1", "c");
    expect(third.closed).toEqual({ code: 1013, reason: "limit" });
    await registry.attach(new FakeSocket(), "s2", "a");
    expect(spawned).toHaveLength(3);
  });

  it("closes with the runtime reason when there is no target", async () => {
    const { registry, spawned } = setup(
      {},
      { reason: "Terminal mode is not available for VM sessions.", defaultPreset: "shell" },
    );
    const ws = new FakeSocket();
    await registry.attach(ws, "s1", "a");
    expect(spawned).toHaveLength(0);
    expect(ws.closed?.reason).toMatch(/VM sessions/);
    expect((await registry.status("s1")).available).toBe(false);
  });

  it("kills one terminal on close and all of a session's on delete", async () => {
    const { registry, children } = setup();
    const ws = new FakeSocket();
    await registry.attach(ws, "s1", "a");
    await registry.attach(new FakeSocket(), "s1", "b");
    await registry.attach(new FakeSocket(), "s2", "a");
    expect(registry.close("s1", "a")).toBe(true);
    expect(children[0]!.kill).toHaveBeenCalled();
    expect(ws.closed?.code).toBe(1000);
    expect(registry.close("s1", "a")).toBe(false);

    registry.closeSession("s1");
    expect(children[1]!.kill).toHaveBeenCalled();
    expect(children[2]!.kill).not.toHaveBeenCalled();
    expect(registry.list("s1")).toEqual([]);
    expect(registry.list("s2")).toHaveLength(1);
  });

  it("drops the entry when the process exits so the id can respawn", async () => {
    const { registry, children, spawned } = setup();
    const ws = new FakeSocket();
    await registry.attach(ws, "s1", "a");
    children[0]!.emit("close", 0);
    expect(ws.sent.join("")).toContain("[exited 0]");
    expect(ws.closed?.reason).toBe("exited");
    await registry.attach(new FakeSocket(), "s1", "a");
    expect(spawned).toHaveLength(2);
  });

  it("flags Needs you when an agent CLI goes quiet on a prompt, and clears on a keystroke", async () => {
    vi.useFakeTimers();
    const { registry, children, attention } = setup({ quietMs: 8000 });
    const ws = new FakeSocket();
    await registry.attach(ws, "s1", "a");
    const child = children[0]!;

    // Start-up prompt before the person asked anything does not count.
    child.emitOut("Welcome\r\n> ");
    vi.advanceTimersByTime(9000);
    expect(attention.flag).not.toHaveBeenCalled();

    ws.type("fix the tests\r");
    child.emitOut("Editing src/app.ts\r\n");
    vi.advanceTimersByTime(4000);
    child.emitOut("Do you want to make this edit to src/app.ts?\r\n");
    vi.advanceTimersByTime(7999);
    expect(attention.flag).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(attention.flag).toHaveBeenCalledWith(
      "s1",
      "Do you want to make this edit to src/app.ts?",
    );
    expect(registry.list("s1")[0]?.waiting).toBe(true);

    ws.type("1");
    expect(attention.clear).toHaveBeenCalledWith("s1");
    expect(registry.list("s1")[0]?.waiting).toBeUndefined();
  });

  it("does not flag quiet non-prompt output or a bare shell", async () => {
    vi.useFakeTimers();
    const { registry, children, attention } = setup();
    const agent = new FakeSocket();
    await registry.attach(agent, "s1", "a");
    agent.type("go\r");
    children[0]!.emitOut("Compiling…\r\n");
    vi.advanceTimersByTime(10_000);

    const shell = new FakeSocket();
    await registry.attach(shell, "s1", "b", "shell");
    shell.type("ls\r");
    children[1]!.emitOut("README.md\r\n❯ ");
    vi.advanceTimersByTime(10_000);
    expect(attention.flag).not.toHaveBeenCalled();
  });

  it("ignores resize frames as input", async () => {
    const { registry, children } = setup();
    const ws = new FakeSocket();
    await registry.attach(ws, "s1", "a");
    ws.type('{"type":"resize","cols":100,"rows":30}');
    expect(children[0]!.written).toEqual([]);
  });
});
