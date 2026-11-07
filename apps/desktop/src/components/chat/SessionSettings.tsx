import {
  formatNetworkJail,
  formatVision,
  formatWebSearch,
  formatLiveChrome,
  sessionLiveChrome,
  isCanvasSession,
  isDesignSession,
  isGameSession,
  isAssetSession,
  isNetworkJail,
  resolveDesignPalette,
  sessionRuntime,
  sessionVision,
  sessionWebSearch,
  configuredToolsForRuntime,
  AUTONOMY_TIERS,
  formatAutonomy,
  parseAutonomyTier,
  sessionPlacement,
  workerIsMetered,
  sessionDefaultSubagent,
  HUB_ROLE_PRESETS,
  DEFAULT_HUB_AVATAR,
  DEFAULT_HUB_AVATAR_ACCESSORY,
  DEFAULT_HUB_AVATAR_POSE,
  parseProductMode,
  policyAllowsAutonomous,
  policyAllowsLiveChrome,
  policyForcedJail,
  resolveAssetBuild,
  inferAssetSubject,
  assetShowsStage3d,
  type AssetBuild,
  type AutonomyTier,
  type CodexReasoningEffort,
  type DesignPalette,
  type HubAvatarAccessory,
  type HubAvatarId,
  type HubAvatarPose,
  type NetworkJail,
  type SubagentKind,
  type VisionMode,
  type BrainMemory,
} from "@locus/shared";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { CodexReasoningPicker, ModelPicker } from "@/components/settings/ModelPicker";
import { SubagentPicker } from "./SubagentPicker";
import { DesignPalettePicker } from "@/components/design/DesignPalettePicker";
import { DesignSystemPicker } from "@/components/design/DesignSystemPicker";
import { AssetStylePicker } from "@/components/assets/AssetStylePicker";
import { AssetBuildPicker } from "@/components/assets/AssetBuildPicker";
import { SubscriptionList } from "./SubscriptionCard";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { applyHubRoleToDraft, personaFromDraft, shouldPatchPersona } from "@/lib/personaDraft";
import { PersonaAvatarPicker } from "@/components/layout/PersonaAvatar";

export function SessionSettings() {
  const { state, dispatch } = useStore();
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const providers = state.config?.providers ?? [];
  const hubMode = parseProductMode(state.config?.productMode) === "swarm";
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort | undefined>();
  const [instructions, setInstructions] = useState("");
  const [allowedTools, setAllowedTools] = useState("");
  const [network, setNetwork] = useState<NetworkJail>("restricted");
  const [vision, setVision] = useState<VisionMode>("latest");
  const [webSearch, setWebSearch] = useState(false);
  const [liveChrome, setLiveChrome] = useState(false);
  const [playbook, setPlaybook] = useState("");
  const [autonomy, setAutonomy] = useState<AutonomyTier>("guided");
  const [defaultSubagent, setDefaultSubagent] = useState<SubagentKind>("explore");
  const [maxUsd, setMaxUsd] = useState("");
  const [palette, setPalette] = useState<DesignPalette>(resolveDesignPalette(undefined));
  const [designSystemId, setDesignSystemId] = useState("");
  const [assetStyleId, setAssetStyleId] = useState("");
  const [assetBuild, setAssetBuild] = useState<AssetBuild>(() => resolveAssetBuild());
  const [displayName, setDisplayName] = useState("");
  const [avatarId, setAvatarId] = useState<HubAvatarId>(DEFAULT_HUB_AVATAR);
  const [avatarPose, setAvatarPose] = useState<HubAvatarPose>(DEFAULT_HUB_AVATAR_POSE);
  const [avatarAccessory, setAvatarAccessory] = useState<HubAvatarAccessory>(
    DEFAULT_HUB_AVATAR_ACCESSORY,
  );
  const [avatarAccent, setAvatarAccent] = useState<string | undefined>();
  const [hubRole, setHubRole] = useState("");
  const [personality, setPersonality] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memories, setMemories] = useState<BrainMemory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    dispatch({ type: "sessionSettings", open: false });
  }, [dispatch]);

  useDialogFocus(Boolean(state.sessionSettingsOpen && session), close, dialogRef);

  const toolHint = session
    ? configuredToolsForRuntime(session.os, sessionRuntime(session), state.config?.integrations)
        .map((t) => t.name)
        .join(", ")
    : "";

  useEffect(() => {
    if (!state.sessionSettingsOpen || !session) return;
    openedAt.current = Date.now();
    setProviderId(session.providerId);
    setModel(session.model);
    setReasoningEffort(session.reasoningEffort);
    setInstructions(session.instructions ?? "");
    setAllowedTools((session.allowedTools ?? []).join(", "));
    setNetwork(session.network ?? "restricted");
    setVision(sessionVision(session));
    setWebSearch(sessionWebSearch(session));
    setLiveChrome(sessionLiveChrome(session));
    setPlaybook(session.playbook ?? "");
    setAutonomy(parseAutonomyTier(session.autonomy ?? state.config?.advanced.autonomy));
    setDefaultSubagent(sessionDefaultSubagent(session));
    setMaxUsd(session.maxUsd != null ? String(session.maxUsd) : "");
    setPalette(resolveDesignPalette(session.palette));
    setDesignSystemId(session.designSystemId ?? "");
    setAssetStyleId(session.assetStyleId ?? "");
    setAssetBuild(resolveAssetBuild(session.assetBuild));
    setDisplayName(session.persona?.displayName ?? session.title ?? "");
    setAvatarId(session.persona?.avatarId ?? DEFAULT_HUB_AVATAR);
    setAvatarPose(session.persona?.avatarPose ?? DEFAULT_HUB_AVATAR_POSE);
    setAvatarAccessory(session.persona?.avatarAccessory ?? DEFAULT_HUB_AVATAR_ACCESSORY);
    setAvatarAccent(session.persona?.avatarAccent);
    setHubRole(session.persona?.hubRole ?? "");
    setPersonality(session.persona?.personality ?? "");
    setShowAdvanced(!hubMode);
    setError(null);
    setBusy(false);
    void api
      .brain()
      .then((doc) =>
        setMemories((doc.memories ?? []).filter((row) => row.sessionId === session.id).slice(0, 5)),
      )
      .catch(() => setMemories([]));
  }, [state.sessionSettingsOpen, session?.id, hubMode]);

  if (!state.sessionSettingsOpen || !session) return null;
  const current = session;
  const worker = (state.config?.workers ?? []).find((row) => row.id === current.backendId);
  const meterVm = sessionPlacement(current) === "worker" && worker && workerIsMetered(worker);

  function onBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (Date.now() - openedAt.current < 250) return;
    if (document.activeElement instanceof HTMLSelectElement) return;
    close();
  }

  async function save() {
    setError(null);
    const names = allowedTools
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    setBusy(true);
    try {
      const provider = providers.find((p) => p.id === providerId);
      const patchPersona = shouldPatchPersona({
        isDesign: isCanvasSession(current),
        swarmMode: hubMode,
        hasPersona: Boolean(current.persona),
      });
      const updated = await api.patchSession(current.id, {
        providerId,
        model: model || provider?.defaultModel || current.model,
        reasoningEffort: provider?.kind === "codex-cli" ? (reasoningEffort ?? null) : null,
        ...(patchPersona && displayName.trim() && displayName.trim() !== current.title
          ? { title: displayName.trim() }
          : {}),
        instructions: instructions.trim() ? instructions : null,
        allowedTools: names,
        network,
        vision,
        webSearch,
        liveChrome: sessionRuntime(current) === "host" ? liveChrome : undefined,
        playbook: playbook.trim() ? playbook : null,
        autonomy,
        defaultSubagent: isCanvasSession(current) ? undefined : defaultSubagent,
        maxUsd: maxUsd.trim() ? Number(maxUsd) : null,
        palette: isDesignSession(current) ? palette : undefined,
        designSystemId: isDesignSession(current) ? designSystemId || null : undefined,
        assetStyleId: isAssetSession(current) ? assetStyleId || null : undefined,
        assetBuild: isAssetSession(current) ? assetBuild : undefined,
        ...(patchPersona
          ? {
              persona: personaFromDraft({
                displayName,
                avatarId,
                avatarPose,
                avatarAccessory,
                avatarAccent,
                hubRole,
                personality,
              }),
            }
          : {}),
      });
      dispatch({ type: "session", session: updated });
      close();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not save ${isAssetSession(current) ? "asset" : isGameSession(current) ? "game" : isDesignSession(current) ? "design" : "agent"} settings`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onBackdrop}>
      <div
        className={`modal${hubMode ? " hub-teammate-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-settings-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="session-settings-title">
          {isAssetSession(current)
            ? "Asset settings"
            : isGameSession(current)
              ? "Game settings"
              : isDesignSession(current)
                ? "Design settings"
                : hubMode
                  ? "Teammate profile"
                  : "Agent settings"}
        </h2>
        <p className="modal-lead">
          {sessionRuntime(current) === "host"
            ? "Applies on the next turn. This chat runs on the host with no VM or container."
            : sessionRuntime(current) === "docker"
              ? "Applies on the next turn. This agent uses a Docker container at /workspace."
              : "Applies on the next turn. Guest network applies the next time you start the VM."}
        </p>
        {!isCanvasSession(current) && (hubMode || current.persona) ? (
          <div className="hub-persona-fields">
            <div className="hub-persona-identity">
              <div className="field">
                <label htmlFor="session-display-name">Name</label>
                <input
                  id="session-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="session-hub-role">Role</label>
                <input
                  id="session-hub-role"
                  list="hub-role-presets"
                  value={hubRole}
                  onChange={(e) => {
                    const next = applyHubRoleToDraft(
                      {
                        displayName,
                        avatarId,
                        avatarPose,
                        avatarAccessory,
                        avatarAccent,
                        hubRole,
                        personality,
                      },
                      e.target.value,
                    );
                    setHubRole(next.hubRole);
                    setPersonality(next.personality);
                    setAvatarId(next.avatarId);
                  }}
                  placeholder="Designer, Builder, Researcher…"
                />
                <datalist id="hub-role-presets">
                  {HUB_ROLE_PRESETS.map((role) => (
                    <option key={role} value={role} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label htmlFor="session-personality">Personality</label>
                <textarea
                  id="session-personality"
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="Calm, concise, cites sources"
                  rows={hubMode ? 2 : undefined}
                />
              </div>
              {hubMode ? (
                <div className="field">
                  <label htmlFor="session-brief">Brief</label>
                  <textarea
                    id="session-brief"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Master prompt — what they own, how they should work"
                    rows={3}
                    data-testid="session-brief"
                  />
                </div>
              ) : null}
            </div>
            <div className="field hub-persona-avatar">
              <span>Avatar</span>
              <PersonaAvatarPicker
                layout={hubMode ? "panel" : "stack"}
                value={{ avatarId, avatarPose, avatarAccessory, avatarAccent }}
                onChange={(next) => {
                  setAvatarId(next.avatarId);
                  setAvatarPose(next.avatarPose);
                  setAvatarAccessory(next.avatarAccessory);
                  setAvatarAccent(next.avatarAccent);
                }}
              />
            </div>
          </div>
        ) : null}
        {memories.length ? (
          <div className="field session-brain-profile" data-testid="session-brain-profile">
            <label>What they remember</label>
            <ul className="session-brain-list">
              {memories.map((row) => (
                <li key={row.id}>{row.claim}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {hubMode && !isCanvasSession(current) ? (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => setShowAdvanced((open) => !open)}
          >
            {showAdvanced ? "Hide advanced" : "Advanced"}
          </button>
        ) : null}
        {showAdvanced || isCanvasSession(current) || !hubMode ? (
          <>
            <ModelPicker
              providers={providers}
              providerId={providerId}
              model={model}
              onChange={(next) => {
                setProviderId(next.providerId);
                setModel(next.model);
                setReasoningEffort(undefined);
              }}
            />
            <CodexReasoningPicker
              provider={providers.find((p) => p.id === providerId)}
              model={model}
              value={reasoningEffort}
              onChange={setReasoningEffort}
            />
            {isDesignSession(current) ? (
              <>
                <DesignSystemPicker
                  selectedId={designSystemId}
                  onChange={(system) => {
                    setDesignSystemId(system?.id ?? "");
                    if (system) setPalette({ ...system.palette });
                  }}
                />
                <DesignPalettePicker palette={palette} onChange={setPalette} />
              </>
            ) : null}
            {isAssetSession(current) ? (
              <>
                <AssetStylePicker
                  selectedId={assetStyleId}
                  onChange={(style) => setAssetStyleId(style?.id ?? "")}
                />
                <div className="field">
                  <label>Build</label>
                  <AssetBuildPicker
                    value={assetBuild}
                    onChange={setAssetBuild}
                    mesh={assetShowsStage3d(
                      inferAssetSubject({
                        title: current.title,
                        recipeId: current.designSystemId,
                      }),
                    )}
                  />
                </div>
              </>
            ) : null}
            {isCanvasSession(current) || sessionRuntime(current) === "host" ? null : (
              <div className="field">
                <label>Vision</label>
                <select value={vision} onChange={(e) => setVision(e.target.value as VisionMode)}>
                  <option value="latest">
                    {formatVision("latest")} — send the latest guest screenshot to the model
                  </option>
                  <option value="off">
                    {formatVision("off")} — text and accessibility trees only
                  </option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Web search</label>
              <select
                value={webSearch ? "on" : "off"}
                onChange={(e) => setWebSearch(e.target.value === "on")}
              >
                <option value="off">
                  {formatWebSearch(false)} — model cannot query the public web from the host
                </option>
                <option value="on">
                  {formatWebSearch(true)} — model can call websearch on the host
                </option>
              </select>
            </div>
            {sessionRuntime(current) === "host" ? (
              <div className="field">
                <label>Use my Chrome</label>
                <select
                  value={liveChrome ? "on" : "off"}
                  disabled={!policyAllowsLiveChrome(state.config?.managedPolicy)}
                  onChange={(e) => setLiveChrome(e.target.value === "on")}
                >
                  <option value="off">
                    {formatLiveChrome(false)} — isolated host-chrome profile
                  </option>
                  <option value="on">
                    {formatLiveChrome(true)} — drive the Chrome tabs already open on this machine
                  </option>
                </select>
              </div>
            ) : null}
            {isCanvasSession(current) ? null : (
              <div className="field">
                <label>Default subagent</label>
                <SubagentPicker value={defaultSubagent} onChange={setDefaultSubagent} />
              </div>
            )}
            {hubMode ? null : (
              <div className="field">
                <label>Instructions (optional)</label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder={
                    sessionRuntime(current) === "host"
                      ? "Prefer short answers, cite sources, …"
                      : "Always use /mnt/host, commit on a feature branch, …"
                  }
                />
              </div>
            )}
            <div className="field">
              <label>Playbook (optional)</label>
              <textarea
                value={playbook}
                onChange={(e) => setPlaybook(e.target.value)}
                placeholder="Project SOP injected every turn. How we test, branch, and ship this repo."
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Autonomy</label>
                <select
                  value={autonomy}
                  disabled={!policyAllowsAutonomous(state.config?.managedPolicy)}
                  onChange={(e) => setAutonomy(parseAutonomyTier(e.target.value))}
                >
                  {AUTONOMY_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {formatAutonomy(tier)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{meterVm ? "Spend cap (USD, LLM + VM)" : "Spend cap (USD)"}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={maxUsd}
                  placeholder={autonomy === "autonomous" ? "20" : "unlimited"}
                  onChange={(e) => setMaxUsd(e.target.value)}
                />
              </div>
            </div>
            {sessionRuntime(current) === "docker" || sessionRuntime(current) === "host" ? null : (
              <div className="field">
                <label>Guest network</label>
                <select
                  value={network}
                  disabled={Boolean(policyForcedJail(state.config?.managedPolicy))}
                  onChange={(e) => {
                    if (isNetworkJail(e.target.value)) setNetwork(e.target.value);
                  }}
                >
                  <option value="open">{formatNetworkJail("open")}</option>
                  <option value="restricted">{formatNetworkJail("restricted")}</option>
                  <option value="none">{formatNetworkJail("none")}</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Allowed tools (optional)</label>
              <input
                value={allowedTools}
                onChange={(e) => setAllowedTools(e.target.value)}
                placeholder={toolHint || "exec, screenshot, git_commit"}
              />
            </div>
            {isCanvasSession(current) ? null : (
              <div className="field">
                <label>Subscriptions</label>
                <SubscriptionList
                  subscriptions={current.subscriptions ?? []}
                  onRemove={(id) => {
                    const next = (current.subscriptions ?? []).filter((row) => row.id !== id);
                    void api
                      .patchSession(current.id, { subscriptions: next.length ? next : null })
                      .then((updated) => dispatch({ type: "session", session: updated }));
                  }}
                  onRemoveAll={
                    current.subscriptions?.length
                      ? () => {
                          void api
                            .patchSession(current.id, { subscriptions: null })
                            .then((updated) => dispatch({ type: "session", session: updated }));
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </>
        ) : null}
        {error && (
          <p className="scrim-note" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
