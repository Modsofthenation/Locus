import {
  formatNetworkJail,
  namedEnvironmentSummary,
  snapshotNamedEnvironment,
  upsertNamedEnvironment,
  workerWhereLabel,
  type AgentRuntime,
  type GuestOs,
  type NamedEnvironment,
  type NetworkJail,
  type AgentPlacement,
} from "@locus/shared";
import { useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";

export function EnvironmentPicker(props: {
  value: string;
  onChange: (id: string, env?: NamedEnvironment) => void;
  noneLabel?: string;
  snapshot: {
    runtime: AgentRuntime;
    os: GuestOs;
    templateId?: string;
    dockerImage?: string;
    imageId?: string;
    network?: NetworkJail;
    recipeId?: string | null;
    maxUsd?: number;
    placement?: AgentPlacement;
    backendId?: string;
    allowHosts?: string[];
  };
}) {
  const { state, dispatch } = useStore();
  const items = state.config?.namedEnvironments ?? [];
  const workers = state.config?.workers ?? [];
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const existing = items.find((row) => row.name.toLowerCase() === name.trim().toLowerCase());
    const id = existing?.id ?? crypto.randomUUID();
    const env = snapshotNamedEnvironment({
      id,
      name,
      existing,
      ...props.snapshot,
    });
    if (!env) {
      setError("Name the environment and pick Docker, VM, or Host");
      return;
    }
    const next = upsertNamedEnvironment(items, env);
    if (!state.config) return;
    setBusy(true);
    setError(null);
    try {
      const config = await api.saveConfig({ ...state.config, namedEnvironments: next });
      dispatch({ type: "config", config });
      const stored =
        (config.namedEnvironments ?? []).find(
          (row) => row.name.toLowerCase() === env.name.toLowerCase(),
        ) ?? env;
      setSaving(false);
      setName("");
      props.onChange(stored.id, stored);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save environment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field env-picker">
      <label>Environment</label>
      <select
        aria-label="Named environment"
        value={props.value}
        onChange={(event) => {
          const id = event.target.value;
          props.onChange(
            id,
            items.find((row) => row.id === id),
          );
        }}
      >
        <option value="">
          {props.noneLabel ?? "None — pick runtime, recipe, and Where as usual"}
        </option>
        {items.map((env) => {
          const worker = workers.find((row) => row.id === env.backendId);
          return (
            <option key={env.id} value={env.id}>
              {env.name}
              {env.network ? ` · ${formatNetworkJail(env.network)}` : ""}
              {typeof env.maxUsd === "number" ? ` · $${env.maxUsd}` : ""}
              {worker ? ` · ${workerWhereLabel(worker)}` : ""}
            </option>
          );
        })}
      </select>
      {props.value ? (
        <p className="hint">
          {(() => {
            const env = items.find((row) => row.id === props.value);
            if (!env) return "Unknown environment";
            const worker = workers.find((row) => row.id === env.backendId);
            return namedEnvironmentSummary(env, {
              whereLabel: worker
                ? workerWhereLabel(worker)
                : env.placement === "worker"
                  ? "Worker"
                  : "This machine",
            });
          })()}
        </p>
      ) : (
        <p className="hint">
          A named box is golden image + jail + recipe + spend cap + Where. Adaptive and webhook jobs
          reuse it overnight.
        </p>
      )}
      {saving ? (
        <form className="env-picker-save" onSubmit={(event) => void save(event)}>
          <input
            aria-label="Environment name"
            placeholder="staging-qa"
            value={name}
            maxLength={64}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button className="btn small primary" type="submit" disabled={busy || !name.trim()}>
            Save
          </button>
          <button
            className="btn small"
            type="button"
            disabled={busy}
            onClick={() => {
              setSaving(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button className="btn small" type="button" disabled={busy} onClick={() => setSaving(true)}>
          Save as environment
        </button>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
