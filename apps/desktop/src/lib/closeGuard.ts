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
  /** Present in desktop builds with update install support. */
  installUpdate?: (
    path: string,
  ) => Promise<{ ok: boolean; action?: "relaunching" | "installer" | "opened"; error?: string }>;
  /** Quit and relaunch, stopping the control plane even when Keep running is on. */
  restartApp?: () => Promise<{ ok: boolean }>;
  /** Tray menu + dock/taskbar badge counts. */
  setAmbientStatus?: (status: { running: number; needsYou: number }) => void;
  /** System notification routed back through `onAmbientAction`. */
  notify?: (request: {
    title: string;
    body: string;
    sessionId?: string;
    callId?: string;
    approvable?: boolean;
  }) => void;
  onAmbientAction?: (callback: (payload: AmbientAction) => void) => () => void;
};

/** Tray menu or notification click, delivered from the desktop shell. */
export type AmbientAction = {
  action: "open" | "inbox" | "approve" | "deny";
  sessionId?: string;
  callId?: string;
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
