import { useState } from "react";
import { policyAllowsHostAgents, sessionRuntime, type AgentSession } from "@locus/shared";
import { api } from "@/lib/api";
import { isDockerDownError } from "@/lib/automations";
import { startHostRepoAgent } from "@/lib/hostAgent";
import { useStore, type Action } from "@/state/store";

/** True when the Docker CLI is installed but the daemon is not answering. */
export function dockerIsDown(state: { dockerKind: "mock" | "docker"; dockerReady: boolean }) {
  return state.dockerKind === "docker" && !state.dockerReady;
}

/** Ask the control plane again and update the store. Resolves to the new readiness. */
export async function recheckDocker(dispatch: (action: Action) => void): Promise<boolean> {
  const health = await api.health();
  const dockerKind = health.docker === "docker" ? "docker" : "mock";
  const dockerReady = dockerKind === "docker" && health.dockerReady !== false;
  dispatch({ type: "dockerHealth", dockerKind, dockerReady });
  return dockerKind === "mock" || dockerReady;
}

/**
 * The one "Docker isn't running" callout: what needed Docker, how to start it,
 * Check again, and (when the caller can offer one) a Host alternative.
 */
export function DockerDownCallout(props: {
  /** One sentence on what needed Docker, e.g. "Start agent runs in a Docker container." */
  detail: string;
  hostLabel?: string;
  onHost?: () => void;
  /** Called after Check again finds Docker running. */
  onReady?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
  testId?: string;
}) {
  const { dispatch } = useStore();
  const [checking, setChecking] = useState(false);
  const [stillDown, setStillDown] = useState(false);
  const busy = props.busy || checking;

  async function checkAgain() {
    setChecking(true);
    try {
      const ready = await recheckDocker(dispatch);
      setStillDown(!ready);
      if (ready) props.onReady?.();
    } catch {
      setStillDown(true);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="auto-runtime-notice docker-down-callout"
      role="alert"
      data-testid={props.testId ?? "docker-down-callout"}
    >
      <p className="auto-runtime-notice-title">Docker isn&rsquo;t running</p>
      <p className="hint">
        {props.detail} Open Docker Desktop, or run <code>sudo systemctl start docker</code> on
        Linux, then check again.
      </p>
      {stillDown ? <p className="hint">Still not reachable.</p> : null}
      <div className="auto-memory-actions">
        {props.onHost ? (
          <button
            type="button"
            className="btn small primary"
            disabled={busy}
            onClick={props.onHost}
          >
            {props.hostLabel ?? "Use Host instead"}
          </button>
        ) : null}
        <button
          type="button"
          className={`btn small${props.onHost ? "" : " primary"}`}
          disabled={busy}
          onClick={() => void checkAgain()}
        >
          {checking ? "Checking…" : "Check again"}
        </button>
        {props.onDismiss ? (
          <button type="button" className="btn small ghost" onClick={props.onDismiss}>
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Shown in a Docker agent's thread when its container could not start because
 * the daemon is down. The runtime is fixed per agent, so instead of "switch to
 * Host" this offers a Host copy (same repo, first prompt and model) or Start.
 */
export function DockerDownSessionNotice(props: { session: AgentSession }) {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session } = props;
  if (sessionRuntime(session) !== "docker" || !isDockerDownError(session.error)) return null;
  const hostAllowed = policyAllowsHostAgents(state.config?.managedPolicy);
  const repo = session.repoId ? state.repos.find((row) => row.id === session.repoId) : undefined;
  const firstPrompt = session.messages.find((row) => row.role === "user")?.content;

  async function hostCopy() {
    if (!state.config) return;
    setBusy(true);
    setError(null);
    try {
      const next = await startHostRepoAgent({
        config: state.config,
        repo,
        title: `${session.title} (Host)`,
        prompt: firstPrompt,
        providerId: session.providerId,
        model: session.model,
      });
      dispatch({ type: "session", session: next });
      dispatch({ type: "select", id: next.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a Host copy");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await api.startVm(session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="docker-down-session" data-testid="docker-down-session">
      <DockerDownCallout
        detail={`This agent runs in a Docker container, and an agent's runtime can't change after it is created.${
          hostAllowed
            ? " A Host copy starts a new chat on this machine with the same repo and first message."
            : ""
        }`}
        hostLabel="Start a Host copy"
        onHost={hostAllowed ? () => void hostCopy() : undefined}
        onReady={() => void start()}
        busy={busy}
      />
      {error ? <p className="hint danger">{error}</p> : null}
    </div>
  );
}
