import type { ProductMode } from "@locus/shared";
import type { UiSection } from "@/state/store";
import { isLockedRailSection, moreRailSections } from "./railNav";

/**
 * Pin suggestions for rail sections that live in More.
 * Signals say a section is in use; each section is suggested at most once.
 */

/** Cheap usage signals read from app state. */
export type RailUsage = {
  /** At least one Design canvas exists. */
  designs: boolean;
  /** At least one automation exists. */
  automations: boolean;
  /** A Grafana token is saved in Settings → Integrations. */
  grafanaToken: boolean;
  /** Docker engine detected. */
  dockerFound: boolean;
  /** At least one Docker agent exists. */
  dockerAgents: boolean;
};

/** Sections whose state signal is on, in suggestion order. */
export function railUsageSignals(usage: RailUsage): UiSection[] {
  const out: UiSection[] = [];
  if (usage.designs) out.push("design");
  if (usage.automations) out.push("automations");
  if (usage.grafanaToken) out.push("grafana");
  if (usage.dockerFound && usage.dockerAgents) out.push("docker");
  return out;
}

/**
 * The one section to suggest pinning, or null.
 * Developer rail only (Swarm hides it). Skips pinned, locked, and already-answered sections.
 */
export function railPinSuggestion(input: {
  mode: ProductMode;
  pinned: readonly UiSection[];
  done: readonly string[];
  signals: readonly UiSection[];
}): UiSection | null {
  if (input.mode !== "developer") return null;
  const more = moreRailSections(input.mode);
  for (const section of input.signals) {
    if (!more.includes(section)) continue;
    if (input.pinned.includes(section)) continue;
    if (isLockedRailSection(section, input.mode)) continue;
    if (input.done.includes(section)) continue;
    return section;
  }
  return null;
}

/** Record that a suggestion was answered so it never shows again. */
export function markRailHintDone(done: readonly string[], section: UiSection): string[] {
  return done.includes(section) ? [...done] : [...done, section];
}

/** Add an event signal once, keeping first-seen order. */
export function addRailSignal(signals: readonly UiSection[], section: UiSection): UiSection[] {
  return signals.includes(section) ? [...signals] : [...signals, section];
}

type RailSignalListener = (section: UiSection) => void;
const listeners = new Set<RailSignalListener>();

/** Report an action that makes a section relevant (opened an .html file, used the palette). */
export function noteRailSignal(section: UiSection): void {
  for (const listener of listeners) listener(section);
}

export function onRailSignal(listener: RailSignalListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
