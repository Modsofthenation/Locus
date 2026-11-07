import type { NamedEnvironment, NetworkJail } from "@locus/shared";
import { formatNetworkJail } from "@locus/shared";

export type ComposerMoreOptionsProps = {
  hostChat: boolean;
  hasRepo: boolean;
  network: NetworkJail;
  maxUsd: string;
  namedEnvId: string;
  environments: NamedEnvironment[];
  branchLock: boolean;
  jailLocked?: boolean;
  onNetworkChange: (next: NetworkJail) => void;
  onMaxUsdChange: (next: string) => void;
  onNamedEnvChange: (id: string, env?: NamedEnvironment) => void;
  onBranchLockChange: (next: boolean) => void;
};

export function ComposerMoreOptions(props: ComposerMoreOptionsProps) {
  const jailOn = props.network === "restricted" || props.network === "none";
  const selectedEnv = props.environments.find((row) => row.id === props.namedEnvId);
  const envLabel = selectedEnv?.name?.trim() || "Default";

  return (
    <div className="composer-more-options" data-testid="composer-more-options">
      <div className="composer-more-grid">
        <div className="composer-more-cell">
          <span className="composer-more-label">Jail</span>
          <div className={`composer-more-field${props.hostChat ? " is-disabled" : ""}`}>
            <span className="composer-more-field-text">
              {props.hostChat
                ? "Host workspace only"
                : jailOn
                  ? formatNetworkJail(props.network === "none" ? "none" : "restricted")
                  : "Open network"}
            </span>
            <button
              type="button"
              className={`settings-switch${jailOn ? " on" : ""}`}
              role="switch"
              aria-checked={jailOn}
              aria-label="Jail"
              disabled={props.hostChat || props.jailLocked}
              onClick={() => props.onNetworkChange(jailOn ? "open" : "restricted")}
            />
          </div>
        </div>

        <div className="composer-more-cell">
          <span className="composer-more-label">Spend cap</span>
          <div className="composer-more-field">
            <span className="composer-more-field-text">Stop after</span>
            <label className="composer-more-spend">
              <span aria-hidden>$</span>
              <input
                aria-label="Spend cap (USD)"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="∞"
                value={props.maxUsd}
                onChange={(e) => props.onMaxUsdChange(e.target.value)}
              />
            </label>
          </div>
        </div>

        <div className="composer-more-cell">
          <span className="composer-more-label">Named environment</span>
          <div className="composer-more-field composer-more-env">
            <select
              aria-label="Named environment"
              value={props.namedEnvId}
              onChange={(e) => {
                const id = e.target.value;
                props.onNamedEnvChange(
                  id,
                  props.environments.find((row) => row.id === id),
                );
              }}
            >
              <option value="">Default</option>
              {props.environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
            <span className="composer-more-env-label" aria-hidden>
              {envLabel}
            </span>
            {!props.namedEnvId ? <span className="composer-more-optional">Optional</span> : null}
          </div>
        </div>

        <div className="composer-more-cell">
          <span className="composer-more-label">Branch lock</span>
          <div className={`composer-more-field${!props.hasRepo ? " is-disabled" : ""}`}>
            <span className="composer-more-field-text">Lock after create</span>
            <button
              type="button"
              className={`settings-switch${props.branchLock ? " on" : ""}`}
              role="switch"
              aria-checked={props.branchLock}
              aria-label="Branch lock"
              disabled={!props.hasRepo}
              onClick={() => props.onBranchLockChange(!props.branchLock)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
