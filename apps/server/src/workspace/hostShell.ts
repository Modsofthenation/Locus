import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export function hostShellCommand(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { cmd: string; args: string[] } {
  if (platform === "win32") {
    return { cmd: env.ComSpec?.trim() || "cmd.exe", args: [] };
  }
  const shell = env.SHELL?.trim() || "/bin/bash";
  if (platform === "darwin") {
    return { cmd: "script", args: ["-q", "/dev/null", shell, "-i"] };
  }
  return { cmd: "script", args: ["-qefc", `${shell} -i`, "/dev/null"] };
}

export function spawnHostShell(
  cwd: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; spawn?: typeof spawn } = {},
): ChildProcess {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const { cmd, args } = hostShellCommand(platform, env);
  const spawnFn = opts.spawn ?? spawn;
  const childOpts: SpawnOptions = {
    cwd,
    env: {
      ...env,
      TERM: env.TERM || "xterm-256color",
      COLORTERM: env.COLORTERM || "truecolor",
      COLUMNS: env.COLUMNS || "80",
      LINES: env.LINES || "24",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  };
  return spawnFn(cmd, args, childOpts);
}

/** Windows cmd.exe over pipes is not a console: it does not echo, does not
 *  honor backspace, and only treats LF as end-of-line. xterm sends CR. */
export function createWindowsCookedLine(): {
  feed(raw: Buffer | string): { toChild: string; echo: string };
} {
  let line = "";
  let pendingCR = false;
  return {
    feed(raw) {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      let toChild = "";
      let echo = "";
      for (const ch of text) {
        if (ch === "\n" && pendingCR) {
          pendingCR = false;
          continue;
        }
        pendingCR = ch === "\r";
        if (ch === "\r" || ch === "\n") {
          toChild += `${line}\n`;
          line = "";
          echo += "\r\n";
          continue;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (!line) continue;
          line = [...line].slice(0, -1).join("");
          echo += "\b \b";
          continue;
        }
        if (ch === "\u0003") {
          line = "";
          echo += "^C\r\n";
          continue;
        }
        if (ch < " " && ch !== "\t") continue;
        line += ch;
        echo += ch;
      }
      return { toChild, echo };
    },
  };
}

export function parsePtyResize(raw: unknown): { cols: number; rows: number } | null {
  let text = "";
  if (typeof raw === "string") text = raw;
  else if (Buffer.isBuffer(raw)) {
    if (raw.length < 16 || raw.length > 96 || raw[0] !== 0x7b) return null;
    text = raw.toString("utf8");
  } else {
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || trimmed.length > 96 || !trimmed.includes('"resize"')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown; cols?: unknown; rows?: unknown };
    if (parsed.type !== "resize") return null;
    const cols = Math.floor(Number(parsed.cols));
    const rows = Math.floor(Number(parsed.rows));
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return null;
    if (cols < 2 || cols > 400 || rows < 1 || rows > 200) return null;
    return { cols, rows };
  } catch {
    return null;
  }
}

const RESIZE_PY = `
import fcntl, os, signal, struct, subprocess, sys, termios
pid, cols, rows = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
winsz = struct.pack("HHHH", rows, cols, 0, 0)

def kids(p):
    found = [p]
    try:
        out = subprocess.check_output(["pgrep", "-P", str(p)], text=True, stderr=subprocess.DEVNULL)
        for line in out.split():
            try:
                found.extend(kids(int(line.strip())))
            except Exception:
                pass
    except Exception:
        pass
    return found

for p in kids(pid):
    fd_dir = f"/proc/{p}/fd"
    try:
        for fd in os.listdir(fd_dir):
            try:
                target = os.readlink(os.path.join(fd_dir, fd))
            except Exception:
                continue
            if "/pts/" in target or "pty" in target or "/ttys" in target:
                try:
                    f = os.open(target, os.O_RDWR)
                    try:
                        fcntl.ioctl(f, termios.TIOCSWINSZ, winsz)
                    finally:
                        os.close(f)
                except Exception:
                    pass
    except Exception:
        pass
    try:
        os.kill(p, signal.SIGWINCH)
    except Exception:
        pass
`.trim();

export function resizeHostShell(pid: number | undefined, cols: number, rows: number): void {
  if (process.platform === "win32") return;
  if (!pid || pid < 1) return;
  const c = Math.max(2, Math.min(400, Math.floor(cols)));
  const r = Math.max(1, Math.min(200, Math.floor(rows)));
  const run = (bin: string) => {
    execFile(
      bin,
      ["-c", RESIZE_PY, String(pid), String(c), String(r)],
      { timeout: 2_000 },
      (err) => {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code?: string }).code)
            : "";
        if (code === "ENOENT" && bin === "python3") run("python");
      },
    );
  };
  run("python3");
}
