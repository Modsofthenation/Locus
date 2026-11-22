import { useEffect, useRef, useState } from "react";
import type { AgentSession, WorkerConnectionStatus } from "@locus/shared";
import { api } from "@/lib/api";
import { askConfirm } from "@/lib/dialog";
import { useStore } from "@/state/store";
import { ExpandableLog } from "./ExpandableLog";

function statusText(status: WorkerConnectionStatus): string {
  if (status.reconnecting) return "Reconnecting to worker CLI…";
  if (status.connection === "unreachable") return "Worker unreachable · Task status unknown";
  if (status.connection === "missing") return "Worker guest unavailable";
  if (status.connection === "stopped") return "Worker guest stopped";
  if (status.task === "running") return "Worker connected · Task running";
  if (status.task === "finished") return "Worker connected · Task ended";
  return "Worker connected";
}

export function WorkerConnection({ session }: { session: AgentSession }) {
  const { dispatch } = useStore();
  const [status, setStatus] = useState<WorkerConnectionStatus>();
  const [logs, setLogs] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const previous = useRef<WorkerConnectionStatus | undefined>(undefined);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.workerConnection(session.id);
        if (!live) return;
        if (
          next.connection === "connected" &&
          (previous.current?.connection === "unreachable" ||
            (previous.current?.reconnecting && !next.reconnecting))
        ) {
          window.dispatchEvent(
            new CustomEvent("locus:workspace-changed", {
              detail: { sessionId: session.id },
            }),
          );
        }
        previous.current = next;
        setStatus(next);
      } catch {
        if (live) {
          const next: WorkerConnectionStatus = {
            connection: "unreachable",
            task: "unknown",
            canResume: false,
          };
          previous.current = next;
          setStatus(next);
        }
      } finally {
        if (live) timer = setTimeout(() => void poll(), 12_000);
      }
    }
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [session.id, session.vmId, session.status]);

  async function resume() {
    if (
      !(await askConfirm({
        title: "Resume from the last chat checkpoint?",
        body: "Locus will restore the conversation and retry the interrupted prompt using the files currently on the worker.",
        confirmLabel: "Resume turn",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const next = await api.resumeWorkerCheckpoint(session.id);
      dispatch({ type: "session", session: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadLogs() {
    setError("");
    try {
      const response = await api.vmLogs(session.id);
      setLogs(response.text || "No guest logs yet.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="worker-connection">
      <button
        type="button"
        className="btn small ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {status ? statusText(status) : "Checking worker…"}
      </button>
      {expanded ? (
        <div className="worker-connection-details">
          {status?.connection === "connected" ? (
            <button type="button" className="btn small" onClick={() => void loadLogs()}>
              Load guest logs
            </button>
          ) : null}
          {status?.canResume ? (
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => void resume()}
            >
              Resume from checkpoint
            </button>
          ) : null}
          {status?.connection === "unreachable" ? (
            <p className="hint">Locus will check again automatically.</p>
          ) : null}
          {logs ? <ExpandableLog text={logs} /> : null}
          {error ? (
            <p role="alert" className="hint is-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
