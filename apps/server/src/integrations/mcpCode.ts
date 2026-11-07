import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpChildEnv } from "./mcp.js";

const MCP_CLIENT_PY = `import json
import os
import urllib.error
import urllib.request

def call_tool(server, name, arguments=None):
    req = urllib.request.Request(
        os.environ["MCP_CODE_BRIDGE"],
        data=json.dumps({"server": server, "name": name, "args": arguments or {}}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        raise RuntimeError(err.read().decode() or str(err)) from err
    if not body.get("ok"):
        raise RuntimeError(body.get("error") or "mcp call failed")
    return body.get("result")
`;

export async function runMcpCode(opts: {
  code: string;
  workspaceRoot?: string;
  callTool: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string }>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; output: string }> {
  const code = opts.code.trim();
  if (!code) return { ok: false, output: "mcp_code requires Python source in `code`." };
  if (code.length > 32_768) return { ok: false, output: "mcp_code source is too long (max 32k)." };
  const python = await whichPython();
  if (!python) {
    return {
      ok: false,
      output: "Python 3 is not installed on the host. Use mcp_call, or install python3.",
    };
  }
  const tmp = await mkdtemp(join(tmpdir(), "locus-mcp-code-"));
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const server = createServer((req, res) => {
    void handleBridge(req, res, opts.callTool);
  });
  try {
    await writeFile(join(tmp, "mcp_client.py"), MCP_CLIENT_PY, "utf8");
    await writeFile(join(tmp, "script.py"), `${code}\n`, "utf8");
    const port = await listenLocal(server);
    const env = mcpChildEnv({
      MCP_CODE_BRIDGE: `http://127.0.0.1:${port}/`,
      PYTHONPATH: tmp,
      PYTHONDONTWRITEBYTECODE: "1",
    });
    const result = await spawnPython({
      python,
      cwd: opts.workspaceRoot || tmp,
      env,
      script: join(tmp, "script.py"),
      timeoutMs,
    });
    return result;
  } finally {
    server.close();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function handleBridge(
  req: IncomingMessage,
  res: ServerResponse,
  callTool: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string }>,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("POST only");
    return;
  }
  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}") as {
      server?: unknown;
      name?: unknown;
      args?: unknown;
    };
    const server = typeof parsed.server === "string" ? parsed.server.trim() : "";
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const args =
      parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
        ? (parsed.args as Record<string, unknown>)
        : {};
    if (!server || !name) {
      json(res, 400, { ok: false, error: "server and name are required" });
      return;
    }
    const result = await callTool(server, name, args);
    json(res, 200, {
      ok: result.ok,
      result: result.output,
      error: result.ok ? undefined : result.output,
    });
  } catch (err) {
    json(res, 200, {
      ok: false,
      error: err instanceof Error ? err.message : "mcp bridge failed",
    });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listenLocal(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("MCP bridge failed to bind"));
    });
    server.on("error", reject);
  });
}

async function whichPython(): Promise<string | undefined> {
  for (const bin of ["python3", "python"]) {
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        bin,
        ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
    if (ok) return bin;
  }
  return undefined;
}

function spawnPython(opts: {
  python: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  script: string;
  timeoutMs: number;
}): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(opts.python, ["-u", opts.script], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: err.message });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (code === 0) resolve({ ok: true, output: out || "(empty mcp_code stdout)" });
      else resolve({ ok: false, output: out || `mcp_code exited ${code ?? "killed"}` });
    });
  });
}
