import type { VmInstance, VmLifecycle } from "./vm.js";

export const DOCKER_CONTAINER_STATES = [
  "created",
  "running",
  "paused",
  "restarting",
  "stopped",
  "exited",
  "dead",
  "unknown",
] as const;

export type DockerContainerState = (typeof DOCKER_CONTAINER_STATES)[number];

export type DockerContainerAction = "start" | "stop" | "restart";

export const DOCKER_CONTAINER_ACTIONS: DockerContainerAction[] = ["start", "stop", "restart"];

export const DEFAULT_DOCKER_LOG_TAIL = 400;
export const MAX_DOCKER_LOG_TAIL = 2000;
export const MAX_DOCKER_BULK_IDS = 64;

export interface DockerBulkStopError {
  id: string;
  error: string;
}

export interface DockerBulkStopResult {
  stopped: DockerContainer[];
  errors: DockerBulkStopError[];
}

/** Raw `docker ps` row from the host engine. */
export interface DockerHostContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: DockerContainerState;
  status: string;
  createdAt: string;
  containerId?: string;
  sessionId?: string;
  sessionTitle?: string;
  vmId?: string;
  locus: boolean;
}

const CONTAINER_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

/** Reject empty, overlong, or shell-unsafe docker ids/names before they hit argv. */
export function parseDockerContainerRef(raw: string): string | undefined {
  const value = raw.trim();
  if (!value || value.length > 128) return undefined;
  if (!CONTAINER_REF.test(value)) return undefined;
  return value;
}

export function parseDockerLogTail(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_DOCKER_LOG_TAIL;
  return Math.min(MAX_DOCKER_LOG_TAIL, Math.max(1, Math.floor(n)));
}

/** Parse `{ ids: string[] }` for bulk Docker stop. Rejects empty, oversized, or unsafe refs. */
export function parseDockerBulkIds(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const ids = (raw as { ids?: unknown }).ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_DOCKER_BULK_IDS) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of ids) {
    if (typeof item !== "string") return undefined;
    const id = parseDockerContainerRef(item);
    if (!id) return undefined;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isDockerContainerAction(value: string): value is DockerContainerAction {
  return (DOCKER_CONTAINER_ACTIONS as string[]).includes(value);
}

export function dockerIdMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 12 && b.length >= 12 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

export function matchDockerContainer(row: DockerContainer, ref: string): boolean {
  if (row.id === ref || row.name === ref || row.vmId === ref || row.sessionId === ref) return true;
  if (row.containerId && dockerIdMatch(row.containerId, ref)) return true;
  return false;
}

export function dockerStateFromVm(status: VmLifecycle): DockerContainerState {
  if (status === "running" || status === "ready" || status === "booting") return "running";
  if (status === "paused") return "paused";
  if (status === "error") return "dead";
  if (status === "creating" || status === "installing") return "created";
  return "stopped";
}

export function dockerStateFromHost(state: string, status = ""): DockerContainerState {
  const raw = state.trim().toLowerCase();
  if ((DOCKER_CONTAINER_STATES as readonly string[]).includes(raw)) {
    return raw as DockerContainerState;
  }
  const label = status.trim().toLowerCase();
  if (label.includes("paused")) return "paused";
  if (label.startsWith("up") || label.includes("running")) return "running";
  if (label.includes("restarting")) return "restarting";
  if (label.startsWith("exited") || label.includes("exited")) return "exited";
  if (label.startsWith("created")) return "created";
  if (label.includes("dead")) return "dead";
  if (label.includes("stopped")) return "stopped";
  return "unknown";
}

export function dockerDotClass(state: DockerContainerState): string {
  if (state === "running") return "running";
  if (state === "paused") return "paused";
  if (state === "restarting") return "booting";
  if (state === "dead") return "error";
  return "stopped";
}

export function dockerContainerLive(state: DockerContainerState): boolean {
  return state === "running" || state === "paused" || state === "restarting";
}

/** One sample from `docker stats --no-stream --format '{{json .}}'`. */
export interface DockerContainerStats {
  id: string;
  name: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsage: string;
  memoryLimit: string;
  networkRx: string;
  networkTx: string;
  blockRead: string;
  blockWrite: string;
  pids: number;
  running: boolean;
  sampledAt: string;
}

function parseStatsPercent(raw: string): number {
  const n = Number.parseFloat(raw.replace(/%/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseStatsIo(raw: string): { left: string; right: string } {
  const [left, right] = raw.split("/").map((part) => part.trim());
  const clean = (value: string | undefined) =>
    !value || value === "--" || value === "-" ? "0B" : value;
  return { left: clean(left), right: clean(right) };
}

function statsField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
  }
  return "";
}

export function parseDockerStatsJson(
  stdout: string,
  sampledAt = new Date().toISOString(),
): DockerContainerStats | undefined {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const row = JSON.parse(trimmed) as Record<string, unknown>;
      const id = statsField(row, "ID", "Id", "Container", "Name");
      if (!id) continue;
      const cpuLabel = statsField(row, "CPUPerc");
      const memLabel = statsField(row, "MemPerc");
      const memUsage = statsField(row, "MemUsage");
      const net = parseStatsIo(statsField(row, "NetIO"));
      const block = parseStatsIo(statsField(row, "BlockIO"));
      const pidsRaw = statsField(row, "PIDs", "Pids");
      const pids = Number.parseInt(pidsRaw, 10);
      const memory = parseStatsIo(memUsage);
      const running = cpuLabel !== "--" && memUsage !== "-- / --" && memUsage !== "--";
      return {
        id,
        name: statsField(row, "Name", "Names", "Container") || id,
        cpuPercent: parseStatsPercent(cpuLabel),
        memoryPercent: parseStatsPercent(memLabel),
        memoryUsage: memory.left,
        memoryLimit: memory.right,
        networkRx: net.left,
        networkTx: net.right,
        blockRead: block.left,
        blockWrite: block.right,
        pids: Number.isFinite(pids) ? pids : 0,
        running,
        sampledAt,
      };
    } catch {
      continue;
    }
  }
  return undefined;
}

export function mockDockerContainerStats(input: {
  id: string;
  name: string;
  running: boolean;
  sampledAt?: string;
}): DockerContainerStats {
  const sampledAt = input.sampledAt ?? new Date().toISOString();
  if (!input.running) {
    return {
      id: input.id,
      name: input.name,
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsage: "0B",
      memoryLimit: "0B",
      networkRx: "0B",
      networkTx: "0B",
      blockRead: "0B",
      blockWrite: "0B",
      pids: 0,
      running: false,
      sampledAt,
    };
  }
  return {
    id: input.id,
    name: input.name,
    cpuPercent: 1.2,
    memoryPercent: 0.4,
    memoryUsage: "12.0MiB",
    memoryLimit: "8GiB",
    networkRx: "1.2kB",
    networkTx: "0B",
    blockRead: "0B",
    blockWrite: "0B",
    pids: 3,
    running: true,
    sampledAt,
  };
}

function locusName(vmId: string): string {
  return `locus-${vmId}`;
}

function hostMatchesVm(host: DockerHostContainer, vm: VmInstance): boolean {
  if (vm.containerId && dockerIdMatch(vm.containerId, host.id)) return true;
  if (host.name === locusName(vm.id)) return true;
  return false;
}

function fromVm(
  vm: VmInstance,
  sessions: Array<{ id: string; title: string; vmId?: string }>,
  host?: DockerHostContainer,
): DockerContainer {
  const session =
    sessions.find((row) => row.vmId === vm.id) ?? sessions.find((row) => row.id === vm.sessionId);
  const state = host ? dockerStateFromHost(host.state, host.status) : dockerStateFromVm(vm.status);
  return {
    id: vm.id,
    name: host?.name || vm.name || locusName(vm.id),
    image: host?.image || vm.dockerImage || "",
    state,
    status: host?.status || vm.error || vm.status,
    createdAt: host?.createdAt || vm.createdAt,
    containerId: host?.id || vm.containerId,
    sessionId: session?.id ?? vm.sessionId,
    sessionTitle: session?.title,
    vmId: vm.id,
    locus: true,
  };
}

function fromHost(
  host: DockerHostContainer,
  sessions: Array<{ id: string; title: string; vmId?: string }>,
): DockerContainer {
  const session = sessions.find((row) => row.vmId && dockerIdMatch(row.vmId, host.id));
  return {
    id: host.id,
    name: host.name || host.id.slice(0, 12),
    image: host.image,
    state: dockerStateFromHost(host.state, host.status),
    status: host.status || host.state,
    createdAt: host.createdAt,
    containerId: host.id,
    sessionId: session?.id,
    sessionTitle: session?.title,
    locus: false,
  };
}

const LIVE_RANK: Record<DockerContainerState, number> = {
  running: 0,
  restarting: 1,
  paused: 2,
  created: 3,
  stopped: 4,
  exited: 5,
  dead: 6,
  unknown: 7,
};

export function mergeDockerInventory(input: {
  vms: VmInstance[];
  host: DockerHostContainer[];
  sessions: Array<{ id: string; title: string; vmId?: string }>;
}): DockerContainer[] {
  const usedHost = new Set<string>();
  const rows: DockerContainer[] = [];
  for (const vm of input.vms) {
    const host = input.host.find((row) => hostMatchesVm(row, vm));
    if (host) usedHost.add(host.id);
    rows.push(fromVm(vm, input.sessions, host));
  }
  for (const host of input.host) {
    if (usedHost.has(host.id)) continue;
    rows.push(fromHost(host, input.sessions));
  }
  return rows.sort((a, b) => {
    const rank = LIVE_RANK[a.state] - LIVE_RANK[b.state];
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name);
  });
}
