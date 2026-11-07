import type { Dispatch } from "react";
import { parseProductMode, type LocusConfig, type ProductMode } from "@locus/shared";
import { api } from "@/lib/api";
import {
  applyProductModeSideEffects,
  beginProductModeTransition,
  PRODUCT_MODE_LABELS,
} from "@/lib/productMode";
import type { Action } from "@/state/store";
import { useStore } from "@/state/store";

/** Persist product mode and run shell side effects. */
export async function setProductMode(
  next: ProductMode,
  opts: {
    config: LocusConfig;
    dispatch: Dispatch<Action>;
    vmCollapsed: boolean;
    sidebarCollapsed: boolean;
  },
): Promise<ProductMode | null> {
  const prev = parseProductMode(opts.config.productMode);
  if (next === prev) return prev;
  const finishTransition = beginProductModeTransition(next, prev, opts.dispatch);
  try {
    const saved = await api.saveConfig({ ...opts.config, productMode: next });
    opts.dispatch({ type: "config", config: saved });
    applyProductModeSideEffects(next, prev, opts.dispatch, {
      vmCollapsed: opts.vmCollapsed,
      sidebarCollapsed: opts.sidebarCollapsed,
    });
    return parseProductMode(saved.productMode);
  } catch {
    return null;
  } finally {
    await finishTransition?.();
  }
}

/** Full-width Dev / Swarm radios — kept for tests and optional settings embeds. */
export function ProductModeToggle(props: { compact?: boolean }) {
  const { state, dispatch } = useStore();
  const mode = parseProductMode(state.config?.productMode);

  async function setMode(next: ProductMode) {
    if (!state.config) return;
    await setProductMode(next, {
      config: state.config,
      dispatch,
      vmCollapsed: state.vmCollapsed,
      sidebarCollapsed: state.collapsed,
    });
  }

  return (
    <div
      className={`product-mode-toggle${props.compact ? " compact" : ""}`}
      role="radiogroup"
      aria-label="Product mode"
      data-testid="product-mode-toggle"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "developer"}
        aria-label={PRODUCT_MODE_LABELS.developer}
        title={PRODUCT_MODE_LABELS.developer}
        className={mode === "developer" ? "on" : ""}
        data-testid="product-mode-developer"
        onClick={() => void setMode("developer")}
      >
        {PRODUCT_MODE_LABELS.developer}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "swarm"}
        aria-label={PRODUCT_MODE_LABELS.swarm}
        title={PRODUCT_MODE_LABELS.swarm}
        className={mode === "swarm" ? "on" : ""}
        data-testid="product-mode-swarm"
        onClick={() => void setMode("swarm")}
      >
        {props.compact ? "Swarm" : PRODUCT_MODE_LABELS.swarm}
      </button>
    </div>
  );
}
