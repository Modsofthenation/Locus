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
  formatAutonomyShort,
  formatAutonomyHint,
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
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { CodexReasoningPicker, ModelPicker } from "@/components/settings/ModelPicker";
import { Select } from "@/components/layout/Select";
import { SubagentPicker } from "./SubagentPicker";
import { DesignPalettePicker } from "@/components/design/DesignPalettePicker";
import { DesignSystemPicker } from "@/components/design/DesignSystemPicker";
import { AssetStylePicker } from "@/components/assets/AssetStylePicker";
import { AssetBuildPicker } from "@/components/assets/AssetBuildPicker";
import { SubscriptionList } from "./SubscriptionCard";
import { Modal } from "@/components/layout/Modal";
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
  const [settingsTab, setSettingsTab] = useState<"agent" | "tools" | "runtime">("agent");
  const [memories, setMemories] = useState<BrainMemory[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => {
    dispatch({ type: "sessionSettings", open: false });
  }, [dispatch]);

  const toolCatalog = session
    ? configuredToolsForRuntime(session.os, sessionRuntime(session), state.config?.integrations)
    : [];
  const allowedSet = new Set(
    allowedTools
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const allToolsAllowed = allowedSet.size === 0;

  useEffect(() => {
    if (!state.sessionSettingsOpen || !session) return;
    setSettingsTab("agent");
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
    <Modal
      titleId="session-settings-title"
      className={hubMode ? "hub-teammate-modal" : undefined}
      closeGuardMs={250}
      onClose={close}
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
          <div className="session-settings-tabs" role="tablist" aria-label="Agent settings">
            {(
              [
                ["agent", "Agent"],
                ["tools", "Tools"],
                ["runtime", "Runtime"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={settingsTab === id}
                className={settingsTab === id ? "on" : ""}
                onClick={() => setSettingsTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {settingsTab === "agent" ? (
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
                  <Select
                    ariaLabel="Autonomy"
                    value={autonomy}
                    disabled={!policyAllowsAutonomous(state.config?.managedPolicy)}
                    options={AUTONOMY_TIERS.map((tier) => ({
                      value: tier,
                      label: formatAutonomyShort(tier),
                      hint: formatAutonomyHint(tier),
                    }))}
                    onChange={(value) => setAutonomy(parseAutonomyTier(value))}
                  />
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
            </>
          ) : null}
          {settingsTab === "tools" ? (
            <>
              <div className="field">
                <label>Web search</label>
                <Select
                  ariaLabel="Web search"
                  value={webSearch ? "on" : "off"}
                  options={[
                    {
                      value: "off",
                      label: formatWebSearch(false),
                      hint: "Model cannot query the public web from the host",
                    },
                    {
                      value: "on",
                      label: formatWebSearch(true),
                      hint: "Model can call websearch on the host",
                    },
                  ]}
                  onChange={(value) => setWebSearch(value === "on")}
                />
              </div>
              {sessionRuntime(current) === "host" ? (
                <div className="field">
                  <label>Use my Chrome</label>
                  <Select
                    ariaLabel="Use my Chrome"
                    value={liveChrome ? "on" : "off"}
                    disabled={!policyAllowsLiveChrome(state.config?.managedPolicy)}
                    options={[
                      {
                        value: "off",
                        label: formatLiveChrome(false),
                        hint: "Isolated host-chrome profile",
                      },
                      {
                        value: "on",
                        label: formatLiveChrome(true),
                        hint: "Drive the Chrome tabs already open on this machine",
                      },
                    ]}
                    onChange={(value) => setLiveChrome(value === "on")}
                  />
                </div>
              ) : null}
              {isCanvasSession(current) ? null : (
                <div className="field">
                  <label>Default subagent</label>
                  <SubagentPicker value={defaultSubagent} onChange={setDefaultSubagent} />
                </div>
              )}
              <div className="field">
                <label>Allowed tools</label>
                <p className="hint">
                  {allToolsAllowed
                    ? "All tools for this runtime. Uncheck to limit the next turn."
                    : `${allowedSet.size} of ${toolCatalog.length} tools.`}
                </p>
                <div className="tool-checklist">
                  {toolCatalog.map((tool) => {
                    const on = allToolsAllowed || allowedSet.has(tool.name);
                    return (
                      <label key={tool.name} className="check-row">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const catalog = toolCatalog.map((row) => row.name);
                            const currentNames = allToolsAllowed ? catalog : [...allowedSet];
                            const next = currentNames.includes(tool.name)
                              ? currentNames.filter((name) => name !== tool.name)
                              : [...currentNames, tool.name];
                            setAllowedTools(next.length === catalog.length ? "" : next.join(", "));
                          }}
                        />
                        {tool.name}
                      </label>
                    );
                  })}
                </div>
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
          {settingsTab === "runtime" ? (
            <>
              {isCanvasSession(current) || sessionRuntime(current) === "host" ? null : (
                <div className="field">
                  <label>Vision</label>
                  <Select
                    ariaLabel="Vision"
                    value={vision}
                    options={[
                      {
                        value: "latest",
                        label: formatVision("latest"),
                        hint: "Send the latest guest screenshot to the model",
                      },
                      {
                        value: "off",
                        label: formatVision("off"),
                        hint: "Text and accessibility trees only",
                      },
                    ]}
                    onChange={(value) => setVision(value as VisionMode)}
                  />
                </div>
              )}
              {sessionRuntime(current) === "docker" || sessionRuntime(current) === "host" ? null : (
                <div className="field">
                  <label>Guest network</label>
                  <Select
                    ariaLabel="Guest network"
                    value={network}
                    disabled={Boolean(policyForcedJail(state.config?.managedPolicy))}
                    options={[
                      { value: "open", label: formatNetworkJail("open") },
                      { value: "restricted", label: formatNetworkJail("restricted") },
                      { value: "none", label: formatNetworkJail("none") },
                    ]}
                    onChange={(value) => {
                      if (isNetworkJail(value)) setNetwork(value);
                    }}
                  />
                </div>
              )}
              <p className="hint">
                {sessionRuntime(current) === "host"
                  ? "This chat runs on the host with no VM or container."
                  : sessionRuntime(current) === "docker"
                    ? "This agent uses a Docker container at /workspace."
                    : "Guest network applies the next time you start the VM."}
              </p>
            </>
          ) : null}
        </>
      ) : null}
      {error && <p className="scrim-note is-danger">{error}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
