import {
  isBoardSession,
  isProjectSession,
  isCanvasSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  isHiddenChatMessage,
  isIdeSession,
  operatorVisibleText,
  sessionRuntime,
  shortRepoName,
  type AgentSession,
  type LinkedRepo,
  type ToolCall,
} from "@locus/shared";
import { startOfLocalDay } from "./sessionGroups";
import { phoneToken } from "./phoneAuth";

export const UI_SHELL_KEY = "locus.shell";
export type UiShell = "desktop" | "mobile";

export type MobileApproval = {
  sessionId: string;
  title: string;
  call: ToolCall;
};

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function parseShell(value: string | null | undefined): UiShell | undefined {
  const raw = value?.trim().toLowerCase();
  if (raw === "mobile" || raw === "desktop") return raw;
  return undefined;
}

export function setUiShell(
  shell: UiShell,
  storage: Pick<Storage, "setItem"> | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(UI_SHELL_KEY, shell);
  } catch {
    /* private mode */
  }
}

export function initUiShell(
  loc: Pick<Location, "pathname" | "search" | "hash"> = location,
  historyApi: Pick<History, "replaceState"> = history,
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = defaultStorage(),
): UiShell {
  const params = new URLSearchParams(loc.search);
  const fromQuery = parseShell(params.get("shell"));
  if (fromQuery) {
    setUiShell(fromQuery, storage);
    params.delete("shell");
    const search = params.toString();
    try {
      historyApi.replaceState(null, "", `${loc.pathname}${search ? `?${search}` : ""}${loc.hash}`);
    } catch {
      /* ignore */
    }
    return fromQuery;
  }
  return resolveUiShell({ storage, token: phoneToken() });
}

export function resolveUiShell(opts?: {
  token?: string;
  storage?: Pick<Storage, "getItem">;
}): UiShell {
  const storage = opts?.storage ?? defaultStorage();
  try {
    const stored = parseShell(storage?.getItem(UI_SHELL_KEY));
    if (stored) return stored;
  } catch {
    /* ignore */
  }
  const token = opts?.token ?? phoneToken();
  return token ? "mobile" : "desktop";
}

export function mobileSessions(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter(
    (session) =>
      !session.archived &&
      !isCanvasSession(session) &&
      !isIdeSession(session) &&
      !isBoardSession(session) &&
      !isProjectSession(session),
  );
}

/** Design canvases on the phone shell. Coding chats stay in `mobileSessions`. */
export function mobileDesigns(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter((session) => !session.archived && isDesignSession(session));
}

/** Game canvases on the phone shell. */
export function mobileGames(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter((session) => !session.archived && isGameSession(session));
}

/** Asset studios on the phone shell. */
export function mobileAssets(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter((session) => !session.archived && isAssetSession(session));
}

/** Host IDE workspaces on the phone shell. */
export function mobileIdeWorkspaces(sessions: AgentSession[]): AgentSession[] {
  return sessions.filter((session) => !session.archived && isIdeSession(session));
}

/** Docker (local or worker) coding guests expose the live Chromium pane. */
export function sessionShowsBrowser(session: AgentSession): boolean {
  return sessionRuntime(session) === "docker" && !isCanvasSession(session);
}

/** QEMU guests expose a view-only VNC pane on the phone. Control stays on the desktop. */
export function sessionShowsVnc(session: AgentSession): boolean {
  return sessionRuntime(session) === "vm" && Boolean(session.vmId);
}

export function pendingApprovals(sessions: AgentSession[]): MobileApproval[] {
  const out: MobileApproval[] = [];
  const seen = new Set<string>();
  for (const session of mobileSessions(sessions)) {
    for (const message of session.messages) {
      for (const call of message.toolCalls ?? []) {
        if (call.approval !== "needed" || call.finishedAt) continue;
        if (seen.has(call.id)) continue;
        seen.add(call.id);
        out.push({ sessionId: session.id, title: session.title, call });
      }
    }
  }
  return out;
}

const MONTHS_SHORT = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Clip on a word boundary so list snippets never cut a word mid-way. */
export function clipOnWords(text: string, max = 96): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  const slice = compact.slice(0, max);
  const boundary = slice.search(/\s+\S*$/);
  const kept = (boundary >= Math.floor(max * 0.45) ? slice.slice(0, boundary) : slice).trimEnd();
  return `${kept}…`;
}

export function lastChatSnippet(session: AgentSession): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (!message || isHiddenChatMessage(message) || message.role !== "user") continue;
    const text = operatorVisibleText(message.role, message.content).replace(/\s+/g, " ").trim();
    if (text) return clipOnWords(text);
  }
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (!message || isHiddenChatMessage(message) || message.role !== "assistant") continue;
    const text = operatorVisibleText(message.role, message.content).replace(/\s+/g, " ").trim();
    if (text) return clipOnWords(text);
  }
  return "No messages yet";
}

export function compactRelativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const delta = Math.max(0, now - t);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  if (delta < 7 * MS_PER_DAY) return `${Math.floor(delta / MS_PER_DAY)}d`;
  const date = new Date(t);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function mobileDayLabel(
  iso: string,
  now: Date = new Date(),
  mode: "calendar" | "today-earlier" = "calendar",
): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "EARLIER";
  const today = startOfLocalDay(now);
  if (t >= today) return "TODAY";
  if (mode === "today-earlier") return "EARLIER";
  const date = new Date(t);
  if (startOfLocalDay(date) >= today - 6 * MS_PER_DAY) {
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
  }
  return "EARLIER";
}

export function groupMobileRows<T extends { updatedAt: string }>(
  rows: T[],
  mode: "calendar" | "today-earlier" = "calendar",
  now: Date = new Date(),
): Array<{ label: string; items: T[] }> {
  const groups: Array<{ label: string; items: T[] }> = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const label = mobileDayLabel(row.updatedAt, now, mode);
    const at = index.get(label);
    if (at != null) {
      groups[at]!.items.push(row);
      continue;
    }
    index.set(label, groups.length);
    groups.push({ label, items: [row] });
  }
  groups.sort((a, b) => mobileGroupStamp(b.items) - mobileGroupStamp(a.items));
  return groups;
}

function mobileGroupStamp(items: Array<{ updatedAt: string }>): number {
  let max = 0;
  for (const row of items) {
    const t = Date.parse(row.updatedAt);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

export type MobileAgentFilter = "all" | "needs" | "running" | "unseen";

export function filterMobileAgents(
  sessions: AgentSession[],
  filter: MobileAgentFilter,
  unreadIds: string[],
): AgentSession[] {
  const unread = new Set(unreadIds);
  return sessions.filter((row) => {
    if (filter === "needs") return sessionNeedsYou(row);
    if (filter === "running") return row.status === "running" || row.status === "provisioning";
    if (filter === "unseen") return unread.has(row.id);
    return true;
  });
}

export function matchesMobileQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

export type AgentStatusTone = "running" | "needs" | "ok" | "idle";

export function agentStatusTone(session: AgentSession, now = Date.now()): AgentStatusTone {
  if (sessionNeedsYou(session) || session.status === "error") return "needs";
  if (session.status === "running" || session.status === "provisioning") return "running";
  const t = Date.parse(session.updatedAt);
  if (Number.isFinite(t) && now - t > 36 * 3_600_000) return "idle";
  return "ok";
}

export function sessionProjectLabel(
  session: AgentSession,
  repos: Array<Pick<LinkedRepo, "id" | "name"> & { checkout: { url: string } }> = [],
): string {
  if (session.repo?.url) return shortRepoName(session.repo.url);
  if (session.repoId) {
    const repo = repos.find((row) => row.id === session.repoId);
    if (repo) return shortRepoName(repo.checkout.url, repo.name.split("/").at(-1) ?? repo.name);
  }
  if (session.hostDir) {
    const parts = session.hostDir.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.at(-1) || "host";
  }
  return "local";
}

export function sessionMetaLine(
  session: AgentSession,
  repos: Array<Pick<LinkedRepo, "id" | "name"> & { checkout: { url: string } }> = [],
): { text: string; waiting: boolean } {
  const text = `${sessionProjectLabel(session, repos)} / ${sessionRuntime(session)}`;
  return { text, waiting: sessionNeedsYou(session) };
}

export function designMetaLine(session: AgentSession): string {
  const frames = session.designVariants?.length ?? 0;
  const mid =
    frames > 0 ? `${frames} ${frames === 1 ? "frame" : "frames"}` : sessionRuntime(session);
  return `canvas / ${mid} / ${compactRelativeTime(session.updatedAt)}`;
}

export function sessionNeedsYou(session: AgentSession): boolean {
  if (session.needsHuman?.trim()) return true;
  return pendingApprovals([session]).length > 0;
}

export function sessionStatusLabel(session: AgentSession): string {
  if (sessionNeedsYou(session)) return "Needs you";
  if (session.status === "running") return "Working";
  if (session.status === "error" || session.error) return "Error";
  if (session.status === "provisioning") return "Starting";
  return session.runtime === "host" ? "Host" : session.runtime === "docker" ? "Docker" : "Agent";
}

export type MobileViewport = {
  height: number;
  offsetTop: number;
  addEventListener: (type: "resize" | "scroll", listener: () => void) => void;
  removeEventListener: (type: "resize" | "scroll", listener: () => void) => void;
};

/** Shrink overflowing phone-canvas content until it fits the available width. */
export function canvasFitScale(available: number, content: number, minScale = 0.55): number {
  if (!(available > 0) || !(content > 0) || content <= available + 1) return 1;
  return Math.max(minScale, available / content);
}

export function bindMobileViewport(
  target: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> = document.documentElement
    .style,
  viewport: MobileViewport | null = typeof window === "undefined"
    ? null
    : ((window.visualViewport as MobileViewport | null | undefined) ?? null),
  innerHeight: () => number = () => (typeof window === "undefined" ? 0 : window.innerHeight),
): () => void {
  function sync() {
    const height = viewport?.height ?? innerHeight();
    const top = viewport?.offsetTop ?? 0;
    target.setProperty("--mobile-vh", `${Math.round(height)}px`);
    target.setProperty("--mobile-vt", `${Math.round(top)}px`);
  }
  sync();
  viewport?.addEventListener("resize", sync);
  viewport?.addEventListener("scroll", sync);
  const win = typeof window === "undefined" ? undefined : window;
  if (!viewport) win?.addEventListener("resize", sync);
  return () => {
    viewport?.removeEventListener("resize", sync);
    viewport?.removeEventListener("scroll", sync);
    if (!viewport) win?.removeEventListener("resize", sync);
    target.removeProperty("--mobile-vh");
    target.removeProperty("--mobile-vt");
  };
}
