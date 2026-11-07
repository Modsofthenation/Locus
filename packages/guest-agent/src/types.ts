import type { ComputerUseToolName, GuestOs } from "@locus/shared";
import type { ChromiumDriver } from "./chromium.js";

export interface ToolRequest {
  name: ComputerUseToolName;
  args: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  status?: "success" | "failed" | "blocked";
  category?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  screenshotBase64?: string;
  recordingName?: string;
  recordingGuestPath?: string;
  artifactName?: string;
  artifactKind?: "pdf" | "trace" | "download";
  artifactBase64?: string;
  artifactGuestPath?: string;
}

export interface GuestRuntime {
  readonly os: GuestOs;
  /**
   * Live guests exec against a real container, VM, or host tree.
   * The in-memory mock adapter omits this so callers use the bind-mounted workspace instead.
   */
  readonly liveGuest?: boolean;
  execute(
    req: ToolRequest,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<ToolResult>;
  /** Copy a host directory into the guest. No-op when the adapter has no guest tree. */
  syncHostDirToGuest(hostDir: string, guestDir: string): Promise<void>;
  /**
   * Make the bind-mounted workspace writable by the host process.
   * Docker agents create files as root unless exec runs as the workspace owner;
   * host-side `npm test` then hits EACCES on `node_modules/.vite-temp`.
   * No-op when the adapter does not bind-mount a host tree.
   */
  prepareHostWorkspace(): Promise<void>;
  /** Headed Chromium when the adapter has Browser CDP; otherwise undefined. */
  chromium(): ChromiumDriver | undefined;
}

export function str(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

export function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function num(args: Record<string, unknown>, key: string, fallback = 0): number {
  return optNum(args, key) ?? fallback;
}

export function truthy(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  return value === true || value === 1 || value === "true" || value === "1";
}

/** Surrounding context lines for grep. Default 3 so hits are readable without a follow-up read. */
export function grepContextLines(args: Record<string, unknown>, fallback = 3): number {
  const value = args.context;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(8, Math.max(0, Math.round(value)));
}
