import type {
  AgentRuntime,
  AutomationSchedule,
  AutonomyTier,
  CreateAutomationInput,
  GoldenImage,
  GuestOs,
  HardwareOverride,
  LinkedRepo,
  LocusConfig,
  NamedEnvironment,
  NetworkJail,
} from "@locus/shared";
import {
  DEFAULT_DOCKER_IMAGE,
  DEFAULT_WEBHOOK_PROMPT,
  MAX_AUTOMATION_CHATS,
  applyNamedEnvironment,
  buildAutomationSchedule,
  automationStarterById,
  computeNextRunAt,
  forgeLabel,
  formatClockTime,
  formatLocalTimezone,
  formatNextFire,
  isNetworkJail,
  parseClockTime,
  SCHEDULE_WEEKDAYS,
  isClockSchedule,
  matchRepoHardware,
  parseAllowHosts,
  parseAutonomyTier,
  parseDockerImage,
  parseMcpToolNames,
  parseProductMode,
  parseRepoUrl,
  parseSpendUsd,
  latestGoldenImage,
  pickConfiguredOs,
  policyAllowsAutonomous,
  policyForcedJail,
  sessionDisplayName,
  sessionMatchesSurface,
  sessionRuntime,
  validateSchedule,
  workerIsMetered,
  workerWhereLabel,
} from "@locus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickProvider } from "@/lib/lastAgent";
import { suggestedHardware } from "@/lib/hardware";
import { api } from "@/lib/api";
import { openSettings, useStore } from "@/state/store";
import {
  AUTOMATION_TRIGGER_FAMILIES,
  CLOCK_SCHEDULE_KINDS,
  automationAllowlistOptions,
  automationTriggerFamily,
  defaultKindForTriggerFamily,
  DOCKER_DOWN_MESSAGE,
  isClockScheduleKind,
} from "@/lib/automations";
import { DockerDownActions, dockerDownFor, hostJobsLocked } from "./jobRun";
import { HardwareFields } from "@/components/settings/HardwareFields";
import { ModelPicker } from "@/components/settings/ModelPicker";
import { OsPicker, OsSoloHint } from "@/components/settings/OsPicker";
import {
  DockerImageField,
  PlacementToggle,
  RuntimeToggle,
} from "@/components/settings/RuntimePicker";
import { HostFolderField } from "@/components/workspace/HostFolderField";
import { EnvironmentPicker } from "@/components/settings/EnvironmentPicker";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { FormTabs, Select } from "@/components/layout/Select";
import {
  AUTONOMY_SELECT_OPTIONS,
  JAIL_SELECT_OPTIONS,
  OVERLAP_SELECT_OPTIONS,
} from "@/lib/formOptions";
import { Modal } from "@/components/layout/Modal";

export function NewAutomationModal() {
  const { state, dispatch } = useStore();
  const templates = state.config?.templates ?? [];
  const providers = state.config?.providers ?? [];
  const workers = state.config?.workers ?? [];
  const editing = state.automations.find((a) => a.id === state.editingAutomationId);

  const [name, setName] = useState(editing?.name ?? "");
  const [prompt, setPrompt] = useState(editing?.prompt ?? "");
  const [os, setOs] = useState<GuestOs>(editing?.os ?? "ubuntu");
  const [runtime, setRuntime] = useState<AgentRuntime>(
    editing ? sessionRuntime(editing) : "docker",
  );
  const [dockerImage, setDockerImage] = useState(editing?.dockerImage ?? DEFAULT_DOCKER_IMAGE);
  const [hostDir, setHostDir] = useState(editing?.hostDir ?? "");
  const [templateId, setTemplateId] = useState(
    editing?.templateId ?? templates.find((t) => t.os === "ubuntu")?.id ?? "",
  );
  const [providerId, setProviderId] = useState(
    editing?.providerId ?? pickProvider(providers)?.id ?? "",
  );
  const [model, setModel] = useState(editing?.model ?? pickProvider(providers)?.defaultModel ?? "");
  const [repo, setRepo] = useState(editing?.repo?.url ?? "");
  const [repoId, setRepoId] = useState(liveRepoId(state.repos, editing?.repoId));
  const [ref, setRef] = useState(editing?.repo?.ref ?? "");
  const [startVm, setStartVm] = useState(editing?.startVm ?? true);
  const [reuseSession, setReuseSession] = useState(editing?.reuseSession ?? false);
  const [ownerSessionId, setOwnerSessionId] = useState(
    editing?.ownerSessionId ??
      (parseProductMode(state.config?.productMode) === "swarm" ? (state.selectedId ?? "") : ""),
  );
  const [persistMemory, setPersistMemory] = useState(editing?.persistMemory ?? false);
  const [imageId, setImageId] = useState(editing?.imageId ?? "");
  const [images, setImages] = useState<GoldenImage[]>([]);
  const [kind, setKind] = useState<AutomationSchedule["kind"]>(editing?.schedule.kind ?? "daily");
  const [everyMinutes, setEveryMinutes] = useState(
    editing?.schedule.kind === "interval" || editing?.schedule.kind === "adaptive"
      ? editing.schedule.everyMinutes
      : 60,
  );
  const [otherwiseEveryMinutes, setOtherwiseEveryMinutes] = useState(
    editing?.schedule.kind === "adaptive" ? editing.schedule.otherwiseEveryMinutes : 180,
  );
  const [weekday, setWeekday] = useState(
    editing?.schedule.kind === "weekly" ? editing.schedule.weekday : 1,
  );
  const [time, setTime] = useState(() => {
    if (editing?.schedule.kind === "daily" || editing?.schedule.kind === "weekly") {
      return formatClockTime(editing.schedule.hour, editing.schedule.minute);
    }
    return "09:00";
  });
  const [windowStart, setWindowStart] = useState(() =>
    editing?.schedule.kind === "adaptive"
      ? formatClockTime(editing.schedule.startHour, editing.schedule.startMinute)
      : "09:00",
  );
  const [windowEnd, setWindowEnd] = useState(() =>
    editing?.schedule.kind === "adaptive"
      ? formatClockTime(editing.schedule.endHour, editing.schedule.endMinute)
      : "17:00",
  );
  const [cronExpr, setCronExpr] = useState(
    editing?.schedule.kind === "cron" ? editing.schedule.expr : "0 9 * * *",
  );
  const [timeZone, setTimeZone] = useState(
    editing?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    editing?.schedule.kind === "adaptive" ? [...(editing.schedule.weekdays ?? [])] : [],
  );
  const [overlap, setOverlap] = useState(editing?.overlap ?? "skip");
  const [lifetimeMaxUsd, setLifetimeMaxUsd] = useState(
    editing?.lifetimeMaxUsd != null ? String(editing.lifetimeMaxUsd) : "",
  );
  const [blackout, setBlackout] = useState((editing?.blackoutDates ?? []).join(", "));
  const [notifySuccess, setNotifySuccess] = useState(editing?.notify?.success ?? true);
  const [notifyFailure, setNotifyFailure] = useState(editing?.notify?.failure ?? true);
  const [notifyNeedsYou, setNotifyNeedsYou] = useState(editing?.notify?.needsYou ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hwDirty, setHwDirty] = useState(false);
  const [cpuCores, setCpuCores] = useState(editing?.hardware?.cpuCores ?? 4);
  const [memoryMb, setMemoryMb] = useState(editing?.hardware?.memoryMb ?? 4096);
  const [diskSizeGb, setDiskSizeGb] = useState(editing?.hardware?.diskSizeGb ?? 40);
  const [notifyWebhook, setNotifyWebhook] = useState(editing?.notifyWebhook ?? "");
  const [notifyChannel, setNotifyChannel] = useState(editing?.notifyChannel ?? "");
  const [allowedMcpTools, setAllowedMcpTools] = useState<string[]>(editing?.allowedMcpTools ?? []);
  const [allowHosts, setAllowHosts] = useState((editing?.allowHosts ?? []).join(", "));
  const [autonomy, setAutonomy] = useState<AutonomyTier>(parseAutonomyTier(editing?.autonomy));
  const [maxUsd, setMaxUsd] = useState(editing?.maxUsd != null ? String(editing.maxUsd) : "");
  const [namedEnvId, setNamedEnvId] = useState(editing?.namedEnvironmentId ?? "");
  const [backendId, setBackendId] = useState(editing?.backendId ?? "");
  const [network, setNetwork] = useState<NetworkJail>(editing?.network ?? "restricted");
  const [confirmHost, setConfirmHost] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [dockerDown, setDockerDown] = useState(false);
  const [dockerCheck, setDockerCheck] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<"runtime" | "agent" | "notify">("runtime");

  const osTemplates = useMemo(() => templates.filter((t) => t.os === os), [templates, os]);
  const provider = providers.find((p) => p.id === providerId);
  const selectedWorker = workers.find((row) => row.id === backendId);
  const parsedRepo = (() => {
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
    parsedRepo?.url,
  );
  const repoProfile = matchRepoHardware(state.config?.hardwareProfiles ?? [], parsedRepo?.url, os);

  useEffect(() => {
    if (!state.newAutomationOpen) return;
    const current = state.automations.find((a) => a.id === state.editingAutomationId);
    const starter = current ? undefined : automationStarterById(state.automationStarterId);
    const seedSchedule = current?.schedule ?? starter?.schedule;
    const nextOs = current?.os ?? pickConfiguredOs(templates);
    setName(current?.name ?? starter?.name ?? "");
    setPrompt(current?.prompt ?? starter?.prompt ?? "");
    setOs(nextOs);
    setRuntime(current ? sessionRuntime(current) : "docker");
    setDockerImage(current?.dockerImage ?? DEFAULT_DOCKER_IMAGE);
    setHostDir(current?.hostDir ?? "");
    setTemplateId(current?.templateId ?? templates.find((t) => t.os === nextOs)?.id ?? "");
    setProviderId(current?.providerId ?? pickProvider(providers)?.id ?? "");
    setModel(current?.model ?? pickProvider(providers)?.defaultModel ?? "");
    // From Codebase, the selected repo. Elsewhere, a lone linked repo — except
    // for starters that don't use git (Slack ops webhook).
    const seedRepo =
      state.section === "codebase"
        ? state.repos.find((row) => row.id === state.selectedRepoId)
        : !current && state.automationStarterId !== "slack-ops" && state.repos.length === 1
          ? state.repos[0]
          : undefined;
    setRepo(current?.repo?.url ?? seedRepo?.checkout.url ?? "");
    setRepoId(current ? liveRepoId(state.repos, current.repoId) : (seedRepo?.id ?? ""));
    setRef(current?.repo?.ref ?? seedRepo?.checkout.ref ?? "");
    setStartVm(current?.startVm ?? true);
    setReuseSession(current?.reuseSession ?? false);
    setOwnerSessionId(
      current?.ownerSessionId ??
        (parseProductMode(state.config?.productMode) === "swarm" ? (state.selectedId ?? "") : ""),
    );
    setPersistMemory(current?.persistMemory ?? false);
    setImageId(current?.imageId ?? "");
    setKind(seedSchedule?.kind ?? "daily");
    setEveryMinutes(
      seedSchedule?.kind === "interval" || seedSchedule?.kind === "adaptive"
        ? seedSchedule.everyMinutes
        : 60,
    );
    setOtherwiseEveryMinutes(
      seedSchedule?.kind === "adaptive" ? seedSchedule.otherwiseEveryMinutes : 180,
    );
    setWeekday(seedSchedule?.kind === "weekly" ? seedSchedule.weekday : 1);
    if (seedSchedule?.kind === "daily" || seedSchedule?.kind === "weekly") {
      setTime(formatClockTime(seedSchedule.hour, seedSchedule.minute));
    } else {
      setTime("09:00");
    }
    if (seedSchedule?.kind === "adaptive") {
      setWindowStart(formatClockTime(seedSchedule.startHour, seedSchedule.startMinute));
      setWindowEnd(formatClockTime(seedSchedule.endHour, seedSchedule.endMinute));
    } else {
      setWindowStart("09:00");
      setWindowEnd("17:00");
    }
    setCronExpr(seedSchedule?.kind === "cron" ? seedSchedule.expr : "0 9 * * *");
    setTimeZone(current?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    setWeekdays(seedSchedule?.kind === "adaptive" ? [...(seedSchedule.weekdays ?? [])] : []);
    setOverlap(current?.overlap ?? "skip");
    setLifetimeMaxUsd(current?.lifetimeMaxUsd != null ? String(current.lifetimeMaxUsd) : "");
    setBlackout((current?.blackoutDates ?? []).join(", "));
    setNotifySuccess(current?.notify?.success ?? true);
    setNotifyFailure(current?.notify?.failure ?? true);
    setNotifyNeedsYou(current?.notify?.needsYou ?? true);
    setHwDirty(Boolean(current?.hardware));
    setCpuCores(current?.hardware?.cpuCores ?? 4);
    setMemoryMb(current?.hardware?.memoryMb ?? 4096);
    setDiskSizeGb(current?.hardware?.diskSizeGb ?? 40);
    setNotifyWebhook(current?.notifyWebhook ?? "");
    setNotifyChannel(current?.notifyChannel ?? "");
    setAllowedMcpTools(current?.allowedMcpTools ?? []);
    setAllowHosts((current?.allowHosts ?? []).join(", "));
    setAutonomy(parseAutonomyTier(current?.autonomy));
    setMaxUsd(current?.maxUsd != null ? String(current.maxUsd) : "");
    setNamedEnvId(current?.namedEnvironmentId ?? "");
    setBackendId(current?.backendId ?? "");
    setNetwork(current?.network ?? "restricted");
    setConfirmHost(false);
    setConfirmDiscard(false);
    setDirty(false);
    setError(null);
  }, [state.newAutomationOpen, state.editingAutomationId, state.automationStarterId]);

  useEffect(() => {
    if (!state.newAutomationOpen || runtime !== "docker" || backendId) {
      setDockerDown(false);
      return;
    }
    let cancelled = false;
    void dockerDownFor({ runtime, backendId: undefined }).then((down) => {
      if (!cancelled) setDockerDown(down);
    });
    return () => {
      cancelled = true;
    };
  }, [state.newAutomationOpen, runtime, backendId, dockerCheck]);

  useEffect(() => {
    if (!state.newAutomationOpen || repoId || repo.trim()) return;
    if ((kind === "forge" || kind === "pull_request") && state.repos.length === 1) {
      const only = state.repos[0]!;
      setRepoId(only.id);
      setRepo(only.checkout.url);
      if (only.checkout.ref) setRef(only.checkout.ref);
    }
    // Only when the trigger switches to a repo event; picking "No repo" afterwards sticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.newAutomationOpen, kind]);

  useEffect(() => {
    if (!state.newAutomationOpen) return;
    void api
      .images()
      .then(setImages)
      .catch(() => setImages([]));
  }, [state.newAutomationOpen]);

  useEffect(() => {
    if (!state.newAutomationOpen || state.editingAutomationId || namedEnvId) return;
    setImageId(
      runtime === "host"
        ? ""
        : (latestGoldenImage(images, os, runtime === "docker" ? "docker" : "vm")?.id ?? ""),
    );
  }, [images, os, runtime, namedEnvId, state.newAutomationOpen, state.editingAutomationId]);

  useEffect(() => {
    if (!state.newAutomationOpen || hwDirty) return;
    setCpuCores(suggestion.cpuCores);
    setMemoryMb(suggestion.memoryMb);
    setDiskSizeGb(suggestion.diskSizeGb);
  }, [
    state.newAutomationOpen,
    suggestion.cpuCores,
    suggestion.memoryMb,
    suggestion.diskSizeGb,
    hwDirty,
  ]);

  function closeModal() {
    dispatch({ type: "newAutomation", open: false });
  }

  function requestClose() {
    if (confirmHost) {
      setConfirmHost(false);
      return;
    }
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    closeModal();
  }

  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const onDialogClose = useCallback(() => requestCloseRef.current(), []);

  if (!state.newAutomationOpen) return null;

  function schedule(): AutomationSchedule {
    return buildAutomationSchedule({
      kind,
      everyMinutes,
      otherwiseEveryMinutes,
      time,
      windowStart,
      windowEnd,
      weekday,
      weekdays,
      cronExpr,
    });
  }

  async function submit(opts?: { hostConfirmed?: boolean }) {
    setError(null);
    const parsed = parsedRepo;
    if ((kind === "forge" || kind === "pull_request") && !parsed) {
      setError(
        "Attach a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps repository to run on git events",
      );
      return;
    }
    if (kind === "webhook" && !name.trim()) {
      setError("Name is required");
      return;
    }
    const promptText = prompt.trim() || (kind === "webhook" ? DEFAULT_WEBHOOK_PROMPT : "");
    if (!promptText) {
      setError("Prompt is required");
      return;
    }
    if (kind === "adaptive") {
      const start = parseClockTime(windowStart);
      const end = parseClockTime(windowEnd);
      if (start.hour === end.hour && start.minute === end.minute) {
        setError("Window start and end must differ");
        return;
      }
    }
    const sched = schedule();
    const scheduleError = validateSchedule(sched);
    if (scheduleError) {
      setError(scheduleError);
      return;
    }
    if (repo.trim() && !parsed) {
      setError("Enter a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps URL");
      return;
    }
    const repoValue = parsed
      ? {
          forge: parsed.forge,
          url: parsed.url,
          ref: ref.trim() || undefined,
          accountId: parsed.accountId,
        }
      : undefined;
    const hardware: HardwareOverride | undefined =
      cpuCores !== suggestion.cpuCores ||
      memoryMb !== suggestion.memoryMb ||
      diskSizeGb !== suggestion.diskSizeGb
        ? { cpuCores, memoryMb, diskSizeGb }
        : undefined;
    const hostChat = runtime === "host";
    const input: CreateAutomationInput = {
      name,
      prompt: promptText,
      os:
        (runtime === "docker" || hostChat) && (os === "windows-11" || os === "windows-10")
          ? "ubuntu"
          : os,
      templateId: templateId || osTemplates[0]?.id || (hostChat ? "host" : ""),
      runtime,
      dockerImage: runtime === "docker" ? parseDockerImage(dockerImage) : undefined,
      providerId,
      model: model || provider?.defaultModel || "",
      startVm: hostChat && !backendId ? false : startVm,
      reuseSession,
      ownerSessionId: ownerSessionId.trim() || undefined,
      persistMemory,
      imageId: hostChat ? undefined : imageId || undefined,
      schedule: sched,
      repo: repoValue,
      repoId: repoId || undefined,
      hardware: runtime === "vm" ? hardware : undefined,
      notifyWebhook: notifyWebhook.trim() || undefined,
      notifyChannel: notifyChannel.trim() || undefined,
      allowedMcpTools: parseMcpToolNames(allowedMcpTools),
      allowHosts: hostChat ? [] : parseAllowHosts(allowHosts),
      autonomy,
      maxUsd: maxUsd.trim() ? Number(maxUsd) : autonomy === "autonomous" ? 20 : undefined,
      lifetimeMaxUsd: lifetimeMaxUsd.trim() ? Number(lifetimeMaxUsd) : undefined,
      overlap,
      timeZone: timeZone.trim() || undefined,
      blackoutDates: blackout
        .split(/[\s,]+/)
        .map((row) => row.trim())
        .filter(Boolean),
      notify: { success: notifySuccess, failure: notifyFailure, needsYou: notifyNeedsYou },
      hostDir: hostChat ? hostDir.trim() || undefined : undefined,
      namedEnvironmentId: namedEnvId || undefined,
      placement: backendId ? "worker" : undefined,
      backendId: backendId || undefined,
      network: hostChat ? undefined : network,
    };
    if (!editing && runtime === "host" && !opts?.hostConfirmed) {
      setConfirmHost(true);
      return;
    }
    setConfirmHost(false);
    setBusy(true);
    try {
      const item = editing
        ? await api.patchAutomation(editing.id, {
            ...input,
            hostDir: hostChat ? hostDir.trim() || null : null,
            repo: repoValue ?? null,
            repoId: repoId || null,
            hardware: hardware ?? null,
            namedEnvironmentId: namedEnvId || null,
            placement: backendId ? "worker" : null,
            backendId: backendId || null,
            network: hostChat ? null : network,
            notifyWebhook: notifyWebhook.trim() || null,
            notifyChannel: notifyChannel.trim() || null,
            ownerSessionId: ownerSessionId.trim() || null,
            imageId: hostChat ? null : imageId || null,
            maxUsd: maxUsd.trim() ? Number(maxUsd) : null,
            lifetimeMaxUsd: lifetimeMaxUsd.trim() ? Number(lifetimeMaxUsd) : null,
            timeZone: timeZone.trim() || null,
            blackoutDates: blackout
              .split(/[\s,]+/)
              .map((row) => row.trim())
              .filter(Boolean),
          })
        : await api.createAutomation(input);
      dispatch({ type: "automation", automation: item });
      dispatch({ type: "selectAutomation", id: item.id });
      if (
        !editing &&
        item.webhookSecret &&
        (item.schedule.kind === "forge" ||
          item.schedule.kind === "pull_request" ||
          item.schedule.kind === "webhook")
      ) {
        dispatch({ type: "highlightAutomationWebhook", id: item.id });
      }
      dispatch({ type: "newAutomation", open: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save job");
    } finally {
      setBusy(false);
    }
  }

  function chooseRuntime(next: AgentRuntime) {
    setDirty(true);
    setRuntime(next);
    const nextOs = next !== "vm" && (os === "windows-11" || os === "windows-10") ? "ubuntu" : os;
    if (nextOs !== os) setOs(nextOs);
    setStartVm(next !== "host" || Boolean(backendId));
    setImageId(
      next === "host"
        ? ""
        : (latestGoldenImage(images, nextOs, next === "docker" ? "docker" : "vm")?.id ?? ""),
    );
  }

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
    setNetwork(
      applied.network ?? ((applied.runtime ?? env.runtime) === "host" ? "open" : "restricted"),
    );
    setMaxUsd(applied.maxUsd != null ? String(applied.maxUsd) : "");
    setReuseSession(true);
    setPersistMemory(true);
    setStartVm((applied.runtime ?? env.runtime) !== "host");
  }

  return (
    <Modal
      titleId="new-automation-title"
      className="auto-modal"
      onClose={onDialogClose}
      onInput={() => setDirty(true)}
      onChange={() => setDirty(true)}
    >
      <h2 id="new-automation-title">{editing ? "Edit job" : "New job"}</h2>
      {!editing ? (
        <p className="modal-lead">
          When an event fires, run a prompt on a guest and keep the history.
        </p>
      ) : null}
      <section className="auto-form-section" data-testid="auto-when">
        <h3>When</h3>
        <div
          className="auto-trigger-grid"
          role="radiogroup"
          aria-label="Trigger"
          data-testid="auto-trigger-family"
        >
          {AUTOMATION_TRIGGER_FAMILIES.map((row) => {
            const selected = automationTriggerFamily(kind) === row.id;
            return (
              <button
                key={row.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`auto-trigger-card${selected ? " active" : ""}`}
                onClick={() => {
                  setDirty(true);
                  setKind(defaultKindForTriggerFamily(row.id, kind));
                }}
              >
                <strong>{row.title}</strong>
                <span className="hint">{row.blurb}</span>
              </button>
            );
          })}
        </div>
        {isClockScheduleKind(kind) ? (
          <div className="grid-2">
            <div className="field">
              <label>Schedule</label>
              <Select
                ariaLabel="Schedule"
                value={kind}
                options={CLOCK_SCHEDULE_KINDS.map((row) => ({
                  value: row,
                  label:
                    row === "interval"
                      ? "Every N minutes"
                      : row === "adaptive"
                        ? "Adaptive (by time of day)"
                        : row === "daily"
                          ? "Daily"
                          : row === "weekly"
                            ? "Weekly"
                            : "Cron",
                }))}
                onChange={(value) => setKind(value as AutomationSchedule["kind"])}
              />
            </div>
            {kind === "interval" ? (
              <div className="field">
                <label>Minutes</label>
                <input
                  type="number"
                  min={1}
                  value={everyMinutes}
                  onChange={(e) => setEveryMinutes(Number(e.target.value))}
                />
              </div>
            ) : kind === "adaptive" ? (
              <p className="hint" style={{ margin: 0, alignSelf: "center" }}>
                Faster inside a daily window, slower the rest of the day.
              </p>
            ) : kind === "cron" ? (
              <div className="field">
                <label>Expression</label>
                <input
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="0 9 * * 1"
                />
              </div>
            ) : (
              <div className="field">
                <label>Time</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            )}
          </div>
        ) : kind === "forge" ? (
          <p className="hint">Webhook plus polling for a new commit. Attach a repo below.</p>
        ) : kind === "pull_request" ? (
          <p className="hint">Webhook plus polling for a new pull request. Attach a repo below.</p>
        ) : (
          <p className="hint">
            POST /api/hooks with X-Locus-Secret or a Slack signing secret. No git repo required.
          </p>
        )}
        {kind === "daily" || kind === "weekly" || kind === "adaptive" || kind === "cron" ? (
          <div className="field">
            <label>Timezone</label>
            <input
              aria-label="Timezone"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              placeholder="America/Los_Angeles"
            />
            <p className="hint" data-testid="auto-tz-hint">
              Clock fires use this IANA zone. This machine is {formatLocalTimezone()}.
            </p>
          </div>
        ) : null}
        {kind === "adaptive" ? (
          <div className="field">
            <label>Days</label>
            <div className="auto-schedule-fields" role="group" aria-label="Weekdays">
              {SCHEDULE_WEEKDAYS.map((day, index) => (
                <label key={day} className="hint check">
                  <input
                    type="checkbox"
                    checked={!weekdays.length || weekdays.includes(index)}
                    onChange={(e) => {
                      const current = weekdays.length
                        ? weekdays
                        : SCHEDULE_WEEKDAYS.map((_, i) => i);
                      setWeekdays(
                        e.target.checked
                          ? [...new Set([...current, index])]
                          : current.filter((value) => value !== index),
                      );
                    }}
                  />
                  {day.slice(0, 3)}
                </label>
              ))}
            </div>
            <p className="hint">All checked means every day. Uncheck a day to skip it.</p>
          </div>
        ) : null}
        {(() => {
          try {
            const sched = schedule();
            if (validateSchedule(sched)) return null;
            if (sched.kind === "webhook") {
              return (
                <p className="hint" data-testid="auto-next-fire-preview">
                  Fires on each accepted webhook POST.
                </p>
              );
            }
            if (!isClockSchedule(sched)) return null;
            const nextAt = computeNextRunAt(sched).toISOString();
            const label = formatNextFire({
              enabled: true,
              schedule: sched,
              nextRunAt: nextAt,
            });
            if (!label) return null;
            return (
              <p className="hint" data-testid="auto-next-fire-preview">
                Next fire ≈{" "}
                {new Date(label).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            );
          } catch {
            return null;
          }
        })()}
        {kind === "adaptive" && (
          <>
            <div className="grid-2">
              <div className="field">
                <label>From</label>
                <input
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                />
              </div>
              <div className="field">
                <label>To</label>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Minutes during window</label>
                <input
                  type="number"
                  min={1}
                  value={everyMinutes}
                  onChange={(e) => setEveryMinutes(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Minutes otherwise</label>
                <input
                  type="number"
                  min={1}
                  value={otherwiseEveryMinutes}
                  onChange={(e) => setOtherwiseEveryMinutes(Number(e.target.value))}
                />
              </div>
            </div>
          </>
        )}
        {kind === "weekly" && (
          <div className="field">
            <label>Weekday</label>
            <Select
              ariaLabel="Weekday"
              value={String(weekday)}
              options={SCHEDULE_WEEKDAYS.map((day, i) => ({
                value: String(i),
                label: day,
              }))}
              onChange={(value) => setWeekday(Number(value))}
            />
          </div>
        )}
      </section>
      <section className="auto-form-section" data-testid="auto-then">
        <h3>Then</h3>
        <div className="field">
          <label>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly tests"
          />
        </div>
        <div className="field">
          <label>Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              kind === "webhook" ? DEFAULT_WEBHOOK_PROMPT : "What should the agent do each run?"
            }
            rows={6}
          />
        </div>
      </section>
      <JobRepoField
        repos={state.repos}
        repoId={repoId}
        url={repo}
        onRepoId={setRepoId}
        onUrl={setRepo}
        onRef={setRef}
      />
      {parsedRepo || repo.trim() || repoId ? (
        <div className="field">
          <label>Git ref (optional)</label>
          <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
        </div>
      ) : null}
      <ModelPicker
        providers={providers}
        providerId={providerId}
        model={model}
        showCosts={false}
        onChange={(next) => {
          setProviderId(next.providerId);
          setModel(next.model);
        }}
      />
      {provider && !provider.enabled ? (
        <div className="auto-runtime-notice" role="status" data-testid="auto-provider-off">
          <p className="auto-runtime-notice-title">
            {provider.name} is off. Runs fail until you turn it on.
          </p>
          <div className="auto-memory-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => openSettings(dispatch, "providers")}
            >
              Open Providers
            </button>
          </div>
        </div>
      ) : null}
      <details className="advanced">
        <summary>More options</summary>
        <p className="hint">
          Named environment, placement, runtime, OS, hardware, jail, spend, autonomy, notify, MCP,
          and reuse. When, Then, repo, and model stay above.
        </p>
        <FormTabs
          ariaLabel="More options"
          value={advancedTab}
          onChange={setAdvancedTab}
          tabs={[
            { id: "runtime", label: "Runtime" },
            { id: "agent", label: "Agent" },
            { id: "notify", label: "Notify" },
          ]}
        />
        <div hidden={advancedTab !== "runtime"}>
          <EnvironmentPicker
            value={namedEnvId}
            noneLabel="None — pick runtime below"
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
              allowHosts: parseAllowHosts(allowHosts),
            }}
          />
          <PlacementToggle
            workers={workers}
            value={backendId}
            onChange={(id) => {
              setBackendId(id);
            }}
          />
          <RuntimeToggle
            value={runtime}
            disabledRuntimes={
              state.config?.managedPolicy?.active &&
              state.config.managedPolicy.locked.includes("hostAutomations")
                ? ["host"]
                : []
            }
            onChange={chooseRuntime}
          />
          <p className="hint">
            {backendId
              ? `${runtime === "host" ? "The host workspace" : runtime === "vm" ? "The VM" : "The container"} runs on ${selectedWorker ? workerWhereLabel(selectedWorker) : "the worker"}. Chat and keys stay on this machine.${
                  selectedWorker && workerIsMetered(selectedWorker)
                    ? " Stop destroys the guest. Idle TTL applies on the metered VM."
                    : ""
                }`
              : runtime === "host"
                ? "Runs on this machine with no VM or container — files, shell, and git (host-side tools). Treat this as a security exception."
                : runtime === "docker"
                  ? "Daily path: Docker + locus/agent. Windows guests need a QEMU VM."
                  : "QEMU is the Windows-desktop / installer-QA path. Hardware overrides are VM-only."}
          </p>
          {runtime === "docker" ? (
            <DockerImageField value={dockerImage} onChange={setDockerImage} />
          ) : runtime === "vm" ? (
            <>
              <OsPicker
                templates={templates}
                value={os}
                onChange={(next) => {
                  setOs(next);
                  setTemplateId(templates.find((t) => t.os === next)?.id ?? "");
                  setHwDirty(false);
                }}
              />
              <OsSoloHint templates={templates} os={os} />
            </>
          ) : (
            <HostFolderField value={hostDir} onChange={setHostDir} remote={Boolean(backendId)} />
          )}
          {runtime === "host" ? null : (
            <div className="field">
              <label>Template</label>
              <Select
                ariaLabel="Template"
                value={templateId}
                options={osTemplates.map((t) => ({ value: t.id, label: t.name }))}
                onChange={setTemplateId}
              />
            </div>
          )}
          {runtime === "vm" ? (
            <HardwareFields
              cpuCores={cpuCores}
              memoryMb={memoryMb}
              diskSizeGb={diskSizeGb}
              hint={
                repoProfile
                  ? "Using a repo hardware profile. Edit to override for this job."
                  : "Defaults from Settings → Machines. Override for this job if you want."
              }
              onChange={(next) => {
                setHwDirty(true);
                setCpuCores(next.cpuCores);
                setMemoryMb(next.memoryMb);
                setDiskSizeGb(next.diskSizeGb);
              }}
            />
          ) : null}
          {runtime === "host" ? null : (
            <div className="field">
              <label>
                {runtime === "docker" ? "Workspace image (optional)" : "Golden image (optional)"}
              </label>
              <Select
                ariaLabel={runtime === "docker" ? "Workspace image" : "Golden image"}
                value={imageId}
                options={[
                  {
                    value: "",
                    label:
                      runtime === "docker"
                        ? "Empty /workspace"
                        : "Fresh disk from ISO / cloud image",
                  },
                  ...images
                    .filter((img) =>
                      runtime === "docker"
                        ? img.runtime === "docker"
                        : img.os === os && img.runtime !== "docker",
                    )
                    .map((img) => ({ value: img.id, label: img.name })),
                ]}
                onChange={setImageId}
              />
            </div>
          )}
          {runtime === "host" ? null : (
            <div className="field">
              <label>Jail</label>
              <Select
                ariaLabel="Jail"
                value={network}
                disabled={Boolean(policyForcedJail(state.config?.managedPolicy))}
                options={JAIL_SELECT_OPTIONS}
                onChange={(value) => {
                  if (isNetworkJail(value)) setNetwork(value);
                }}
              />
              <p className="hint">
                Adaptive and webhook jobs reuse this jail on the named machine.
              </p>
            </div>
          )}
          {runtime === "host" ? null : (
            <label className="hint check">
              <input
                type="checkbox"
                checked={startVm}
                onChange={(e) => setStartVm(e.target.checked)}
              />
              {runtime === "docker"
                ? "Start the container for each run"
                : "Start the VM for each run"}
            </label>
          )}
        </div>
        <div hidden={advancedTab !== "agent"}>
          <label className="hint check">
            <input
              type="checkbox"
              checked={reuseSession}
              onChange={(e) => setReuseSession(e.target.checked)}
            />
            {runtime === "host"
              ? "Reuse the last chat for this job"
              : "Reuse the last machine for this job"}
          </label>
          {parseProductMode(state.config?.productMode) === "swarm" ? (
            <div className="field">
              <label htmlFor="routine-owner">Owning teammate</label>
              <Select
                id="routine-owner"
                ariaLabel="Owning teammate"
                value={ownerSessionId}
                options={[
                  { value: "", label: "Unassigned" },
                  ...state.sessions
                    .filter(
                      (row) =>
                        !row.archived &&
                        sessionMatchesSurface(row, "swarm") &&
                        !row.projectId &&
                        !row.automationId,
                    )
                    .map((row) => ({ value: row.id, label: sessionDisplayName(row) })),
                ]}
                onChange={setOwnerSessionId}
              />
              <p className="hint">Shown on that teammate&apos;s computer panel in Swarm.</p>
            </div>
          ) : null}
          <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
            Without reuse, each run opens a new chat. Locus keeps the newest {MAX_AUTOMATION_CHATS}{" "}
            chats for this job and deletes older ones. Pinned chats stay.
          </p>
          <label className="hint check">
            <input
              type="checkbox"
              checked={persistMemory}
              onChange={(e) => setPersistMemory(e.target.checked)}
            />
            Remember facts between runs
          </label>
          <p className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
            Optional. The agent can save short facts that carry into later runs, even when each run
            opens a new chat. Reuse keeps the full thread; memory keeps a distilled list. Do not use
            this for secrets.
          </p>
          <div className="grid-2 grid-spend">
            <div className="field">
              <label>Autonomy</label>
              <Select
                ariaLabel="Autonomy"
                value={autonomy}
                disabled={!policyAllowsAutonomous(state.config?.managedPolicy)}
                options={AUTONOMY_SELECT_OPTIONS}
                onChange={(value) => setAutonomy(parseAutonomyTier(value))}
              />
            </div>
            <div className="field">
              <label>Spend cap (USD)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={maxUsd}
                placeholder={autonomy === "autonomous" ? "20" : "unlimited"}
                onChange={(e) => setMaxUsd(e.target.value)}
              />
              <p className="hint">Per run. Stops that turn.</p>
            </div>
            <div className="field">
              <label>Lifetime cap (USD)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                aria-label="Lifetime spend cap"
                value={lifetimeMaxUsd}
                placeholder="unlimited"
                onChange={(e) => setLifetimeMaxUsd(e.target.value)}
              />
              <p className="hint">Later fires are skipped once stored spend reaches this.</p>
            </div>
          </div>
          <div className="field">
            <label>Overlap</label>
            <Select
              ariaLabel="Overlap"
              value={overlap}
              options={OVERLAP_SELECT_OPTIONS}
              onChange={(value) => setOverlap(value as "skip" | "coalesce" | "queue")}
            />
          </div>
          <div className="field">
            <label>Blackout dates</label>
            <input
              aria-label="Blackout dates"
              value={blackout}
              placeholder="YYYY-MM-DD, comma-separated"
              onChange={(e) => setBlackout(e.target.value)}
            />
          </div>
        </div>
        <div hidden={advancedTab !== "notify"}>
          <NotifyFields
            notifyWebhook={notifyWebhook}
            notifyChannel={notifyChannel}
            onWebhook={setNotifyWebhook}
            onChannel={setNotifyChannel}
          />
          <McpAllowlistField
            config={state.config ?? undefined}
            value={allowedMcpTools}
            onChange={setAllowedMcpTools}
          />
          {runtime === "host" ? null : (
            <div className="field">
              <label>Extra allow hosts</label>
              <input
                value={allowHosts}
                onChange={(e) => setAllowHosts(e.target.value)}
                placeholder="your-domain.atlassian.net, grafana.example.com, api.incident.io"
              />
              <p className="hint">Added to the restricted jail allowlist for this job.</p>
            </div>
          )}
          <div className="field">
            <label>Notify</label>
            <label className="hint check">
              <input
                type="checkbox"
                checked={notifySuccess}
                onChange={(e) => setNotifySuccess(e.target.checked)}
              />
              Success
            </label>
            <label className="hint check">
              <input
                type="checkbox"
                checked={notifyFailure}
                onChange={(e) => setNotifyFailure(e.target.checked)}
              />
              Failure
            </label>
            <label className="hint check">
              <input
                type="checkbox"
                checked={notifyNeedsYou}
                onChange={(e) => setNotifyNeedsYou(e.target.checked)}
              />
              Needs you
            </label>
          </div>
        </div>
      </details>
      {dockerDown && runtime === "docker" && !backendId ? (
        <div className="auto-runtime-notice" role="alert" data-testid="auto-editor-docker-down">
          <p className="auto-runtime-notice-title">{DOCKER_DOWN_MESSAGE}</p>
          <p className="hint">You can still save. Runs fail until Docker answers.</p>
          <DockerDownActions
            hostLocked={hostJobsLocked(state.config)}
            onSwitchToHost={() => chooseRuntime("host")}
            onCheckAgain={() => setDockerCheck((n) => n + 1)}
          />
        </div>
      ) : null}
      {error && <p className="scrim-note is-danger">{error}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={requestClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Saving…" : editing ? "Save" : "Create job"}
        </button>
      </div>
      {confirmHost ? (
        <ConfirmModal
          title="Create on the host?"
          body="Host runtime has no VM or container. Treat this as a security exception."
          confirmLabel="Create on host"
          danger
          testId="auto-host-confirm"
          onCancel={() => setConfirmHost(false)}
          onConfirm={() => void submit({ hostConfirmed: true })}
        />
      ) : null}
      {confirmDiscard ? (
        <ConfirmModal
          title="Discard this draft?"
          body="Unsaved name, prompt, and settings will be lost."
          confirmLabel="Discard"
          danger
          testId="auto-discard-confirm"
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={closeModal}
        />
      ) : null}
    </Modal>
  );
}

function NotifyFields(props: {
  notifyWebhook: string;
  notifyChannel: string;
  onWebhook: (value: string) => void;
  onChannel: (value: string) => void;
}) {
  return (
    <>
      <div className="field">
        <label>Notify webhook (optional)</label>
        <input
          value={props.notifyWebhook}
          onChange={(e) => props.onWebhook(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
        />
        <p className="hint">
          Slack incoming webhooks get a text summary of the last assistant message. When Slack is
          signed in, a channel ID below posts that summary as you instead.
        </p>
      </div>
      <div className="field">
        <label>Notify channel (optional)</label>
        <input
          value={props.notifyChannel}
          onChange={(e) => props.onChannel(e.target.value)}
          placeholder="#ops or C0123ABCD"
        />
        <p className="hint">
          Channel ID or name. Used when Sign in with Slack is connected; otherwise included on a
          generic notify webhook.
        </p>
      </div>
    </>
  );
}

function McpAllowlistField(props: {
  config: LocusConfig | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [extra, setExtra] = useState("");
  const options = automationAllowlistOptions(props.config, props.value);
  const groups = [...new Set(options.map((row) => row.group))];

  function toggle(name: string, on: boolean) {
    if (on) {
      if (props.value.includes(name)) return;
      props.onChange([...props.value, name]);
      return;
    }
    props.onChange(props.value.filter((row) => row !== name));
  }

  function addExtra() {
    const names = parseMcpToolNames(extra);
    if (!names.length) return;
    const next = [...props.value];
    for (const name of names) {
      if (!next.includes(name)) next.push(name);
    }
    props.onChange(next);
    setExtra("");
  }

  return (
    <div className="field auto-mcp" data-testid="auto-mcp">
      <label>Allowed MCP / integration tools</label>
      <p className="hint">
        Empty means this job gets no MCP, Jira, Confluence, Linear, Slack, Grafana, Sentry, Figma,
        incident.io, AWS IAM, Portainer, Gmail, Calendar, Drive, Kubernetes, or plugin tools. Listed
        names skip Approve on this job only.
      </p>
      {groups.map((group) => (
        <div className="auto-mcp-group" key={group}>
          <span>{group}</span>
          {options
            .filter((row) => row.group === group)
            .map((row) => (
              <label className="hint check" key={row.name}>
                <input
                  type="checkbox"
                  checked={props.value.includes(row.name)}
                  onChange={(e) => toggle(row.name, e.target.checked)}
                />
                {row.name}
              </label>
            ))}
        </div>
      ))}
      <input
        value={extra}
        onChange={(e) => setExtra(e.target.value)}
        placeholder="Add mcp_jira_search, grafana_query, …"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addExtra();
          }
        }}
      />
      <div className="auto-memory-actions">
        <button className="btn small" type="button" disabled={!extra.trim()} onClick={addExtra}>
          Add tool
        </button>
      </div>
    </div>
  );
}

const OTHER_URL = "__url";

/** Linked repos first; a pasted URL is the fallback, not the default label. */
function JobRepoField(props: {
  repos: LinkedRepo[];
  repoId: string;
  url: string;
  onRepoId: (id: string) => void;
  onUrl: (url: string) => void;
  onRef: (ref: string) => void;
}) {
  const [urlMode, setUrlMode] = useState(!props.repoId && Boolean(props.url.trim()));

  useEffect(() => {
    if (props.repoId) setUrlMode(false);
    else if (props.url.trim()) setUrlMode(true);
  }, [props.repoId, props.url]);

  const urlInput = (
    <input
      aria-label="Repository URL"
      value={props.url}
      onChange={(e) => {
        props.onUrl(e.target.value);
        props.onRepoId("");
      }}
      placeholder="https://github.com/acme/app, https://gitlab.com/acme/app, or https://bitbucket.org/org/repo"
    />
  );

  if (!props.repos.length) {
    return (
      <div className="field">
        <label>Repository (optional)</label>
        {urlInput}
      </div>
    );
  }

  return (
    <div className="field" data-testid="auto-repo-field">
      <label>Repository</label>
      <Select
        ariaLabel="Repository"
        value={props.repoId || (urlMode ? OTHER_URL : "")}
        options={[
          { value: "", label: "No repo" },
          ...props.repos.map((row) => ({
            value: row.id,
            label: `${row.name} · ${forgeLabel(row.checkout.forge)}`,
          })),
          { value: OTHER_URL, label: "Another URL…" },
        ]}
        onChange={(id) => {
          if (!id || id === OTHER_URL) {
            props.onRepoId("");
            props.onUrl("");
            setUrlMode(id === OTHER_URL);
            return;
          }
          const linked = props.repos.find((row) => row.id === id);
          props.onRepoId(id);
          setUrlMode(false);
          if (linked) {
            props.onUrl(linked.checkout.url);
            if (linked.checkout.ref) props.onRef(linked.checkout.ref);
          }
        }}
      />
      {urlMode ? urlInput : null}
    </div>
  );
}

/** Drop a stored repoId whose linked repo no longer exists, so the form falls back to its URL. */
function liveRepoId(repos: LinkedRepo[], repoId: string | undefined): string {
  return repoId && repos.some((row) => row.id === repoId) ? repoId : "";
}
