import { useEffect, useState } from "react";
import type { DockerContainerStats } from "@locus/shared";
import { api } from "@/lib/api";

export function useDockerStats(id: string | undefined, enabled: boolean) {
  const [stats, setStats] = useState<DockerContainerStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    setError(null);
  }, [id]);

  useEffect(() => {
    if (!id || !enabled) return;
    const containerId = id;
    let cancelled = false;
    let inflight = false;
    async function tick() {
      if (inflight || cancelled) return;
      inflight = true;
      try {
        const next = await api.dockerContainerStats(containerId);
        if (!cancelled) {
          setStats(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read stats");
      } finally {
        inflight = false;
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, enabled]);

  return { stats, error };
}

function StatsMeter({
  label,
  detail,
  percent,
}: {
  label: string;
  detail: string;
  percent: number;
}) {
  const width = Math.min(100, Math.max(0, percent));
  const tone = width >= 85 ? " hot" : width >= 60 ? " warn" : "";
  return (
    <div className="docker-stat">
      <div className="docker-stat-head">
        <span>{label}</span>
        <strong>{detail}</strong>
      </div>
      <div className="docker-stat-track">
        <span className={`docker-stat-fill${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function formatStatsTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DockerStatsPanel({
  stats,
  error,
  pane,
}: {
  stats: DockerContainerStats | null;
  error: string | null;
  pane?: boolean;
}) {
  if (error && !stats) return <p className="docker-stats-empty">{error}</p>;
  if (!stats) return <p className="docker-stats-empty">Reading docker stats…</p>;
  const sampled = formatStatsTime(stats.sampledAt);
  return (
    <div className={pane ? "docker-stats docker-stats-pane" : "docker-stats"}>
      <div className="docker-stats-head">
        <span>
          {stats.running ? "Live" : "Idle"} · <strong>{stats.name}</strong>
        </span>
        <span className={error ? "docker-stats-error" : undefined}>
          {error ? error : sampled ? `sampled ${sampled}` : "live docker stats"}
        </span>
      </div>
      <StatsMeter
        label="CPU"
        detail={`${stats.cpuPercent.toFixed(2)}%`}
        percent={stats.cpuPercent}
      />
      <StatsMeter
        label="Memory"
        detail={`${stats.memoryUsage} / ${stats.memoryLimit} (${stats.memoryPercent.toFixed(1)}%)`}
        percent={stats.memoryPercent}
      />
      <dl className="docker-stats-grid">
        <div>
          <dt>Net I/O</dt>
          <dd>
            {stats.networkRx} / {stats.networkTx}
          </dd>
        </div>
        <div>
          <dt>Block I/O</dt>
          <dd>
            {stats.blockRead} / {stats.blockWrite}
          </dd>
        </div>
        <div>
          <dt>PIDs</dt>
          <dd>{stats.pids}</dd>
        </div>
      </dl>
    </div>
  );
}
