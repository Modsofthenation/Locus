import { useEffect, useRef, useState } from "react";
import {
  applyRemember,
  AUTOMATION_STARTERS,
  automationHealth,
  automationScheduleOpts,
  automationHookCurl,
  buildAutomationSchedule,
  automationHookUrl,
  automationLastFact,
  automationLatestAgentRun,
  clipFact,
  computeNextRunAt,
  formatNetworkJail,
  formatNextFire,
  formatClockTime,
  formatRunDuration,
  formatSchedule,
  isClockSchedule,
  localTimezoneLabel,
  SCHEDULE_WEEKDAYS,
  MAX_AUTOMATION_CHATS,
  MAX_MEMORIES,
  MAX_MEMORY_CHARS,
  namedEnvironmentById,
  normalizeBlackoutDates,
  normalizeTimeZone,
  newMemoryId,
  replaceMemoryText,
  runHistoryStatusLabel,
  runStatusText,
  sessionRuntime,
  validateSchedule,
  type Automation,
  type AutomationRun,
  type AutomationSchedule,
  type PatchAutomationInput,
  type RepoMemory,
} from "@locus/shared";
import { api } from "@/lib/api";
import { automationDetailPrefFor, saveAutomationDetailPref } from "@/lib/automationPrefs";
import {
  automationFunnelHint,
  automationSpendLabel,
  promptNeedsCollapse,
  runMatchesHistoryFilter,
  runOutcomeLabel,
  runSpendLabel,
  spendChipTitle,
  type RunHistoryFilter,
} from "@/lib/automations";
import { openSettings, useStore } from "@/state/store";
import { ExpandableLog } from "@/components/chat/ExpandableLog";
import { EmptyHero, EmptyHint } from "@/components/layout/EmptyHero";
import { ErrorBanner, InlineError } from "@/components/layout/Skeleton";
import { Select } from "@/components/layout/Select";
import { OVERLAP_SELECT_OPTIONS } from "@/lib/formOptions";
import { ConfirmModal } from "@/components/layout/ConfirmModal";
import { TrustActions } from "@/components/chat/TrustActions";
import { IconCopy, IconPlay, IconStop } from "@/components/layout/Icons";
import { ModelPicker } from "@/components/settings/ModelPicker";

const RUN_HISTORY_PAGE = 25;
const RUN_HISTORY_FETCH = 200;

export function formatWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ChipTone = "ok" | "warn" | "muted" | undefined;

function chipClass(tone: ChipTone): string {
  if (tone === "muted") return " muted";
  if (tone === "ok") return " ok";
  if (tone === "warn") return " warn";
  return "";
}

function statusChipTone(label: string): ChipTone {
  if (label === "Paused") return "muted";
  if (label === "Enabled" || label.startsWith("Last succeeded")) return "ok";
  if (label === "Running" || label.startsWith("Last failed") || label.startsWith("Last needs"))
    return "warn";
  return undefined;
}

function isEditableClockSchedule(schedule: AutomationSchedule): boolean {
  return (
    schedule.kind === "interval" ||
    schedule.kind === "adaptive" ||
    schedule.kind === "daily" ||
    schedule.kind === "weekly" ||
    schedule.kind === "cron"
  );
}

function chipFilterTarget(chip: { key: string; label: string }): RunHistoryFilter | null {
  if (chip.key === "status" && chip.label === "Running") return "running";
  if (chip.key === "last" && chip.label.startsWith("Last failed")) return "failed";
  return null;
}

export function AutomationsPane() {
  const { state, dispatch } = useStore();
  const item = state.automations.find((a) => a.id === state.selectedAutomationId);
  const runs = state.runs.filter((r) => r.automationId === item?.id);

  useEffect(() => {
    if (item || !state.automations.length) return;
    dispatch({ type: "selectAutomation", id: state.automations[0]!.id });
  }, [item, state.automations, dispatch]);
  const loadedSessions = useRef(new Set<string>());
  const env = namedEnvironmentById(state.config?.namedEnvironments, item?.namedEnvironmentId);
  const lastFact = item ? automationLastFact(item) : undefined;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(item?.prompt ?? "");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(item?.name ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [paneError, setPaneError] = useState<string | null>(null);
  const [runActionError, setRunActionError] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runFilter, setRunFilter] = useState<RunHistoryFilter>("all");
  const hookHighlighted = state.highlightAutomationWebhookId === item?.id;

  useEffect(() => {
    setPromptDraft(item?.prompt ?? "");
    setEditingPrompt(false);
    setConfirmDelete(false);
    setPromptError(null);
    setPaneError(null);
    setRunActionError(null);
    setRunBusy(false);
    setEditingName(false);
    setNameDraft(item?.name ?? "");
    setNameError(null);
    if (item?.id) {
      const pref = automationDetailPrefFor(item.id);
      setPromptExpanded(Boolean(pref.promptExpanded));
      setChipsExpanded(Boolean(pref.chipsExpanded));
      const latest = automationLatestAgentRun(runs, item.id);
      const health = automationHealth(item, latest);
      setRunFilter(health === "failing" ? "failed" : health === "needs_you" ? "needs_you" : "all");
    } else {
      setPromptExpanded(false);
      setChipsExpanded(false);
      setRunFilter("all");
    }
    // Default filter / expand prefs only when switching jobs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(() => {
    setPromptDraft(item?.prompt ?? "");
    setNameDraft(item?.name ?? "");
  }, [item?.prompt, item?.name]);

  useEffect(() => {
    if (!item?.id) return;
    let cancelled = false;
    void api
      .automationRuns(item.id, { limit: 200 })
      .then((rows) => {
        if (cancelled) return;
        for (const run of rows) dispatch({ type: "run", run });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item?.id, dispatch]);

  useEffect(() => {
    if (!hookHighlighted) return;
    document
      .querySelector('[data-testid="auto-hook"]')
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [hookHighlighted, item?.id]);

  useEffect(() => {
    for (const run of runs) {
      if (!run.sessionId || loadedSessions.current.has(run.sessionId)) continue;
      if (state.sessions.some((s) => s.id === run.sessionId)) {
        loadedSessions.current.add(run.sessionId);
        continue;
      }
      loadedSessions.current.add(run.sessionId);
      void api
        .session(run.sessionId)
        .then((session) => dispatch({ type: "session", session }))
        .catch(() => loadedSessions.current.delete(run.sessionId!));
    }
  }, [runs, state.sessions, dispatch]);

  async function openChat(run: AutomationRun) {
    if (!run.sessionId) return;
    let session = state.sessions.find((s) => s.id === run.sessionId);
    if (!session) {
      try {
        session = await api.session(run.sessionId);
        dispatch({ type: "session", session });
      } catch {
        return;
      }
    }
    dispatch({ type: "select", id: session.id });
  }

  async function replayRun(run: AutomationRun) {
    if (!item) return;
    setRunBusy(true);
    setRunActionError(null);
    setPaneError(null);
    try {
      const next = await api.runAutomation(item.id, { runId: run.id });
      dispatch({ type: "run", run: next });
    } catch (err) {
      setRunActionError(err instanceof Error ? err.message : "Could not start a run");
    } finally {
      setRunBusy(false);
    }
  }

  async function startManualRun() {
    if (!item) return;
    setRunBusy(true);
    setRunActionError(null);
    setPaneError(null);
    try {
      const run = await api.runAutomation(item.id);
      dispatch({ type: "run", run });
    } catch (err) {
      setRunActionError(err instanceof Error ? err.message : "Could not start a run");
    } finally {
      setRunBusy(false);
    }
  }

  async function stopLiveRun(run: AutomationRun) {
    setRunActionError(null);
    const previous = run;
    dispatch({
      type: "run",
      run: {
        ...run,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: run.error?.trim() || "Stopped",
      },
    });
    try {
      const result = await api.stopAutomation(item!.id);
      if (result.run) dispatch({ type: "run", run: result.run });
    } catch (err) {
      dispatch({ type: "run", run: previous });
      setRunActionError(err instanceof Error ? err.message : "Could not stop the run");
    }
  }

  function openLatestAutomationChat() {
    if (!item) return;
    const latest = [...state.sessions]
      .filter((s) => s.automationId === item.id && !s.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
    if (!latest) return;
    dispatch({ type: "select", id: latest.id });
  }

  if (!state.automations.length) {
    return (
      <div className="empty auto-start">
        <div className="empty-card">
          <EmptyHero
            pose="rest"
            eyebrow="Automations"
            title="When should an agent run?"
            lead="Pick a trigger — clock, git push, pull request, or webhook — then a prompt. Each run executes on Docker, VM, or host and keeps a thread you can open."
          />
          <button
            className="btn primary"
            onClick={() => dispatch({ type: "newAutomation", open: true })}
          >
            New automation
          </button>
          <div className="design-start-from">
            <p className="design-start-from-label">Or start from</p>
            <div
              className="recipe-grid pills"
              role="group"
              aria-label="Automation starters"
              data-testid="auto-starters"
            >
              {AUTOMATION_STARTERS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="os-card"
                  title={row.blurb}
                  onClick={() => dispatch({ type: "newAutomation", open: true, starterId: row.id })}
                >
                  <h3>{row.title}</h3>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!item) return null;

  const runtime = sessionRuntime(item);
  const latestAgent = automationLatestAgentRun(runs, item.id);
  const running = runs.some((r) => r.status === "running" || r.status === "queued");
  const liveRun = runs.find((r) => r.status === "running" || r.status === "queued");
  const jail = runtime === "host" ? undefined : (item.network ?? env?.network);
  const tz = isClockSchedule(item.schedule)
    ? localTimezoneLabel(undefined, item.timeZone)
    : undefined;
  const next = formatNextFire(item);
  const nextChip =
    item.enabled && next && next !== "On webhook" ? `Next ${formatWhen(next)}` : undefined;
  const spend = automationSpendLabel(runs, item, state.sessions, state.config ?? undefined);
  const lastRunSession = latestAgent?.sessionId
    ? state.sessions.find((row) => row.id === latestAgent.sessionId)
    : undefined;
  const lastSpend = latestAgent
    ? runSpendLabel(latestAgent, item, lastRunSession, state.config ?? undefined)
    : undefined;
  const spendSessionIds = new Set<string>();
  let spendSessionCount = 0;
  let spendPendingSessions = 0;
  for (const run of runs) {
    if (!run.sessionId || spendSessionIds.has(run.sessionId)) continue;
    spendSessionIds.add(run.sessionId);
    if (state.sessions.some((s) => s.id === run.sessionId)) spendSessionCount += 1;
    else spendPendingSessions += 1;
  }
  const statusLabel = running ? "Running" : item.enabled ? "Enabled" : "Paused";
  const lastLabel = latestAgent ? `Last ${runStatusText(latestAgent)}` : undefined;
  const spendChip = spend
    ? {
        key: "spend",
        label: spend.label,
        title: spendChipTitle({
          over: spend.over,
          label: spend.label,
          sessionCount: spendSessionCount,
          pendingSessions: spendPendingSessions,
        }),
        tone: spend.over ? ("warn" as const) : undefined,
      }
    : spendPendingSessions > 0
      ? { key: "spend", label: "Spend loading…", tone: "muted" as const }
      : undefined;
  const primaryChips: {
    key: string;
    caption: string;
    label: string;
    title?: string;
    tone?: ChipTone;
  }[] = [
    { key: "status", caption: "Status", label: statusLabel, tone: statusChipTone(statusLabel) },
    { key: "schedule", caption: "When", label: formatSchedule(item.schedule) },
    ...(nextChip ? [{ key: "next", caption: "Next", label: nextChip }] : []),
    ...(lastLabel
      ? [{ key: "last", caption: "Last", label: lastLabel, tone: statusChipTone(lastLabel) }]
      : []),
    ...(lastSpend && lastSpend !== "—"
      ? [{ key: "last-spend", caption: "Last run", label: lastSpend, title: "Per-run spend cap" }]
      : []),
    ...(spendChip ? [{ ...spendChip, caption: "Lifetime" }] : []),
  ];
  const detailChips: {
    key: string;
    caption: string;
    label: string;
    title?: string;
    tone?: ChipTone;
  }[] = [
    {
      key: "runtime",
      caption: "Runtime",
      label: runtime === "host" ? "Host" : runtime === "docker" ? "Docker" : "VM",
    },
    ...(tz
      ? [
          {
            key: "tz",
            caption: "Timezone",
            label: item.timeZone ?? tz.chip,
            title: item.timeZone ? `Fires in ${tz.iana}` : tz.iana,
          },
        ]
      : []),
    ...(env?.name ? [{ key: "env", caption: "Environment", label: env.name }] : []),
    ...(jail ? [{ key: "jail", caption: "Jail", label: formatNetworkJail(jail) }] : []),
  ];
  const visibleChips = chipsExpanded ? [...primaryChips, ...detailChips] : primaryChips;
  const showWebhook =
    Boolean(item.webhookSecret) &&
    (item.schedule.kind === "forge" ||
      item.schedule.kind === "pull_request" ||
      item.schedule.kind === "webhook");
  const automationChats = state.sessions.filter((s) => s.automationId === item.id && !s.archived);
  const chatCount = automationChats.length;
  const nearChatCap = chatCount >= MAX_AUTOMATION_CHATS - 5;

  return (
    <div className="auto-pane">
      <div className="auto-head">
        <div className="auto-overview" data-testid="auto-chips">
          {visibleChips.map((chip) => {
            const filterTarget = chipFilterTarget(chip);
            const className = `auto-chip${chipClass(chip.tone)}`;
            return (
              <div key={chip.key} className="auto-overview-item">
                <span className="auto-overview-caption">{chip.caption}</span>
                {filterTarget ? (
                  <button
                    type="button"
                    title={chip.title ?? `Show ${filterTarget} runs`}
                    className={`${className} clickable`}
                    onClick={() => setRunFilter(filterTarget)}
                  >
                    {chip.label}
                  </button>
                ) : (
                  <span title={chip.title} className={className}>
                    {chip.label}
                  </span>
                )}
              </div>
            );
          })}
          {detailChips.length ? (
            <button
              type="button"
              className="btn small ghost auto-chip-more"
              aria-expanded={chipsExpanded}
              onClick={() => {
                setChipsExpanded((v) => {
                  const next = !v;
                  saveAutomationDetailPref(item.id, { chipsExpanded: next });
                  return next;
                });
              }}
            >
              {chipsExpanded ? "Less" : `+${detailChips.length} details`}
            </button>
          ) : null}
        </div>
        <div
          className="row"
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          {running && liveRun ? (
            <button
              className="btn small danger"
              type="button"
              data-testid="auto-pane-stop"
              onClick={() => void stopLiveRun(liveRun)}
            >
              <IconStop /> Stop
            </button>
          ) : (
            <button
              className="btn small primary"
              type="button"
              data-testid="auto-pane-run-now"
              disabled={!item.enabled || runBusy}
              title={item.enabled ? "Start a new manual run" : "Paused"}
              onClick={() => void startManualRun()}
            >
              <IconPlay /> {runBusy ? "Starting…" : "Run now"}
            </button>
          )}
          {editingName ? (
            <>
              <input
                className="auto-rename-input"
                aria-label="Automation name"
                value={nameDraft}
                disabled={nameBusy}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  setNameError(null);
                }}
              />
              <button
                className="btn small primary"
                type="button"
                disabled={nameBusy || !nameDraft.trim() || nameDraft.trim() === item.name}
                onClick={() => {
                  setNameBusy(true);
                  setNameError(null);
                  void api
                    .patchAutomation(item.id, { name: nameDraft.trim() })
                    .then((automation) => {
                      dispatch({ type: "automation", automation });
                      setEditingName(false);
                    })
                    .catch((err: unknown) => {
                      setNameError(err instanceof Error ? err.message : "Could not rename");
                    })
                    .finally(() => setNameBusy(false));
                }}
              >
                Save
              </button>
              <button
                className="btn small"
                type="button"
                disabled={nameBusy}
                onClick={() => {
                  setNameDraft(item.name);
                  setEditingName(false);
                  setNameError(null);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="btn small"
              type="button"
              onClick={() => {
                setNameDraft(item.name);
                setEditingName(true);
                setNameError(null);
              }}
            >
              Rename
            </button>
          )}
          <button
            className="btn small"
            onClick={() => {
              setPaneError(null);
              void api
                .cloneAutomation(item.id)
                .then((copy) => {
                  dispatch({ type: "automation", automation: copy });
                  dispatch({ type: "selectAutomation", id: copy.id });
                })
                .catch((err: unknown) => {
                  setPaneError(err instanceof Error ? err.message : "Could not duplicate");
                });
            }}
          >
            Duplicate
          </button>
          <button
            className="btn small"
            onClick={() => dispatch({ type: "newAutomation", open: true, editId: item.id })}
          >
            Settings
          </button>
          <button className="btn small danger ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>
      {nameError ? <InlineError message={nameError} testId="auto-rename-error" /> : null}
      {paneError ? <ErrorBanner message={paneError} testId="auto-pane-error" /> : null}
      {runActionError ? <ErrorBanner message={runActionError} testId="auto-pane-error" /> : null}
      {confirmDelete ? (
        <ConfirmModal
          title={`Delete ${item.name}?`}
          body="This cannot be undone."
          confirmLabel="Delete"
          danger
          testId="auto-delete-confirm"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            setPaneError(null);
            void api
              .deleteAutomation(item.id)
              .then(() => dispatch({ type: "automationDeleted", id: item.id }))
              .catch((err: unknown) => {
                setPaneError(err instanceof Error ? err.message : "Could not delete");
              });
          }}
        />
      ) : null}
      {isEditableClockSchedule(item.schedule) ? (
        <ScheduleMiniEditor
          item={item}
          onSaved={(automation) => dispatch({ type: "automation", automation })}
        />
      ) : null}
      <JobOptions
        item={item}
        onSaved={(automation) => dispatch({ type: "automation", automation })}
      />
      {showWebhook && hookHighlighted ? (
        <div className="auto-hook-handoff" data-testid="auto-hook-handoff">
          <p>Copy the POST URL and secret for callers.</p>
          <button
            type="button"
            className="btn small"
            onClick={() => dispatch({ type: "highlightAutomationWebhook", id: null })}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {showWebhook ? <WebhookCard item={item} highlighted={hookHighlighted} /> : null}
      <section
        className={`auto-prompt${
          !editingPrompt && promptNeedsCollapse(item.prompt) && !promptExpanded ? " collapsed" : ""
        }`}
        data-testid="auto-prompt"
      >
        <div className="auto-memory-head">
          <h3>Then</h3>
          <div className="auto-memory-actions">
            {!editingPrompt && promptNeedsCollapse(item.prompt) ? (
              <button
                className="btn small"
                type="button"
                aria-expanded={promptExpanded}
                onClick={() => {
                  setPromptExpanded((v) => {
                    const next = !v;
                    saveAutomationDetailPref(item.id, { promptExpanded: next });
                    return next;
                  });
                }}
              >
                {promptExpanded ? "Collapse" : "Expand"}
              </button>
            ) : null}
            <button
              className="btn small"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(item.prompt).then(() => {
                  setPromptCopied(true);
                  window.setTimeout(() => setPromptCopied(false), 1200);
                });
              }}
            >
              <IconCopy /> {promptCopied ? "Copied" : "Copy"}
            </button>
            {editingPrompt ? null : (
              <button className="btn small" type="button" onClick={() => setEditingPrompt(true)}>
                Edit prompt
              </button>
            )}
          </div>
        </div>
        {editingPrompt ? (
          <>
            <textarea
              aria-label="Edit prompt"
              rows={12}
              value={promptDraft}
              disabled={promptBusy}
              onChange={(e) => {
                setPromptDraft(e.target.value);
                setPromptError(null);
              }}
            />
            <div className="auto-memory-actions">
              <button
                className="btn small primary"
                type="button"
                disabled={promptBusy || !promptDraft.trim() || promptDraft.trim() === item.prompt}
                onClick={() => {
                  setPromptBusy(true);
                  setPromptError(null);
                  void api
                    .patchAutomation(item.id, { prompt: promptDraft.trim() })
                    .then((automation) => {
                      dispatch({ type: "automation", automation });
                      setEditingPrompt(false);
                    })
                    .catch((err: unknown) => {
                      setPromptError(err instanceof Error ? err.message : "Could not save prompt");
                    })
                    .finally(() => setPromptBusy(false));
                }}
              >
                Save
              </button>
              <button
                className="btn small"
                type="button"
                disabled={promptBusy}
                onClick={() => {
                  setPromptDraft(item.prompt);
                  setEditingPrompt(false);
                  setPromptError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p>{item.prompt}</p>
        )}
        {promptError ? <InlineError message={promptError} /> : null}
      </section>
      <RunHistory
        item={item}
        runs={runs}
        filter={runFilter}
        onFilterChange={setRunFilter}
        onOpenChat={(run) => void openChat(run)}
        onRunNow={() => void startManualRun()}
        onReplay={(run) => void replayRun(run)}
        onStop={(run) => void stopLiveRun(run)}
        runBusy={runBusy}
      />
      <AutomationMemoryEditor
        item={item}
        lastFact={lastFact}
        onSaved={(automation) => dispatch({ type: "automation", automation })}
      />
      <div
        className={`auto-chat-retention${nearChatCap ? " warn" : ""}`}
        data-testid="auto-chat-retention"
      >
        <p className="hint">
          {chatCount} / {MAX_AUTOMATION_CHATS} chats kept
          {nearChatCap ? " · near the retention cap" : ""}. Pinned chats stay.
        </p>
        <button
          type="button"
          className="btn small ghost"
          disabled={chatCount === 0}
          onClick={openLatestAutomationChat}
        >
          Open latest chat
        </button>
      </div>
    </div>
  );
}

function WebhookCard(props: { item: Automation; highlighted?: boolean }) {
  const { state, dispatch } = useStore();
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [testHint, setTestHint] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const url = automationHookUrl(props.item.id, {
    webhookBaseUrl: state.config?.advanced.webhookBaseUrl,
    bindHost: state.config?.advanced.bindHost,
    bindPort: state.config?.advanced.bindPort,
  });
  const secret = props.item.webhookSecret ?? "";
  const funnel = automationFunnelHint(state.config?.advanced.webhookBaseUrl);
  const curl = automationHookCurl(url, secret);

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(label);
    window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1200);
  }

  async function rotate() {
    setRotating(true);
    setRotateError(null);
    try {
      const updated = await api.patchAutomation(props.item.id, { rotateWebhookSecret: true });
      dispatch({ type: "automation", automation: updated });
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : "Could not rotate secret");
    } finally {
      setRotating(false);
      setConfirmRotate(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestError(null);
    setTestHint(null);
    try {
      const run = await api.testAutomationWebhook(props.item.id);
      dispatch({ type: "run", run });
      setTestHint("Recorded a test skip. No agent ran.");
      window.setTimeout(
        () => setTestHint((current) => (current?.startsWith("Recorded a test") ? null : current)),
        2400,
      );
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Could not send test");
    } finally {
      setTesting(false);
    }
  }

  return (
    <section
      className={`auto-hook${props.highlighted ? " highlight" : ""}`}
      data-testid="auto-hook"
    >
      <div className="auto-memory-head">
        <h3>Webhook</h3>
        <span className={`hint${funnel.public ? "" : " warn"}`}>{funnel.text}</span>
      </div>
      {!funnel.public ? (
        <div className="auto-funnel-wizard" data-testid="auto-funnel-wizard">
          <p className="hint">Reachability</p>
          <ol>
            <li>Install Tailscale on this machine.</li>
            <li>Enable Funnel / set a webhook base URL in Settings → Advanced.</li>
            <li>Copy the POST URL and secret below for callers.</li>
          </ol>
          <button
            type="button"
            className="btn small"
            onClick={() => openSettings(dispatch, "advanced")}
          >
            Open Funnel settings
          </button>
        </div>
      ) : null}
      {props.item.schedule.kind === "forge" || props.item.schedule.kind === "pull_request" ? (
        <div className="auto-forge-hook-help" data-testid="auto-forge-hook-help">
          <p className="hint">Forge webhook setup</p>
          <ol>
            <li>Attach a repo on this automation (required).</li>
            <li>Enable Funnel so the forge can reach this host.</li>
            <li>
              Add a forge webhook that POSTs to the URL below with the secret
              {props.item.schedule.kind === "pull_request"
                ? " (pull_request events)."
                : " (push events)."}
            </li>
          </ol>
          <button type="button" className="btn small" onClick={() => openSettings(dispatch, "git")}>
            Open Git settings
          </button>
          <p className="hint">
            Copy curl below for a smoke test; use{" "}
            {props.item.schedule.kind === "pull_request" ? "PR" : "push"} events in the forge UI.
          </p>
        </div>
      ) : null}
      <label className="auto-hook-row">
        <span className="hint">POST URL</span>
        <code>{url}</code>
      </label>
      <label className="auto-hook-row">
        <span className="hint">Secret</span>
        <code>{showSecret ? secret : "••••••••••••••••"}</code>
      </label>
      <div className="auto-hook-actions">
        <button className="btn small" type="button" onClick={() => void copy("url", url)}>
          <IconCopy /> {copied === "url" ? "Copied" : "Copy URL"}
        </button>
        <button className="btn small" type="button" onClick={() => void copy("secret", secret)}>
          <IconCopy /> {copied === "secret" ? "Copied" : "Copy secret"}
        </button>
        <button className="btn small" type="button" onClick={() => void copy("curl", curl)}>
          <IconCopy /> {copied === "curl" ? "Copied" : "Copy curl"}
        </button>
        <button className="btn small" type="button" onClick={() => setShowSecret((v) => !v)}>
          {showSecret ? "Hide secret" : "Reveal secret"}
        </button>
        <button
          className="btn small"
          type="button"
          disabled={testing}
          onClick={() => void sendTest()}
        >
          {testing ? "Recording…" : "Simulate trigger"}
        </button>
        <button
          className="btn small danger ghost"
          type="button"
          disabled={rotating}
          onClick={() => setConfirmRotate(true)}
        >
          {rotating ? "Rotating…" : "Rotate secret"}
        </button>
      </div>
      {confirmRotate ? (
        <ConfirmModal
          title="Rotate this secret?"
          body="Existing callers need the new value."
          confirmLabel="Rotate secret"
          danger
          testId="auto-rotate-confirm"
          onCancel={() => setConfirmRotate(false)}
          onConfirm={() => void rotate()}
        />
      ) : null}
      {testHint ? <p className="hint">{testHint}</p> : null}
      {testError ? <InlineError message={testError} /> : null}
      {rotateError ? <InlineError message={rotateError} /> : null}
      <p className="hint">
        Simulate trigger writes a test row in history. It does not POST the webhook or boot an
        agent. Use Copy curl for a real POST. Send <code>X-Locus-Secret</code> and{" "}
        <code>X-Locus-Timestamp</code>
        {props.item.schedule.kind === "webhook"
          ? ", or Slack signing headers."
          : ", or GitHub X-Hub-Signature-256."}{" "}
        Expose only <code>/api/hooks</code> with Tailscale Funnel.
      </p>
    </section>
  );
}

function ScheduleMiniEditor(props: {
  item: Automation;
  onSaved: (automation: Automation) => void;
}) {
  const schedule = props.item.schedule;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [everyMinutes, setEveryMinutes] = useState(
    schedule.kind === "interval" || schedule.kind === "adaptive" ? schedule.everyMinutes : 30,
  );
  const [otherwiseEveryMinutes, setOtherwiseEveryMinutes] = useState(
    schedule.kind === "adaptive" ? schedule.otherwiseEveryMinutes : 180,
  );
  const [weekday, setWeekday] = useState(schedule.kind === "weekly" ? schedule.weekday : 1);
  const [time, setTime] = useState(
    schedule.kind === "daily" || schedule.kind === "weekly"
      ? formatClockTime(schedule.hour, schedule.minute)
      : "09:00",
  );
  const [windowStart, setWindowStart] = useState(
    schedule.kind === "adaptive"
      ? formatClockTime(schedule.startHour, schedule.startMinute)
      : "09:00",
  );
  const [windowEnd, setWindowEnd] = useState(
    schedule.kind === "adaptive" ? formatClockTime(schedule.endHour, schedule.endMinute) : "17:00",
  );
  const [cronExpr, setCronExpr] = useState(schedule.kind === "cron" ? schedule.expr : "0 9 * * *");
  const [weekdays, setWeekdays] = useState<number[]>(
    schedule.kind === "adaptive" ? [...(schedule.weekdays ?? [])] : [],
  );

  function applyFrom(next: AutomationSchedule) {
    setEveryMinutes(next.kind === "interval" || next.kind === "adaptive" ? next.everyMinutes : 30);
    setOtherwiseEveryMinutes(next.kind === "adaptive" ? next.otherwiseEveryMinutes : 180);
    setWeekday(next.kind === "weekly" ? next.weekday : 1);
    setTime(
      next.kind === "daily" || next.kind === "weekly"
        ? formatClockTime(next.hour, next.minute)
        : "09:00",
    );
    setWindowStart(
      next.kind === "adaptive" ? formatClockTime(next.startHour, next.startMinute) : "09:00",
    );
    setWindowEnd(
      next.kind === "adaptive" ? formatClockTime(next.endHour, next.endMinute) : "17:00",
    );
    setCronExpr(next.kind === "cron" ? next.expr : "0 9 * * *");
    setWeekdays(next.kind === "adaptive" ? [...(next.weekdays ?? [])] : []);
  }

  useEffect(() => {
    setEditing(false);
    setError(null);
    applyFrom(schedule);
  }, [props.item.id, schedule]);

  function draftSchedule(): AutomationSchedule {
    return buildAutomationSchedule({
      kind: schedule.kind,
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

  function resetDraft() {
    applyFrom(schedule);
    setError(null);
    setEditing(false);
  }

  let nextPreview: string | null = null;
  try {
    const draft = draftSchedule();
    if (!validateSchedule(draft)) {
      const nextAt = computeNextRunAt(
        draft,
        new Date(),
        automationScheduleOpts(props.item),
      ).toISOString();
      const label = formatNextFire({ enabled: true, schedule: draft, nextRunAt: nextAt });
      if (label && label !== "On webhook") nextPreview = formatWhen(label);
    }
  } catch {
    nextPreview = null;
  }

  return (
    <section className="auto-schedule-edit" data-testid="auto-schedule-edit">
      <div className="auto-memory-head">
        <h3>When</h3>
        {!editing ? (
          <button className="btn small" type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
      </div>
      <p className="hint">{formatSchedule(schedule)}</p>
      {editing ? (
        <>
          {schedule.kind === "interval" ? (
            <label className="auto-schedule-field">
              <span className="hint">Every minutes</span>
              <input
                type="number"
                min={1}
                value={everyMinutes}
                disabled={busy}
                onChange={(e) => setEveryMinutes(Number(e.target.value))}
              />
            </label>
          ) : null}
          {schedule.kind === "daily" ? (
            <label className="auto-schedule-field">
              <span className="hint">Time</span>
              <input
                type="time"
                value={time}
                disabled={busy}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          ) : null}
          {schedule.kind === "weekly" ? (
            <div className="auto-schedule-fields">
              <label className="auto-schedule-field">
                <span className="hint">Weekday</span>
                <Select
                  compact
                  ariaLabel="Weekday"
                  value={String(weekday)}
                  disabled={busy}
                  options={SCHEDULE_WEEKDAYS.map((day, i) => ({
                    value: String(i),
                    label: day,
                  }))}
                  onChange={(value) => setWeekday(Number(value))}
                />
              </label>
              <label className="auto-schedule-field">
                <span className="hint">Time</span>
                <input
                  type="time"
                  value={time}
                  disabled={busy}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>
            </div>
          ) : null}
          {schedule.kind === "cron" ? (
            <label className="auto-schedule-field">
              <span className="hint">Expression</span>
              <input
                value={cronExpr}
                disabled={busy}
                onChange={(e) => setCronExpr(e.target.value)}
                placeholder="0 9 * * *"
              />
            </label>
          ) : null}
          {schedule.kind === "adaptive" ? (
            <>
              <div className="auto-schedule-fields">
                <label className="auto-schedule-field">
                  <span className="hint">From</span>
                  <input
                    type="time"
                    value={windowStart}
                    disabled={busy}
                    onChange={(e) => setWindowStart(e.target.value)}
                  />
                </label>
                <label className="auto-schedule-field">
                  <span className="hint">To</span>
                  <input
                    type="time"
                    value={windowEnd}
                    disabled={busy}
                    onChange={(e) => setWindowEnd(e.target.value)}
                  />
                </label>
              </div>
              <div className="auto-schedule-fields">
                <label className="auto-schedule-field">
                  <span className="hint">Minutes during window</span>
                  <input
                    type="number"
                    min={1}
                    value={everyMinutes}
                    disabled={busy}
                    onChange={(e) => setEveryMinutes(Number(e.target.value))}
                  />
                </label>
                <label className="auto-schedule-field">
                  <span className="hint">Minutes otherwise</span>
                  <input
                    type="number"
                    min={1}
                    value={otherwiseEveryMinutes}
                    disabled={busy}
                    onChange={(e) => setOtherwiseEveryMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="auto-schedule-fields" role="group" aria-label="Weekdays">
                {SCHEDULE_WEEKDAYS.map((day, index) => (
                  <label key={day} className="hint check">
                    <input
                      type="checkbox"
                      checked={!weekdays.length || weekdays.includes(index)}
                      disabled={busy}
                      onChange={(e) => {
                        const current = weekdays.length
                          ? weekdays
                          : SCHEDULE_WEEKDAYS.map((_, i) => i);
                        setWeekdays(
                          e.target.checked
                            ? [...current, index]
                            : current.filter((value) => value !== index),
                        );
                      }}
                    />
                    {day.slice(0, 3)}
                  </label>
                ))}
              </div>
              <p className="hint">Checked days are the only days this window fires.</p>
            </>
          ) : null}
          {nextPreview ? (
            <p className="hint" data-testid="auto-schedule-next">
              Next fire ≈ {nextPreview}
            </p>
          ) : null}
          <div className="auto-memory-actions">
            <button
              className="btn small primary"
              type="button"
              disabled={busy}
              onClick={() => {
                const next = draftSchedule();
                const invalid = validateSchedule(next);
                if (invalid) {
                  setError(invalid);
                  return;
                }
                setBusy(true);
                setError(null);
                void api
                  .patchAutomation(props.item.id, { schedule: next })
                  .then((automation) => {
                    props.onSaved(automation);
                    setEditing(false);
                  })
                  .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : "Could not save schedule");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </button>
            <button className="btn small" type="button" disabled={busy} onClick={resetDraft}>
              Cancel
            </button>
          </div>
        </>
      ) : null}
      {error ? <InlineError message={error} /> : null}
    </section>
  );
}

function JobOptions(props: { item: Automation; onSaved: (automation: Automation) => void }) {
  const { state } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zone, setZone] = useState(props.item.timeZone ?? "");
  const [blackout, setBlackout] = useState((props.item.blackoutDates ?? []).join(", "));
  const notify = props.item.notify ?? { success: true, failure: true, needsYou: true };
  const clock = isClockSchedule(props.item.schedule);

  useEffect(() => {
    setZone(props.item.timeZone ?? "");
    setBlackout((props.item.blackoutDates ?? []).join(", "));
    setError(null);
  }, [props.item.id, props.item.timeZone, props.item.blackoutDates]);

  async function patch(input: PatchAutomationInput) {
    setBusy(true);
    setError(null);
    try {
      props.onSaved(await api.patchAutomation(props.item.id, input));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auto-prompt" data-testid="auto-job-options">
      <div className="auto-memory-head">
        <h3>Job</h3>
      </div>
      <ModelPicker
        compact
        providers={state.config?.providers ?? []}
        providerId={props.item.providerId}
        model={props.item.model}
        disabled={busy}
        onChange={(next) => {
          if (next.providerId === props.item.providerId && next.model === props.item.model) return;
          void patch({ providerId: next.providerId, model: next.model });
        }}
      />
      <div className="auto-schedule-fields">
        <label className="auto-schedule-field">
          <span className="hint">Overlap</span>
          <Select
            compact
            ariaLabel="Overlap"
            value={props.item.overlap ?? "skip"}
            disabled={busy}
            options={OVERLAP_SELECT_OPTIONS}
            onChange={(overlap) => {
              void patch({ overlap: overlap as "skip" | "coalesce" | "queue" });
            }}
          />
        </label>
        {clock ? (
          <label className="auto-schedule-field">
            <span className="hint">Timezone</span>
            <input
              aria-label="Timezone"
              value={zone}
              disabled={busy}
              placeholder="America/Los_Angeles"
              onChange={(e) => setZone(e.target.value)}
              onBlur={() => {
                const next = zone.trim();
                if (next === (props.item.timeZone ?? "")) return;
                try {
                  void patch({ timeZone: next ? (normalizeTimeZone(next) ?? null) : null });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Unknown timezone");
                }
              }}
            />
          </label>
        ) : null}
      </div>
      <p className="hint">
        Skip drops a fire while a run is in progress. Run latest keeps the newest event and starts
        it when the current run finishes. Queue one shows that waiting run.
      </p>
      <label className="auto-schedule-field">
        <span className="hint">Blackout dates</span>
        <input
          aria-label="Blackout dates"
          value={blackout}
          disabled={busy}
          placeholder="2026-12-25, 2026-01-01"
          onChange={(e) => setBlackout(e.target.value)}
          onBlur={() => {
            const dates = blackout
              .split(/[\s,]+/)
              .map((row) => row.trim())
              .filter(Boolean);
            const current = (props.item.blackoutDates ?? []).join(",");
            if (dates.join(",") === current) return;
            try {
              void patch({ blackoutDates: normalizeBlackoutDates(dates) ?? null });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Blackout dates must be YYYY-MM-DD");
            }
          }}
        />
      </label>
      <div className="auto-schedule-fields" role="group" aria-label="Notify">
        {(
          [
            ["success", "Success"],
            ["failure", "Failure"],
            ["needsYou", "Needs you"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="hint check">
            <input
              type="checkbox"
              checked={notify[key]}
              disabled={busy}
              onChange={(e) => {
                void patch({ notify: { ...notify, [key]: e.target.checked } });
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="hint">
        These replace the global failed-only switch for this job. Slack still uses the notify
        webhook and channel in Settings.
      </p>
      {error ? <InlineError message={error} /> : null}
    </section>
  );
}

function RunHistory(props: {
  item: Automation;
  runs: AutomationRun[];
  filter: RunHistoryFilter;
  onFilterChange: (filter: RunHistoryFilter) => void;
  onOpenChat: (run: AutomationRun) => void;
  onRunNow: () => void;
  onReplay: (run: AutomationRun) => void;
  onStop: (run: AutomationRun) => void;
  runBusy: boolean;
}) {
  const { state, dispatch } = useStore();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visible, setVisible] = useState(RUN_HISTORY_PAGE);
  const [fetchLimit, setFetchLimit] = useState(RUN_HISTORY_FETCH);
  const [serverExhausted, setServerExhausted] = useState(false);
  const ordered = [...props.runs].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
  );
  const filtered = ordered.filter((run) => runMatchesHistoryFilter(run, props.filter));
  const shown = filtered.slice(0, visible);
  const exhausted = serverExhausted || ordered.length < fetchLimit;
  const canLoadMore = filtered.length > visible || (!exhausted && filtered.length >= visible);
  const filters: { value: RunHistoryFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "running", label: "Running" },
    { value: "succeeded", label: "Succeeded" },
    { value: "failed", label: "Failed" },
    { value: "needs_you", label: "Needs you" },
    { value: "skipped", label: "Skipped" },
    { value: "test", label: "Test" },
  ];
  const isWebhookSchedule =
    props.item.schedule.kind === "forge" ||
    props.item.schedule.kind === "pull_request" ||
    props.item.schedule.kind === "webhook";

  useEffect(() => {
    setVisible(RUN_HISTORY_PAGE);
    setLoadError(null);
    setFetchLimit(RUN_HISTORY_FETCH);
    setServerExhausted(false);
  }, [props.item.id, props.filter]);

  return (
    <section className="auto-runs">
      <div className="auto-runs-head">
        <h3 className="auto-runs-title">Runs</h3>
        {props.runs.length ? (
          <div className="run-filters" role="tablist" aria-label="Filter runs">
            {filters.map((row) => (
              <button
                key={row.value}
                type="button"
                role="tab"
                aria-selected={props.filter === row.value}
                className={`btn small${props.filter === row.value ? " primary" : " ghost"}`}
                onClick={() => props.onFilterChange(row.value)}
              >
                {row.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {loadError ? <p className="error run-history-error">{loadError}</p> : null}
      {props.runs.length === 0 ? (
        <div className="auto-runs-empty" data-testid="auto-runs-empty-cta">
          <p className="hint">
            No runs yet. Wait for the schedule, or start one now
            {isWebhookSchedule ? ", or POST the webhook." : "."}
          </p>
          {isWebhookSchedule ? (
            <p className="hint">Use the Webhook card to copy the URL or simulate a trigger.</p>
          ) : null}
          <button
            type="button"
            className="btn small primary"
            disabled={!props.item.enabled || props.runBusy}
            title={props.item.enabled ? "Start a new manual run" : "Paused"}
            onClick={props.onRunNow}
          >
            <IconPlay /> {props.runBusy ? "Starting…" : "Run now"}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyHint title="No runs match this filter." />
      ) : (
        <>
          <table className="run-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Trigger</th>
                <th>Why</th>
                <th>Duration</th>
                <th>Spend</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((run) => {
                const session = state.sessions.find((s) => s.id === run.sessionId);
                const outcome = runOutcomeLabel(run, session);
                const statusLabel = runHistoryStatusLabel(run);
                const live = run.status === "running" || run.status === "queued";
                return (
                  <tr key={run.id}>
                    <td>
                      <span className={`status-chip ${statusLabel}`}>{runStatusText(run)}</span>
                      {outcome ? (
                        <div
                          className={
                            run.status === "failed" || run.status === "skipped"
                              ? "run-error"
                              : "run-outcome"
                          }
                        >
                          {run.status === "failed" || run.status === "skipped" ? (
                            <ExpandableLog compact danger text={outcome} />
                          ) : (
                            <p className="hint">{outcome}</p>
                          )}
                        </div>
                      ) : null}
                    </td>
                    <td>{run.trigger}</td>
                    <td>{run.reason ?? "—"}</td>
                    <td>{formatRunDuration(run.startedAt, run.finishedAt) ?? "—"}</td>
                    <td>{runSpendLabel(run, props.item, session, state.config ?? undefined)}</td>
                    <td>{formatWhen(run.startedAt)}</td>
                    <td>
                      {live || run.sessionId ? (
                        <div className="run-actions">
                          {run.sessionId ? (
                            <button
                              className="btn small ghost"
                              onClick={() => props.onOpenChat(run)}
                            >
                              View chat
                            </button>
                          ) : null}
                          {live ? (
                            <button
                              className="btn small danger ghost"
                              onClick={() => props.onStop(run)}
                            >
                              <IconStop /> Stop
                            </button>
                          ) : (
                            <button
                              className="btn small ghost"
                              disabled={!props.item.enabled || props.runBusy}
                              title={props.item.enabled ? "Start a new manual run" : "Paused"}
                              onClick={() => props.onReplay(run)}
                            >
                              <IconPlay /> {props.runBusy ? "Starting…" : "Run again"}
                            </button>
                          )}
                          {session ? <TrustActions compact session={session} /> : null}
                        </div>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {canLoadMore ? (
            <button
              type="button"
              className="btn small auto-runs-load-more"
              data-testid="auto-runs-load-more"
              onClick={() => {
                const next = visible + RUN_HISTORY_PAGE;
                setVisible(next);
                if (filtered.length > next || serverExhausted) return;
                const nextLimit = Math.max(next + RUN_HISTORY_PAGE, fetchLimit + RUN_HISTORY_FETCH);
                void api
                  .automationRuns(props.item.id, { limit: nextLimit })
                  .then((rows) => {
                    for (const run of rows) dispatch({ type: "run", run });
                    setFetchLimit(nextLimit);
                    setServerExhausted(rows.length < nextLimit);
                  })
                  .catch((err: unknown) => {
                    setLoadError(err instanceof Error ? err.message : "Could not load more runs");
                  });
              }}
            >
              Load more
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function AutomationMemoryEditor(props: {
  item: Automation;
  lastFact?: string;
  onSaved: (automation: Automation) => void;
}) {
  const memories = props.item.memories ?? [];
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atCap = memories.length >= MAX_MEMORIES;

  async function persist(next: RepoMemory[], persistMemory?: boolean) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchAutomation(props.item.id, {
        memories: next,
        ...(persistMemory !== undefined ? { persistMemory } : {}),
      });
      props.onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function addFact() {
    const result = applyRemember(
      memories,
      { action: "add", text: draft },
      { id: newMemoryId(), createdAt: new Date().toISOString() },
    );
    if (!result.output.startsWith("Saved")) {
      setError(result.output);
      return;
    }
    setDraft("");
    await persist(result.memories);
  }

  async function saveEdit() {
    if (!editingId) return;
    const result = replaceMemoryText(memories, editingId, editText);
    if (!result.output.startsWith("Updated")) {
      setError(result.output);
      return;
    }
    setEditingId(null);
    setEditText("");
    await persist(result.memories);
  }

  async function removeFact(id: string) {
    const result = applyRemember(memories, { action: "forget", id });
    if (!result.output.startsWith("Forgot")) {
      setError(result.output);
      return;
    }
    if (editingId === id) {
      setEditingId(null);
      setEditText("");
    }
    await persist(result.memories);
  }

  if (!props.item.persistMemory && memories.length === 0) {
    return (
      <section className="auto-memory collapsed" data-testid="auto-memory">
        <div className="auto-memory-head">
          <h3>Memory</h3>
          <span className="hint">Off</span>
        </div>
        <button
          className="btn small"
          type="button"
          disabled={busy}
          onClick={() => void persist(memories, true)}
        >
          Enable memory
        </button>
        {error ? <InlineError message={error} /> : null}
      </section>
    );
  }

  return (
    <section className="auto-memory" data-testid="auto-memory">
      <div className="auto-memory-head">
        <h3>Memory</h3>
        <div className="auto-memory-actions">
          <span className="hint">
            {memories.length}/{MAX_MEMORIES}
            {props.lastFact ? ` · last ${clipFact(props.lastFact, 48)}` : ""}
          </span>
          {props.item.persistMemory ? (
            <button
              className="btn small"
              type="button"
              disabled={busy}
              onClick={() => void persist(memories, false)}
            >
              Turn off
            </button>
          ) : null}
        </div>
      </div>
      {props.item.persistMemory ? (
        <p className="hint">
          Later runs see these facts, even when Reuse is off. The agent can also call{" "}
          <code>remember</code>. Do not store secrets.
        </p>
      ) : (
        <p className="hint">
          Memory is off, so later runs will not see these facts until you enable it.
        </p>
      )}
      {!props.item.persistMemory ? (
        <button
          className="btn small"
          type="button"
          disabled={busy}
          onClick={() => void persist(memories, true)}
        >
          Enable memory
        </button>
      ) : null}
      {memories.length === 0 ? (
        <p className="hint" data-testid="auto-memory-empty">
          No saved facts yet.
        </p>
      ) : (
        <ul className="auto-memory-list">
          {memories.map((row) => (
            <li key={row.id} className="auto-memory-item">
              {editingId === row.id ? (
                <>
                  <textarea
                    aria-label="Edit fact"
                    rows={3}
                    maxLength={MAX_MEMORY_CHARS}
                    value={editText}
                    disabled={busy}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="auto-memory-actions">
                    <button
                      className="btn small primary"
                      type="button"
                      disabled={busy || !editText.trim()}
                      onClick={() => void saveEdit()}
                    >
                      Save
                    </button>
                    <button
                      className="btn small"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setEditText("");
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="auto-memory-text">{row.text}</p>
                  <div className="auto-memory-meta">
                    <time className="hint">{formatWhen(row.createdAt)}</time>
                    {row.runId ? <span className="hint">run {row.runId.slice(0, 8)}</span> : null}
                    <div className="auto-memory-actions">
                      <button
                        className="btn small"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(row.id);
                          setEditText(row.text);
                          setError(null);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn small danger ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void removeFact(row.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="auto-memory-add">
        <span className="hint">Add a fact</span>
        <textarea
          rows={2}
          maxLength={MAX_MEMORY_CHARS}
          placeholder="Short durable fact for later runs"
          value={draft}
          disabled={busy || atCap}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <div className="auto-memory-actions">
        <button
          className="btn small primary"
          type="button"
          disabled={busy || atCap || !draft.trim()}
          onClick={() => void addFact()}
        >
          Add fact
        </button>
        {atCap ? <span className="hint">Memory is full. Remove a fact to add another.</span> : null}
      </div>
      {error ? <InlineError message={error} /> : null}
    </section>
  );
}
