import {
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_HUB_AVATAR,
  DEFAULT_HUB_AVATAR_ACCESSORY,
  DEFAULT_HUB_AVATAR_POSE,
  HUB_ROLE_PRESETS,
  applyNamedEnvironment,
  configuredGuestOsOptions,
  FIRST_TASKS,
  firstOversizeAttachment,
  forgesWithTokens,
  latestGoldenImage,
  parseDockerImage,
  parseProductMode,
  pickConfiguredOs,
  policyAllowsHostAgents,
  sessionVision,
  setupHasRemainingTodos,
  showFirstTaskPills,
  t,
  visibleRecipes,
  workerIsMetered,
  workerWhereLabel,
  type AgentRecipe,
  type FirstTask,
  type AgentRuntime,
  type ComputerUseToolName,
  type GuestOs,
  type HubAvatarAccessory,
  type HubAvatarId,
  type HubAvatarPose,
  type CodexReasoningEffort,
  type NamedEnvironment,
  type NetworkJail,
  type VisionMode,
} from "@locus/shared";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { api } from "@/lib/api";
import {
  filesToAttachments,
  filesFromDataTransfer,
  composerFilesFromClipboard,
} from "@/lib/attachments";
import { applyComposerChipKey, applyComposerPaste, splitComposerFiles } from "@/lib/composerPaste";
import {
  loadLastAgent,
  rememberedWorkerId,
  resolveAgentDefaults,
  saveLastAgent,
} from "@/lib/lastAgent";
import { applyHubRoleToDraft, personaFromDraft } from "@/lib/personaDraft";
import { openSettings, useStore } from "@/state/store";
import {
  ComposerAddButton,
  ComposerFileThumbs,
  ComposerTextarea,
  mergeComposerFiles,
} from "@/components/chat/ComposerFiles";
import { ComposerMoreOptions } from "@/components/chat/ComposerMoreOptions";
import { PlacementToggle } from "@/components/settings/RuntimePicker";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { OsPicker } from "@/components/settings/OsPicker";
import { ComposerRepoPicker } from "@/components/codebase/RepoField";
import { FirstTaskPills, RecipeCards } from "@/components/settings/RecipeCards";
import {
  FinishSetupChecklist,
  loadFinishSetupDismissed,
  saveFinishSetupDismissed,
} from "@/components/settings/FinishSetupChecklist";
import { LaunchWorkspace, type LaunchWorkspaceSelection } from "./LaunchWorkspace";
import { EmptyHero } from "./EmptyHero";
import { ProviderSetupBanner, SetupBanner } from "./SetupBanner";
import { IconReturn } from "./Icons";
import { NEW_AGENT_COPY, newAgentSendLabel } from "@/lib/launchCopy";
import { Select } from "./Select";
import { PersonaAvatarPicker } from "./PersonaAvatar";

export function EmptyState() {
  const { state, dispatch } = useStore();
  const setup = state.setup;
  const prefs = loadLastAgent();
  const templates = state.config?.templates;
  const workers = state.config?.workers ?? [];
  const available = useMemo(() => configuredGuestOsOptions(templates), [templates]);
  const recipes = useMemo(() => visibleRecipes(available.map((opt) => opt.os)), [available]);
  const [runtime, setRuntime] = useState<AgentRuntime>(() =>
    setup?.dockerFound ? "docker" : "host",
  );
  const hostAgentsLocked = !policyAllowsHostAgents(state.config?.managedPolicy);
  const [backendId, setBackendId] = useState("");
  const [dockerImage, setDockerImage] = useState(prefs.dockerImage ?? DEFAULT_DOCKER_IMAGE);
  const [hostDir, setHostDir] = useState(prefs.hostDir ?? "");
  const [workspace, setWorkspace] = useState<LaunchWorkspaceSelection>(() =>
    prefs.hostDir?.trim() ? { kind: "host", path: prefs.hostDir.trim() } : { kind: "private" },
  );
  const [osChoice, setOsChoice] = useState<GuestOs>(prefs.os);
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [playbook, setPlaybook] = useState("");
  const [allowedTools, setAllowedTools] = useState<ComputerUseToolName[]>([]);
  const [vision, setVision] = useState<VisionMode | undefined>();
  const [repoIds, setRepoIds] = useState<string[]>([]);
  const [repoRefs, setRepoRefs] = useState<Record<string, string>>({});
  const [setupHintDismissed, setSetupHintDismissed] = useState(loadFinishSetupDismissed);
  const [displayName, setDisplayName] = useState("");
  const [avatarId, setAvatarId] = useState<HubAvatarId>(DEFAULT_HUB_AVATAR);
  const [avatarPose, setAvatarPose] = useState<HubAvatarPose>(DEFAULT_HUB_AVATAR_POSE);
  const [avatarAccessory, setAvatarAccessory] = useState<HubAvatarAccessory>(
    DEFAULT_HUB_AVATAR_ACCESSORY,
  );
  const [avatarAccent, setAvatarAccent] = useState<string | undefined>();
  const [hubRole, setHubRole] = useState<string>("");
  const [personality, setPersonality] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [maxUsd, setMaxUsd] = useState("");
  const [network, setNetwork] = useState<NetworkJail>("restricted");
  const [netDirty, setNetDirty] = useState(false);
  const [namedEnvId, setNamedEnvId] = useState("");
  const [branchLock, setBranchLock] = useState(false);
  const hubMode = parseProductMode(state.config?.productMode) === "swarm";
  const activeTeamId = hubMode
    ? state.projects.find((row) => row.id === state.selectedProjectId && row.surface === "swarm")
        ?.id
    : undefined;
  const effectiveRuntime = hubMode && !showAdvanced ? "host" : runtime;
  const os =
    effectiveRuntime === "vm"
      ? pickConfiguredOs(templates, osChoice)
      : osChoice === "windows-11" || osChoice === "windows-10"
        ? "ubuntu"
        : osChoice;
  const manyOs = available.length > 1;
  const soloOsBadge = !manyOs
    ? available[0]
      ? `Using ${available[0].name}`
      : "Add a guest ISO in Settings → Machines."
    : undefined;
  const hostChat = effectiveRuntime === "host";
  const selectedWorker = workers.find((row) => row.id === backendId);
  const namedEnvironments = state.config?.namedEnvironments ?? [];
  const appliedEnv =
    workspace.kind === "environment" && workspace.env.runtime === effectiveRuntime
      ? applyNamedEnvironment(workspace.env)
      : {};
  const launchDockerImage =
    effectiveRuntime === "docker"
      ? parseDockerImage(appliedEnv.dockerImage ?? dockerImage)
      : undefined;
  const launchHostDir = hostChat && workspace.kind === "host" ? workspace.path : undefined;
  const mockDocker = effectiveRuntime === "docker" && state.dockerKind === "mock" && !backendId;
  const mockHypervisor = effectiveRuntime === "vm" && !backendId && state.hypervisorKind === "mock";
  const engineBlocked = mockDocker || mockHypervisor;
  const canCreate =
    Boolean(state.config) &&
    !engineBlocked &&
    (hostChat ||
      (effectiveRuntime === "docker" ? Boolean(launchDockerImage) : available.length > 0));
  const showRuntimeChrome = !hubMode || showAdvanced;
  const workerHint = backendId
    ? `${effectiveRuntime === "host" ? "The host workspace" : effectiveRuntime === "vm" ? "The VM" : "The container"} runs on ${
        selectedWorker ? workerWhereLabel(selectedWorker) : "the worker"
      }. Chat and keys stay on this machine.${
        selectedWorker && workerIsMetered(selectedWorker)
          ? " Stop destroys the guest. Idle TTL applies on the metered VM."
          : ""
      }`
    : "";
  const hasProvider =
    setup?.hasProvider ?? Boolean(state.config?.providers.some((row) => row.enabled));
  const showSample = showFirstTaskPills({ sessions: state.sessions, hasProvider });
  const primaryRepo = state.repos.find((row) => row.id === repoIds[0]);

  useEffect(() => {
    const last = loadLastAgent();
    const nextWorker = rememberedWorkerId(last, state.config?.workers);
    // Host is the empty-state default. A worker remembered from Docker/VM must
    // not ride along — that used to boot a guest (and sometimes a container)
    // when Start chat still said Host.
    setBackendId(last.runtime === "host" ? nextWorker : "");
  }, [state.config]);

  useEffect(() => {
    if (hostAgentsLocked && runtime === "host") setRuntime("docker");
  }, [hostAgentsLocked, runtime]);

  useEffect(() => {
    const defaults = resolveAgentDefaults(state.config, os, loadLastAgent());
    setProviderId(defaults.providerId);
    setModel(defaults.model);
  }, [state.config, os]);

  function clearRecipeExtras() {
    setRecipeId(null);
    setInstructions("");
    setPlaybook("");
    setAllowedTools([]);
    setVision(undefined);
  }

  function applyFirstTask(task: FirstTask) {
    clearRecipeExtras();
    setPrompt(task.prompt);
    setError(null);
    if (state.config?.setupFirstTask === "pending") {
      void api.saveConfig({ ...state.config, setupFirstTask: "done" }).then((saved) => {
        dispatch({ type: "config", config: saved });
      });
    }
  }

  async function skipFirstTask() {
    if (!state.config) return;
    const saved = await api.saveConfig({ ...state.config, setupFirstTask: "dismissed" });
    dispatch({ type: "config", config: saved });
  }

  function applyRecipe(recipe: AgentRecipe) {
    setRecipeId(recipe.id);
    setRuntime(recipe.runtime);
    setWorkspace({ kind: "private" });
    if (recipe.runtime !== "host") setHostDir("");
    if (recipe.dockerImage) setDockerImage(recipe.dockerImage);
    setOsChoice(recipe.runtime === "vm" ? pickConfiguredOs(templates, recipe.os) : recipe.os);
    setPrompt(recipe.prompt);
    setInstructions(recipe.instructions ?? "");
    setPlaybook(recipe.playbook);
    setAllowedTools(recipe.allowedTools ?? []);
    setVision(recipe.vision);
    setError(null);
  }

  function changeRuntime(next: AgentRuntime) {
    setRuntime(next);
    setNamedEnvId("");
    setWorkspace({ kind: "private" });
    if (next === "docker" || next === "vm") {
      const last = loadLastAgent();
      setBackendId((id) => id || rememberedWorkerId(last, workers));
    }
    if (recipeId && recipes.find((r) => r.id === recipeId)?.runtime !== next) clearRecipeExtras();
  }

  function selectWorkspace(next: LaunchWorkspaceSelection) {
    setWorkspace(next);
    if (next.kind === "host") {
      setNamedEnvId("");
      setHostDir(next.path);
      return;
    }
    if (next.kind === "private") {
      setNamedEnvId("");
      if (effectiveRuntime === "host") setHostDir("");
      return;
    }
    setNamedEnvId(next.env.id);
    const applied = applyNamedEnvironment(next.env);
    if (applied.dockerImage) setDockerImage(applied.dockerImage);
    if (applied.os) setOsChoice(applied.os);
    if (applied.network) {
      setNetDirty(true);
      setNetwork(applied.network);
    }
    if (applied.maxUsd != null) setMaxUsd(String(applied.maxUsd));
    if (next.env.recipeId) {
      const recipe = recipes.find((row) => row.id === next.env.recipeId);
      if (recipe) {
        setRecipeId(recipe.id);
        setInstructions(recipe.instructions ?? "");
        setPlaybook(recipe.playbook);
        setAllowedTools(recipe.allowedTools ?? []);
        setVision(recipe.vision);
      }
    }
    if (applied.placement === "worker" && applied.backendId) {
      setBackendId(applied.backendId);
    }
  }

  function selectNamedEnv(id: string, env?: NamedEnvironment) {
    setNamedEnvId(id);
    if (!env) {
      if (workspace.kind === "environment") setWorkspace({ kind: "private" });
      return;
    }
    selectWorkspace({ kind: "environment", env });
  }

  function setSelectedRepos(ids: string[], refs?: Record<string, string>) {
    const next = [...new Set(ids.filter(Boolean))];
    const hadRepos = repoIds.length > 0;
    setRepoIds(next);
    if (next.length === 0) setBranchLock(false);
    else if (!hadRepos) setBranchLock(true);
    const source = refs ?? repoRefs;
    const kept: Record<string, string> = {};
    for (const id of next) {
      const value = (source[id] ?? state.repos.find((row) => row.id === id)?.checkout.ref)?.trim();
      if (value) kept[id] = value;
    }
    setRepoRefs(kept);
  }

  function checkoutFor(id: string) {
    const row = state.repos.find((item) => item.id === id);
    if (!row) return undefined;
    const ref = repoRefs[id]?.trim() || row.checkout.ref?.trim();
    return { ...row.checkout, ...(ref ? { ref } : {}) };
  }

  async function createQuick() {
    if (!state.config || busy || !canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const defaults = resolveAgentDefaults(state.config, os, loadLastAgent());
      const chosenProvider = providerId || defaults.providerId;
      const chosenModel = model || defaults.model;
      const attachments = files.length ? await filesToAttachments(files) : undefined;
      const resolvedImageId = hostChat
        ? undefined
        : backendId
          ? undefined
          : latestGoldenImage(
              await api.images().catch(() => []),
              os,
              effectiveRuntime === "docker" ? "docker" : "vm",
            )?.id;
      const primaryCheckout = repoIds[0] ? checkoutFor(repoIds[0]) : undefined;
      const extraCheckouts = repoIds
        .slice(1)
        .map((id) => checkoutFor(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      const sessionOs = appliedEnv.os ?? os;
      const sessionBackendId = appliedEnv.backendId ?? backendId;
      const session = await api.createSession({
        os: sessionOs,
        templateId:
          appliedEnv.templateId ||
          defaults.templateId ||
          state.config.templates.find((t) => t.os === "ubuntu")?.id ||
          (hostChat ? "host" : ""),
        runtime: effectiveRuntime,
        kind: recipes.find((row) => row.id === recipeId)?.kind ?? appliedEnv.kind,
        dockerImage: launchDockerImage,
        providerId: chosenProvider,
        model: chosenModel,
        reasoningEffort:
          state.config.providers.find((row) => row.id === chosenProvider)?.kind === "codex-cli"
            ? reasoningEffort
            : undefined,
        startVm: !hostChat || Boolean(sessionBackendId),
        imageId: appliedEnv.imageId ?? resolvedImageId,
        instructions: instructions.trim() || appliedEnv.instructions || undefined,
        playbook: playbook.trim() || appliedEnv.playbook || undefined,
        allowedTools: allowedTools.length
          ? allowedTools
          : appliedEnv.allowedTools?.length
            ? appliedEnv.allowedTools
            : undefined,
        vision: hostChat ? "off" : (vision ?? appliedEnv.vision),
        autonomy: hubMode ? "guided" : undefined,
        surface: hubMode ? "swarm" : "developer",
        ...(activeTeamId ? { projectId: activeTeamId } : {}),
        persona: hubMode
          ? personaFromDraft({
              displayName,
              avatarId,
              avatarPose,
              avatarAccessory,
              avatarAccent,
              hubRole,
              personality,
            })
          : undefined,
        prompt: prompt.trim() || undefined,
        ...(attachments ? { attachments } : {}),
        hostDir: launchHostDir,
        network: hostChat ? undefined : netDirty ? network : appliedEnv.network,
        maxUsd: maxUsd.trim() ? Number(maxUsd) : appliedEnv.maxUsd,
        allowHosts: appliedEnv.allowHosts,
        ...(repoIds[0] ? { repoId: repoIds[0] } : {}),
        ...(repoIds.slice(1).length ? { extraRepoIds: repoIds.slice(1) } : {}),
        ...(primaryCheckout ? { repo: primaryCheckout } : {}),
        ...(extraCheckouts.length ? { extraRepos: extraCheckouts } : {}),
        ...(repoIds[0] && branchLock ? { branchLock: true } : {}),
        ...(sessionBackendId ? { placement: "worker" as const, backendId: sessionBackendId } : {}),
      });
      setFiles([]);
      saveLastAgent({
        os: sessionOs,
        runtime: effectiveRuntime,
        dockerImage: effectiveRuntime === "docker" ? (launchDockerImage ?? dockerImage) : undefined,
        hostDir: hostChat ? launchHostDir : loadLastAgent().hostDir,
        providerId: chosenProvider,
        model: chosenModel,
        placement: sessionBackendId ? "worker" : "local",
        backendId: sessionBackendId || undefined,
      });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent");
    } finally {
      setBusy(false);
    }
  }

  const hasForge = Boolean(state.config && forgesWithTokens(state.config.forges).length);
  const remainingSetup = Boolean(setup?.setupCompleted && setupHasRemainingTodos(setup));
  const checklistOpen = remainingSetup && !setupHintDismissed;
  const showProviderCallout = Boolean(
    setup && !setup.hasProvider && !checklistOpen && !setupHintDismissed,
  );
  const showEngineCallout = engineBlocked && !checklistOpen;
  const showImageCallout = Boolean(
    setup &&
    runtime === "vm" &&
    !backendId &&
    !engineBlocked &&
    !setup.linuxImageReady &&
    !checklistOpen,
  );
  const showGitCallout = Boolean(
    state.config && !hasForge && !checklistOpen && !showEngineCallout && !setupHintDismissed,
  );

  function useHostInstead() {
    changeRuntime("host");
    setBackendId("");
    if (recipeId) clearRecipeExtras();
  }

  return (
    <div className={`empty agent-start${hubMode ? " hub-start" : ""}`}>
      <div className="empty-card">
        <EmptyHero
          hideMascot={hubMode}
          followCursor
          title={hubMode ? "Create a teammate" : NEW_AGENT_COPY.heading}
          lead={hubMode ? "Name them, pick a look, and give them a role." : NEW_AGENT_COPY.lead}
        />

        {hubMode ? (
          <div className="hub-persona-fields">
            <div className="hub-persona-identity">
              <div className="field">
                <label htmlFor="hub-teammate-name">Name</label>
                <input
                  id="hub-teammate-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Nova"
                  data-testid="hub-teammate-name"
                />
              </div>
              <div className="field">
                <label htmlFor="hub-role">Role (optional)</label>
                <Select
                  id="hub-role"
                  ariaLabel="Role (optional)"
                  value={hubRole}
                  options={[
                    { value: "", label: "Ask when we start" },
                    ...HUB_ROLE_PRESETS.map((role) => ({ value: role, label: role })),
                  ]}
                  onChange={(value) => {
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
                      value,
                    );
                    setHubRole(next.hubRole);
                    setPersonality(next.personality);
                    setAvatarId(next.avatarId);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="hub-personality">Personality (optional)</label>
                <input
                  id="hub-personality"
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="Calm, concise, cites sources"
                />
              </div>
              <div className="field">
                <label htmlFor="hub-brief">Brief (optional)</label>
                <textarea
                  id="hub-brief"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Master prompt for this teammate — goals, tone, what they own"
                  rows={3}
                  data-testid="hub-brief"
                />
              </div>
            </div>
            <div className="field hub-persona-avatar">
              <span id="hub-avatar-label">Avatar</span>
              <PersonaAvatarPicker
                layout="panel"
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

        <section className="launch" aria-label={hubMode ? "New teammate" : "New chat"}>
          {state.config?.setupFirstTask === "pending" && hasProvider ? (
            <div className="first-task-card" data-testid="first-task-card">
              <h3>{t("empty.firstTask.title")}</h3>
              <p>{t("empty.firstTask.body")}</p>
              <div className="first-task-card-actions">
                <button
                  type="button"
                  className="btn small primary"
                  onClick={() => applyFirstTask(FIRST_TASKS[0]!)}
                >
                  {t("empty.firstTask.cta")}
                </button>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => void skipFirstTask()}
                >
                  {t("onboarding.skip")}
                </button>
              </div>
            </div>
          ) : null}
          {setup ? (
            <FinishSetupChecklist
              setup={setup}
              dismissed={setupHintDismissed}
              onFinish={() => dispatch({ type: "setupOpen", open: true })}
              onDismiss={() => {
                saveFinishSetupDismissed(true);
                setSetupHintDismissed(true);
              }}
              extras={
                checklistOpen && !hasForge
                  ? [{ id: "git", label: "GitHub token", done: false, optional: true }]
                  : undefined
              }
              extraActions={
                checklistOpen && engineBlocked ? (
                  <button type="button" className="btn small" onClick={useHostInstead}>
                    Use Host instead
                  </button>
                ) : undefined
              }
            />
          ) : null}
          {showProviderCallout && (
            <ProviderSetupBanner onFinish={() => dispatch({ type: "setupOpen", open: true })} />
          )}
          {showEngineCallout && (
            <SetupBanner
              title={mockDocker ? "Docker isn't installed" : "QEMU isn't installed"}
              detail={
                mockDocker
                  ? "Agents cannot run on a mock engine"
                  : "VM agents cannot run on a mock hypervisor"
              }
              testId="engine-setup-banner"
            >
              <button
                type="button"
                className="btn small primary"
                onClick={() => dispatch({ type: "setupOpen", open: true })}
              >
                {mockDocker ? "Install Docker" : "Install QEMU"}
              </button>
              <button type="button" className="btn small" onClick={useHostInstead}>
                Use Host instead
              </button>
            </SetupBanner>
          )}
          {showImageCallout && (
            <SetupBanner title="Finish setup" detail="Linux cloud image">
              <button
                type="button"
                className="btn small primary"
                onClick={() => dispatch({ type: "setupOpen", open: true })}
              >
                Continue
              </button>
            </SetupBanner>
          )}
          {showGitCallout ? (
            <SetupBanner title="Connect GitHub" detail="to clone and review pull requests">
              <button
                type="button"
                className="btn small"
                onClick={() => openSettings(dispatch, "git")}
              >
                Add a GitHub token
              </button>
            </SetupBanner>
          ) : null}

          {hubMode ? (
            <button
              type="button"
              className="btn small ghost"
              data-testid="hub-advanced-toggle"
              onClick={() => setShowAdvanced((open) => !open)}
            >
              {showAdvanced ? "Hide advanced" : "Advanced"}
            </button>
          ) : null}

          {showRuntimeChrome && workers.length ? (
            <div className="launch-env-bar">
              <PlacementToggle
                workers={workers}
                value={backendId}
                onChange={(id) => {
                  setBackendId(id);
                }}
              />
              <p className="hint launch-runtime-hint">{workerHint || "\u00a0"}</p>
            </div>
          ) : null}

          <div className="launch-card">
            {showRuntimeChrome ? (
              <LaunchWorkspace
                runtime={effectiveRuntime}
                remote={Boolean(backendId)}
                hostDir={hostDir}
                environments={namedEnvironments}
                selection={
                  workspace.kind === "environment" && workspace.env.runtime !== effectiveRuntime
                    ? { kind: "private" }
                    : workspace
                }
                onSelect={selectWorkspace}
                onHostDir={setHostDir}
                kickerBadge={effectiveRuntime === "vm" ? soloOsBadge : undefined}
                disabledRuntimes={hostAgentsLocked ? ["host"] : []}
                onRuntimeChange={(next) => {
                  if (hostAgentsLocked && next === "host") return;
                  changeRuntime(next);
                }}
              />
            ) : null}

            <div
              className="empty-composer"
              onDragOver={(event) => {
                if (event.dataTransfer?.types?.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                const incoming = filesFromDataTransfer(event.dataTransfer);
                if (!incoming.length) return;
                event.preventDefault();
                const oversize = firstOversizeAttachment(incoming);
                if (oversize) {
                  setError(oversize);
                  return;
                }
                setError(null);
                setFiles((rows) => mergeComposerFiles(rows, incoming));
              }}
              onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
                const incoming = composerFilesFromClipboard(
                  event.clipboardData,
                  files.map((file) => file.name),
                );
                if (!incoming.length) return;
                event.preventDefault();
                const oversize = firstOversizeAttachment(incoming);
                if (oversize) {
                  setError(oversize);
                  return;
                }
                setError(null);
                const el = box.current;
                const current = el?.value ?? prompt;
                const caret = el?.selectionStart ?? current.length;
                const next = applyComposerPaste(
                  current,
                  caret,
                  files,
                  incoming,
                  el?.selectionEnd ?? caret,
                );
                setPrompt(next.text);
                setFiles(next.files);
                queueMicrotask(() => {
                  const el = box.current;
                  if (!el) return;
                  el.focus();
                  el.selectionStart = el.selectionEnd = next.cursor;
                });
              }}
            >
              <ComposerTextarea
                textareaRef={box}
                value={prompt}
                files={files}
                placeholder={
                  hubMode
                    ? "First message to your teammate…"
                    : !hostChat && runtime === "vm" && manyOs
                      ? NEW_AGENT_COPY.placeholderPickOs
                      : NEW_AGENT_COPY.placeholder
                }
                onChange={setPrompt}
                onKeyDown={(e) => {
                  const chip = applyComposerChipKey(
                    e.key,
                    prompt,
                    e.currentTarget.selectionStart ?? prompt.length,
                    files,
                  );
                  if (chip) {
                    e.preventDefault();
                    setPrompt(chip.text);
                    setFiles(chip.files);
                    queueMicrotask(() => {
                      const el = box.current;
                      if (!el) return;
                      el.selectionStart = el.selectionEnd = chip.cursor;
                    });
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void createQuick();
                  }
                }}
              />
              <div className="empty-composer-bar">
                <ComposerAddButton
                  title={
                    hostChat || sessionVision({ vision, runtime }) !== "off"
                      ? "Attach a file (images, text, PDF). Copied into /workspace/.locus-attachments."
                      : "Attach a file. Images copy into /workspace/.locus-attachments but are not sent to the model while Vision is off."
                  }
                  onError={setError}
                  onPick={(picked) => setFiles((rows) => mergeComposerFiles(rows, picked))}
                />
                <ComposerFileThumbs
                  files={splitComposerFiles(prompt, files).bar}
                  onRemove={(index) => {
                    const target = splitComposerFiles(prompt, files).bar[index];
                    if (!target) return;
                    setFiles((rows) => rows.filter((file) => file !== target));
                  }}
                />
                <ComposerRepoPicker
                  repos={state.repos}
                  repoIds={repoIds}
                  repoRefs={repoRefs}
                  onChange={setSelectedRepos}
                  multiple
                />
                <div className="composer-toolbar-end">
                  <ModelPicker
                    compact
                    providers={state.config?.providers ?? []}
                    providerId={providerId}
                    model={model}
                    reasoningEffort={reasoningEffort}
                    onReasoningEffortChange={setReasoningEffort}
                    onChange={(next) => {
                      setProviderId(next.providerId);
                      setModel(next.model);
                      setReasoningEffort(undefined);
                    }}
                  />
                  <button
                    type="button"
                    className="btn primary small composer-send"
                    disabled={busy || !canCreate}
                    title={newAgentSendLabel({ hubMode, hostChat })}
                    aria-label={busy ? "Creating…" : newAgentSendLabel({ hubMode, hostChat })}
                    onClick={() => void createQuick()}
                  >
                    {busy ? (
                      "Creating…"
                    ) : (
                      <span className="composer-send-label">{NEW_AGENT_COPY.send}</span>
                    )}
                    <IconReturn />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && <p className="scrim-note is-danger">{error}</p>}

          {showOptions ? (
            <ComposerMoreOptions
              hostChat={hostChat}
              hasRepo={repoIds.length > 0}
              network={network}
              maxUsd={maxUsd}
              namedEnvId={namedEnvId}
              environments={namedEnvironments}
              branchLock={branchLock}
              jailLocked={Boolean(
                state.config?.managedPolicy?.active &&
                state.config.managedPolicy.locked.includes("jail"),
              )}
              onNetworkChange={(next) => {
                setNetDirty(true);
                setNetwork(next);
              }}
              onMaxUsdChange={setMaxUsd}
              onNamedEnvChange={selectNamedEnv}
              onBranchLockChange={setBranchLock}
            />
          ) : null}

          <div className="empty-actions launch-footer">
            <button
              className="btn ghost"
              type="button"
              disabled={engineBlocked}
              onClick={() => setShowOptions((open) => !open)}
            >
              {showOptions ? "Hide options" : NEW_AGENT_COPY.moreOptions}
            </button>
            {showOptions ? (
              <button
                className="btn ghost"
                type="button"
                disabled={engineBlocked}
                onClick={() =>
                  dispatch({
                    type: "new",
                    open: true,
                    os,
                    prompt: prompt.trim() || undefined,
                    runtime,
                    dockerImage: runtime === "docker" ? dockerImage : undefined,
                    hostDir: hostChat ? launchHostDir : undefined,
                    instructions: instructions.trim() || undefined,
                    playbook: playbook.trim() || undefined,
                    allowedTools: allowedTools.length ? allowedTools : undefined,
                    kind: recipes.find((row) => row.id === recipeId)?.kind,
                    repoId: repoIds[0] || undefined,
                    extraRepoIds: repoIds.slice(1).length ? repoIds.slice(1) : undefined,
                    repoUrl: primaryRepo?.checkout.url,
                    repoRef: (repoIds[0] && repoRefs[repoIds[0]]) || primaryRepo?.checkout.ref,
                  })
                }
              >
                Full form
              </button>
            ) : null}
          </div>

          {showRuntimeChrome ? (
            <div className="launch-below">
              {manyOs ? (
                <div
                  className={`launch-os-slot is-reserved${runtime === "vm" ? " is-active" : ""}`}
                  aria-hidden={runtime !== "vm"}
                >
                  <OsPicker
                    templates={templates}
                    value={os}
                    onChange={(next) => {
                      setOsChoice(next);
                      if (recipeId && recipes.find((r) => r.id === recipeId)?.os !== next)
                        clearRecipeExtras();
                    }}
                  />
                </div>
              ) : null}
              <div className="launch-starters-slot">
                {!hostChat ? (
                  <div className="design-start-from">
                    <p className="design-start-from-label">Or start from</p>
                    <RecipeCards
                      pills
                      recipes={recipes}
                      selectedId={recipeId}
                      onSelect={applyRecipe}
                    />
                  </div>
                ) : !hubMode && showSample ? (
                  <FirstTaskPills
                    tasks={FIRST_TASKS}
                    selectedId={FIRST_TASKS.find((task) => task.prompt === prompt)?.id ?? null}
                    onSelect={applyFirstTask}
                  />
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
