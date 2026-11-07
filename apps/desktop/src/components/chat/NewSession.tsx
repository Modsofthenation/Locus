import type {
  AgentRuntime,
  AgentSession,
  AutonomyTier,
  CreateSessionInput,
  GoldenImage,
  GuestOs,
  HardwareOverride,
  NamedEnvironment,
  NetworkJail,
  CodexReasoningEffort,
  VisionMode,
} from "@locus/shared";
import {
  AUTONOMY_TIERS,
  DEFAULT_DOCKER_IMAGE,
  applyNamedEnvironment,
  defaultNetworkJail,
  formatAutonomy,
  latestGoldenImage,
  matchRepoHardware,
  parseAutonomyTier,
  parseDockerImage,
  parseRepoUrl,
  parseSpendUsd,
  pickConfiguredOs,
  policyAllowsAutonomous,
  policyAllowsHostAgents,
  policyAllowsLiveChrome,
  policyForcedJail,
  workerIsMetered,
  workerWhereLabel,
} from "@locus/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { suggestedHardware } from "@/lib/hardware";
import {
  loadLastAgent,
  preferredRuntime,
  rememberedWorkerId,
  resolveAgentDefaults,
  saveLastAgent,
} from "@/lib/lastAgent";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";
import { HardwareFields } from "@/components/settings/HardwareFields";
import { CodexReasoningPicker, ModelPicker } from "@/components/settings/ModelPicker";
import { OsPicker, OsSoloHint } from "@/components/settings/OsPicker";
import { RepoField, ComposerBranchPicker } from "@/components/codebase/RepoField";
import {
  DockerImageField,
  PlacementToggle,
  RuntimeToggle,
} from "@/components/settings/RuntimePicker";
import { HostFolderField } from "@/components/workspace/HostFolderField";
import { EnvironmentPicker } from "@/components/settings/EnvironmentPicker";

export function NewSessionModal() {
  const { state, dispatch } = useStore();
  const templates = state.config?.templates ?? [];
  const providers = state.config?.providers ?? [];
  const workers = state.config?.workers ?? [];
  const prefs = loadLastAgent();
  const [os, setOs] = useState<GuestOs>(prefs.os);
  const [runtime, setRuntime] = useState<AgentRuntime>(
    preferredRuntime(prefs, state.setup?.dockerFound),
  );
  const [backendId, setBackendId] = useState("");
  const [dockerImage, setDockerImage] = useState(prefs.dockerImage ?? DEFAULT_DOCKER_IMAGE);
  const [hostDir, setHostDir] = useState(prefs.hostDir ?? "");
  const [templateId, setTemplateId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort | undefined>();
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("");
  const [repoId, setRepoId] = useState("");
  const [extraRepoIds, setExtraRepoIds] = useState<string[]>([]);
  const [ref, setRef] = useState("");
  const [startVm, setStartVm] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(true, () => dispatch({ type: "new", open: false }), dialogRef);
  const [hwDirty, setHwDirty] = useState(false);
  const [cpuCores, setCpuCores] = useState(4);
  const [memoryMb, setMemoryMb] = useState(4096);
  const [diskSizeGb, setDiskSizeGb] = useState(40);
  const [imageId, setImageId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [playbook, setPlaybook] = useState("");
  const [vision, setVision] = useState<VisionMode>("latest");
  const [webSearch, setWebSearch] = useState(false);
  const [liveChrome, setLiveChrome] = useState(false);
  const [allowedTools, setAllowedTools] = useState("");
  const [autonomy, setAutonomy] = useState<AutonomyTier>("guided");
  const [maxUsd, setMaxUsd] = useState("");
  const [network, setNetwork] = useState<NetworkJail>(defaultNetworkJail());
  const [netDirty, setNetDirty] = useState(false);
  const [namedEnvId, setNamedEnvId] = useState("");
  const [branchLock, setBranchLock] = useState(false);
  const [images, setImages] = useState<GoldenImage[]>([]);
  const selectedWorker = workers.find((row) => row.id === backendId);

  const osTemplates = useMemo(() => templates.filter((t) => t.os === os), [templates, os]);
  const provider = providers.find((p) => p.id === providerId);
  const parsed = (() => {
    const linked = state.repos.find((row) => row.id === repoId);
    if (linked)
      return {
        forge: linked.checkout.forge,
        url: linked.checkout.url,
        accountId: linked.checkout.accountId,
      };
    const fromUrl = repo.trim() ? parseRepoUrl(repo) : null;
    return fromUrl ? { ...fromUrl, accountId: undefined as string | undefined } : null;
  })();
  const suggestion = suggestedHardware(
    state.config,
    os,
    templateId || osTemplates[0]?.id || "",
    parsed?.url,
  );
  const repoProfile = matchRepoHardware(state.config?.hardwareProfiles ?? [], parsed?.url, os);

  useEffect(() => {
    if (hwDirty) return;
    setCpuCores(suggestion.cpuCores);
    setMemoryMb(suggestion.memoryMb);
    setDiskSizeGb(suggestion.diskSizeGb);
  }, [suggestion.cpuCores, suggestion.memoryMb, suggestion.diskSizeGb, hwDirty]);

  useEffect(() => {
    if (!state.newOpen) return;
    const last = loadLastAgent();
    const nextWorker = rememberedWorkerId(last, state.config?.workers);
    let nextRuntime = state.newRuntime ?? preferredRuntime(last, state.setup?.dockerFound);
    if (nextRuntime === "host" && !policyAllowsHostAgents(state.config?.managedPolicy)) {
      nextRuntime = "docker";
    }
    const workerId = nextRuntime === "vm" ? "" : nextWorker;
    const nextOs =
      nextRuntime === "vm"
        ? pickConfiguredOs(state.config?.templates, state.newOs ?? last.os)
        : state.newOs && state.newOs !== "windows-11" && state.newOs !== "windows-10"
          ? state.newOs
          : last.os === "windows-11" || last.os === "windows-10"
            ? "ubuntu"
            : last.os;
    const defaults = resolveAgentDefaults(state.config, nextOs, last);
    setRuntime(nextRuntime);
    setBackendId(workerId);
    setDockerImage(state.newDockerImage || last.dockerImage || DEFAULT_DOCKER_IMAGE);
    setOs(nextOs);
    setTemplateId(defaults.templateId);
    setProviderId(defaults.providerId);
    setModel(defaults.model);
    setReasoningEffort(undefined);
    setPrompt(state.newPrompt);
    setHostDir(state.newHostDir || last.hostDir || "");
    setRepo(state.newRepoUrl || "");
    setRepoId(state.newRepoId || "");
    setExtraRepoIds(state.newExtraRepoIds || []);
    setRef(state.newRepoRef || "");
    setStartVm(nextRuntime !== "host");
    setError(null);
    setHwDirty(false);
    setImageId("");
    setInstructions(state.newInstructions);
    setPlaybook(state.newPlaybook);
    setVision(nextRuntime === "vm" ? "latest" : "off");
    setAllowedTools(state.newAllowedTools.join(", "));
    setAutonomy(parseAutonomyTier(state.config?.advanced.autonomy));
    setMaxUsd("");
    setNetDirty(false);
    setNetwork(policyForcedJail(state.config?.managedPolicy) ?? defaultNetworkJail());
    setNamedEnvId("");
    setBranchLock(Boolean(state.newRepoId));
    void api
      .images()
      .then((rows) => {
        setImages(rows);
        setImageId(
          nextRuntime === "host" || workerId
            ? ""
            : (latestGoldenImage(rows, nextOs, nextRuntime === "docker" ? "docker" : "vm")?.id ??
                ""),
        );
      })
      .catch(() => setImages([]));
  }, [
    state.newOpen,
    state.newOs,
    state.newPrompt,
    state.newHostDir,
    state.newRepoId,
    state.newExtraRepoIds,
    state.newRepoUrl,
    state.newRepoRef,
  ]);

  useEffect(() => {
    if (!netDirty) {
      setNetwork(
        policyForcedJail(state.config?.managedPolicy) ?? defaultNetworkJail(imageId || undefined),
      );
    }
  }, [imageId, netDirty, state.config?.managedPolicy]);

  if (!state.newOpen) return null;

  function applyEnv(env?: NamedEnvironment) {
    setNamedEnvId(env?.id ?? "");
    if (!env) return;
    const applied = applyNamedEnvironment(env);
    setRuntime(applied.runtime ?? env.runtime);
    setOs(applied.os ?? env.os);
    if (applied.dockerImage) setDockerImage(applied.dockerImage);
    if (applied.templateId) setTemplateId(applied.templateId);
    setBackendId(applied.backendId ?? "");
    setImageId(applied.imageId ?? "");
    if (applied.network) {
      setNetDirty(true);
      setNetwork(applied.network);
    }
    setMaxUsd(applied.maxUsd != null ? String(applied.maxUsd) : "");
    setInstructions(applied.instructions ?? instructions);
    setPlaybook(applied.playbook ?? playbook);
    if (applied.allowedTools?.length) setAllowedTools(applied.allowedTools.join(", "));
    if (applied.vision) setVision(applied.vision);
    setStartVm((applied.runtime ?? env.runtime) !== "host");
  }

  async function submit() {
    setError(null);
    if (repo.trim() && !parsed) {
      setError("Enter a GitHub, GitLab, or Bitbucket URL");
      return;
    }
    const override: HardwareOverride | undefined =
      cpuCores !== suggestion.cpuCores ||
      memoryMb !== suggestion.memoryMb ||
      diskSizeGb !== suggestion.diskSizeGb
        ? { cpuCores, memoryMb, diskSizeGb }
        : undefined;
    const hostChat = runtime === "host";
    const input: CreateSessionInput = {
      os:
        (runtime === "docker" || hostChat) && (os === "windows-11" || os === "windows-10")
          ? "ubuntu"
          : os,
      templateId: templateId || osTemplates[0]?.id || (hostChat ? "host" : ""),
      runtime,
      dockerImage: runtime === "docker" ? parseDockerImage(dockerImage) : undefined,
      providerId,
      model: model || provider?.defaultModel || "",
      reasoningEffort: provider?.kind === "codex-cli" ? reasoningEffort : undefined,
      startVm: hostChat && !backendId ? false : startVm,
      hardware: runtime === "vm" ? override : undefined,
      imageId: hostChat ? undefined : imageId || undefined,
      network: hostChat ? undefined : network,
      instructions: instructions.trim() || undefined,
      playbook: playbook.trim() || undefined,
      vision: hostChat ? "off" : vision,
      webSearch: webSearch || undefined,
      liveChrome: runtime === "host" && liveChrome ? true : undefined,
      autonomy,
      maxUsd: maxUsd.trim() ? Number(maxUsd) : autonomy === "autonomous" ? 20 : undefined,
      allowedTools: (() => {
        const names = allowedTools
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
        return names.length ? names : undefined;
      })(),
      kind: state.newKind || undefined,
      repo: parsed
        ? {
            forge: parsed.forge,
            url: parsed.url,
            ref: ref.trim() || undefined,
            accountId: parsed.accountId,
          }
        : undefined,
      repoId: repoId || undefined,
      extraRepoIds: extraRepoIds.length ? extraRepoIds : undefined,
      ...(branchLock && (repoId || parsed) ? { branchLock: true } : {}),
      prompt: prompt.trim() || undefined,
      hostDir: hostChat ? hostDir.trim() || undefined : undefined,
      ...(backendId ? { placement: "worker" as const, backendId } : {}),
    };
    setBusy(true);
    try {
      const session: AgentSession = await api.createSession(input);
      saveLastAgent({
        os: input.os,
        runtime,
        dockerImage: input.dockerImage,
        hostDir: hostChat ? hostDir.trim() || undefined : loadLastAgent().hostDir,
        providerId: input.providerId,
        model: input.model,
        placement: backendId ? "worker" : "local",
        backendId: backendId || undefined,
      });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
      dispatch({ type: "new", open: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => dispatch({ type: "new", open: false })}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-session-title">New agent</h2>
        <EnvironmentPicker
          value={namedEnvId}
          onChange={(_id, env) => applyEnv(env)}
          snapshot={{
            runtime,
            os,
            templateId: templateId || undefined,
            dockerImage: runtime === "docker" ? dockerImage : undefined,
            imageId: imageId || undefined,
            network: runtime === "host" ? undefined : network,
            maxUsd: parseSpendUsd(maxUsd),
            placement: backendId ? "worker" : "local",
            backendId: backendId || undefined,
          }}
        />
        <PlacementToggle
          workers={workers}
          value={backendId}
          onChange={(id) => {
            setBackendId(id);
            if (id) {
              if (runtime === "vm") setRuntime("docker");
              setVision("off");
              setStartVm(true);
              setImageId("");
            }
          }}
        />
        <RuntimeToggle
          value={runtime}
          runtimes={backendId ? ["docker", "host"] : undefined}
          disabledRuntimes={policyAllowsHostAgents(state.config?.managedPolicy) ? [] : ["host"]}
          onChange={(next) => {
            setRuntime(next);
            if (next === "vm") setBackendId("");
            const nextOs =
              next !== "vm" && (os === "windows-11" || os === "windows-10") ? "ubuntu" : os;
            if (nextOs !== os) setOs(nextOs);
            setVision(next === "vm" ? "latest" : "off");
            setStartVm(next !== "host" || Boolean(backendId));
            if (next === "host") setAllowedTools("");
            setImageId(
              next === "host" || backendId
                ? ""
                : (latestGoldenImage(images, nextOs, next === "docker" ? "docker" : "vm")?.id ??
                    ""),
            );
          }}
        />
        <p className="hint">
          {backendId
            ? `${runtime === "host" ? "The host workspace" : "The container"} runs on ${selectedWorker ? workerWhereLabel(selectedWorker) : "the worker"}. Chat and keys stay on this machine.${
                selectedWorker && workerIsMetered(selectedWorker)
                  ? " Stop destroys the guest. Idle TTL applies on the metered VM."
                  : ""
              }`
            : runtime === "host"
              ? "A coding agent on this machine. No VM or container — files, shell, and git run here (a security exception)."
              : runtime === "docker"
                ? "Daily path: Docker + locus/agent. Windows guests need a QEMU VM."
                : "QEMU is the Windows-desktop / installer-QA path. Hardware overrides are VM-only."}
        </p>
        <div className="field">
          <label>Task</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              runtime === "host"
                ? "What should we talk about? Sent as the first message."
                : runtime === "docker"
                  ? "What should this container do? Sent as the first message after the container starts."
                  : "What should this machine do? Sent as the first message after the VM starts."
            }
          />
        </div>
        {runtime === "host" ? (
          <HostFolderField value={hostDir} onChange={setHostDir} remote={Boolean(backendId)} />
        ) : null}
        {runtime === "docker" ? (
          <>
            <DockerImageField value={dockerImage} onChange={setDockerImage} />
            {images.some((img) => img.runtime === "docker") && !backendId ? (
              <div className="field">
                <label>Workspace image</label>
                <select value={imageId} onChange={(e) => setImageId(e.target.value)}>
                  <option value="">Empty /workspace</option>
                  {images
                    .filter((img) => img.runtime === "docker")
                    .map((img) => (
                      <option key={img.id} value={img.id}>
                        {img.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
          </>
        ) : runtime === "vm" ? (
          <>
            <OsPicker
              templates={templates}
              value={os}
              onChange={(next) => {
                setOs(next);
                const defaults = resolveAgentDefaults(state.config, next, loadLastAgent());
                setTemplateId(defaults.templateId);
                setHwDirty(false);
                setImageId(latestGoldenImage(images, next)?.id ?? "");
              }}
            />
            <OsSoloHint templates={templates} os={os} />
          </>
        ) : null}
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
          provider={provider}
          model={model}
          value={reasoningEffort}
          onChange={setReasoningEffort}
        />
        <details className="advanced">
          <summary>More options</summary>
          <p className="hint">
            Jail, spend cap, environment extras, and hardware. Runtime and repo stay fixed after
            create; branch lock is optional below.
          </p>
          <h3 className="new-session-group-title">Environment</h3>
          {runtime === "vm" ? (
            <div className="field">
              <label>Template</label>
              <select
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setHwDirty(false);
                }}
              >
                {osTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <RepoField
            repos={state.repos}
            repoId={repoId}
            extraRepoIds={extraRepoIds}
            url={repo}
            onRepoId={(id) => {
              const hadRepo = Boolean(repoId);
              setRepoId(id);
              if (!id) setBranchLock(false);
              else if (!hadRepo) setBranchLock(true);
            }}
            onExtraRepoIds={setExtraRepoIds}
            onUrl={(next) => {
              setRepo(next);
              setHwDirty(false);
            }}
            onRef={setRef}
          />
          {repoId ? (
            <div className="field">
              <label>Branch</label>
              <ComposerBranchPicker
                repoId={repoId}
                value={ref}
                fallback={state.repos.find((row) => row.id === repoId)?.checkout.ref}
                onChange={setRef}
              />
            </div>
          ) : (
            <div className="field">
              <label>Git ref (optional)</label>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
            </div>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={branchLock}
              disabled={!repoId && !parsed}
              onChange={(e) => setBranchLock(e.target.checked)}
            />
            Lock branch after create
          </label>
          {runtime === "vm" && (
            <>
              <div className="field">
                <label>Golden image</label>
                <select value={imageId} onChange={(e) => setImageId(e.target.value)}>
                  <option value="">Fresh disk from ISO / cloud image</option>
                  {images
                    .filter((img) => img.os === os && img.runtime !== "docker")
                    .map((img) => (
                      <option key={img.id} value={img.id}>
                        {img.name}
                        {img.id === latestGoldenImage(images, os)?.id ? " (default)" : ""}
                      </option>
                    ))}
                </select>
                {images.some((img) => img.os === os && img.runtime !== "docker") ? (
                  <p className="hint">
                    Boots a copy of a saved disk so you skip the next OS install.
                  </p>
                ) : (
                  <p className="hint">
                    After the first VM is ready, save a golden image so the next agent skips
                    install.
                  </p>
                )}
              </div>
            </>
          )}
          <h3 className="new-session-group-title">Jail & spend</h3>
          {runtime === "host" ? null : (
            <div className="field">
              <label>{runtime === "docker" ? "Container network" : "Guest network"}</label>
              <select
                aria-label="Jail"
                value={network}
                disabled={Boolean(policyForcedJail(state.config?.managedPolicy))}
                onChange={(e) => {
                  setNetDirty(true);
                  setNetwork(e.target.value as NetworkJail);
                }}
              >
                <option value="open">Open — full internet (needed for first-boot apt)</option>
                <option value="restricted">Restricted — forge and providers only</option>
                <option value="none">None — no guest internet</option>
              </select>
              {runtime === "docker" ? (
                <p className="hint">
                  Restricted sets HTTP(S)_PROXY to an allowlist CONNECT proxy (on this machine, or
                  on the worker). None uses --network none.
                </p>
              ) : null}
            </div>
          )}
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
              <label>
                {selectedWorker && workerIsMetered(selectedWorker)
                  ? "Spend cap (USD, LLM + VM)"
                  : "Spend cap (USD)"}
              </label>
              <input
                aria-label="Spend cap (USD)"
                type="number"
                min={0}
                step="0.01"
                value={maxUsd}
                placeholder={autonomy === "autonomous" ? "20" : "unlimited"}
                onChange={(e) => setMaxUsd(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Instructions (optional)</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                runtime === "host"
                  ? "Prefer short answers, cite sources, …"
                  : runtime === "docker"
                    ? "Always work in /workspace, commit on a feature branch, …"
                    : "Always use /mnt/host, commit on a feature branch, …"
              }
            />
          </div>
          <div className="field">
            <label>Playbook (optional)</label>
            <textarea
              value={playbook}
              onChange={(e) => setPlaybook(e.target.value)}
              placeholder="Project SOP injected every turn — how we test, branch, and ship."
            />
          </div>
          {runtime === "host" ? null : (
            <div className="field">
              <label>Vision</label>
              <select value={vision} onChange={(e) => setVision(e.target.value as VisionMode)}>
                <option value="latest">
                  Latest screenshot — model sees the guest after GUI tools
                </option>
                <option value="off">Off — text and accessibility trees only</option>
              </select>
            </div>
          )}
          <div className="field">
            <label>Web search</label>
            <select
              value={webSearch ? "on" : "off"}
              onChange={(e) => setWebSearch(e.target.value === "on")}
            >
              <option value="off">Off — model cannot query the public web from the host</option>
              <option value="on">On — model can call websearch on the host</option>
            </select>
          </div>
          {runtime === "host" ? (
            <div className="field">
              <label>Use my Chrome</label>
              <select
                value={liveChrome ? "on" : "off"}
                disabled={!policyAllowsLiveChrome(state.config?.managedPolicy)}
                onChange={(e) => setLiveChrome(e.target.value === "on")}
              >
                <option value="off">Off — isolated host-chrome profile</option>
                <option value="on">On — drive the Chrome tabs already open on this machine</option>
              </select>
            </div>
          ) : null}
          <div className="field">
            <label>Allowed tools (optional)</label>
            <input
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              placeholder={
                runtime === "host"
                  ? "git_pr, git_pr_list, websearch"
                  : runtime === "docker"
                    ? "exec, screenshot, file_read, git_commit, git_push, git_pr"
                    : "exec, screenshot, git_commit, git_push, git_pr"
              }
            />
          </div>
          {runtime === "vm" && (
            <>
              <h3 className="new-session-group-title">Hardware</h3>
              <HardwareFields
                cpuCores={cpuCores}
                memoryMb={memoryMb}
                diskSizeGb={diskSizeGb}
                hint={
                  repoProfile
                    ? "Using a repo hardware profile. Edit to override for this agent."
                    : "Defaults from Settings → Machines. Override for this agent if you want."
                }
                onChange={(next) => {
                  setHwDirty(true);
                  setCpuCores(next.cpuCores);
                  setMemoryMb(next.memoryMb);
                  setDiskSizeGb(next.diskSizeGb);
                }}
              />
            </>
          )}
          {runtime === "host" ? null : (
            <label className="hint check">
              <input
                type="checkbox"
                checked={startVm}
                onChange={(e) => setStartVm(e.target.checked)}
              />
              {runtime === "docker"
                ? "Start the container immediately"
                : "Start the VM immediately"}
            </label>
          )}
        </details>
        {error && (
          <p className="scrim-note" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => dispatch({ type: "new", open: false })}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || (runtime === "docker" && !parseDockerImage(dockerImage))}
            onClick={() => void submit()}
          >
            {busy ? "Creating…" : runtime === "host" ? "Start chat" : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
