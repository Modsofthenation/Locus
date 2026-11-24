import type { ToolRequest, ToolResult } from "@locus/guest-agent";
import type { GuestRuntime } from "@locus/guest-agent";
import {
  execArgCommands,
  guessListenPorts,
  isGuestReady,
  pickPreviewPort,
  sessionRuntime,
  sessionVision,
  toolNeedsGuest,
  toolsForRuntime,
  type AgentSession,
  type LocusConfig,
  type VmInstance,
} from "@locus/shared";
import { executeSessionForgeTool, type SessionForgeDeps } from "./sessionForgeTools.js";

export type GuestCatalogExecutePorts = {
  tryIndexedGrep: (
    session: AgentSession,
    req: ToolRequest,
    config: LocusConfig,
    fenceHostile: (name: string, output: string) => string,
  ) => Promise<ToolResult | undefined>;
  forge: SessionForgeDeps;
  isWorkerSession: (session: AgentSession) => boolean;
  executeHostTool: (
    session: AgentSession,
    req: ToolRequest,
    opts?: { ignoreAllowlist?: boolean; onOutput?: (chunk: string) => void },
  ) => Promise<ToolResult>;
  getMachine: (vmId: string) => VmInstance | undefined;
  guests: { forVm: (vm: VmInstance) => GuestRuntime };
  aborts: Map<string, AbortController>;
  injectForgeGitArgs: (session: AgentSession, req: ToolRequest) => Promise<ToolRequest>;
  broadcastToolOverlay: (sessionId: string, req: ToolRequest) => void;
  snapshotFileUndo: (
    session: AgentSession,
    guest: GuestRuntime,
    req: ToolRequest,
    opts?: { ignoreAllowlist?: boolean },
  ) => Promise<void>;
  settleExecutedTool: (
    session: AgentSession,
    req: ToolRequest,
    result: ToolResult,
    opts?: { ignoreAllowlist?: boolean },
  ) => Promise<ToolResult>;
  persistRecording: (sessionId: string, vm: VmInstance, result: ToolResult) => Promise<ToolResult>;
  persistArtifact: (sessionId: string, result: ToolResult) => Promise<ToolResult>;
  noteListeningPorts?: (vmId: string, ports: number[]) => void;
  mutatePreview: (sessionId: string, port: number) => Promise<void>;
  openPreview: (
    session: AgentSession,
    vm: VmInstance,
    args: Record<string, unknown>,
  ) => Promise<ToolResult>;
  publishToolResult: (
    sessionId: string,
    req: ToolRequest,
    result: ToolResult,
  ) => Promise<ToolResult>;
};

const GUI_TOOLS = new Set([
  "screenshot",
  "mouse_move",
  "mouse_click",
  "mouse_drag",
  "mouse_scroll",
  "key",
  "type_text",
  "window_focus",
]);

/** Runtime catalog execute: allow → Guest/Host adapter → settle/publish. */
export async function executeGuestCatalogTool(
  ports: GuestCatalogExecutePorts,
  session: AgentSession,
  req: ToolRequest,
  opts: { ignoreAllowlist?: boolean; onOutput?: (chunk: string) => void } | undefined,
  fenceHostile: (name: string, output: string) => string,
  config: LocusConfig,
): Promise<ToolResult> {
  const runtime = sessionRuntime(session);
  const catalog = new Set(toolsForRuntime(session.os, runtime).map((t) => t.name));
  if (!catalog.has(req.name)) {
    throw new Error(`Tool ${req.name} is not available for this agent`);
  }
  if (req.name === "grep") {
    const indexed = await ports.tryIndexedGrep(session, req, config, fenceHostile);
    if (indexed) return indexed;
  }
  const forge = await executeSessionForgeTool(ports.forge, session, req, fenceHostile);
  if (forge) return forge;
  if (runtime === "host" && !ports.isWorkerSession(session)) {
    return ports.executeHostTool(session, req, opts);
  }
  const vm = session.vmId ? ports.getMachine(session.vmId) : undefined;
  if (!vm) {
    throw new Error(
      runtime === "docker"
        ? "Start the container before using guest tools"
        : "Start the VM before using guest tools",
    );
  }
  if (toolNeedsGuest(req.name) && !isGuestReady(vm.status)) {
    throw new Error(
      `The guest isn't ready yet (${vm.status}). Wait until it finishes starting, then try again.`,
    );
  }
  if (req.name === "preview") {
    return ports.openPreview(session, vm, req.args);
  }
  req = await ports.injectForgeGitArgs(session, req);
  ports.broadcastToolOverlay(session.id, req);
  const guest = ports.guests.forVm(vm);
  await ports.snapshotFileUndo(session, guest, req, opts);
  let result = await guest.execute(req, ports.aborts.get(session.id)?.signal, opts?.onOutput);
  result = await ports.settleExecutedTool(session, req, result, opts);
  if (req.name === "record_screen") {
    result = await ports.persistRecording(session.id, vm, result);
  }
  if (
    req.name === "browser_pdf" ||
    req.name === "browser_trace" ||
    req.name === "browser_download"
  ) {
    result = await ports.persistArtifact(session.id, result);
  }
  if (result.ok && (req.name === "exec" || req.name === "start_process")) {
    const command = execArgCommands(req.args).join("\n");
    const guessed = guessListenPorts(command);
    if (guessed.length) {
      ports.noteListeningPorts?.(vm.id, guessed);
      if (!session.preview) {
        const port = pickPreviewPort(guessed) ?? guessed[0]!;
        await ports.mutatePreview(session.id, port);
      }
    }
  }
  if (GUI_TOOLS.has(req.name) && req.name !== "screenshot" && sessionVision(session) !== "off") {
    try {
      const shot = await guest.execute({ name: "screenshot", args: {} });
      if (shot.screenshotBase64) result.screenshotBase64 = shot.screenshotBase64;
    } catch {
      /* screenshot is optional */
    }
  }
  return await ports.publishToolResult(session.id, req, result);
}
