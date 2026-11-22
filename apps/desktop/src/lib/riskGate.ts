import type { AgentVerdict } from "@locus/shared";
import { askConfirm } from "@/lib/dialog";

/** The server's risk-gate refusal ends with this sentence (see `riskGateReason`). */
const GATE_SUFFIX = "Merge needs your approval.";

export function isRiskGateRefusal(err: unknown): err is Error {
  return err instanceof Error && err.message.trim().endsWith(GATE_SUFFIX);
}

/**
 * Run a merge; when the latest review verdict gates it (`review.requireApprovalAtRisk`),
 * show the reviewer's reason and retry with `approveRisk` only after an explicit confirm.
 */
export async function withRiskConfirm<T>(run: (approveRisk: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(false);
  } catch (err) {
    if (!isRiskGateRefusal(err)) throw err;
    const ok = await askConfirm({
      title: "Review flagged this merge",
      body: err.message,
      confirmLabel: "Approve and merge",
      danger: true,
    });
    if (!ok) throw new Error("Merge not approved");
    return run(true);
  }
}

/** "PASS · risk low" for verdict pills on PRs, Compare, and the turn summary. */
export function verdictLabel(verdict: Pick<AgentVerdict, "verdict" | "risk">): string {
  return `${verdict.verdict} · risk ${verdict.risk}`;
}

/** `ok` only for a clean PASS at low risk; anything else needs a look before merge. */
export function verdictTone(verdict: Pick<AgentVerdict, "verdict" | "risk">): "ok" | "warn" {
  return verdict.verdict === "PASS" && verdict.risk === "low" ? "ok" : "warn";
}
