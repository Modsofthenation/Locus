import {
  isCursorProvider,
  sessionPlacement,
  workerIsMetered,
  type AgentSession,
  type LocusConfig,
} from "@locus/shared";

const labels = { cloud: "Cloud", local: "Local", remote: "Remote" } as const;

export type SessionBackend = keyof typeof labels;

export function sessionBackend(
  session: AgentSession,
  config: Pick<LocusConfig, "providers" | "workers"> | null,
): SessionBackend {
  const provider = config?.providers?.find((row) => row.id === session.providerId);
  if (provider ? isCursorProvider(provider) : session.cursorCloud) return "cloud";
  if (sessionPlacement(session) === "worker" || session.backendId) {
    const worker = config?.workers?.find((row) => row.id === session.backendId);
    return worker && workerIsMetered(worker) ? "cloud" : "remote";
  }
  return "local";
}

export function SessionBackendBadge({ backend }: { backend: SessionBackend }) {
  return (
    <span className="session-backend-badge" data-backend={backend}>
      {labels[backend]}
    </span>
  );
}
