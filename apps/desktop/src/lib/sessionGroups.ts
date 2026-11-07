import { shortRepoName } from "@locus/shared";

export type DayGroupId = "pinned" | "today" | "yesterday" | "week" | "earlier";

export const DAY_GROUP_LABELS: Record<DayGroupId, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};

const DAY_GROUP_ORDER: DayGroupId[] = ["pinned", "today", "yesterday", "week", "earlier"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Unpinned idle/draft chats older than this are Archive idle targets. */
export const IDLE_ARCHIVE_AFTER_MS = 7 * MS_PER_DAY;

export function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function sessionDayGroup(
  iso: string,
  now: Date = new Date(),
): Exclude<DayGroupId, "pinned"> {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "earlier";
  const today = startOfLocalDay(now);
  if (t >= today) return "today";
  if (t >= today - MS_PER_DAY) return "yesterday";
  if (t >= today - 6 * MS_PER_DAY) return "week";
  return "earlier";
}

export interface DayGroup<T> {
  id: DayGroupId;
  label: string;
  items: T[];
}

export function groupSessionsByDay<T extends { pinned?: boolean; updatedAt: string }>(
  sessions: T[],
  now: Date = new Date(),
): DayGroup<T>[] {
  const buckets: Record<DayGroupId, T[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    week: [],
    earlier: [],
  };
  for (const session of sessions) {
    if (session.pinned) buckets.pinned.push(session);
    else buckets[sessionDayGroup(session.updatedAt, now)].push(session);
  }
  return DAY_GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    label: DAY_GROUP_LABELS[id],
    items: buckets[id],
  }));
}

export function sessionRepoKey(session: {
  repoId?: string;
  repo?: { url?: string };
}): string | null {
  const id = session.repoId?.trim();
  if (id) return `id:${id}`;
  const url = session.repo?.url?.trim();
  if (url) return `url:${url}`;
  return null;
}

export function sessionRepoLabel(
  session: { repoId?: string; repo?: { url?: string } },
  repos: Array<{ id: string; name: string; checkout: { url: string } }> = [],
): string {
  if (session.repo?.url) return shortRepoName(session.repo.url);
  if (session.repoId) {
    const repo = repos.find((row) => row.id === session.repoId);
    if (repo) return shortRepoName(repo.checkout.url, repo.name.split("/").at(-1) ?? repo.name);
  }
  return "repo";
}

export interface RepoCluster<T> {
  key: string;
  label: string | null;
  items: T[];
}

/** Nest a repo heading only when two or more sessions in the list share a repo. */
export function clusterSessionsByRepo<T extends { id: string }>(
  sessions: T[],
  keyFor: (session: T) => string | null,
  labelFor: (session: T) => string,
): RepoCluster<T>[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const key = keyFor(session);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const clusters: RepoCluster<T>[] = [];
  const visited = new Set<string>();
  for (const session of sessions) {
    if (visited.has(session.id)) continue;
    const key = keyFor(session);
    if (key && (counts.get(key) ?? 0) >= 2) {
      const items = sessions.filter((row) => keyFor(row) === key);
      for (const row of items) visited.add(row.id);
      clusters.push({ key, label: labelFor(items[0]!), items });
      continue;
    }
    visited.add(session.id);
    const last = clusters.at(-1);
    if (last && last.label == null) last.items.push(session);
    else clusters.push({ key: session.id, label: null, items: [session] });
  }
  return clusters;
}

export function isEmptyDraftSession(session: {
  status: string;
  archived?: boolean;
  pinned?: boolean;
  messages: Array<{ role: string }>;
}): boolean {
  if (session.archived || session.pinned) return false;
  if (session.status !== "draft") return false;
  return !session.messages.some((message) => message.role === "user");
}

export function isIdleArchiveCandidate(
  session: {
    status: string;
    archived?: boolean;
    pinned?: boolean;
    updatedAt: string;
  },
  now: Date = new Date(),
  maxAgeMs = IDLE_ARCHIVE_AFTER_MS,
): boolean {
  if (session.archived || session.pinned) return false;
  if (session.status !== "idle" && session.status !== "draft") return false;
  const t = Date.parse(session.updatedAt);
  if (Number.isNaN(t)) return false;
  return now.getTime() - t >= maxAgeMs;
}

export const HIDE_AUTOMATION_CHATS_KEY = "locus.hideAutomationChats";

/** Hide automation-spawned chats from Agents by default. */
export function loadHideAutomationChats(): boolean {
  try {
    const raw = localStorage.getItem(HIDE_AUTOMATION_CHATS_KEY);
    if (raw == null || raw === "") return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function saveHideAutomationChats(hide: boolean): void {
  try {
    localStorage.setItem(HIDE_AUTOMATION_CHATS_KEY, hide ? "1" : "0");
  } catch {
    /* ignore */
  }
}
