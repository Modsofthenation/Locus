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
import { Select } from "@/components/layout/Select";
import { InlineError } from "@/components/layout/Skeleton";

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
      <Select
        ariaLabel="Named environment"
        value={props.value}
        options={[
          {
            value: "",
            label: props.noneLabel ?? "None — pick runtime, recipe, and Where as usual",
          },
          ...items.map((env) => {
            const worker = workers.find((row) => row.id === env.backendId);
            const bits = [
              env.name,
              env.network ? formatNetworkJail(env.network) : "",
              typeof env.maxUsd === "number" ? `$${env.maxUsd}` : "",
              worker ? workerWhereLabel(worker) : "",
            ].filter(Boolean);
            return { value: env.id, label: bits.join(" · ") };
          }),
        ]}
        onChange={(id) => {
          props.onChange(
            id,
            items.find((row) => row.id === id),
          );
        }}
      />
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
      {error ? <InlineError message={error} /> : null}
    </div>
  );
}
