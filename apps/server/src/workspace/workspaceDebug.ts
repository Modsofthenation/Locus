import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { extname, join } from "node:path";
import { WebSocket as WsWebSocket } from "ws";
import { DapClient, startDebugpy } from "./workspaceDap.js";
import { sanitizeWorkspaceRel } from "./workspaceFiles.js";

export type WorkspaceBreakpoint = { path: string; line: number };

export type WorkspaceStackFrame = {
  id: number;
  name: string;
  path: string;
  line: number;
};

export type WorkspaceDebugVariable = { name: string; value: string };

export type WorkspaceDebugState = {
  status: "idle" | "running" | "paused" | "stopped" | "error";
  sessionId: string;
  program?: string;
  error?: string;
  breakpoints: WorkspaceBreakpoint[];
  stack: WorkspaceStackFrame[];
  variables: WorkspaceDebugVariable[];
};

type DebugSession = WorkspaceDebugState & {
  kind?: "cdp" | "dap";
  child?: ChildProcessWithoutNullStreams;
  ws?: WsWebSocket;
  dap?: DapClient;
  seq: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>;
};

const sessions = new Map<string, DebugSession>();

export function debugState(sessionId: string): WorkspaceDebugState {
  const row = sessions.get(sessionId);
  if (!row) {
    return {
      status: "idle",
      sessionId,
      breakpoints: [],
      stack: [],
      variables: [],
    };
  }
  return publicState(row);
}

export function setDebugBreakpoints(
  sessionId: string,
  breakpoints: WorkspaceBreakpoint[],
): WorkspaceDebugState {
  const row = sessions.get(sessionId) ?? emptySession(sessionId);
  row.breakpoints = uniqueBreakpoints(breakpoints);
  sessions.set(sessionId, row);
  return publicState(row);
}

export function toggleDebugBreakpoint(
  sessionId: string,
  path: string,
  line: number,
): WorkspaceDebugState {
  const row = sessions.get(sessionId) ?? emptySession(sessionId);
  const rel = sanitizeWorkspaceRel(path);
  if (!rel || line < 1) return publicState(row);
  const next = row.breakpoints.filter((bp) => !(bp.path === rel && bp.line === line));
  if (next.length === row.breakpoints.length) next.push({ path: rel, line });
  row.breakpoints = next;
  sessions.set(sessionId, row);
  return publicState(row);
}

export async function startWorkspaceDebug(input: {
  sessionId: string;
  root: string;
  program: string;
}): Promise<WorkspaceDebugState> {
  const rel = sanitizeWorkspaceRel(input.program);
  if (!rel)
    return { ...debugState(input.sessionId), status: "error", error: "Pick a file to debug" };
  await stopWorkspaceDebug(input.sessionId);
  const row = sessions.get(input.sessionId) ?? emptySession(input.sessionId);
  row.program = rel;
  row.status = "running";
  row.error = undefined;
  row.stack = [];
  row.variables = [];
  sessions.set(input.sessionId, row);
  const abs = join(input.root, rel);
  const ext = extname(rel).toLowerCase();
  try {
    if (ext === ".py") {
      await startPython(row, input.root, abs);
    } else if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
      await startNode(row, input.root, abs);
    } else {
      throw new Error(
        `Launch is only available for Node (.js, .cjs, .mjs) and Python (.py). ${rel} needs another debugger adapter.`,
      );
    }
  } catch (err) {
    row.status = "error";
    row.error = err instanceof Error ? err.message : "Debug failed";
    row.child?.kill();
    row.dap?.close();
  }
  return publicState(row);
}

export async function debugCommand(
  sessionId: string,
  action: "continue" | "stepOver" | "stepInto" | "stepOut" | "stop",
): Promise<WorkspaceDebugState> {
  const row = sessions.get(sessionId);
  if (!row) return debugState(sessionId);
  if (action === "stop") return stopWorkspaceDebug(sessionId);
  if (row.kind === "dap" && row.dap) {
    try {
      if (action === "continue") await row.dap.continue();
      else if (action === "stepOver") await row.dap.stepOver();
      else if (action === "stepInto") await row.dap.stepInto();
      else await row.dap.stepOut();
      if (action === "continue") {
        row.status = "running";
        row.stack = [];
        row.variables = [];
      }
    } catch (err) {
      row.status = "error";
      row.error = err instanceof Error ? err.message : "Debug command failed";
    }
    return publicState(row);
  }
  if (!row.ws || row.ws.readyState !== row.ws.OPEN) return publicState(row);
  const method =
    action === "continue"
      ? "Debugger.resume"
      : action === "stepOver"
        ? "Debugger.stepOver"
        : action === "stepInto"
          ? "Debugger.stepInto"
          : "Debugger.stepOut";
  try {
    await cdp(row, method, {});
    if (action === "continue") {
      row.status = "running";
      row.stack = [];
      row.variables = [];
    }
  } catch (err) {
    row.status = "error";
    row.error = err instanceof Error ? err.message : "Debug command failed";
  }
  return publicState(row);
}

export async function stopWorkspaceDebug(sessionId: string): Promise<WorkspaceDebugState> {
  const row = sessions.get(sessionId);
  if (!row) return debugState(sessionId);
  try {
    row.ws?.close();
  } catch {
    /* ignore */
  }
  row.ws = undefined;
  try {
    await row.dap?.disconnect();
  } catch {
    row.dap?.close();
  }
  row.dap = undefined;
  row.child?.kill();
  row.child = undefined;
  row.kind = undefined;
  row.status = "stopped";
  row.stack = [];
  row.variables = [];
  return publicState(row);
}

function emptySession(sessionId: string): DebugSession {
  return {
    status: "idle",
    sessionId,
    breakpoints: [],
    stack: [],
    variables: [],
    seq: 0,
    pending: new Map(),
  };
}

function publicState(row: DebugSession): WorkspaceDebugState {
  return {
    status: row.status,
    sessionId: row.sessionId,
    program: row.program,
    error: row.error,
    breakpoints: row.breakpoints,
    stack: row.stack,
    variables: row.variables,
  };
}

function uniqueBreakpoints(rows: WorkspaceBreakpoint[]): WorkspaceBreakpoint[] {
  const seen = new Set<string>();
  const out: WorkspaceBreakpoint[] = [];
  for (const row of rows) {
    const path = sanitizeWorkspaceRel(row.path);
    const line = Math.round(row.line);
    if (!path || line < 1) continue;
    const key = `${path}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, line });
  }
  return out;
}

async function startNode(row: DebugSession, cwd: string, abs: string): Promise<void> {
  row.kind = "cdp";
  const child = spawn(process.execPath, ["--inspect-brk=0", abs], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams;
  row.child = child;
  const url = await waitInspectUrl(child);
  await attachCdp(row, url);
}

async function startPython(row: DebugSession, cwd: string, abs: string): Promise<void> {
  row.kind = "dap";
  const { child, host, port } = await startDebugpy(cwd, abs);
  row.child = child;
  const dap = await DapClient.connect(host, port);
  row.dap = dap;
  dap.onPause((info) => {
    row.status = "paused";
    row.stack = info.stack.map((frame) => ({
      ...frame,
      path: workspaceRelFromAbs(cwd, frame.path) || frame.path,
    }));
    row.variables = info.variables;
  });
  dap.onResume(() => {
    row.status = "running";
    row.stack = [];
    row.variables = [];
  });
  await dap.initialize();
  await dap.attach();
  const byPath = new Map<string, number[]>();
  for (const bp of row.breakpoints) {
    const lines = byPath.get(bp.path) ?? [];
    lines.push(bp.line);
    byPath.set(bp.path, lines);
  }
  for (const [rel, lines] of byPath) {
    try {
      await dap.setBreakpoints(join(cwd, rel), lines);
    } catch {
      /* ignore missing files */
    }
  }
  await dap.configurationDone();
}

function workspaceRelFromAbs(root: string, abs: string): string {
  const normRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normAbs = abs.replace(/\\/g, "/");
  if (normAbs.startsWith(normRoot + "/")) return normAbs.slice(normRoot.length + 1);
  return sanitizeWorkspaceRel(abs) ?? "";
}

function waitInspectUrl(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Debugger did not start")), 8_000);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const match = text.match(/ws:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9-]+/);
      if (match) {
        clearTimeout(timer);
        child.stderr.off("data", onData);
        child.stdout.off("data", onData);
        resolve(match[0]);
      }
    };
    child.stderr.on("data", onData);
    child.stdout.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Debugger exited (${code ?? "unknown"})`));
    });
  });
}

async function attachCdp(row: DebugSession, url: string): Promise<void> {
  const ws = new WsWebSocket(url);
  row.ws = ws;
  row.seq = 0;
  row.pending = new Map();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connect timed out")), 5_000);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  ws.on("message", (raw) => {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };
    try {
      msg = JSON.parse(String(raw)) as typeof msg;
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const pending = row.pending.get(msg.id);
      if (pending) {
        row.pending.delete(msg.id);
        pending.resolve(msg.result);
      }
    }
    if (msg.method === "Debugger.paused") void onPaused(row, msg.params ?? {});
    if (msg.method === "Debugger.resumed") {
      row.status = "running";
      row.stack = [];
      row.variables = [];
    }
  });
  await cdp(row, "Debugger.enable", {});
  await cdp(row, "Runtime.enable", {});
  await applyBreakpoints(row);
  await cdp(row, "Runtime.runIfWaitingForDebugger", {});
}

async function applyBreakpoints(row: DebugSession): Promise<void> {
  for (const bp of row.breakpoints) {
    try {
      await cdp(row, "Debugger.setBreakpointByUrl", {
        lineNumber: Math.max(0, bp.line - 1),
        urlRegex: `${bp.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      });
    } catch {
      /* ignore missing scripts */
    }
  }
}

async function onPaused(row: DebugSession, params: Record<string, unknown>): Promise<void> {
  row.status = "paused";
  const frames = Array.isArray(params.callFrames) ? params.callFrames : [];
  const stack: WorkspaceStackFrame[] = [];
  for (const raw of frames.slice(0, 24)) {
    const frame = raw as {
      callFrameId?: string;
      functionName?: string;
      location?: { lineNumber?: number };
      url?: string;
      scopeChain?: Array<{ object?: { objectId?: string } }>;
    };
    stack.push({
      id: stack.length,
      name: frame.functionName || "(anonymous)",
      path: (frame.url ?? "").replace(/^file:\/\//, ""),
      line: (frame.location?.lineNumber ?? 0) + 1,
    });
  }
  row.stack = stack;
  const local = (
    frames[0] as
      { scopeChain?: Array<{ type?: string; object?: { objectId?: string } }> } | undefined
  )?.scopeChain?.find((scope) => scope.type === "local" || scope.type === "closure");
  row.variables = [];
  if (local?.object?.objectId) {
    try {
      const props = (await cdp(row, "Runtime.getProperties", {
        objectId: local.object.objectId,
        ownProperties: true,
      })) as {
        result?: Array<{ name?: string; value?: { description?: string; value?: unknown } }>;
      };
      for (const prop of props.result ?? []) {
        if (!prop.name) continue;
        row.variables.push({
          name: prop.name,
          value: String(prop.value?.description ?? prop.value?.value ?? ""),
        });
        if (row.variables.length >= 40) break;
      }
    } catch {
      /* ignore */
    }
  }
}

function cdp(row: DebugSession, method: string, params: Record<string, unknown>): Promise<unknown> {
  const ws = row.ws;
  if (!ws || ws.readyState !== ws.OPEN)
    return Promise.reject(new Error("Debugger is not connected"));
  const id = ++row.seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      row.pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 8_000);
    row.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}
