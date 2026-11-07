import { describe, expect, it } from "vitest";
import {
  createWindowsCookedLine,
  hostShellCommand,
  parsePtyResize,
  spawnHostShell,
} from "./hostShell.js";

describe("hostShellCommand", () => {
  it("uses script -qefc on Linux so the workspace shell has a PTY", () => {
    expect(hostShellCommand("linux", { SHELL: "/bin/zsh" })).toEqual({
      cmd: "script",
      args: ["-qefc", "/bin/zsh -i", "/dev/null"],
    });
  });

  it("uses macOS script flags", () => {
    expect(hostShellCommand("darwin", { SHELL: "/bin/bash" })).toEqual({
      cmd: "script",
      args: ["-q", "/dev/null", "/bin/bash", "-i"],
    });
  });

  it("uses ComSpec on Windows", () => {
    expect(hostShellCommand("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" })).toEqual({
      cmd: "C:\\Windows\\System32\\cmd.exe",
      args: [],
    });
  });
});

describe("spawnHostShell", () => {
  it("spawns in the given cwd with TERM set", () => {
    const seen: Array<{
      cmd: string;
      args: unknown;
      cwd?: string;
      term?: string;
      stdio?: unknown;
      windowsHide?: boolean;
    }> = [];
    spawnHostShell("/tmp/proj", {
      platform: "linux",
      env: { SHELL: "/bin/bash", PATH: "/bin" },
      spawn: ((
        cmd: string,
        args: string[],
        opts?: {
          cwd?: string;
          env?: NodeJS.ProcessEnv;
          stdio?: unknown;
          windowsHide?: boolean;
        },
      ) => {
        seen.push({
          cmd,
          args,
          cwd: opts?.cwd,
          term: opts?.env?.TERM,
          stdio: opts?.stdio,
          windowsHide: opts?.windowsHide,
        });
        return { pid: 1 };
      }) as typeof import("node:child_process").spawn,
    });
    expect(seen[0]).toMatchObject({
      cmd: "script",
      cwd: "/tmp/proj",
      term: "xterm-256color",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  it("hides cmd.exe and pipes stdio so Windows GUI input stays with Electron", () => {
    const seen: Array<{ cmd: string; stdio?: unknown; windowsHide?: boolean }> = [];
    spawnHostShell("C:\\proj", {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      spawn: ((cmd: string, _args: string[], opts?: { stdio?: unknown; windowsHide?: boolean }) => {
        seen.push({ cmd, stdio: opts?.stdio, windowsHide: opts?.windowsHide });
        return { pid: 1 };
      }) as typeof import("node:child_process").spawn,
    });
    expect(seen[0]).toEqual({
      cmd: "C:\\Windows\\System32\\cmd.exe",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  });

  it("sets COLUMNS and LINES so the PTY has an initial size", () => {
    const seen: Array<{ columns?: string; lines?: string }> = [];
    spawnHostShell("/tmp/proj", {
      platform: "linux",
      env: { SHELL: "/bin/bash", PATH: "/bin" },
      spawn: ((_cmd, _args, opts?: { env?: NodeJS.ProcessEnv }) => {
        seen.push({ columns: opts?.env?.COLUMNS, lines: opts?.env?.LINES });
        return { pid: 1 };
      }) as typeof import("node:child_process").spawn,
    });
    expect(seen[0]).toEqual({ columns: "80", lines: "24" });
  });
});

describe("parsePtyResize", () => {
  it("accepts a resize JSON frame and rejects stdin-looking payloads", () => {
    expect(parsePtyResize('{"type":"resize","cols":120,"rows":40}')).toEqual({
      cols: 120,
      rows: 40,
    });
    expect(parsePtyResize(Buffer.from('{"type":"resize","cols":80,"rows":24}'))).toEqual({
      cols: 80,
      rows: 24,
    });
    expect(parsePtyResize("ls\n")).toBeNull();
    expect(parsePtyResize("{")).toBeNull();
    expect(parsePtyResize('{"type":"resize","cols":0,"rows":24}')).toBeNull();
    expect(parsePtyResize('{"type":"resize","cols":9999,"rows":24}')).toBeNull();
  });
});

describe("createWindowsCookedLine", () => {
  it("echoes keystrokes and turns CR into LF for piped cmd.exe", () => {
    const cook = createWindowsCookedLine();
    expect(cook.feed("di")).toEqual({ toChild: "", echo: "di" });
    expect(cook.feed("r\r")).toEqual({ toChild: "dir\n", echo: "r\r\n" });
  });

  it("treats CR LF as one newline and erases with backspace", () => {
    const cook = createWindowsCookedLine();
    expect(cook.feed("ab\u007f")).toEqual({ toChild: "", echo: "ab\b \b" });
    expect(cook.feed("c\r\n")).toEqual({ toChild: "ac\n", echo: "c\r\n" });
  });
});
