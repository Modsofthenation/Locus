import type { Dispatch } from "react";
import { parseProductMode, type LocusConfig, type ProductMode } from "@locus/shared";
import type { Action, UiSection } from "@/state/store";
import { moreRailSections, primaryRailSections } from "./railNav";

export const PRODUCT_MODE_TRANSITION_MS = 360;

export const PRODUCT_MODE_LABELS: Record<ProductMode, string> = {
  developer: "Developer",
  swarm: "Swarm",
};

/** Show the mascot while a product-mode save and shell update settle. */
export function beginProductModeTransition(
  next: ProductMode,
  prev: ProductMode,
  dispatch: Dispatch<Action>,
): (() => Promise<void>) | null {
  if (next === prev) return null;
  const startedAt = Date.now();
  dispatch({ type: "productModeTransition", transition: { from: prev, to: next } });
  return async () => {
    const remaining = PRODUCT_MODE_TRANSITION_MS - (Date.now() - startedAt);
    if (remaining > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, remaining));
    dispatch({ type: "productModeTransition", transition: null });
  };
}

/** Side effects after productMode changes (rail icon or Settings save). */
export function applyProductModeSideEffects(
  next: ProductMode,
  prev: ProductMode | undefined,
  dispatch: Dispatch<Action>,
  opts: { vmCollapsed: boolean; sidebarCollapsed?: boolean },
): void {
  if (next === prev) return;
  if (next === "swarm") {
    dispatch({ type: "section", section: "agents" });
    // Do not carry a Developer chat into the Swarm shell. Start at the
    // teammate creation surface instead; selecting an existing teammate
    // remains an explicit action in the Swarm roster.
    dispatch({ type: "select", id: null });
    // Messenger shell wants the computer column open by default.
    if (opts.vmCollapsed) dispatch({ type: "toggleVmPane" });
    // Keep the teammate list visible beside the icon rail.
    if (opts.sidebarCollapsed) dispatch({ type: "toggleSidebar" });
  }
}

export function productModeFromConfig(
  config?: Pick<LocusConfig, "productMode"> | null,
): ProductMode {
  return parseProductMode(config?.productMode);
}

/** Swarm messenger: Teammates, Teams, More surfaces, and Settings. */
export function swarmShellKeepsSection(section: string): boolean {
  if (section === "settings") return true;
  const id = section as UiSection;
  return (
    (primaryRailSections("swarm") as readonly string[]).includes(id) ||
    (moreRailSections("swarm") as readonly string[]).includes(id)
  );
}
