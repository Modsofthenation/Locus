import { useState, useSyncExternalStore } from "react";
import { sessionRuntime, type Automation, type AutomationRun } from "@locus/shared";
import { api } from "@/lib/api";
import { DOCKER_DOWN_MESSAGE, plainJobError } from "@/lib/automations";
import { useStore } from "@/state/store";
import { ErrorBanner } from "@/components/layout/Skeleton";

/**
 * One notice per Jobs pane: Run now lives in the topbar but its outcome belongs on the
 * pane, not as red text under the topbar title.
 */
export type JobNotice =
  | { automationId: string; kind: "docker"; runId?: string; detail?: string }
  | { automationId: string; kind: "error"; message: string };

let current: JobNotice | null = null;
const listeners = new Set<() => void>();

export function setJobNotice(next: JobNotice | null): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useJobNotice(automationId: string | undefined): JobNotice | null {
  const notice = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  return notice && notice.automationId === automationId ? notice : null;
}

export function hostJobsLocked(
  config: { managedPolicy?: { active?: boolean; locked: string[] } } | null | undefined,
): boolean {
  return Boolean(
    config?.managedPolicy?.active && config.managedPolicy.locked.includes("hostAutomations"),
  );
}

/** True when this job runs in local Docker and the daemon does not answer. */
export async function dockerDownFor(
  item: Pick<Automation, "runtime" | "backendId">,
): Promise<boolean> {
  if (sessionRuntime(item) !== "docker" || item.backendId) return false;
  try {
    const status = await api.dockerStatus();
    return status.kind === "docker" && !status.available;
  } catch {
    // Older servers have no status route; let the run report its own error.
    return false;
  }
}

/** Report a failed job action on the pane, in plain language when we know the cause. */
export function reportJobError(automationId: string, err: unknown, fallback: string): void {
  const message = err instanceof Error && err.message.trim() ? err.message : fallback;
  const plain = plainJobError(message);
  if (plain?.cause === "docker") {
    setJobNotice({ automationId, kind: "docker", detail: plain.detail });
    return;
  }
  setJobNotice({ automationId, kind: "error", message });
}

/** Run now / Run again: check the runtime first so a down daemon is not a raw socket error. */
export async function startJobRun(
  item: Automation,
  dispatch: (action: { type: "run"; run: AutomationRun }) => void,
  opts?: { runId?: string },
): Promise<boolean> {
  setJobNotice(null);
  if (await dockerDownFor(item)) {
    setJobNotice({ automationId: item.id, kind: "docker", runId: opts?.runId });
    return false;
  }
  try {
    const run = opts?.runId
      ? await api.runAutomation(item.id, { runId: opts.runId })
      : await api.runAutomation(item.id);
    dispatch({ type: "run", run });
    return true;
  } catch (err) {
    reportJobError(item.id, err, "Could not start a run");
    return false;
  }
}

/** Two ways out when Docker is down: Host now, or start Docker and check again. */
export function DockerDownActions(props: {
  hostLocked: boolean;
  busy?: boolean;
  onSwitchToHost: () => void;
  onCheckAgain?: () => void;
  checkLabel?: string;
}) {
  const [help, setHelp] = useState(false);
  return (
    <>
      <div className="auto-memory-actions">
        {props.hostLocked ? null : (
          <button
            type="button"
            className="btn small primary"
            disabled={props.busy}
            onClick={props.onSwitchToHost}
          >
            Switch to Host
          </button>
        )}
        <button
          type="button"
          className="btn small"
          aria-expanded={help}
          onClick={() => setHelp((v) => !v)}
        >
          Start Docker
        </button>
      </div>
      {help ? (
        <div className="auto-docker-help" data-testid="auto-docker-help">
          <p className="hint">
            Open Docker Desktop, or run <code>sudo systemctl start docker</code> on Linux.
          </p>
          {props.onCheckAgain ? (
            <button
              type="button"
              className="btn small"
              disabled={props.busy}
              onClick={props.onCheckAgain}
            >
              {props.checkLabel ?? "Check again"}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function JobRunNotice(props: { item: Automation }) {
  const { state, dispatch } = useStore();
  const notice = useJobNotice(props.item.id);
  const [busy, setBusy] = useState(false);
  if (!notice) return null;
  if (notice.kind === "error") {
    return (
      <ErrorBanner
        message={notice.message}
        testId="auto-pane-error"
        action={
          <button type="button" className="btn small ghost" onClick={() => setJobNotice(null)}>
            Dismiss
          </button>
        }
      />
    );
  }
  const runId = notice.runId;

  async function switchToHost() {
    setBusy(true);
    try {
      const updated = await api.patchAutomation(props.item.id, { runtime: "host" });
      dispatch({ type: "automation", automation: updated });
      await startJobRun(updated, dispatch, runId ? { runId } : undefined);
    } catch (err) {
      reportJobError(props.item.id, err, "Could not switch to Host");
    } finally {
      setBusy(false);
    }
  }

  async function checkAgain() {
    setBusy(true);
    try {
      await startJobRun(props.item, dispatch, runId ? { runId } : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auto-runtime-notice" role="alert" data-testid="auto-docker-down">
      <p className="auto-runtime-notice-title">{DOCKER_DOWN_MESSAGE}</p>
      <p className="hint">Host runs on this machine without a container.</p>
      <DockerDownActions
        hostLocked={hostJobsLocked(state.config)}
        busy={busy}
        onSwitchToHost={() => void switchToHost()}
        onCheckAgain={() => void checkAgain()}
        checkLabel="Check again and run"
      />
      {notice.detail ? (
        <details className="auto-error-details">
          <summary>Show details</summary>
          <pre>{notice.detail}</pre>
        </details>
      ) : null}
      <button
        type="button"
        className="btn small ghost auto-runtime-notice-dismiss"
        onClick={() => setJobNotice(null)}
      >
        Dismiss
      </button>
    </div>
  );
}
