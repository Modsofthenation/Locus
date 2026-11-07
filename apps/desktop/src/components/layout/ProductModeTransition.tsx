import { parseProductMode } from "@locus/shared";
import { Mascot } from "@/components/layout/Mascot";
import { PRODUCT_MODE_LABELS } from "@/lib/productMode";
import type { ProductModeTransition as ProductModeTransitionState } from "@/state/store";

export function ProductModeTransition(props: { transition: ProductModeTransitionState }) {
  const mode = parseProductMode(props.transition.to);
  const label = PRODUCT_MODE_LABELS[mode];

  return (
    <div
      className="product-mode-transition"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="product-mode-transition"
    >
      <div className="product-mode-transition-card">
        <Mascot pose="think" size={96} title={`Switching to ${label}`} />
        <p>Switching to {label}</p>
        <span>Getting your workspace ready...</span>
      </div>
    </div>
  );
}
