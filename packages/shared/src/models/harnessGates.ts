/**
 * Harness gates a session may opt out of at create time (or later via PATCH).
 *
 * Each id names one block the harness applies on top of the approval policy:
 * - `test-gate`: run the workspace test/verify command before git_push / git_pr
 *   and block the publish when it fails ("Harness blocked git_push: tests failed").
 * - `pre-tool-use-hooks`: run the repo's PreToolUse hooks and block on failure.
 * - `force-push`: refuse git_push --force and `git push --force` in exec.
 * - `recursive-delete`: refuse `rm -rf` tree wipes in exec.
 *
 * Secret protections (credential files, env dumps, sensitive paths), the
 * protected-branch guard, the tool allowlist, and the network allowlist are not
 * bypassable here: they have their own per-session or policy settings, or
 * guard secrets that must never reach model context.
 */
export const HARNESS_GATES = [
  "test-gate",
  "pre-tool-use-hooks",
  "force-push",
  "recursive-delete",
] as const;

export type HarnessGate = (typeof HARNESS_GATES)[number];

export const HARNESS_GATE_LABELS: Record<HarnessGate, string> = {
  "test-gate": "Test gate on push / PR",
  "pre-tool-use-hooks": "Repo PreToolUse hooks",
  "force-push": "Force-push refusal",
  "recursive-delete": "rm -rf refusal",
};

export function isHarnessGate(value: unknown): value is HarnessGate {
  return typeof value === "string" && (HARNESS_GATES as readonly string[]).includes(value);
}

/**
 * Normalize a client-supplied gate list. Unknown ids throw so a typo does not
 * silently leave a gate on. Returns `undefined` for an empty list.
 */
export function parseHarnessGates(raw: unknown): HarnessGate[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw new Error("bypassGates must be an array of gate ids");
  const out: HarnessGate[] = [];
  for (const item of raw) {
    const id = typeof item === "string" ? item.trim() : item;
    if (!isHarnessGate(id)) {
      throw new Error(
        `Unknown harness gate ${JSON.stringify(item)}. Known gates: ${HARNESS_GATES.join(", ")}`,
      );
    }
    if (!out.includes(id)) out.push(id);
  }
  return out.length ? out : undefined;
}

export function harnessGateBypassed(
  bypass: readonly string[] | undefined,
  gate: HarnessGate,
): boolean {
  return Boolean(bypass?.includes(gate));
}
