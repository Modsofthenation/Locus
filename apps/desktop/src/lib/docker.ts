import {
  dockerContainerLive,
  type DockerBulkStopError,
  type DockerBulkStopResult,
  type DockerContainer,
  type DockerContainerStats,
} from "@locus/shared";
import { askConfirm } from "@/lib/dialog";

export const DOCKER_EXPLORER_POLL_MS = 5000;
export const DOCKER_EXPLORER_EXPANDED_KEY = "locus.dockerExplorer.containersExpanded";

export type DockerGroupId = "running" | "stopped" | "exited";

export type DockerLogLevel = "error" | "warn" | "info" | "debug" | "other";

export interface DockerLogLine {
  raw: string;
  time: string;
  level: DockerLogLevel;
  message: string;
}

export function liveDockerContainers(rows: DockerContainer[]): DockerContainer[] {
  return rows.filter((row) => dockerContainerLive(row.state));
}

export async function confirmStopContainers(rows: DockerContainer[]): Promise<boolean> {
  if (rows.length === 0) return false;
  const names = rows.map((row) => row.name);
  const agents = rows.filter((row) => row.sessionTitle);
  const agentNote = agents.length
    ? `\n\n${agents.map((row) => `${row.name} is the ${row.sessionTitle} agent.`).join("\n")}`
    : "";
  return askConfirm({
    title: names.length === 1 ? "Stop container?" : "Stop containers?",
    body: `Stop ${names.length} container${names.length === 1 ? "" : "s"}?\n\n${names.join("\n")}${agentNote}`,
    confirmLabel: "Stop",
    danger: true,
  });
}

export async function confirmDockerContainerAction(
  action: "stop" | "restart",
  target: DockerContainer,
): Promise<boolean> {
  const verb = action === "stop" ? "Stop" : "Restart";
  return askConfirm({
    title: `${verb} container?`,
    body: `${verb} ${target.name}?${
      target.sessionTitle ? ` This is the ${target.sessionTitle} agent.` : ""
    }`,
    confirmLabel: verb,
    danger: action === "stop",
  });
}

export async function confirmRestartContainers(rows: DockerContainer[]): Promise<boolean> {
  if (rows.length === 0) return false;
  const names = rows.map((row) => row.name);
  const agents = rows.filter((row) => row.sessionTitle);
  const agentNote = agents.length
    ? `\n\n${agents.map((row) => `${row.name} is the ${row.sessionTitle} agent.`).join("\n")}`
    : "";
  return askConfirm({
    title: names.length === 1 ? "Restart container?" : "Restart containers?",
    body: `Restart ${names.length} container${names.length === 1 ? "" : "s"}?\n\n${names.join("\n")}${agentNote}`,
    confirmLabel: "Restart",
  });
}

export function dockerGroup(state: DockerContainer["state"]): DockerGroupId {
  if (dockerContainerLive(state)) return "running";
  if (state === "exited" || state === "dead") return "exited";
  return "stopped";
}

export function groupDockerContainers(
  rows: DockerContainer[],
): Record<DockerGroupId, DockerContainer[]> {
  const running: DockerContainer[] = [];
  const stopped: DockerContainer[] = [];
  const exited: DockerContainer[] = [];
  for (const row of rows) {
    const group = dockerGroup(row.state);
    if (group === "running") running.push(row);
    else if (group === "exited") exited.push(row);
    else stopped.push(row);
  }
  return { running, stopped, exited };
}

export function shortContainerId(id: string): string {
  const hex = id.replace(/[^a-fA-F0-9]/g, "");
  if (hex.length >= 12) return hex.slice(0, 12).toLowerCase();
  return id.slice(0, 12);
}

const AGE_UNIT: Record<string, string> = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  week: "w",
  month: "mo",
  year: "y",
};

export function compactDockerAge(status: string, createdAt?: string, now = Date.now()): string {
  const match = status.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?/i);
  if (match) {
    const unit = AGE_UNIT[match[2]!.toLowerCase()] ?? match[2]!.slice(0, 1);
    return `${match[1]}${unit}`;
  }
  if (!createdAt) return "";
  const stamp = new Date(createdAt).getTime();
  if (Number.isNaN(stamp)) return "";
  const sec = Math.max(0, Math.round((now - stamp) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`;
  if (sec < 86400) return `${Math.max(1, Math.round(sec / 3600))}h`;
  return `${Math.max(1, Math.round(sec / 86400))}d`;
}

export function dockerStatusLabel(row: DockerContainer, now = Date.now()): string {
  const age = compactDockerAge(row.status, row.createdAt, now);
  if (dockerContainerLive(row.state)) return age ? `running · up ${age}` : row.state;
  return age ? `${row.state} · ${age}` : row.state;
}

export function loadDockerExplorerExpanded(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(DOCKER_EXPLORER_EXPANDED_KEY);
    if (raw == null || raw.trim() === "") return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

export function saveDockerExplorerExpanded(
  expanded: boolean,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  try {
    storage.setItem(DOCKER_EXPLORER_EXPANDED_KEY, expanded ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

export function dockerInspectPayload(
  item: DockerContainer,
  stats?: DockerContainerStats | null,
): Record<string, unknown> {
  return {
    name: item.name,
    id: item.containerId || item.id,
    image: item.image,
    state: item.state,
    status: item.status,
    createdAt: item.createdAt,
    locus: item.locus,
    sessionId: item.sessionId ?? null,
    sessionTitle: item.sessionTitle ?? null,
    stats: stats
      ? {
          cpuPercent: stats.cpuPercent,
          memoryUsage: stats.memoryUsage,
          memoryLimit: stats.memoryLimit,
          pids: stats.pids,
          sampledAt: stats.sampledAt,
        }
      : null,
  };
}

function classifyLogLevel(token: string): DockerLogLevel {
  const value = token.toUpperCase();
  if (value === "ERROR" || value === "ERR" || value === "FATAL") return "error";
  if (value === "WARN" || value === "WARNING") return "warn";
  if (value === "INFO") return "info";
  if (value === "DEBUG" || value === "TRACE") return "debug";
  return "other";
}

const LOG_TIME =
  /^\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?[:\s,|]*/;
const LOG_LEVEL = /^(?:\[)?(ERROR|ERR|FATAL|WARN(?:ING)?|INFO|DEBUG|TRACE)\b(?:\]|(?=\/)|:|\s|$)/i;

export function parseDockerLogLine(raw: string): DockerLogLine {
  let rest = raw.trim();
  let time = "";
  const timeMatch = rest.match(LOG_TIME);
  if (timeMatch) {
    time = timeMatch[1]!.replace(",", ".");
    rest = rest.slice(timeMatch[0].length).trim();
  }
  const levelMatch = rest.match(LOG_LEVEL);
  const level = levelMatch ? classifyLogLevel(levelMatch[1]!) : "other";
  let message = rest;
  if (levelMatch) {
    message = rest
      .slice(levelMatch[0].length)
      .replace(/^(?:\/[A-Za-z0-9._-]+)?\]\s*/, "")
      .replace(/^[|:\-\s]+/, "")
      .trim();
  }
  return { raw, time, level, message: message || rest || raw };
}

export function parseDockerLogs(text: string): DockerLogLine[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(parseDockerLogLine);
}

export function countDockerLogLevels(lines: DockerLogLine[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const line of lines) {
    if (line.level === "error") errors += 1;
    else if (line.level === "warn") warnings += 1;
  }
  return { errors, warnings };
}

export function formatLogTime(time: string): string {
  if (!time) return "";
  const date = new Date(time.includes("T") ? time : time.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return time;
  return date.toISOString().slice(11, 19);
}

export async function runStopContainers(
  rows: DockerContainer[],
  ops: {
    stop: (ids: string[]) => Promise<DockerBulkStopResult>;
    list: () => Promise<{ containers: DockerContainer[] }>;
    confirm?: (rows: DockerContainer[]) => boolean | Promise<boolean>;
  },
): Promise<{
  containers: DockerContainer[];
  stoppedIds: Set<string>;
  errors: DockerBulkStopError[];
} | null> {
  if (rows.length === 0) return null;
  const confirm = ops.confirm ?? confirmStopContainers;
  if (!(await confirm(rows))) return null;
  const result = await ops.stop(rows.map((row) => row.id));
  const snapshot = await ops.list();
  return {
    containers: snapshot.containers,
    stoppedIds: new Set(result.stopped.map((row) => row.id)),
    errors: result.errors,
  };
}
