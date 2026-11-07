import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  debugLogId,
  parseDebugLogId,
  replayTrace,
  summarizeTrace,
  type DebugLogDetail,
  type DebugLogSource,
  type TraceEvent,
} from "@locus/shared";
import type { SessionService } from "../session/sessions.js";
import { SessionTraceLog, tracePath } from "../session/traces.js";

export const DEBUG_LOG_TEXT_MAX = 400_000;
export const DEBUG_LOG_SUMMARY_MAX = 32_000;

function tailString(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const sliced = text.slice(text.length - max);
  const nl = sliced.indexOf("\n");
  return { text: nl >= 0 ? sliced.slice(nl + 1) : sliced, truncated: true };
}

export async function readFileTail(
  path: string,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; bytes: number; mtime: string } | undefined> {
  try {
    const fh = await open(path, "r");
    try {
      const info = await fh.stat();
      if (!info.isFile()) return undefined;
      const start = Math.max(0, info.size - maxBytes);
      const length = info.size - start;
      const buf = Buffer.alloc(length);
      if (length) await fh.read(buf, 0, length, start);
      let text = buf.toString("utf8");
      const truncated = start > 0;
      if (truncated) {
        const nl = text.indexOf("\n");
        if (nl >= 0) text = text.slice(nl + 1);
      }
      return { text, truncated, bytes: info.size, mtime: info.mtime.toISOString() };
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

async function fileInfo(path: string): Promise<{ bytes: number; mtime: string } | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    return { bytes: info.size, mtime: info.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

function traceSummary(text: string, bytes: number): string {
  const events = replayTrace(text);
  if (events.length) return summarizeTrace(events);
  return bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB` : "empty trace";
}

function guestSummary(text: string, bytes: number): string {
  const lines = text.trim() ? text.trim().split(/\n/).length : 0;
  if (lines) return `${lines} lines`;
  return bytes ? `${Math.max(1, Math.round(bytes / 1024))} KB on disk` : "empty guest log";
}

export async function listDebugLogs(
  dataDir: string,
  sessions: SessionService,
): Promise<DebugLogSource[]> {
  const listed = await sessions.list();
  const bySession = new Map(listed.map((session) => [session.id, session]));
  const byVm = new Map(
    listed.filter((session) => session.vmId).map((session) => [session.vmId!, session]),
  );
  const traces = new SessionTraceLog(dataDir);
  const sources: DebugLogSource[] = [];

  for (const row of await traces.list()) {
    const tail = await readFileTail(row.path, DEBUG_LOG_SUMMARY_MAX);
    const session = bySession.get(row.sessionId);
    sources.push({
      id: debugLogId("trace", row.sessionId),
      kind: "trace",
      title: session?.title?.trim() || `Session ${row.sessionId.slice(0, 8)}`,
      path: row.path,
      sessionId: row.sessionId,
      bytes: row.bytes,
      mtime: row.mtime,
      summary: traceSummary(tail?.text ?? "", row.bytes),
    });
  }

  const seenVm = new Set<string>();
  for (const vm of sessions.listMachines()) {
    seenVm.add(vm.id);
    const live = sessions.logsForMachine(vm.id);
    const diskPath = join(dataDir, "vms", vm.id, "qemu.log");
    const disk = await fileInfo(diskPath);
    if (!live && !disk) continue;
    const session = byVm.get(vm.id) ?? (vm.sessionId ? bySession.get(vm.sessionId) : undefined);
    const liveTail = tailString(live, DEBUG_LOG_SUMMARY_MAX);
    sources.push({
      id: debugLogId("guest", vm.id),
      kind: "guest",
      title: session?.title?.trim() || vm.name || `Guest ${vm.id.slice(0, 8)}`,
      path: disk?.bytes ? diskPath : `memory:${vm.id}`,
      sessionId: session?.id ?? vm.sessionId,
      vmId: vm.id,
      bytes: Math.max(live.length, disk?.bytes ?? 0),
      mtime: disk?.mtime ?? vm.updatedAt,
      summary: guestSummary(liveTail.text, Math.max(live.length, disk?.bytes ?? 0)),
    });
  }

  let vmNames: string[] = [];
  try {
    vmNames = await readdir(join(dataDir, "vms"));
  } catch {
    vmNames = [];
  }
  for (const vmId of vmNames) {
    if (seenVm.has(vmId)) continue;
    const diskPath = join(dataDir, "vms", vmId, "qemu.log");
    const disk = await fileInfo(diskPath);
    if (!disk) continue;
    const session = byVm.get(vmId);
    sources.push({
      id: debugLogId("guest", vmId),
      kind: "guest",
      title: session?.title?.trim() || `Guest ${vmId.slice(0, 8)}`,
      path: diskPath,
      sessionId: session?.id,
      vmId,
      bytes: disk.bytes,
      mtime: disk.mtime,
      summary: guestSummary("", disk.bytes),
    });
  }

  return sources.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

export async function readDebugLog(
  dataDir: string,
  sessions: SessionService,
  id: string,
): Promise<DebugLogDetail | undefined> {
  const parsed = parseDebugLogId(id);
  if (!parsed) return undefined;

  if (parsed.kind === "trace") {
    const path = tracePath(dataDir, parsed.key);
    const tail = await readFileTail(path, DEBUG_LOG_TEXT_MAX);
    if (!tail) return undefined;
    const session = await sessions.get(parsed.key);
    const events: TraceEvent[] = replayTrace(tail.text);
    return {
      source: {
        id,
        kind: "trace",
        title: session?.title?.trim() || `Session ${parsed.key.slice(0, 8)}`,
        path,
        sessionId: parsed.key,
        bytes: tail.bytes,
        mtime: tail.mtime,
        summary: traceSummary(tail.text, tail.bytes),
      },
      text: tail.text,
      truncated: tail.truncated,
      events,
    };
  }

  const live = sessions.logsForMachine(parsed.key);
  const diskPath = join(dataDir, "vms", parsed.key, "qemu.log");
  const disk = await readFileTail(diskPath, DEBUG_LOG_TEXT_MAX);
  const liveTail = tailString(live, DEBUG_LOG_TEXT_MAX);
  if (!live && !disk) return undefined;
  const useLive = live.length >= (disk?.bytes ?? 0);
  const text = useLive ? liveTail.text : (disk?.text ?? "");
  const truncated = useLive ? liveTail.truncated : Boolean(disk?.truncated);
  const bytes = Math.max(live.length, disk?.bytes ?? 0);
  const vm = sessions.getMachine(parsed.key);
  const session = vm?.sessionId ? await sessions.get(vm.sessionId) : undefined;
  return {
    source: {
      id,
      kind: "guest",
      title: session?.title?.trim() || vm?.name || `Guest ${parsed.key.slice(0, 8)}`,
      path: disk ? diskPath : `memory:${parsed.key}`,
      sessionId: session?.id ?? vm?.sessionId,
      vmId: parsed.key,
      bytes,
      mtime: disk?.mtime ?? vm?.updatedAt ?? new Date().toISOString(),
      summary: guestSummary(text, bytes),
    },
    text,
    truncated,
  };
}
