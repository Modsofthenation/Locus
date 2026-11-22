import { useSyncExternalStore } from "react";
import { parseProductMode, sessionMatchesSurface, type AgentSession } from "@locus/shared";
import { sessionFitsSection, type UiState } from "@/state/store";

/** Android projects listed in the topbar picker for the current product surface. */
export function androidProjects(state: UiState): AgentSession[] {
  const surface = parseProductMode(state.config?.productMode);
  return state.sessions.filter(
    (s) => sessionFitsSection(s, "android") && !s.archived && sessionMatchesSurface(s, surface),
  );
}

/*
 * "+ New project" clears the selection (like the sidebar's New Android project) and remembers
 * the project it left, so the topbar can offer "Back to <project>" while the start form shows.
 */
let returnTo: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  if (next === returnTo) return;
  returnTo = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => returnTo;

/** The project "+ New project" was pressed from, if any. */
export function useAndroidReturnTo(): string | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function rememberAndroidReturn(id: string | null) {
  set(id);
}

/** Read without subscribing (tests). */
export function androidReturnTo(): string | null {
  return returnTo;
}

/** The device panel opens once per project, like Design opens its canvas on select. */
let panelOpenedFor: string | null = null;
export function claimAndroidPanelOpen(id: string): boolean {
  if (panelOpenedFor === id) return false;
  panelOpenedFor = id;
  return true;
}
