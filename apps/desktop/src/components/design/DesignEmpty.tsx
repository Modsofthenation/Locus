import {
  DESIGN_RECIPES,
  DESIGN_DOCKER_IMAGE,
  DESIGN_PLAYBOOK,
  DESIGN_TOOLS,
  GAME_RECIPES,
  GAME_PLAYBOOK,
  GAME_TOOLS,
  GAME_KITS,
  GAME_REMIX_PROMPTS,
  GAME_ONE_CHANGE_HINT,
  composeGameLaunchPrompt,
  kitForGameDimension,
  looksGameImageFile,
  type GameDimension,
  ASSET_RECIPES,
  ASSET_PLAYBOOK,
  ASSET_TOOLS,
  ASSET_KITS,
  DEFAULT_DESIGN_PALETTE,
  applyNamedEnvironment,
  firstOversizeAttachment,
  formatStartingPointPrompt,
  parseDockerImage,
  policyAllowsHostAgents,
  resolveDesignSystem,
  resolveAssetStyle,
  resolveGameStyle,
  resolveAssetBuild,
  ASSET_BUILD_DEFAULTS,
  inferAssetSubject,
  assetShowsStage3d,
  assetMentionItems,
  filterAssetMentions,
  fileMentionQuery,
  insertAssetMention,
  workerIsMetered,
  workerWhereLabel,
  type AgentRecipe,
  type AssetMentionItem,
  type HostSessionMentionItem,
  type AgentRuntime,
  type ComputerUseToolName,
  type DesignPalette,
  type DesignStartingPoint,
  type NamedEnvironment,
  type NetworkJail,
  type AssetBuild,
} from "@locus/shared";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
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
  LAST_AGENT_KEY,
} from "@/lib/lastAgent";
import { useStore } from "@/state/store";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { ComposerRepoPicker } from "@/components/codebase/RepoField";
import { RecipeCards, recipeShortcut } from "@/components/settings/RecipeCards";
import { DesignPalettePicker } from "./DesignPalettePicker";
import { DesignSystemPicker } from "./DesignSystemPicker";
import { AssetStylePicker } from "@/components/assets/AssetStylePicker";
import { GameStylePicker } from "@/components/game/GameStylePicker";
import { AssetBuildPicker } from "@/components/assets/AssetBuildPicker";
import { ComposerAssetPicker } from "@/components/assets/ComposerAssetPicker";
import { AssetMentionMenu } from "@/components/chat/AssetMentionMenu";
import {
  AssetDropWell,
  assignImageSlots,
  slotFilesList,
  type AssetViewFiles,
} from "@/components/assets/AssetDropWell";
import { PlacementToggle } from "@/components/settings/RuntimePicker";
import {
  ComposerAddButton,
  ComposerFileThumbs,
  ComposerTextarea,
  mergeComposerFiles,
} from "@/components/chat/ComposerFiles";
import { ComposerMoreOptions } from "@/components/chat/ComposerMoreOptions";
import { IconReturn } from "@/components/layout/Icons";
import { OverflowMenu } from "@/components/layout/OverflowMenu";
import { Select } from "@/components/layout/Select";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { ProviderSetupBanner, SetupBanner } from "@/components/layout/SetupBanner";
import {
  LaunchWorkspace,
  type LaunchWorkspaceSelection,
} from "@/components/layout/LaunchWorkspace";

const DESIGN_RUNTIMES: AgentRuntime[] = ["docker", "vm", "host"];

function rememberedDesignRuntime(): AgentRuntime {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_AGENT_KEY);
    if (!raw) return "docker";
    const parsed = JSON.parse(raw) as { runtime?: string; hostDir?: string };
    return parsed.runtime === "host" ? "host" : "docker";
  } catch {
    return "docker";
  }
}

function rememberedDesignWorkspace(): LaunchWorkspaceSelection {
  try {
    const raw = globalThis.localStorage?.getItem(LAST_AGENT_KEY);
    if (!raw) return { kind: "private" };
    const parsed = JSON.parse(raw) as { runtime?: string; hostDir?: string };
    const path = typeof parsed.hostDir === "string" ? parsed.hostDir.trim() : "";
    if (parsed.runtime === "host" && path) return { kind: "host", path };
  } catch {
    /* fall through */
  }
  return { kind: "private" };
}

export type CanvasLaunchSurface = "design" | "game" | "assets";

const CANVAS_LAUNCH = {
  design: {
    kind: "design" as const,
    recipes: DESIGN_RECIPES,
    playbook: DESIGN_PLAYBOOK,
    tools: DESIGN_TOOLS,
    heading: "What should we design?",
    lead: "Describe a landing page, dashboard, or deck. Choose Host or Docker, then the folder the canvas can write.",
    placeholder: "Describe a landing page, dashboard, deck, or one-pager…",
    aria: "New design",
    starters: "Design starters",
    createLabel: "Create design",
    createError: "Could not create design",
    showLook: true,
    vmReason: "Design canvases need Docker or Host",
    starterLimit: 0,
  },
  game: {
    kind: "game" as const,
    recipes: GAME_RECIPES,
    playbook: GAME_PLAYBOOK,
    tools: GAME_TOOLS,
    heading: "What should we play?",
    lead: "Describe a playable web game. Choose Host or Docker, then the folder the canvas can write.",
    placeholder: `${GAME_ONE_CHANGE_HINT} Describe an arcade, platformer, puzzle, or arena…`,
    aria: "New game",
    starters: "Game starters",
    createLabel: "Create game",
    createError: "Could not create game",
    showLook: false,
    vmReason: "Games need Docker or Host",
    starterLimit: 6,
  },
  assets: {
    kind: "assets" as const,
    recipes: ASSET_RECIPES,
    playbook: ASSET_PLAYBOOK,
    tools: ASSET_TOOLS,
    heading: "Drop a photo to reconstruct",
    lead: "Front, side, and back views become the source. Or describe a character, prop, or tileset.",
    placeholder: "Describe a character, prop, or tileset — or drop photos into the well…",
    aria: "New asset",
    starters: "Asset starters",
    createLabel: "Create asset",
    createError: "Could not create asset",
    showLook: false,
    vmReason: "Assets need Docker or Host",
    starterLimit: 0,
  },
};

export function DesignEmpty({ surface = "design" }: { surface?: CanvasLaunchSurface } = {}) {
  const { state, dispatch } = useStore();
  const prefs = loadLastAgent();
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [startId, setStartId] = useState<string | null>(null);
  const [playbook, setPlaybook] = useState("");
  const [allowedTools, setAllowedTools] = useState<ComputerUseToolName[]>([]);
  const [palette, setPalette] = useState<DesignPalette>({ ...DEFAULT_DESIGN_PALETTE });
  const [designSystemId, setDesignSystemId] = useState<string>("");
  const [systemTouched, setSystemTouched] = useState(false);
  const [assetStyleId, setAssetStyleId] = useState<string>("");
  const [gameStyleId, setGameStyleId] = useState<string>("");
  const [styleTouched, setStyleTouched] = useState(false);
  const [gameDim, setGameDim] = useState<GameDimension | null>(null);
  const [hotseat, setHotseat] = useState(false);
  const [remixId, setRemixId] = useState<string | null>(null);
  const [assetBuild, setAssetBuild] = useState<AssetBuild>(ASSET_BUILD_DEFAULTS);
  const [viewSlots, setViewSlots] = useState<AssetViewFiles>({});
  const [repoIds, setRepoIds] = useState<string[]>([]);
  const [repoRefs, setRepoRefs] = useState<Record<string, string>>({});
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [assetHits, setAssetHits] = useState<AssetMentionItem[]>([]);
  const [assetMentionIndex, setAssetMentionIndex] = useState(0);
  const [backendId, setBackendId] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntime>(rememberedDesignRuntime);
  const [hostDir, setHostDir] = useState(() => {
    const remembered = rememberedDesignWorkspace();
    return remembered.kind === "host" ? remembered.path : (prefs.hostDir ?? "");
  });
  const [workspace, setWorkspace] = useState<LaunchWorkspaceSelection>(rememberedDesignWorkspace);
  const [dockerImage, setDockerImage] = useState(prefs.dockerImage ?? DESIGN_DOCKER_IMAGE);
  const [showOptions, setShowOptions] = useState(false);
  const [maxUsd, setMaxUsd] = useState("");
  const [network, setNetwork] = useState<NetworkJail>("restricted");
  const [netDirty, setNetDirty] = useState(false);
  const [namedEnvId, setNamedEnvId] = useState("");
  const [branchLock, setBranchLock] = useState(false);
  /** Games / Assets keep unset context (repo, asset, kit, style, build) in the "+" menu. */
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const dockerDown =
    runtime === "docker" && state.dockerKind === "docker" && !state.dockerReady && !backendId;
  const canCreate = Boolean(state.config) && !dockerDown;
  const workers = state.config?.workers ?? [];
  const selectedWorker = workers.find((row) => row.id === backendId);
  const launch = CANVAS_LAUNCH[surface];
  const compactAssets = surface === "assets" && !showOptions;
  const meshBuild = assetShowsStage3d(inferAssetSubject({ recipeId: recipeId ?? undefined }));
  const selectedSystem = resolveDesignSystem(designSystemId, state.designSystems);
  const kitStarts = surface === "design" ? (selectedSystem?.startingPoints ?? []) : [];
  const namedEnvironments = state.config?.namedEnvironments ?? [];
  const hostChat = runtime === "host";
  const appliedEnv =
    workspace.kind === "environment" && workspace.env.runtime === runtime
      ? applyNamedEnvironment(workspace.env)
      : {};
  const launchDockerImage = hostChat
    ? undefined
    : parseDockerImage(appliedEnv.dockerImage ?? dockerImage) ||
      parseDockerImage(DESIGN_DOCKER_IMAGE);
  const launchHostDir = hostChat && workspace.kind === "host" ? workspace.path : undefined;
  const foldContext = surface === "game" || surface === "assets";
  const reveal = (id: string) => setRevealed((rows) => new Set([...rows, id]));
  const styleId = surface === "assets" ? assetStyleId : gameStyleId;
  const styleName =
    surface === "assets"
      ? state.assetStyles.find((row) => row.id === assetStyleId)?.name
      : state.gameStyles.find((row) => row.id === gameStyleId)?.name;
  const buildSet = JSON.stringify(assetBuild) !== JSON.stringify(ASSET_BUILD_DEFAULTS);
  const showRepo = !foldContext || repoIds.length > 0 || revealed.has("repo");
  const showAsset = surface === "game" && (assetIds.length > 0 || revealed.has("asset"));
  const showKit = !foldContext || Boolean(designSystemId) || revealed.has("kit");
  const showStyle = !foldContext || Boolean(styleId) || revealed.has("style");
  const showBuild = surface === "assets" && (buildSet || revealed.has("build"));
  const addExtras = foldContext
    ? [
        showRepo ? null : { id: "repo", label: "Repo context", onSelect: () => reveal("repo") },
        surface === "game" && !showAsset
          ? { id: "asset", label: "Asset", onSelect: () => reveal("asset") }
          : null,
        showKit ? null : { id: "kit", label: "Kit", onSelect: () => reveal("kit") },
        showStyle ? null : { id: "style", label: "Style", onSelect: () => reveal("style") },
        surface === "assets" && !showBuild
          ? { id: "build", label: "Build", onSelect: () => reveal("build") }
          : null,
      ].filter((row): row is NonNullable<typeof row> => Boolean(row))
    : undefined;
  const workerHint = backendId
    ? `The canvas is /workspace/index.html on ${
        selectedWorker ? workerWhereLabel(selectedWorker) : "the worker"
      }. Chat and keys stay on this machine.${
        selectedWorker && workerIsMetered(selectedWorker)
          ? " Stop destroys the guest. Idle TTL applies on the metered VM."
          : ""
      }`
    : "";

  // Docker CLI installed but the daemon is down: start on Host instead of a launch that fails.
  useEffect(() => {
    if (
      state.dockerKind === "docker" &&
      !state.dockerReady &&
      policyAllowsHostAgents(state.config?.managedPolicy)
    ) {
      setRuntime((current) => (current === "docker" ? "host" : current));
    }
  }, [state.dockerKind, state.dockerReady, state.config?.managedPolicy]);

  useEffect(() => {
    const defaults = resolveAgentDefaults(state.config, "ubuntu", loadLastAgent());
    setProviderId((current) => current || defaults.providerId);
    setModel((current) => current || defaults.model);
    setBackendId(
      (current) => current || rememberedWorkerId(loadLastAgent(), state.config?.workers),
    );
  }, [state.config]);

  useEffect(() => {
    if (surface !== "design" || systemTouched || designSystemId) return;
    const system = resolveDesignSystem(state.config?.defaultDesignSystemId, state.designSystems);
    if (!system) return;
    setDesignSystemId(system.id);
    setPalette({ ...system.palette });
  }, [
    state.config?.defaultDesignSystemId,
    state.designSystems,
    designSystemId,
    systemTouched,
    surface,
  ]);

  useEffect(() => {
    if (surface !== "assets" || styleTouched || assetStyleId) return;
    const style = resolveAssetStyle(state.config?.defaultAssetStyleId, state.assetStyles);
    if (!style) return;
    setAssetStyleId(style.id);
  }, [state.config?.defaultAssetStyleId, state.assetStyles, assetStyleId, styleTouched, surface]);

  useEffect(() => {
    if (surface !== "game" || styleTouched || gameStyleId) return;
    const style = resolveGameStyle(state.config?.defaultGameStyleId, state.gameStyles);
    if (!style) return;
    setGameStyleId(style.id);
  }, [state.config?.defaultGameStyleId, state.gameStyles, gameStyleId, styleTouched, surface]);

  function applyRecipe(recipe: AgentRecipe) {
    setRecipeId(recipe.id);
    setStartId(null);
    setRemixId(null);
    setPrompt(recipe.prompt);
    setPlaybook(recipe.playbook);
    setAllowedTools(recipe.allowedTools ?? []);
    if (recipe.dockerImage) setDockerImage(recipe.dockerImage);
    setError(null);
  }

  function applyRemix(row: (typeof GAME_REMIX_PROMPTS)[number]) {
    setRemixId(row.id);
    setRecipeId(null);
    setStartId(null);
    setPrompt(row.prompt);
    setPlaybook(GAME_PLAYBOOK);
    setAllowedTools([...GAME_TOOLS]);
    setError(null);
  }

  function pickGameDim(next: GameDimension) {
    const dim = gameDim === next ? null : next;
    setGameDim(dim);
    setSystemTouched(true);
    setDesignSystemId(kitForGameDimension(dim, designSystemId));
  }

  function applyStart(point: DesignStartingPoint) {
    setRecipeId(null);
    setStartId(point.id);
    setPrompt(formatStartingPointPrompt(point.title));
    setPlaybook(DESIGN_PLAYBOOK);
    setAllowedTools([...DESIGN_TOOLS]);
    setError(null);
  }

  function changeRuntime(next: AgentRuntime) {
    if (next !== "docker" && next !== "host") return;
    setRuntime(next);
    setNamedEnvId("");
    setWorkspace({ kind: "private" });
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
      if (runtime === "host") setHostDir("");
      return;
    }
    setNamedEnvId(next.env.id);
    const applied = applyNamedEnvironment(next.env);
    if (applied.dockerImage) setDockerImage(applied.dockerImage);
    if (applied.network) {
      setNetDirty(true);
      setNetwork(applied.network);
    }
    if (applied.maxUsd != null) setMaxUsd(String(applied.maxUsd));
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

  // Design with exactly one linked repo: use it as read-only context by default.
  const repoPickTouched = useRef(false);
  const onlyRepoId = surface === "design" && state.repos.length === 1 ? state.repos[0]!.id : "";
  useEffect(() => {
    if (!onlyRepoId || repoPickTouched.current) return;
    repoPickTouched.current = true;
    setSelectedRepos([onlyRepoId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyRepoId]);

  function setSelectedRepos(ids: string[], refs?: Record<string, string>) {
    repoPickTouched.current = true;
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

  function refreshAssetMentions(text: string, caret: number) {
    if (surface !== "game") {
      if (assetHits.length) setAssetHits([]);
      return;
    }
    const query = fileMentionQuery(text, caret);
    if (!query || /[./]/.test(query.query)) {
      if (assetHits.length) setAssetHits([]);
      return;
    }
    const hits = filterAssetMentions(
      assetMentionItems({ session: { id: "", kind: "game" }, sessions: state.sessions }),
      query.query,
    );
    setAssetHits(hits);
    setAssetMentionIndex(0);
  }

  function pickAssetMention(item: AssetMentionItem | HostSessionMentionItem) {
    const caret = box.current?.selectionStart ?? prompt.length;
    const query = fileMentionQuery(prompt, caret);
    const next = insertAssetMention(prompt, caret, item.token.replace(/^asset:/, ""), query);
    setPrompt(next.text);
    setAssetIds((ids) => (ids.includes(item.id) ? ids : [...ids, item.id]));
    setAssetHits([]);
    queueMicrotask(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.selectionStart = el.selectionEnd = next.cursor;
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const recipe = launch.recipes.find((row) => recipeShortcut(row) === event.key.toUpperCase());
      if (!recipe) return;
      event.preventDefault();
      applyRecipe(recipe);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function createQuick() {
    if (!state.config || busy || !canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const defaults = resolveAgentDefaults(state.config, "ubuntu", loadLastAgent());
      const chosenProvider = providerId || defaults.providerId;
      const chosenModel = model || defaults.model;
      const recipe = recipeId ? launch.recipes.find((r) => r.id === recipeId) : undefined;
      const start = selectedSystem?.startingPoints?.find((row) => row.id === startId);
      const slotList = surface === "assets" ? slotFilesList(viewSlots) : [];
      const extraFiles =
        surface === "assets"
          ? files.filter(
              (file) =>
                !slotList.some((slot) => slot.name === file.name && slot.size === file.size),
            )
          : files;
      const outgoing = [...slotList, ...extraFiles];
      const attachments = outgoing.length ? await filesToAttachments(outgoing) : undefined;
      const sessionBackendId = appliedEnv.backendId ?? backendId;
      const primaryCheckout = repoIds[0] ? checkoutFor(repoIds[0]) : undefined;
      const extraCheckouts = repoIds
        .slice(1)
        .map((id) => checkoutFor(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      const session = await api.createSession({
        title: recipe?.title ?? start?.title,
        os: "ubuntu",
        templateId:
          defaults.templateId || state.config.templates.find((t) => t.os === "ubuntu")?.id || "",
        kind: launch.kind,
        runtime,
        dockerImage: hostChat ? undefined : launchDockerImage,
        providerId: chosenProvider,
        model: chosenModel,
        startVm: !hostChat || Boolean(sessionBackendId),
        playbook: playbook.trim() || undefined,
        allowedTools: allowedTools.length ? allowedTools : undefined,
        ...(launch.showLook ? { palette } : {}),
        designSystemId:
          (surface === "game" ? kitForGameDimension(gameDim, designSystemId) : designSystemId) ||
          undefined,
        ...(surface === "assets" && assetStyleId ? { assetStyleId } : {}),
        ...(surface === "game" && gameStyleId ? { gameStyleId } : {}),
        ...(surface === "assets" ? { assetBuild: resolveAssetBuild(assetBuild) } : {}),
        prompt:
          surface === "game"
            ? composeGameLaunchPrompt({
                prompt: prompt.trim(),
                hotseat,
                hasImages: outgoing.some(looksGameImageFile),
              }) || undefined
            : prompt.trim() || undefined,
        hostDir: launchHostDir,
        network: hostChat ? undefined : netDirty ? network : appliedEnv.network,
        maxUsd: maxUsd.trim() ? Number(maxUsd) : appliedEnv.maxUsd,
        allowHosts: appliedEnv.allowHosts,
        ...(attachments ? { attachments } : {}),
        ...(repoIds[0] ? { repoId: repoIds[0] } : {}),
        ...(repoIds.slice(1).length ? { extraRepoIds: repoIds.slice(1) } : {}),
        ...(primaryCheckout ? { repo: primaryCheckout } : {}),
        ...(extraCheckouts.length ? { extraRepos: extraCheckouts } : {}),
        ...(repoIds[0] && branchLock ? { branchLock: true } : {}),
        ...(surface === "game" && assetIds.length ? { assetIds } : {}),
        ...(sessionBackendId ? { placement: "worker" as const, backendId: sessionBackendId } : {}),
      });
      setFiles([]);
      setViewSlots({});
      saveLastAgent({
        os: "ubuntu",
        runtime,
        dockerImage: hostChat ? undefined : (launchDockerImage ?? DESIGN_DOCKER_IMAGE),
        hostDir: hostChat ? launchHostDir : loadLastAgent().hostDir,
        providerId: chosenProvider,
        model: chosenModel,
        placement: sessionBackendId ? "worker" : "local",
        backendId: sessionBackendId || undefined,
      });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : launch.createError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="empty design-start">
      <div className="empty-card">
        <EmptyHero title={launch.heading} lead={launch.lead} />

        <section className="launch" aria-label={launch.aria}>
          {compactAssets ? null : (
            <>
              {state.setup && !state.setup.hasProvider ? (
                <ProviderSetupBanner onFinish={() => dispatch({ type: "setupOpen", open: true })} />
              ) : null}
              {state.dockerKind === "mock" && !hostChat && !backendId ? (
                <SetupBanner
                  title="Docker isn't installed"
                  detail="Using a mock engine until the Docker CLI is installed"
                  testId="engine-setup-banner"
                />
              ) : null}
              {dockerDown ? (
                <SetupBanner
                  title="Docker isn't running"
                  detail="Start the Docker daemon, or switch to Host"
                  testId="engine-setup-banner"
                >
                  <button type="button" className="btn small" onClick={() => setRuntime("host")}>
                    Use Host instead
                  </button>
                </SetupBanner>
              ) : null}

              {workers.length ? (
                <div className="launch-env-bar">
                  <PlacementToggle workers={workers} value={backendId} onChange={setBackendId} />
                  <p className="hint launch-runtime-hint">{workerHint || "\u00a0"}</p>
                </div>
              ) : null}
            </>
          )}

          <div className="launch-card">
            {compactAssets ? null : (
              <LaunchWorkspace
                runtime={runtime}
                remote={Boolean(backendId)}
                hostDir={hostDir}
                environments={namedEnvironments}
                selection={
                  workspace.kind === "environment" && workspace.env.runtime !== runtime
                    ? { kind: "private" }
                    : workspace
                }
                onSelect={selectWorkspace}
                onHostDir={setHostDir}
                runtimes={DESIGN_RUNTIMES}
                unavailableRuntimes={{ vm: launch.vmReason }}
                disabledRuntimes={
                  policyAllowsHostAgents(state.config?.managedPolicy) ? [] : ["host"]
                }
                onRuntimeChange={changeRuntime}
              />
            )}

            {surface === "assets" ? (
              <AssetDropWell
                files={viewSlots}
                onChange={setViewSlots}
                onDropFiles={(incoming) => {
                  const oversize = firstOversizeAttachment(incoming);
                  if (oversize) {
                    setError(oversize);
                    return;
                  }
                  setError(null);
                  setViewSlots((current) => assignImageSlots(incoming, current));
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
                if (surface === "assets") {
                  setViewSlots((current) => assignImageSlots(incoming, current));
                }
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
              {assetHits.length ? (
                <AssetMentionMenu
                  items={assetHits}
                  activeIndex={assetMentionIndex}
                  onPick={pickAssetMention}
                />
              ) : null}
              {surface === "game" ? (
                <div className="game-shape-chips" role="group" aria-label="Game shape">
                  <button
                    type="button"
                    className={`os-card ${gameDim === "2d" ? "active" : ""}`}
                    aria-pressed={gameDim === "2d"}
                    onClick={() => pickGameDim("2d")}
                  >
                    <h3>2D</h3>
                  </button>
                  <button
                    type="button"
                    className={`os-card ${gameDim === "3d" ? "active" : ""}`}
                    aria-pressed={gameDim === "3d"}
                    onClick={() => pickGameDim("3d")}
                  >
                    <h3>3D</h3>
                  </button>
                  <button
                    type="button"
                    className={`os-card ${hotseat ? "active" : ""}`}
                    aria-pressed={hotseat}
                    title="Split keyboard or pass-the-device. No network."
                    onClick={() => setHotseat((on) => !on)}
                  >
                    <h3>Hotseat</h3>
                  </button>
                </div>
              ) : null}
              <ComposerTextarea
                textareaRef={box}
                value={prompt}
                files={files}
                placeholder={
                  surface === "game"
                    ? `${launch.placeholder.replace(/[.…]+$/, "")}. Type @ to reference an asset…`
                    : launch.placeholder
                }
                onChange={(value) => {
                  setPrompt(value);
                  refreshAssetMentions(value, box.current?.selectionStart ?? value.length);
                }}
                onKeyDown={(e) => {
                  if (assetHits.length) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setAssetMentionIndex((value) => (value + 1) % assetHits.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setAssetMentionIndex(
                        (value) => (value - 1 + assetHits.length) % assetHits.length,
                      );
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setAssetHits([]);
                      return;
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      const hit = assetHits[assetMentionIndex] ?? assetHits[0];
                      if (hit) pickAssetMention(hit);
                      return;
                    }
                  }
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
                  title="Attach a file (images, text, PDF). Copied into /workspace/.locus-attachments."
                  extras={addExtras}
                  onError={setError}
                  onPick={(picked) => {
                    setFiles((rows) => mergeComposerFiles(rows, picked));
                    if (surface === "assets") {
                      setViewSlots((current) => assignImageSlots(picked, current));
                    }
                  }}
                />
                <ComposerFileThumbs
                  files={splitComposerFiles(prompt, files).bar}
                  onRemove={(index) => {
                    const target = splitComposerFiles(prompt, files).bar[index];
                    if (!target) return;
                    setFiles((rows) => rows.filter((file) => file !== target));
                  }}
                />
                {showRepo ? (
                  <ComposerRepoPicker
                    repos={state.repos}
                    repoIds={repoIds}
                    repoRefs={repoRefs}
                    onChange={setSelectedRepos}
                    contextOnly
                    multiple
                  />
                ) : null}
                {showAsset ? (
                  <ComposerAssetPicker
                    sessions={state.sessions}
                    assetIds={assetIds}
                    onChange={setAssetIds}
                  />
                ) : null}
                {launch.showLook ? (
                  <OverflowMenu
                    className="composer-look-more"
                    title="Style"
                    label={`Style: ${selectedSystem?.name ?? "default"}`}
                    align="left"
                    toggleClassName="btn small ghost"
                  >
                    <div className="composer-look-pop">
                      <DesignSystemPicker
                        compact
                        manage={false}
                        selectedId={designSystemId}
                        onChange={(system) => {
                          setSystemTouched(true);
                          setDesignSystemId(system?.id ?? "");
                          if (system) setPalette({ ...system.palette });
                        }}
                      />
                      <DesignPalettePicker compact palette={palette} onChange={setPalette} />
                    </div>
                  </OverflowMenu>
                ) : (
                  <>
                    {showKit ? (
                      <Select
                        className="game-kit-select"
                        compact
                        ariaLabel={surface === "assets" ? "Asset kit" : "Game kit"}
                        value={designSystemId}
                        options={[
                          { value: "", label: "No kit" },
                          ...(surface === "assets" ? ASSET_KITS : GAME_KITS).map((kit) => ({
                            value: kit.id,
                            label: kit.title,
                          })),
                        ]}
                        onChange={(id) => {
                          setSystemTouched(true);
                          setDesignSystemId(id);
                        }}
                      />
                    ) : null}
                    {surface === "game" && showStyle ? (
                      <OverflowMenu
                        className="composer-look-more"
                        title="Style"
                        label={`Style: ${styleName ?? "default"}`}
                        align="left"
                        toggleClassName="btn small ghost"
                      >
                        <div className="composer-look-pop">
                          <GameStylePicker
                            compact
                            manage={false}
                            selectedId={gameStyleId}
                            onChange={(style) => {
                              setStyleTouched(true);
                              setGameStyleId(style?.id ?? "");
                            }}
                          />
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => dispatch({ type: "gameStyles", open: true })}
                          >
                            Manage styles
                          </button>
                        </div>
                      </OverflowMenu>
                    ) : null}
                    {surface === "assets" && showStyle ? (
                      <OverflowMenu
                        className="composer-look-more"
                        title="Style"
                        label={`Style: ${styleName ?? "default"}`}
                        align="left"
                        toggleClassName="btn small ghost"
                      >
                        <div className="composer-look-pop">
                          <AssetStylePicker
                            compact
                            manage={false}
                            selectedId={assetStyleId}
                            onChange={(style) => {
                              setStyleTouched(true);
                              setAssetStyleId(style?.id ?? "");
                            }}
                          />
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => dispatch({ type: "assetStyles", open: true })}
                          >
                            Manage styles
                          </button>
                        </div>
                      </OverflowMenu>
                    ) : null}
                    {showBuild ? (
                      <OverflowMenu
                        className="composer-look-more"
                        title="Build"
                        label="Build"
                        align="left"
                        wide
                        toggleClassName="btn small ghost"
                      >
                        <div className="composer-look-pop asset-build-pop">
                          <AssetBuildPicker
                            compact
                            value={assetBuild}
                            onChange={setAssetBuild}
                            mesh={meshBuild}
                          />
                        </div>
                      </OverflowMenu>
                    ) : null}
                  </>
                )}
                <div className="composer-toolbar-end">
                  <ModelPicker
                    compact
                    providers={state.config?.providers ?? []}
                    providerId={providerId || prefs.providerId || ""}
                    model={model || prefs.model || ""}
                    onChange={(next) => {
                      setProviderId(next.providerId);
                      setModel(next.model);
                    }}
                  />
                  <button
                    className="btn primary small composer-send"
                    disabled={busy || !canCreate}
                    title={launch.createLabel}
                    aria-label={busy ? "Creating…" : launch.createLabel}
                    onClick={() => void createQuick()}
                  >
                    {busy ? "Creating…" : <span className="composer-send-label">Send</span>}
                    <IconReturn />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="scrim-note" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          )}

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
              onClick={() => setShowOptions((open) => !open)}
            >
              {showOptions ? "Hide options" : "More options"}
            </button>
            {showOptions ? (
              <button
                className="btn ghost"
                type="button"
                onClick={() =>
                  dispatch({
                    type: "new",
                    open: true,
                    os: "ubuntu",
                    prompt: prompt.trim() || undefined,
                    runtime,
                    dockerImage: hostChat ? undefined : (launchDockerImage ?? dockerImage),
                    hostDir: hostChat ? launchHostDir : undefined,
                    playbook: playbook.trim() || undefined,
                    allowedTools: allowedTools.length ? allowedTools : undefined,
                    kind: launch.kind,
                    repoId: repoIds[0] || undefined,
                    extraRepoIds: repoIds.slice(1).length ? repoIds.slice(1) : undefined,
                    repoUrl: state.repos.find((row) => row.id === repoIds[0])?.checkout.url,
                    repoRef:
                      (repoIds[0] && repoRefs[repoIds[0]]) ||
                      state.repos.find((row) => row.id === repoIds[0])?.checkout.ref,
                  })
                }
              >
                Full form
              </button>
            ) : null}
          </div>

          <div className="launch-below">
            <div className="launch-starters-slot">
              <div className="design-start-from">
                <p className="design-start-from-label">Or start from</p>
                <RecipeCards
                  pills
                  shortcuts
                  recipes={launch.recipes}
                  selectedId={recipeId}
                  onSelect={applyRecipe}
                  label={launch.starters}
                  limit={launch.starterLimit}
                  more={
                    surface === "game" ? (
                      <>
                        <p className="design-start-from-label">Remix a sentence</p>
                        <div
                          className="recipe-grid pills"
                          role="group"
                          aria-label="Remix a sentence"
                        >
                          {GAME_REMIX_PROMPTS.map((row) => (
                            <button
                              key={row.id}
                              type="button"
                              title={row.prompt}
                              aria-pressed={remixId === row.id}
                              className={`os-card ${remixId === row.id ? "active" : ""}`}
                              onClick={() => applyRemix(row)}
                            >
                              <h3>{row.title}</h3>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : undefined
                  }
                />
                {kitStarts.length ? (
                  <div className="recipe-grid pills" role="group" aria-label="Kit starting points">
                    {kitStarts.map((point) => (
                      <button
                        key={point.id}
                        type="button"
                        title={`Compose from ${point.title}`}
                        aria-pressed={startId === point.id}
                        className={`os-card ${startId === point.id ? "active" : ""}`}
                        onClick={() => applyStart(point)}
                      >
                        <h3>{point.title}</h3>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
