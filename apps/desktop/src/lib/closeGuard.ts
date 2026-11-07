import type { SessionStatus } from "@locus/shared";

export type CloseGuardSession = {
  status: SessionStatus;
  title: string;
  subagents?: Array<{ status: string }>;
};

export type LocusDesktopBridge = {
  setCloseGuard: (armed: boolean) => void;
  onCloseRequested: (callback: () => void) => () => void;
  ackClosePrompt: () => void;
  confirmClose: () => void;
};

declare global {
  interface Window {
    locusDesktop?: LocusDesktopBridge;
  }
}

export function isActiveAgent(session: CloseGuardSession): boolean {
  if (session.status === "running" || session.status === "provisioning") return true;
  return Boolean(session.subagents?.some((row) => row.status === "running"));
}

export function activeAgents(sessions: CloseGuardSession[]): CloseGuardSession[] {
  return sessions.filter(isActiveAgent);
}

export function shouldConfirmClose(sessions: CloseGuardSession[]): boolean {
  return sessions.some(isActiveAgent);
}

export function closeConfirmCopy(agents: Array<Pick<CloseGuardSession, "title">>): {
  title: string;
  body: string;
} {
  if (agents.length > 1) {
    return {
      title: "Active agents",
      body: `There are currently ${agents.length} active agents. Are you sure you want to close?`,
    };
  }
  return {
    title: "Active agent",
    body: "There is currently an active agent. Are you sure you want to close?",
  };
}

export function desktopBridge(
  win: Pick<Window, "locusDesktop"> = window,
): LocusDesktopBridge | undefined {
  return win.locusDesktop;
}
