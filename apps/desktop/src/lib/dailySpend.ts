import { useEffect, useState } from "react";
import { formatDailySpendHint, hasAnyBudgetCap, type BudgetSettings } from "@locus/shared";
import { api } from "./api";

/**
 * "Today $1.20 / $5.00" for the composer meta line when a daily cap is set. Refetches when the
 * session's token total moves, at most every few seconds.
 */
export function useDailySpendHint(
  budgets: BudgetSettings | undefined,
  usageTotal: number,
): string | undefined {
  const [hint, setHint] = useState<string | undefined>(undefined);
  const enabled = hasAnyBudgetCap(budgets);
  const bucket = Math.floor(usageTotal / 2_000);
  useEffect(() => {
    if (!enabled) {
      setHint(undefined);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => api.budgets())
        .then((row) => {
          if (!cancelled) setHint(formatDailySpendHint(row.status));
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, bucket]);
  return enabled ? hint : undefined;
}
