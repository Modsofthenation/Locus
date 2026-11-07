export const SWARM_ROSTER_PREFS_KEY = "locus.swarmRoster";

export interface SwarmRosterSection {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SwarmRosterPrefs {
  hiddenSessionIds: string[];
  sections: SwarmRosterSection[];
}

const EMPTY: SwarmRosterPrefs = { hiddenSessionIds: [], sections: [] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function parseSection(value: unknown): SwarmRosterSection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<SwarmRosterSection>;
  if (typeof row.id !== "string" || !row.id) return null;
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  if (!isStringArray(row.sessionIds)) return null;
  return { id: row.id, name: row.name.trim(), sessionIds: [...row.sessionIds] };
}

export function loadSwarmRosterPrefs(
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): SwarmRosterPrefs {
  if (!storage) return { ...EMPTY, hiddenSessionIds: [], sections: [] };
  try {
    const raw = storage.getItem(SWARM_ROSTER_PREFS_KEY);
    if (!raw) return { hiddenSessionIds: [], sections: [] };
    const parsed = JSON.parse(raw) as Partial<SwarmRosterPrefs>;
    const hiddenSessionIds = isStringArray(parsed.hiddenSessionIds)
      ? [...parsed.hiddenSessionIds]
      : [];
    const sections = Array.isArray(parsed.sections)
      ? parsed.sections.map(parseSection).filter((row): row is SwarmRosterSection => Boolean(row))
      : [];
    return { hiddenSessionIds, sections };
  } catch {
    return { hiddenSessionIds: [], sections: [] };
  }
}

export function saveSwarmRosterPrefs(
  prefs: SwarmRosterPrefs,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  const next: SwarmRosterPrefs = {
    hiddenSessionIds: [...prefs.hiddenSessionIds],
    sections: prefs.sections.map((section) => ({
      id: section.id,
      name: section.name,
      sessionIds: [...section.sessionIds],
    })),
  };
  storage.setItem(SWARM_ROSTER_PREFS_KEY, JSON.stringify(next));
}

export function hideSwarmSession(prefs: SwarmRosterPrefs, sessionId: string): SwarmRosterPrefs {
  if (prefs.hiddenSessionIds.includes(sessionId)) return prefs;
  return { ...prefs, hiddenSessionIds: [...prefs.hiddenSessionIds, sessionId] };
}

export function showSwarmSession(prefs: SwarmRosterPrefs, sessionId: string): SwarmRosterPrefs {
  if (!prefs.hiddenSessionIds.includes(sessionId)) return prefs;
  return {
    ...prefs,
    hiddenSessionIds: prefs.hiddenSessionIds.filter((id) => id !== sessionId),
  };
}

export function moveSwarmSessionToSection(
  prefs: SwarmRosterPrefs,
  sessionId: string,
  sectionId: string | null,
): SwarmRosterPrefs {
  const sections = prefs.sections.map((section) => ({
    ...section,
    sessionIds: section.sessionIds.filter((id) => id !== sessionId),
  }));
  if (sectionId) {
    const target = sections.find((section) => section.id === sectionId);
    if (target && !target.sessionIds.includes(sessionId)) {
      target.sessionIds = [...target.sessionIds, sessionId];
    }
  }
  return { ...prefs, sections };
}

export function addSwarmRosterSection(
  prefs: SwarmRosterPrefs,
  name: string,
  sessionId?: string,
): SwarmRosterPrefs {
  const trimmed = name.trim();
  if (!trimmed) return prefs;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `section-${Date.now()}`;
  const section: SwarmRosterSection = {
    id,
    name: trimmed,
    sessionIds: sessionId ? [sessionId] : [],
  };
  const withoutSession = sessionId ? moveSwarmSessionToSection(prefs, sessionId, null) : prefs;
  return {
    ...withoutSession,
    sections: [...withoutSession.sections, section],
  };
}

export function sectionIdForSession(prefs: SwarmRosterPrefs, sessionId: string): string | null {
  for (const section of prefs.sections) {
    if (section.sessionIds.includes(sessionId)) return section.id;
  }
  return null;
}
