import {
  isCanvasSession,
  sessionPlacement,
  sessionRuntime,
  type AgentSession,
} from "@locus/shared";
import { dockerWorkspaceDir } from "@locus/hypervisor";

/** Coding sessions clone into `/workspace`; keep that tree empty until git clone returns. */
export function repoWorkspaceClonePending(
  session: AgentSession,
  cloned: ReadonlySet<string>,
  cloneInflight: ReadonlyMap<string, Promise<void>>,
): boolean {
  if (!session.repo?.url || isCanvasSession(session)) return false;
  return !cloned.has(session.id) || cloneInflight.has(session.id);
}

/** Workspace root that may receive `.locus-attachments`. Undefined while a coding clone is in flight. */
export function attachmentWorkspaceRoot(
  session: AgentSession,
  cloned: ReadonlySet<string>,
  cloneInflight: ReadonlyMap<string, Promise<void>>,
  dataDir: string,
  hostRoot: string,
): string | undefined {
  if (repoWorkspaceClonePending(session, cloned, cloneInflight)) return undefined;
  if (sessionPlacement(session) === "worker") return undefined;
  const runtime = sessionRuntime(session);
  if (runtime === "docker") return dockerWorkspaceDir(dataDir, session.id);
  if (runtime === "host") return hostRoot;
  return undefined;
}
