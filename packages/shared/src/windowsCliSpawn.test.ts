import { describe, expect, it } from "vitest";
import {
  cursorCliSpawnFailureMessage,
  quoteWindowsCmdArg,
  resolveWindowsCliSpawn,
} from "./windowsCliSpawn.js";

const CMD = "C:\\Users\\locus\\AppData\\Local\\cursor-agent\\cursor-agent.cmd";
const INSTALL = "C:\\Users\\locus\\AppData\\Local\\cursor-agent";
const VERSION = "2026.08.31-fd13201";
const OLDER = "2026.03.11-abc1234";
const NODE = `${INSTALL}\\versions\\${VERSION}\\node.exe`;
const SCRIPT = `${INSTALL}\\versions\\${VERSION}\\index.js`;

function existsSet(paths: string[]): (path: string) => boolean {
  const set = new Set(paths);
  return (path) => set.has(path);
}

describe("resolveWindowsCliSpawn", () => {
  it("leaves Unix commands unchanged", () => {
    expect(
      resolveWindowsCliSpawn("/usr/local/bin/agent", ["models"], { platform: "linux" }),
    ).toEqual({ command: "/usr/local/bin/agent", args: ["models"] });
  });

  it("unwraps Cursor's versioned node.exe + index.js next to a .cmd wrapper", () => {
    const files = [
      CMD,
      NODE,
      SCRIPT,
      `${INSTALL}\\versions\\${OLDER}\\node.exe`,
      `${INSTALL}\\versions\\${OLDER}\\index.js`,
    ];
    const target = resolveWindowsCliSpawn(CMD, ["models", "--format", "json"], {
      platform: "win32",
      exists: existsSet(files),
      listDirs: (dir) => (dir === `${INSTALL}\\versions` ? [OLDER, VERSION, "not-a-version"] : []),
    });
    expect(target).toEqual({
      command: NODE,
      args: [SCRIPT, "models", "--format", "json"],
      envPatch: { CURSOR_INVOKED_AS: "cursor-agent.cmd" },
    });
  });

  it("unwraps a same-folder node.exe + index.js layout", () => {
    const target = resolveWindowsCliSpawn(`${INSTALL}\\agent.cmd`, ["-p"], {
      platform: "win32",
      exists: existsSet([`${INSTALL}\\agent.cmd`, `${INSTALL}\\node.exe`, `${INSTALL}\\index.js`]),
      listDirs: () => [],
    });
    expect(target.command).toBe(`${INSTALL}\\node.exe`);
    expect(target.args).toEqual([`${INSTALL}\\index.js`, "-p"]);
  });

  it("spawns a native .exe beside the wrapper when node.exe is missing", () => {
    const exe = `${INSTALL}\\cursor-agent.exe`;
    const target = resolveWindowsCliSpawn(CMD, ["models"], {
      platform: "win32",
      exists: existsSet([CMD, exe]),
      listDirs: () => [],
    });
    expect(target).toEqual({ command: exe, args: ["models"] });
  });

  it("wraps a .cmd in cmd.exe when the versioned layout is absent", () => {
    const target = resolveWindowsCliSpawn(CMD, ["models", "hello & calc"], {
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\system32\\cmd.exe" },
      exists: existsSet([CMD]),
      listDirs: () => [],
    });
    expect(target.command).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(target.windowsVerbatimArguments).toBe(true);
    expect(target.args.slice(0, 4)).toEqual(["/d", "/v:off", "/s", "/c"]);
    expect(target.args[4]).toContain(quoteWindowsCmdArg(CMD));
    expect(target.args[4]).toContain('"hello & calc"');
  });

  it("lets cmd.exe PATHEXT-resolve a bare agent name", () => {
    const target = resolveWindowsCliSpawn("agent", ["models"], {
      platform: "win32",
      env: { ComSpec: "cmd.exe", PATH: "C:\\empty", PATHEXT: ".EXE;.CMD" },
      exists: () => false,
      listDirs: () => [],
    });
    expect(target.command).toBe("cmd.exe");
    expect(target.args[4]).toContain(quoteWindowsCmdArg("agent"));
  });

  it("resolves agent.cmd on PATH then unwraps versions", () => {
    const target = resolveWindowsCliSpawn("agent", ["models"], {
      platform: "win32",
      env: { PATH: "C:\\Users\\locus\\AppData\\Local\\cursor-agent", PATHEXT: ".CMD" },
      exists: existsSet([`${INSTALL}\\agent.cmd`, NODE, SCRIPT]),
      listDirs: (dir) => (dir === `${INSTALL}\\versions` ? [VERSION] : []),
    });
    expect(target.command).toBe(NODE);
    expect(target.args[0]).toBe(SCRIPT);
  });

  it("passes a real .exe through without a shell", () => {
    expect(
      resolveWindowsCliSpawn("C:\\bin\\agent.exe", ["-p"], {
        platform: "win32",
        exists: existsSet(["C:\\bin\\agent.exe"]),
        listDirs: () => [],
      }),
    ).toEqual({ command: "C:\\bin\\agent.exe", args: ["-p"] });
  });

  it("launches a .ps1 via powershell.exe -File when unwrap is impossible", () => {
    const ps1 = `${INSTALL}\\cursor-agent.ps1`;
    const target = resolveWindowsCliSpawn(ps1, ["models"], {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      exists: existsSet([ps1]),
      listDirs: () => [],
    });
    expect(target.command).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(target.args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      ps1,
      "models",
    ]);
  });

  it("runs index.js with the sibling node.exe", () => {
    const js = `${INSTALL}\\versions\\${VERSION}\\index.js`;
    const target = resolveWindowsCliSpawn(js, ["models"], {
      platform: "win32",
      exists: existsSet([js, NODE]),
      listDirs: () => [],
    });
    expect(target).toEqual({ command: NODE, args: [js, "models"] });
  });

  it("never asks Node to spawn a .cmd, .bat, or .ps1 file on Windows", () => {
    const files = [CMD, NODE, SCRIPT, `${INSTALL}\\cursor-agent.ps1`, `${INSTALL}\\agent.exe`];
    const exists = existsSet(files);
    const listDirs = (dir: string) => (dir === `${INSTALL}\\versions` ? [VERSION] : []);
    const env = { ComSpec: "cmd.exe", SystemRoot: "C:\\Windows", PATH: INSTALL, PATHEXT: ".CMD" };
    for (const command of [CMD, "agent", `${INSTALL}\\cursor-agent.ps1`, `${INSTALL}\\agent.exe`]) {
      const target = resolveWindowsCliSpawn(command, ["models"], {
        platform: "win32",
        env,
        exists,
        listDirs,
      });
      expect(target.command).not.toMatch(/\.(cmd|bat|ps1)$/i);
    }
  });
});

describe("quoteWindowsCmdArg", () => {
  it("quotes metacharacters and doubles percents and quotes", () => {
    expect(quoteWindowsCmdArg("")).toBe('""');
    expect(quoteWindowsCmdArg("plain")).toBe('"plain"');
    expect(quoteWindowsCmdArg("a & b")).toBe('"a & b"');
    expect(quoteWindowsCmdArg('say "hi"')).toBe('"say ""hi"""');
    expect(quoteWindowsCmdArg("%PATH%")).toBe('"%%PATH%%"');
  });
});

describe("cursorCliSpawnFailureMessage", () => {
  it("rewrites ENOENT and EINVAL", () => {
    expect(
      cursorCliSpawnFailureMessage(
        Object.assign(new Error("spawn agent ENOENT"), { code: "ENOENT" }),
        "agent",
      ),
    ).toMatch(/not on PATH/);
    expect(
      cursorCliSpawnFailureMessage(
        Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" }),
        CMD,
      ),
    ).toMatch(/spawn EINVAL/);
  });
});
