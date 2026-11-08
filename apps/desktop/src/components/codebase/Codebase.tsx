import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  diffStats,
  fileDiffStats,
  findBoundAgent,
  forgeLabel,
  forgesWithTokens,
  isDraftPull,
  isIdeSession,
  isOpenInboxPull,
  parseRepoUrl,
  parseIssueListState,
  parsePullListState,
  shortLoadPath,
  shortRepoName,
  formatRemoteError,
  isForgeAuthError,
  LOAD_PATH_TRACE_LIMIT,
  visibleReviewAssistantText,
  parseDiffLayout,
  brainClaimsForRepo,
  buildPreMergeBoard,
  type ChatMessage,
  type ForgeImportAccount,
  type ForgeRepoHint,
  type LinkedRepo,
  type LoadPathLayer,
  type LoadPathReview,
  type ChangeStack,
  type ChangeStackRevision,
  type PatchFile,
  type IssueDetail,
  type IssueListState,
  type IssueRef,
  type PullCheck,
  type PullListState,
  type PullRequestDetail,
  type PullRequestRef,
  type CloneProgress,
  type AgentSession,
} from "@locus/shared";
import { api } from "@/lib/api";
import { askConfirm } from "@/lib/dialog";
import { CloneProgressCard } from "@/components/chat/CloneProgressCard";
import { peekPullDetail, peekPullList } from "@/lib/pullCache";
import { peekIssueDetail, peekIssueList } from "@/lib/issueCache";
import { formatMarkdown } from "@/lib/markdown";
import { loadLastAgent, resolveAgentDefaults, saveLastAgent } from "@/lib/lastAgent";
import { openSettings, useStore } from "@/state/store";
import { firstHunkLine, prCommentMarks, requestWorkspaceOpenPr } from "@/lib/workspaceOpenPr";
import {
  buildWorkspaceTree,
  countWorkspaceTreeNodes,
  filterWorkspaceTree,
  WORKSPACE_FILTER_MAX_NODES,
  type WorkspaceTreeNode,
} from "@/lib/workspaceTree";
import { PatchCard, patchFilesFromPull, type DiffLineRef } from "@/components/chat/PatchCard";
import { ArchitecturePane } from "./ArchitecturePane";
import { ChangeStackPanel } from "./ChangeStackPanel";
import { PullSummaryCell, PullTable } from "./PullTable";
import { IconCompress, IconExpand, IconMore } from "@/components/layout/Icons";
import { EmptyHero, EmptyHint } from "@/components/layout/EmptyHero";
import { Splitter } from "@/components/layout/Splitter";
import { stepSplitValue } from "@/lib/splitter";
import { BusyButton, ErrorBanner as ErrorBannerView, Skeleton } from "@/components/layout/Skeleton";
import { Tooltip } from "@/components/layout/Tooltip";
import { ImportAccounts } from "@/components/settings/ImportAccounts";
import { SearchField } from "@/components/layout/SearchField";
import { MenuItem, MenuSep, OverflowMenu } from "@/components/layout/OverflowMenu";
import { Select } from "@/components/layout/Select";

type RepoTab =
  "overview" | "architecture" | "pulls" | "issues" | "agents" | "automations" | "settings";
type PullTab = "overview" | "stack" | "conversation" | "commits" | "checks" | "files";

const PR_LIST_WIDTH_KEY = "locus.prInboxListWidth";
const ISSUE_LIST_WIDTH_KEY = "locus.issueInboxListWidth";
const PR_LIST_MIN = 240;
const PR_LIST_MAX = 560;
const PR_LIST_DEFAULT = 340;

function loadPrListWidth(): number {
  try {
    const raw = localStorage.getItem(PR_LIST_WIDTH_KEY);
    if (raw == null || raw.trim() === "") return PR_LIST_DEFAULT;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.min(PR_LIST_MAX, Math.max(PR_LIST_MIN, Math.round(n)));
  } catch {
    /* ignore */
  }
  return PR_LIST_DEFAULT;
}

function savePrListWidth(width: number) {
  try {
    localStorage.setItem(PR_LIST_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

function loadIssueListWidth(): number {
  try {
    const raw = localStorage.getItem(ISSUE_LIST_WIDTH_KEY);
    if (raw == null || raw.trim() === "") return PR_LIST_DEFAULT;
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.min(PR_LIST_MAX, Math.max(PR_LIST_MIN, Math.round(n)));
  } catch {
    /* ignore */
  }
  return PR_LIST_DEFAULT;
}

function saveIssueListWidth(width: number) {
  try {
    localStorage.setItem(ISSUE_LIST_WIDTH_KEY, String(width));
  } catch {
    /* ignore */
  }
}

export function formatAgo(iso?: string, compact = false): string {
  if (!iso) return compact ? "—" : "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return compact ? "—" : "never";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 45) return compact ? "now" : "just now";
  if (sec < 3600) {
    const value = `${Math.max(1, Math.floor(sec / 60))}m`;
    return compact ? value : `${value} ago`;
  }
  if (sec < 86400) {
    const value = `${Math.floor(sec / 3600)}h`;
    return compact ? value : `${value} ago`;
  }
  if (sec < 86400 * 7) {
    const value = `${Math.floor(sec / 86400)}d`;
    return compact ? value : `${value} ago`;
  }
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pullChip(row: { state: string; draft?: boolean }): { label: string; tone: string } {
  if (isDraftPull(row)) return { label: "draft", tone: "draft" };
  return { label: row.state, tone: row.state };
}

function checkFraction(checks: PullCheck[]): string {
  if (!checks.length) return "—";
  const ok = checks.filter((row) => row.status === "success").length;
  return `${ok}/${checks.length}`;
}

function latestAssistantText(messages: ChatMessage[] | undefined): string | undefined {
  const last = [...(messages ?? [])]
    .reverse()
    .find((row) => row.role === "assistant" && row.content.trim());
  const text = last ? visibleReviewAssistantText(last.content).trim() : "";
  return text || undefined;
}

function checkTone(status: PullCheck["status"]): "ok" | "bad" | "busy" | "muted" {
  if (status === "success") return "ok";
  if (status === "failure" || status === "error") return "bad";
  if (status === "in_progress" || status === "queued") return "busy";
  return "muted";
}

function Markdown({ text }: { text: string }) {
  return <div className="pr-md" dangerouslySetInnerHTML={{ __html: formatMarkdown(text) }} />;
}

function jumpToFile(path: string) {
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(path)
      : path.replace(/"/g, '\\"');
  const node = document.querySelector(`[data-patch-path="${escaped}"]`);
  node?.scrollIntoView?.({ block: "start", behavior: "smooth" });
}

const IDE_CLONE_WAIT = "The IDE opens when this clone finishes.";
const PR_CLONE_WAIT = "This pull request opens in the IDE when the clone finishes.";

type IdeOpen = { label: string; cloning: boolean; waitHint: string };

function ideSessionFor(sessions: AgentSession[], repoId: string | undefined) {
  if (!repoId) return undefined;
  return sessions.find((row) => isIdeSession(row) && row.repoId === repoId && !row.archived);
}

function IdeOpenBanner({ open, progress }: { open: IdeOpen; progress?: CloneProgress }) {
  const live = open.cloning ? (progress ?? { percent: 0, phase: "Starting" }) : undefined;
  if (live) {
    return (
      <div className="pr-ide-opening" data-testid="pr-ide-opening" data-cloning="true">
        <CloneProgressCard progress={live} title={open.label} waitHint={open.waitHint} />
      </div>
    );
  }
  return (
    <div
      className="pr-ide-opening notice-row"
      data-testid="pr-ide-opening"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="notice-dot" aria-hidden="true" />
      <p>{open.label}</p>
    </div>
  );
}

function ErrorBanner({ error }: { error: string }) {
  const { dispatch } = useStore();
  const message = formatRemoteError(error);
  const auth = isForgeAuthError(message);
  return (
    <ErrorBannerView
      message={message}
      action={
        auth ? (
          <button type="button" className="btn small" onClick={() => openSettings(dispatch, "git")}>
            Open Git settings
          </button>
        ) : null
      }
    />
  );
}

export function CodebasePane() {
  const { state, dispatch } = useStore();
  const repo = state.repos.find((row) => row.id === state.selectedRepoId);
  const [tab, setTab] = useState<RepoTab>("overview");
  const [prTab, setPrTab] = useState<PullTab>("overview");
  const [jumpPath, setJumpPath] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkAccountId, setLinkAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ideOpen, setIdeOpen] = useState<IdeOpen | null>(null);
  const ideOpenLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [brainBusy, setBrainBusy] = useState(false);
  const [brainNote, setBrainNote] = useState<string | null>(null);
  const [pullLoadError, setPullLoadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [accounts, setAccounts] = useState<ForgeImportAccount[] | null>(null);
  const [pulls, setPulls] = useState<PullRequestRef[]>([]);
  const [pullsLoading, setPullsLoading] = useState(false);
  const [pullState, setPullState] = useState<PullListState>("open");
  const [issues, setIssues] = useState<IssueRef[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issueState, setIssueState] = useState<IssueListState>("open");
  const [issueLoadError, setIssueLoadError] = useState<string | null>(null);
  const [issueCommentBody, setIssueCommentBody] = useState("");
  const [listWidth, setListWidth] = useState(loadPrListWidth);
  const [issueListWidth, setIssueListWidth] = useState(loadIssueListWidth);
  const [prFocus, setPrFocus] = useState(false);
  const [issueFocus, setIssueFocus] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentPath, setCommentPath] = useState("");
  const [commentLine, setCommentLine] = useState("");
  const [commentSide, setCommentSide] = useState<"" | "LEFT" | "RIGHT">("");
  const [reviewBody, setReviewBody] = useState("");
  const [reviewEvent, setReviewEvent] = useState<"COMMENT" | "APPROVE" | "REQUEST_CHANGES">(
    "COMMENT",
  );
  const [loadPath, setLoadPath] = useState<LoadPathReview | null>(null);
  const [loadPathNotes, setLoadPathNotes] = useState("");
  const [changeStack, setChangeStack] = useState<ChangeStack | null>(null);
  const [stackRevisions, setStackRevisions] = useState<ChangeStackRevision[]>([]);
  const [stackViewSha, setStackViewSha] = useState<string>("");
  const [stackSummarizing, setStackSummarizing] = useState(false);
  const summarizedHead = useRef<string | null>(null);
  const [name, setName] = useState(repo?.name ?? "");
  const [ref, setRef] = useState(repo?.checkout.ref ?? "");
  const [accountId, setAccountId] = useState(repo?.checkout.accountId ?? "");
  const [dockerImage, setDockerImage] = useState(repo?.dockerImage ?? "");
  const [autoReview, setAutoReview] = useState(repo?.autoReview === true);
  const [reviewPrompt, setReviewPrompt] = useState(repo?.reviewPrompt ?? "");
  const pull =
    state.activePull &&
    state.activePull.repoId === repo?.id &&
    state.activePull.number === state.selectedPullNumber
      ? state.activePull
      : undefined;
  const issue =
    state.activeIssue &&
    state.activeIssue.repoId === repo?.id &&
    state.activeIssue.number === state.selectedIssueNumber
      ? state.activeIssue
      : undefined;

  const tokened = forgesWithTokens(state.config?.forges ?? []);
  const agents = useMemo(
    () => state.sessions.filter((session) => session.repoId === repo?.id && !session.archived),
    [state.sessions, repo?.id],
  );
  const bound = repo ? findBoundAgent(state.sessions, { repoId: repo.id }) : undefined;
  const automations = useMemo(
    () => state.automations.filter((item) => item.repoId === repo?.id),
    [state.automations, repo?.id],
  );
  const pullFiles = useMemo(() => (pull ? patchFilesFromPull(pull.files) : []), [pull]);
  const pullDiff = useMemo(() => diffStats(pullFiles), [pullFiles]);
  const agentSummary = useMemo(() => {
    if (!repo || !state.selectedPullNumber) return undefined;
    const review = agents
      .filter(
        (session) => session.kind === "review" && session.pull?.number === state.selectedPullNumber,
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return latestAssistantText(review?.messages);
  }, [agents, repo, state.selectedPullNumber]);
  const selectedLine: DiffLineRef | null =
    commentPath && commentLine
      ? {
          path: commentPath,
          line: Number(commentLine),
          side: commentSide === "LEFT" ? "LEFT" : "RIGHT",
        }
      : null;

  useEffect(() => {
    setTab(state.selectedPullNumber ? "pulls" : state.selectedIssueNumber ? "issues" : "overview");
    setPrTab("overview");
    setJumpPath(null);
    setError(null);
    setPullLoadError(null);
    setIssueLoadError(null);
    setPrFocus(false);
    setIssueFocus(false);
    setCommentBody("");
    setIssueCommentBody("");
    setCommentPath("");
    setCommentLine("");
    setCommentSide("");
    setReviewBody("");
    setReviewEvent("COMMENT");
    if (!repo) return;
    setName(repo.name);
    setRef(repo.checkout.ref ?? "");
    setAccountId(repo.checkout.accountId ?? "");
    setDockerImage(repo.dockerImage ?? "");
    setAutoReview(repo.autoReview === true);
    setReviewPrompt(repo.reviewPrompt ?? "");
  }, [repo?.id]);

  useEffect(() => {
    setCommentBody("");
    setCommentPath("");
    setCommentLine("");
    setCommentSide("");
    setReviewBody("");
    setReviewEvent("COMMENT");
    setLoadPath(null);
    setLoadPathNotes("");
    setChangeStack(null);
    setStackRevisions([]);
    setStackViewSha("");
    summarizedHead.current = null;
    setJumpPath(null);
    if (state.selectedPullNumber) setTab("pulls");
  }, [state.selectedPullNumber]);

  useEffect(() => {
    setIssueCommentBody("");
    if (state.selectedIssueNumber) setTab("issues");
  }, [state.selectedIssueNumber]);

  useEffect(() => {
    savePrListWidth(listWidth);
  }, [listWidth]);

  useEffect(() => {
    saveIssueListWidth(issueListWidth);
  }, [issueListWidth]);

  useEffect(() => {
    if (!prFocus) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPrFocus(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prFocus]);

  useEffect(() => {
    if (!issueFocus) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setIssueFocus(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issueFocus]);

  useEffect(() => {
    if (!repo) {
      setPulls([]);
      setPullsLoading(false);
      return;
    }
    const cached = peekPullList(repo.id, pullState);
    if (cached) {
      setPulls(cached.rows);
      setPullsLoading(false);
      if (cached.fresh) return;
    } else {
      setPullsLoading(true);
    }
    let cancelled = false;
    void api
      .repoPulls(repo.id, pullState)
      .then((rows) => {
        if (!cancelled) setPulls(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load pull requests");
      })
      .finally(() => {
        if (!cancelled) setPullsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, pullState]);

  useEffect(() => {
    if (!repo) {
      setIssues([]);
      setIssuesLoading(false);
      return;
    }
    if (tab !== "issues") return;
    const cached = peekIssueList(repo.id, issueState);
    if (cached) {
      setIssues(cached.rows);
      setIssuesLoading(false);
      if (cached.fresh) return;
    } else {
      setIssuesLoading(true);
    }
    let cancelled = false;
    void api
      .repoIssues(repo.id, issueState)
      .then((rows) => {
        if (!cancelled) setIssues(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load issues");
      })
      .finally(() => {
        if (!cancelled) setIssuesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, issueState, tab]);

  useEffect(() => {
    if (prTab !== "files" || !jumpPath) return;
    const path = jumpPath;
    const id = requestAnimationFrame(() => {
      jumpToFile(path);
      setJumpPath(null);
    });
    return () => cancelAnimationFrame(id);
  }, [prTab, jumpPath]);

  useEffect(() => {
    if (tab !== "pulls" || !pulls.length) return;
    if (state.selectedPullNumber && pulls.some((row) => row.number === state.selectedPullNumber))
      return;
    dispatch({ type: "selectPull", number: pulls[0]!.number });
  }, [tab, pulls, state.selectedPullNumber, dispatch]);

  useEffect(() => {
    if (tab !== "issues" || !issues.length) return;
    if (state.selectedIssueNumber && issues.some((row) => row.number === state.selectedIssueNumber))
      return;
    dispatch({ type: "selectIssue", number: issues[0]!.number });
  }, [tab, issues, state.selectedIssueNumber, dispatch]);

  useEffect(() => {
    if (!repo || !state.selectedPullNumber) {
      dispatch({ type: "pull", pull: null });
      setPullLoadError(null);
      return;
    }
    const cached = peekPullDetail(repo.id, state.selectedPullNumber);
    if (cached) dispatch({ type: "pull", pull: cached.pull });
    if (cached?.fresh) {
      setPullLoadError(null);
      return;
    }
    let cancelled = false;
    setPullLoadError(null);
    void api
      .repoPull(repo.id, state.selectedPullNumber)
      .then((detail) => {
        if (!cancelled) dispatch({ type: "pull", pull: detail });
      })
      .catch((err) => {
        if (!cancelled)
          setPullLoadError(err instanceof Error ? err.message : "Could not load pull request");
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, state.selectedPullNumber, dispatch]);

  useEffect(() => {
    if (!repo || !state.selectedIssueNumber) {
      dispatch({ type: "issue", issue: null });
      setIssueLoadError(null);
      return;
    }
    const cached = peekIssueDetail(repo.id, state.selectedIssueNumber);
    if (cached) dispatch({ type: "issue", issue: cached.issue });
    if (cached?.fresh) {
      setIssueLoadError(null);
      return;
    }
    let cancelled = false;
    setIssueLoadError(null);
    void api
      .repoIssue(repo.id, state.selectedIssueNumber)
      .then((detail) => {
        if (!cancelled) dispatch({ type: "issue", issue: detail });
      })
      .catch((err) => {
        if (!cancelled)
          setIssueLoadError(err instanceof Error ? err.message : "Could not load issue");
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, state.selectedIssueNumber, dispatch]);

  useEffect(() => {
    if (!repo || !state.selectedPullNumber) {
      setLoadPath(null);
      setLoadPathNotes("");
      return;
    }
    let cancelled = false;
    void api
      .repoPullLoadPath(repo.id, state.selectedPullNumber)
      .then((review) => {
        if (cancelled) return;
        setLoadPath(review);
        setLoadPathNotes(review.notes ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setLoadPath(null);
          setLoadPathNotes("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, state.selectedPullNumber, pull?.files.length, pull?.headSha]);

  useEffect(() => {
    if (!repo || !state.selectedPullNumber) {
      setChangeStack(null);
      setStackRevisions([]);
      setStackViewSha("");
      return;
    }
    let cancelled = false;
    void api
      .repoPullChangeStack(repo.id, state.selectedPullNumber)
      .then((next) => {
        if (cancelled) return;
        setChangeStack(next);
        setStackViewSha(next.headSha);
      })
      .catch(() => {
        if (!cancelled) setChangeStack(null);
      });
    void api
      .listPullChangeStackRevisions(repo.id, state.selectedPullNumber)
      .then((next) => {
        if (!cancelled) setStackRevisions(next.revisions);
      })
      .catch(() => {
        if (!cancelled) setStackRevisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repo?.id, state.selectedPullNumber, pull?.files.length, pull?.headSha]);

  useEffect(() => {
    if (prTab !== "stack" || !repo || !state.selectedPullNumber || !changeStack) return;
    if (changeStack.source !== "heuristic") return;
    if (stackViewSha && pull?.headSha && stackViewSha !== pull.headSha) return;
    if (summarizedHead.current === changeStack.headSha) return;
    const sha = changeStack.headSha;
    const repoId = repo.id;
    const number = state.selectedPullNumber;
    let cancelled = false;
    setStackSummarizing(true);
    void api
      .summarizePullChangeStack(repoId, number)
      .then((next) => {
        if (cancelled) return;
        setChangeStack(next);
        setStackViewSha(next.headSha);
        return api.listPullChangeStackRevisions(repoId, number);
      })
      .then((next) => {
        if (!cancelled && next) setStackRevisions(next.revisions);
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        summarizedHead.current = sha;
        setStackSummarizing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prTab, repo, state.selectedPullNumber, changeStack, stackViewSha, pull?.headSha]);

  async function link() {
    setError(null);
    const parsed = parseRepoUrl(linkUrl);
    if (!parsed) {
      setError("Enter a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps URL");
      return;
    }
    setBusy(true);
    try {
      const created = await api.linkRepo({
        url: parsed.url,
        accountId: linkAccountId || undefined,
      });
      dispatch({ type: "repo", repo: created });
      dispatch({ type: "selectRepo", id: created.id });
      setLinkUrl("");
      setAccounts(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link repo");
    } finally {
      setBusy(false);
    }
  }

  async function importFromGit() {
    setError(null);
    setImporting(true);
    try {
      const next = await api.importRepos();
      setAccounts(next.accounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function linkPicked(hints: ForgeRepoHint[]) {
    if (!hints.length) return;
    setBusy(true);
    setError(null);
    try {
      let last: LinkedRepo | undefined;
      for (const hint of hints) {
        last = await api.linkRepo({
          url: hint.url,
          name: `${hint.owner}/${hint.name}`,
          accountId: hint.accountId,
        });
        dispatch({ type: "repo", repo: last });
      }
      if (last) dispatch({ type: "selectRepo", id: last.id });
      setAccounts(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link selected repos");
    } finally {
      setBusy(false);
    }
  }

  async function startAgent(reuse = false) {
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.startRepoAgent(repo.id, { startVm: true, reuse });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start agent");
    } finally {
      setBusy(false);
    }
  }

  function beginIdeOpen(initial: IdeOpen): boolean {
    if (ideOpenLock.current) return false;
    ideOpenLock.current = true;
    setBusy(true);
    setError(null);
    setIdeOpen(initial);
    return true;
  }

  function endIdeOpen() {
    ideOpenLock.current = false;
    setIdeOpen(null);
    setBusy(false);
  }

  async function ensureIdeSession() {
    if (!repo) return null;
    const existing = ideSessionFor(state.sessions, repo.id);
    if (existing) {
      dispatch({ type: "select", id: existing.id });
      return existing;
    }
    if (!state.config) {
      setError("Control plane is still loading");
      return null;
    }
    const defaults = resolveAgentDefaults(state.config, "ubuntu", loadLastAgent());
    const session = await api.createSession({
      title: shortRepoName(repo.checkout.url, repo.name),
      os: "ubuntu",
      templateId:
        defaults.templateId ||
        state.config.templates.find((row) => row.os === "ubuntu")?.id ||
        "host",
      kind: "ide",
      runtime: "host",
      providerId: defaults.providerId,
      model: defaults.model,
      startVm: false,
      vision: "off",
      repoId: repo.id,
    });
    saveLastAgent({
      os: "ubuntu",
      runtime: "host",
      providerId: defaults.providerId,
      model: defaults.model,
    });
    dispatch({ type: "session", session });
    dispatch({ type: "select", id: session.id });
    return session;
  }

  async function openInIde() {
    if (!repo) return;
    const existing = ideSessionFor(state.sessions, repo.id);
    if (
      !beginIdeOpen(
        existing
          ? { label: "Opening in IDE…", cloning: false, waitHint: IDE_CLONE_WAIT }
          : { label: `Cloning ${repo.name}…`, cloning: true, waitHint: IDE_CLONE_WAIT },
      )
    ) {
      return;
    }
    try {
      await ensureIdeSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open in IDE");
    } finally {
      endIdeOpen();
    }
  }

  async function openPrInIde(focus?: { path?: string; line?: number }) {
    if (!repo || !pull) return;
    const existing = ideSessionFor(state.sessions, repo.id);
    const refLabel = pull.headRef || "branch";
    if (
      !beginIdeOpen(
        existing
          ? { label: "Opening in IDE…", cloning: false, waitHint: PR_CLONE_WAIT }
          : { label: `Cloning ${repo.name}…`, cloning: true, waitHint: PR_CLONE_WAIT },
      )
    ) {
      return;
    }
    try {
      const session = await ensureIdeSession();
      if (!session) return;
      if (typeof api.workspaceGitFetch === "function") {
        setIdeOpen({ label: `Fetching ${refLabel}…`, cloning: false, waitHint: PR_CLONE_WAIT });
        try {
          await api.workspaceGitFetch(session.id);
        } catch {
          /* still try a local checkout */
        }
      }
      if (pull.headRef && typeof api.workspaceGitCheckout === "function") {
        setIdeOpen({
          label: `Checking out ${refLabel}…`,
          cloning: false,
          waitHint: PR_CLONE_WAIT,
        });
        await api.workspaceGitCheckout(session.id, pull.headRef);
      }
      const files = pullFiles.map((file) => file.path).filter(Boolean);
      const focusPath = focus?.path ?? files[0];
      const patch = pull.files.find((file) => file.path === focusPath)?.patch;
      const fromHunk = pullFiles.find((file) => file.path === focusPath)?.hunks[0]?.newStart;
      requestWorkspaceOpenPr({
        sessionId: session.id,
        files: files.length ? files : focusPath ? [focusPath] : [],
        comments: prCommentMarks(pull.comments),
        focus: focusPath
          ? { path: focusPath, line: focus?.line ?? firstHunkLine(patch) ?? fromHunk }
          : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open PR in IDE");
    } finally {
      endIdeOpen();
    }
  }

  async function startSetup() {
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      const session = await api.startSetupSession(repo.id);
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start environment setup");
    } finally {
      setBusy(false);
    }
  }

  async function startFix(number: number) {
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      if (loadPathNotes.trim() !== (loadPath?.notes ?? "").trim()) {
        const next = await api.patchPullLoadPath(repo.id, number, { notes: loadPathNotes });
        setLoadPath(next);
        setLoadPathNotes(next.notes ?? loadPathNotes);
      }
      const session = await api.startFixSession(repo.id, number);
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start fix");
    } finally {
      setBusy(false);
    }
  }

  async function startReview(number: number) {
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      if (loadPathNotes.trim() !== (loadPath?.notes ?? "").trim()) {
        const next = await api.patchPullLoadPath(repo.id, number, { notes: loadPathNotes });
        setLoadPath(next);
        setLoadPathNotes(next.notes ?? loadPathNotes);
      }
      const session = await api.startReviewSession(repo.id, number);
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start review");
    } finally {
      setBusy(false);
    }
  }

  async function saveLoadPathNotes() {
    if (!repo || !state.selectedPullNumber) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.patchPullLoadPath(repo.id, state.selectedPullNumber, {
        notes: loadPathNotes,
      });
      setLoadPath(next);
      setLoadPathNotes(next.notes ?? loadPathNotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save load path notes");
    } finally {
      setBusy(false);
    }
  }

  async function refreshChangeStack() {
    if (!repo || !state.selectedPullNumber) return;
    setBusy(true);
    setError(null);
    summarizedHead.current = null;
    try {
      const next = await api.refreshPullChangeStack(repo.id, state.selectedPullNumber);
      setChangeStack(next);
      setStackViewSha(next.headSha);
      summarizedHead.current = next.headSha;
      const listed = await api.listPullChangeStackRevisions(repo.id, state.selectedPullNumber);
      setStackRevisions(listed.revisions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update change stack");
    } finally {
      setBusy(false);
    }
  }

  async function viewChangeStackRevision(sha: string) {
    if (!repo || !state.selectedPullNumber) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.repoPullChangeStack(repo.id, state.selectedPullNumber, { sha });
      setChangeStack(next);
      setStackViewSha(next.headSha);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load change stack snapshot");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.patchRepo(repo.id, {
        name,
        ref,
        accountId: accountId || undefined,
        dockerImage: dockerImage.trim() || null,
        autoReview,
        reviewPrompt: reviewPrompt.trim() ? reviewPrompt : null,
      });
      dispatch({ type: "repo", repo: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!repo) return;
    if (
      !(await askConfirm({
        title: `Unlink ${repo.name}?`,
        body: "Agents keep their checkout.",
        confirmLabel: "Unlink",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await api.deleteRepo(repo.id);
      dispatch({ type: "repoDeleted", id: repo.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlink");
    } finally {
      setBusy(false);
    }
  }

  async function postIssueComment() {
    if (!repo || !state.selectedIssueNumber || !issueCommentBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.commentIssue(repo.id, state.selectedIssueNumber, {
        body: issueCommentBody.trim(),
      });
      dispatch({ type: "issue", issue: next });
      setIssueCommentBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comment failed");
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (!repo || !state.selectedPullNumber || !commentBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.commentPull(repo.id, state.selectedPullNumber, {
        body: commentBody.trim(),
        path: commentPath.trim() || undefined,
        line: commentLine ? Number(commentLine) : undefined,
        side: commentSide === "LEFT" || commentSide === "RIGHT" ? commentSide : undefined,
      });
      dispatch({ type: "pull", pull: next });
      setCommentBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comment failed");
    } finally {
      setBusy(false);
    }
  }

  async function postReview() {
    if (!repo || !state.selectedPullNumber || !reviewBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.reviewPull(repo.id, state.selectedPullNumber, {
        body: reviewBody.trim(),
        event: reviewEvent,
      });
      dispatch({ type: "pull", pull: next });
      setReviewBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function mergePull() {
    if (!repo || !state.selectedPullNumber) return;
    if (
      !(await askConfirm({
        title: "Merge pull request?",
        body: "Merge this pull request on the forge?",
        confirmLabel: "Merge",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.mergePull(repo.id, state.selectedPullNumber);
      dispatch({ type: "pull", pull: next });
      setPulls(await api.repoPulls(repo.id, pullState, { fresh: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  function selectLine(ref: DiffLineRef) {
    setCommentPath(ref.path);
    setCommentLine(String(ref.line));
    setCommentSide(ref.side);
    setPrTab("files");
  }

  function selectStackLine(ref: DiffLineRef) {
    setCommentPath(ref.path);
    setCommentLine(String(ref.line));
    setCommentSide(ref.side);
  }

  function openCommentLoc(path?: string, line?: number, side?: "LEFT" | "RIGHT") {
    if (!path) return;
    setCommentPath(path);
    setCommentLine(line ? String(line) : "");
    setCommentSide(side === "LEFT" || side === "RIGHT" ? side : line ? "RIGHT" : "");
    setPrTab("files");
    setJumpPath(path);
  }

  function jumpToPullFile(path: string) {
    setPrTab("files");
    setJumpPath(path);
  }

  async function saveDiffLayout(next: ReturnType<typeof parseDiffLayout>) {
    if (!state.config) return;
    const saved = await api.saveConfig({ ...state.config, diffLayout: next });
    dispatch({ type: "config", config: saved });
  }

  async function togglePullFileViewed(path: string, viewed: boolean) {
    if (!repo || !state.selectedPullNumber) return;
    try {
      const detail = await api.setPullFileViewed(repo.id, state.selectedPullNumber, path, viewed);
      dispatch({ type: "pull", pull: detail });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update viewed file");
    }
  }

  if (!repo) {
    return (
      <div className="codebase-pane">
        <div className="empty">
          <div className={`empty-card codebase-empty${importing || accounts ? " has-import" : ""}`}>
            <EmptyHero
              pose="rest"
              eyebrow="Codebase"
              title="Link a repository"
              lead="Catalog a GitHub, GitLab, Bitbucket, Gitea, Forgejo, or Azure DevOps repo, then review pulls here."
            />
            <p>
              <button
                type="button"
                className="linkish"
                onClick={() => openSettings(dispatch, "git")}
              >
                {tokened.length ? "Manage tokens in Settings → Git" : "Add a GitHub token"}
              </button>
            </p>
            <div className="codebase-start-cards">
              <section className="codebase-start-card">
                <h3>Sign in and pick a repo</h3>
                <p className="meta">Import from accounts already connected in Settings.</p>
                <BusyButton
                  className="btn"
                  busy={importing}
                  busyLabel="Importing…"
                  onClick={() => void importFromGit()}
                >
                  Import from Git
                </BusyButton>
              </section>
              <section className="codebase-start-card">
                <h3>Paste a URL</h3>
                <p className="meta">Catalog a clone you already have, or a public repo URL.</p>
                <div className="field">
                  <label>Repository URL</label>
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://github.com/acme/app"
                  />
                </div>
                {tokened.length > 1 ? (
                  <div className="field">
                    <label>Account</label>
                    <Select
                      ariaLabel="Account"
                      value={linkAccountId}
                      options={[
                        { value: "", label: "Auto (one token per forge)" },
                        ...tokened.map((row) => ({
                          value: row.id,
                          label: `${row.name} · ${forgeLabel(row.kind)}`,
                        })),
                      ]}
                      onChange={setLinkAccountId}
                    />
                  </div>
                ) : null}
                <button className="btn primary" disabled={busy} onClick={() => void link()}>
                  Link repo
                </button>
              </section>
            </div>
            {error ? <ErrorBanner error={error} /> : null}
            {importing || accounts ? (
              <ImportAccounts
                accounts={accounts ?? []}
                loading={importing && !accounts}
                busy={busy}
                linkedUrls={state.repos.map((row) => row.checkout.url)}
                onLink={(hints) => void linkPicked(hints)}
                onDismiss={() => setAccounts(null)}
                onOpenGitSettings={() => openSettings(dispatch, "git")}
              />
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const openingLabel = ideOpen ? (ideOpen.cloning ? "Cloning…" : "Opening…") : undefined;
  const ideForRepo = ideSessionFor(state.sessions, repo.id);
  const repoCloneProgress = ideForRepo ? state.cloneProgress[ideForRepo.id] : undefined;
  const pullDetailOpen = tab === "pulls" && Boolean(pull);
  const repoBrain = brainClaimsForRepo(state.brain, repo.checkout.url);
  const brainHint =
    brainNote ||
    (repoBrain.nodeCount === 0 && repoBrain.memoryCount === 0
      ? state.brain?.empty
        ? "No claims yet. Index a Host checkout of this remote into the shared brain."
        : `No claims for this remote yet${
            state.brain?.nodeCount ? ` · shared brain has ${state.brain.nodeCount} claims` : ""
          }.`
      : `${repoBrain.nodeCount} claims for this remote · ${repoBrain.memoryCount} memories${
          state.brain && state.brain.nodeCount !== repoBrain.nodeCount
            ? ` · shared brain ${state.brain.nodeCount}`
            : ""
        }`);

  return (
    <div className={prFocus ? "codebase-pane pr-focus" : "codebase-pane"}>
      <div className="codebase-head">
        <div className="row-actions">
          <span className={`forge-badge ${repo.checkout.forge}`}>
            {forgeLabel(repo.checkout.forge)}
          </span>
          {bound ? (
            <button className="btn primary" disabled={busy} onClick={() => void startAgent(true)}>
              Continue
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void startAgent(false)}>
              Start agent
            </button>
          )}
          <BusyButton
            className="btn"
            busy={busy || Boolean(openingLabel)}
            busyLabel={openingLabel ?? "Open in IDE"}
            onClick={() => void openInIde()}
          >
            Open in IDE
          </BusyButton>
          <OverflowMenu
            label={<IconMore />}
            title="Repo actions"
            toggleClassName="btn icon ghost"
            align="right"
          >
            {bound ? (
              <MenuItem disabled={busy} onClick={() => void startAgent(false)}>
                New agent
              </MenuItem>
            ) : null}
            <MenuItem disabled={busy} onClick={() => void startAgent(true)}>
              Open product
            </MenuItem>
            <MenuItem disabled={busy} onClick={() => void startSetup()}>
              Setup environment
            </MenuItem>
            <MenuItem onClick={() => dispatch({ type: "newAutomation", open: true })}>
              New automation
            </MenuItem>
            <MenuSep />
            <MenuItem danger disabled={busy} onClick={() => void unlink()}>
              Unlink
            </MenuItem>
          </OverflowMenu>
        </div>
      </div>
      {error ? <ErrorBanner error={error} /> : null}
      {!pullDetailOpen && ideOpen ? (
        <IdeOpenBanner open={ideOpen} progress={repoCloneProgress} />
      ) : null}
      <div className="codebase-tabs">
        {(
          [
            "overview",
            "architecture",
            "pulls",
            "issues",
            "agents",
            "automations",
            "settings",
          ] as const
        ).map((id) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {id === "pulls"
              ? `Pull requests${typeof repo.openPullCount === "number" ? ` ${repo.openPullCount}` : ""}`
              : id === "issues"
                ? `Issues${typeof repo.openIssueCount === "number" ? ` ${repo.openIssueCount}` : ""}`
                : id[0]!.toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      {!tokened.length ? (
        <div className="notice-row">
          <span className="notice-dot" aria-hidden="true" />
          <p>Sign in or add a GitHub token in Settings → Git to fetch pull requests and issues.</p>
          <button className="btn small" onClick={() => openSettings(dispatch, "git")}>
            Open Git settings
          </button>
        </div>
      ) : null}
      {tab === "architecture" ? <ArchitecturePane repoId={repo.id} repoName={repo.name} /> : null}
      {tab === "overview" ? (
        <div className="codebase-body overview-panes">
          <div className="repo-stats">
            <button className="repo-stat" onClick={() => setTab("pulls")}>
              <strong>{typeof repo.openPullCount === "number" ? repo.openPullCount : "—"}</strong>
              <span>Open PRs</span>
            </button>
            <button className="repo-stat" onClick={() => setTab("issues")}>
              <strong>{typeof repo.openIssueCount === "number" ? repo.openIssueCount : "—"}</strong>
              <span>Open issues</span>
            </button>
            <button className="repo-stat" onClick={() => setTab("agents")}>
              <strong>{agents.length}</strong>
              <span>Agents</span>
            </button>
            <button className="repo-stat" onClick={() => setTab("automations")}>
              <strong>{automations.length}</strong>
              <span>Automations</span>
            </button>
            <div className="repo-stat">
              <strong>{formatAgo(repo.lastFetchAt)}</strong>
              <span>Last fetch</span>
            </div>
            <button
              className="repo-stat"
              type="button"
              title="Open Brain"
              onClick={() => dispatch({ type: "section", section: "brain" })}
            >
              <strong>{repoBrain.nodeCount || "—"}</strong>
              <span>Brain claims</span>
            </button>
          </div>
          <section className="surface-pane overview-remote">
            <header>
              <span className="pane-label">Brain</span>
              <BusyButton
                type="button"
                className="btn small"
                busy={brainBusy}
                busyLabel="Building…"
                onClick={() => {
                  setBrainBusy(true);
                  void api
                    .brainBuild({ repo: repo.checkout.url })
                    .then((next) => {
                      dispatch({ type: "brain", brain: next });
                      setBrainNote(next.output ?? "Indexed into brain.");
                    })
                    .catch((err: unknown) => {
                      setBrainNote(err instanceof Error ? err.message : "Brain build failed");
                    })
                    .finally(() => setBrainBusy(false));
                }}
              >
                Index into brain
              </BusyButton>
            </header>
            <div className="surface-pane-body">
              <p className="hint">{brainHint}</p>
            </div>
          </section>
          <section className="surface-pane pr-table-pane">
            <header>
              <span className="pane-label">Review inbox</span>
              <span className="hint">
                {pulls.filter(isOpenInboxPull).length}{" "}
                {pulls.filter(isOpenInboxPull).length === 1 ? "item" : "items"}
              </span>
            </header>
            <div className="surface-pane-body pr-table-body">
              {pulls.filter(isOpenInboxPull).length === 0 ? (
                <p className="hint">No open pull requests.</p>
              ) : (
                <PullTable
                  rows={pulls.filter(isOpenInboxPull)}
                  onSelect={(number) => {
                    setTab("pulls");
                    dispatch({ type: "selectPull", number });
                  }}
                />
              )}
            </div>
          </section>
          <section className="surface-pane overview-remote">
            <header>
              <span className="pane-label">Remote</span>
            </header>
            <div className="surface-pane-body">
              <dl className="meta-grid">
                <div>
                  <dt>Origin</dt>
                  <dd className="repo-url" title={repo.checkout.url}>
                    {repo.checkout.url}
                  </dd>
                </div>
                <div>
                  <dt>Default branch</dt>
                  <dd>{repo.checkout.ref || "unset"}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      ) : null}
      {tab === "pulls" ? (
        <PullInbox
          pulls={pulls}
          pullsLoading={pullsLoading}
          pullState={pullState}
          setPullState={setPullState}
          selectedNumber={state.selectedPullNumber}
          onSelect={(number) => dispatch({ type: "selectPull", number })}
          pull={pull}
          pullLoadError={pullLoadError}
          listWidth={listWidth}
          onListWidth={setListWidth}
          focused={prFocus}
          onToggleFocus={() => {
            setPrFocus((current) => {
              const next = !current;
              if (next && prTab !== "stack") setPrTab("files");
              return next;
            });
          }}
          pullFiles={pullFiles}
          pullDiff={pullDiff}
          agentSummary={agentSummary}
          loadPath={loadPath}
          loadPathNotes={loadPathNotes}
          setLoadPathNotes={setLoadPathNotes}
          onSaveLoadPathNotes={() => void saveLoadPathNotes()}
          changeStack={changeStack}
          stackRevisions={stackRevisions}
          stackViewSha={stackViewSha}
          stackSummarizing={stackSummarizing}
          onRefreshChangeStack={() => void refreshChangeStack()}
          onViewChangeStackRevision={(sha) => void viewChangeStackRevision(sha)}
          prTab={prTab}
          setPrTab={setPrTab}
          busy={busy}
          error={error}
          commentBody={commentBody}
          setCommentBody={setCommentBody}
          commentPath={commentPath}
          setCommentPath={setCommentPath}
          commentLine={commentLine}
          setCommentLine={setCommentLine}
          commentSide={commentSide}
          setCommentSide={setCommentSide}
          reviewBody={reviewBody}
          setReviewBody={setReviewBody}
          reviewEvent={reviewEvent}
          setReviewEvent={setReviewEvent}
          selectedLine={selectedLine}
          onStartReview={() => {
            if (state.selectedPullNumber) void startReview(state.selectedPullNumber);
          }}
          onStartAgent={() => void startAgent(false)}
          onFix={() => {
            if (state.selectedPullNumber) void startFix(state.selectedPullNumber);
          }}
          onMerge={() => void mergePull()}
          onComment={() => void postComment()}
          onReview={() => void postReview()}
          onSelectLine={selectLine}
          onSelectStackLine={selectStackLine}
          onOpenLoc={openCommentLoc}
          onJumpToFile={jumpToPullFile}
          onOpenInIde={(focus) => void openPrInIde(focus)}
          openingLabel={openingLabel}
          ideBanner={ideOpen ? <IdeOpenBanner open={ideOpen} progress={repoCloneProgress} /> : null}
          onLayoutChange={(next) => void saveDiffLayout(next)}
          onToggleViewed={(path, viewed) => void togglePullFileViewed(path, viewed)}
          diffLayout={parseDiffLayout(state.config?.diffLayout)}
          viewedPaths={new Set(pull?.files.filter((file) => file.viewed).map((file) => file.path))}
          jumpPath={jumpPath}
          onClearLoc={() => {
            setCommentPath("");
            setCommentLine("");
            setCommentSide("");
          }}
        />
      ) : null}
      {tab === "issues" ? (
        <IssueInbox
          issues={issues}
          issuesLoading={issuesLoading}
          issueState={issueState}
          setIssueState={setIssueState}
          selectedNumber={state.selectedIssueNumber}
          onSelect={(number) => dispatch({ type: "selectIssue", number })}
          issue={issue}
          issueLoadError={issueLoadError}
          listWidth={issueListWidth}
          onListWidth={setIssueListWidth}
          focused={issueFocus}
          onToggleFocus={() => setIssueFocus((current) => !current)}
          busy={busy}
          commentBody={issueCommentBody}
          setCommentBody={setIssueCommentBody}
          onComment={() => void postIssueComment()}
        />
      ) : null}
      {tab === "agents" ? (
        <div className="codebase-body">
          {agents.length === 0 ? <p className="hint">No agents on this repo yet.</p> : null}
          {agents.map((session) => (
            <button
              key={session.id}
              className="pr-row"
              onClick={() => dispatch({ type: "select", id: session.id })}
            >
              <span className={`dot ${session.status}`} />
              <span>
                <strong>{session.title}</strong>
                <div className="meta">
                  {session.kind === "review"
                    ? "Review"
                    : session.kind === "setup"
                      ? "Setup"
                      : session.model}
                </div>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {tab === "automations" ? (
        <div className="codebase-body">
          {automations.length === 0 ? (
            <p className="hint">No automations on this repo yet.</p>
          ) : null}
          {automations.map((item) => (
            <button
              key={item.id}
              className="pr-row"
              onClick={() => dispatch({ type: "selectAutomation", id: item.id })}
            >
              <span>
                <strong>{item.name}</strong>
                <div className="meta">{item.enabled ? "On" : "Paused"}</div>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {tab === "settings" ? (
        <div className="codebase-body">
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Default ref</label>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="main" />
          </div>
          <div className="field">
            <label>Account</label>
            <Select
              ariaLabel="Account"
              value={accountId}
              options={[
                { value: "", label: "Auto" },
                ...(state.config?.forges ?? [])
                  .filter((row) => row.kind === repo.checkout.forge)
                  .map((row) => ({ value: row.id, label: row.name })),
              ]}
              onChange={setAccountId}
            />
          </div>
          <div className="field">
            <label>Docker image</label>
            <input
              value={dockerImage}
              onChange={(e) => setDockerImage(e.target.value)}
              placeholder="locus/node"
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={autoReview}
              onChange={(e) => setAutoReview(e.target.checked)}
            />
            Auto-review new pull requests
          </label>
          <div className="field">
            <label>Review prompt</label>
            <textarea
              value={reviewPrompt}
              onChange={(e) => setReviewPrompt(e.target.value)}
              rows={6}
              placeholder="Extra review rules for this repo (API stability, forbidden dirs, test commands)."
            />
            <p className="hint">
              Standard reviews already zoom out, check architecture depth, and apply a strict
              maintainability bar. This field appends repo-specific rules.
            </p>
          </div>
          <div className="row-actions">
            <button className="btn primary" disabled={busy} onClick={() => void saveSettings()}>
              Save
            </button>
            <button className="btn danger ghost" disabled={busy} onClick={() => void unlink()}>
              Unlink
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type PullDetailProps = {
  pull: PullRequestDetail;
  pullFiles: ReturnType<typeof patchFilesFromPull>;
  pullDiff: { additions: number; deletions: number };
  agentSummary?: string;
  loadPath: LoadPathReview | null;
  loadPathNotes: string;
  setLoadPathNotes: (value: string) => void;
  onSaveLoadPathNotes: () => void;
  changeStack: ChangeStack | null;
  stackRevisions: ChangeStackRevision[];
  stackViewSha: string;
  stackSummarizing: boolean;
  onRefreshChangeStack: () => void;
  onViewChangeStackRevision: (sha: string) => void;
  prTab: PullTab;
  setPrTab: (tab: PullTab) => void;
  busy: boolean;
  error: string | null;
  commentBody: string;
  setCommentBody: (value: string) => void;
  commentPath: string;
  setCommentPath: (value: string) => void;
  commentLine: string;
  setCommentLine: (value: string) => void;
  commentSide: "" | "LEFT" | "RIGHT";
  setCommentSide: (value: "" | "LEFT" | "RIGHT") => void;
  reviewBody: string;
  setReviewBody: (value: string) => void;
  reviewEvent: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  setReviewEvent: (value: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => void;
  selectedLine: DiffLineRef | null;
  onStartReview: () => void;
  onStartAgent: () => void;
  onFix: () => void;
  onMerge: () => void;
  onComment: () => void;
  onReview: () => void;
  onSelectLine: (ref: DiffLineRef) => void;
  onSelectStackLine: (ref: DiffLineRef) => void;
  onOpenLoc: (path?: string, line?: number, side?: "LEFT" | "RIGHT") => void;
  onJumpToFile: (path: string) => void;
  onOpenInIde: (focus?: { path?: string; line?: number }) => void;
  openingLabel?: string;
  ideBanner?: ReactNode;
  onLayoutChange: (layout: ReturnType<typeof parseDiffLayout>) => void;
  onToggleViewed: (path: string, viewed: boolean) => void;
  diffLayout: ReturnType<typeof parseDiffLayout>;
  viewedPaths: Set<string>;
  jumpPath: string | null;
  onClearLoc: () => void;
  focused: boolean;
  onToggleFocus: () => void;
};

function PullListSkeleton() {
  return (
    <div className="pr-skeleton-list" data-testid="pr-list-skeleton">
      <Skeleton lines={6} label="Loading pull requests" />
    </div>
  );
}

function PullDetailSkeleton() {
  return (
    <div className="pr-skeleton-detail" data-testid="pr-detail-skeleton">
      <Skeleton lines={5} label="Loading pull request" />
    </div>
  );
}

function PullInbox(
  props: Omit<PullDetailProps, "pull"> & {
    pulls: PullRequestRef[];
    pullsLoading: boolean;
    pullState: PullListState;
    setPullState: (value: PullListState) => void;
    selectedNumber: number | null;
    onSelect: (number: number) => void;
    pull?: PullRequestDetail;
    pullLoadError: string | null;
    listWidth: number;
    onListWidth: (width: number) => void;
  },
) {
  const openCount = props.pulls.filter(isOpenInboxPull).length;
  const draftCount = props.pulls.filter(isDraftPull).length;

  function onGutterDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = props.listWidth;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    function move(ev: PointerEvent) {
      props.onListWidth(
        Math.min(PR_LIST_MAX, Math.max(PR_LIST_MIN, Math.round(start + ev.clientX - origin))),
      );
    }
    function up() {
      if (typeof node.releasePointerCapture === "function")
        node.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className={`pr-inbox-split ${props.focused ? "focused" : ""}`}
      style={
        props.focused
          ? undefined
          : { gridTemplateColumns: `${props.listWidth}px 6px minmax(0, 1fr)` }
      }
    >
      <div className="pr-inbox-list" hidden={props.focused}>
        <div className="pr-inbox-head">
          <div>
            <h3>Pull requests</h3>
            <p className="hint">
              {openCount} open
              {draftCount ? ` · ${draftCount} draft` : ""}
            </p>
          </div>
          <Select
            className="pr-inbox-filter"
            compact
            ariaLabel="Pull request filter"
            value={props.pullState}
            options={[
              { value: "open", label: "Open" },
              { value: "draft", label: "Draft" },
              { value: "all", label: "All" },
            ]}
            onChange={(value) => props.setPullState(parsePullListState(value))}
          />
        </div>
        {props.pullsLoading && props.pulls.length === 0 ? (
          <PullListSkeleton />
        ) : props.pulls.length === 0 ? (
          <EmptyHint title="No pull requests." />
        ) : (
          props.pulls.map((row) => {
            const active = props.selectedNumber === row.number;
            return (
              <button
                key={row.number}
                type="button"
                className={`pr-inbox-item ${active ? "active" : ""}`}
                onClick={() => props.onSelect(row.number)}
              >
                <PullSummaryCell row={row} />
              </button>
            );
          })
        )}
      </div>
      <Splitter
        className="pr-inbox-gutter"
        orientation="vertical"
        label="Resize pull request list"
        value={props.listWidth}
        min={PR_LIST_MIN}
        max={PR_LIST_MAX}
        valueText={`${props.listWidth} pixels`}
        hidden={props.focused}
        onPointerDown={onGutterDown}
        onKeyDown={(event) => {
          const next = stepSplitValue({
            key: event.key,
            shift: event.shiftKey,
            value: props.listWidth,
            min: PR_LIST_MIN,
            max: PR_LIST_MAX,
            axis: "vertical",
            step: 16,
          });
          if (next == null) return;
          event.preventDefault();
          props.onListWidth(next);
        }}
        onDoubleClick={() => props.onListWidth(PR_LIST_DEFAULT)}
      />
      <div className="pr-inbox-detail">
        {props.pull ? (
          <PullDetail {...props} pull={props.pull} />
        ) : props.selectedNumber && !props.pullLoadError ? (
          <PullDetailSkeleton />
        ) : props.pullLoadError ? (
          <ErrorBanner error={props.pullLoadError} />
        ) : (
          <EmptyHint title="Select a pull request." />
        )}
      </div>
    </div>
  );
}

function IssueInbox(props: {
  issues: IssueRef[];
  issuesLoading: boolean;
  issueState: IssueListState;
  setIssueState: (value: IssueListState) => void;
  selectedNumber: number | null;
  onSelect: (number: number) => void;
  issue?: IssueDetail;
  issueLoadError: string | null;
  listWidth: number;
  onListWidth: (width: number) => void;
  focused: boolean;
  onToggleFocus: () => void;
  busy: boolean;
  commentBody: string;
  setCommentBody: (value: string) => void;
  onComment: () => void;
}) {
  const openCount = props.issues.filter((row) => row.state === "open").length;

  function onGutterDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const origin = event.clientX;
    const start = props.listWidth;
    const node = event.currentTarget;
    if (typeof node.setPointerCapture === "function") node.setPointerCapture(event.pointerId);
    function move(ev: PointerEvent) {
      props.onListWidth(
        Math.min(PR_LIST_MAX, Math.max(PR_LIST_MIN, Math.round(start + ev.clientX - origin))),
      );
    }
    function up() {
      if (typeof node.releasePointerCapture === "function")
        node.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      className={`pr-inbox-split issue-inbox-split ${props.focused ? "focused" : ""}`}
      style={
        props.focused
          ? undefined
          : { gridTemplateColumns: `${props.listWidth}px 6px minmax(0, 1fr)` }
      }
    >
      <div className="pr-inbox-list" hidden={props.focused}>
        <div className="pr-inbox-head">
          <div>
            <h3>Issues</h3>
            <p className="hint">{openCount} open</p>
          </div>
          <Select
            className="pr-inbox-filter"
            compact
            ariaLabel="Issue filter"
            value={props.issueState}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "all", label: "All" },
            ]}
            onChange={(value) => props.setIssueState(parseIssueListState(value))}
          />
        </div>
        {props.issuesLoading && props.issues.length === 0 ? (
          <PullListSkeleton />
        ) : props.issues.length === 0 ? (
          <EmptyHint title="No issues." />
        ) : (
          props.issues.map((row) => {
            const active = props.selectedNumber === row.number;
            return (
              <button
                key={row.number}
                type="button"
                className={`pr-inbox-item ${active ? "active" : ""}`}
                onClick={() => props.onSelect(row.number)}
              >
                <IssueSummaryCell row={row} />
              </button>
            );
          })
        )}
      </div>
      <Splitter
        className="pr-inbox-gutter"
        orientation="vertical"
        label="Resize issue list"
        value={props.listWidth}
        min={PR_LIST_MIN}
        max={PR_LIST_MAX}
        valueText={`${props.listWidth} pixels`}
        hidden={props.focused}
        onPointerDown={onGutterDown}
        onKeyDown={(event) => {
          const next = stepSplitValue({
            key: event.key,
            shift: event.shiftKey,
            value: props.listWidth,
            min: PR_LIST_MIN,
            max: PR_LIST_MAX,
            axis: "vertical",
            step: 16,
          });
          if (next == null) return;
          event.preventDefault();
          props.onListWidth(next);
        }}
        onDoubleClick={() => props.onListWidth(PR_LIST_DEFAULT)}
      />
      <div className="pr-inbox-detail">
        {props.issue ? (
          <IssueDetail
            issue={props.issue}
            focused={props.focused}
            onToggleFocus={props.onToggleFocus}
            busy={props.busy}
            commentBody={props.commentBody}
            setCommentBody={props.setCommentBody}
            onComment={props.onComment}
          />
        ) : props.selectedNumber && !props.issueLoadError ? (
          <PullDetailSkeleton />
        ) : props.issueLoadError ? (
          <ErrorBanner error={props.issueLoadError} />
        ) : (
          <EmptyHint title="Select an issue." />
        )}
      </div>
    </div>
  );
}

function IssueSummaryCell(props: { row: IssueRef }) {
  const row = props.row;
  const labels = row.labels?.length ? row.labels.slice(0, 3).join(", ") : "";
  return (
    <span className="pr-summary">
      <span className="pr-summary-body">
        <span className="pr-summary-title">
          {row.state === "closed" ? <span className="pr-draft-badge closed">Closed</span> : null}
          <strong>{row.title}</strong>
        </span>
        <span className="pr-summary-sub">
          <span className="pr-summary-meta">
            {row.author ? <span className="pr-summary-author">{row.author}</span> : null}
            <span className="pr-id">#{row.number}</span>
            {labels ? <span>{labels}</span> : null}
          </span>
        </span>
      </span>
    </span>
  );
}

function IssueDetail(props: {
  issue: IssueDetail;
  focused: boolean;
  onToggleFocus: () => void;
  busy: boolean;
  commentBody: string;
  setCommentBody: (value: string) => void;
  onComment: () => void;
}) {
  const issue = props.issue;
  return (
    <div className="pr-detail">
      <div className="pr-detail-head">
        <div>
          <p className="eyebrow">
            #{issue.number}
            {issue.state === "closed" ? " · closed" : ""}
          </p>
          <h2>{issue.title}</h2>
        </div>
        <div className="pr-detail-actions">
          <Tooltip label={props.focused ? "Show list" : "Focus issue"}>
            <button type="button" className="btn small ghost" onClick={props.onToggleFocus}>
              {props.focused ? <IconCompress /> : <IconExpand />}
            </button>
          </Tooltip>
          <a className="btn small" href={issue.url} target="_blank" rel="noreferrer">
            Open on forge
          </a>
        </div>
      </div>
      <p className="pr-inline-meta">
        {issue.author ? <span>{issue.author}</span> : null}
        {issue.labels?.length ? <span>{issue.labels.join(", ")}</span> : null}
        {issue.assignees?.length ? <span>Assigned {issue.assignees.join(", ")}</span> : null}
      </p>
      <div className="codebase-body pr-thread">
        <section className="pr-card">
          <header>
            <strong>{issue.author || "description"}</strong>
            <span className="hint">opened {formatAgo(issue.createdAt ?? issue.updatedAt)}</span>
          </header>
          {issue.body ? <Markdown text={issue.body} /> : <p className="hint">No description.</p>}
        </section>
        <ul className="pr-comments">
          {issue.comments.map((row) => (
            <li key={row.id} className="pr-card">
              <header>
                <strong>{row.author || "comment"}</strong>
                <span className="hint">{formatAgo(row.createdAt)}</span>
              </header>
              <Markdown text={row.body} />
            </li>
          ))}
        </ul>
        <section className="pr-composer">
          <div className="field">
            <label>Comment</label>
            <textarea
              value={props.commentBody}
              onChange={(e) => props.setCommentBody(e.target.value)}
              rows={3}
              placeholder="Leave a comment on this issue."
            />
          </div>
          <button
            className="btn"
            disabled={props.busy || !props.commentBody.trim()}
            onClick={props.onComment}
          >
            Comment
          </button>
        </section>
      </div>
    </div>
  );
}

function LoadPathPanel(props: {
  review: LoadPathReview | null;
  notes: string;
  busy: boolean;
  onNotes: (value: string) => void;
  onSave: () => void;
  onJumpToFile: (path: string) => void;
}) {
  const review = props.review;
  const [layerFilter, setLayerFilter] = useState<LoadPathLayer | null>(null);
  const [showAllTraces, setShowAllTraces] = useState(false);
  useEffect(() => {
    if (review) return;
    setLayerFilter(null);
    setShowAllTraces(false);
  }, [review]);
  const allPaths = review?.nodes.map((node) => node.path) ?? [];
  const traces = (review?.traces ?? []).filter((trace) => {
    if (!layerFilter || !review) return true;
    const seedLayer = review.nodes.find((node) => node.path === trace.seed)?.layer;
    return seedLayer === layerFilter || trace.hops.some((hop) => hop.layer === layerFilter);
  });
  const visible = showAllTraces ? traces : traces.slice(0, LOAD_PATH_TRACE_LIMIT);
  return (
    <section className="pr-loadpath">
      <h3>Load path</h3>
      {!review ? (
        <p className="hint">Traces appear once the pull files are loaded.</p>
      ) : (
        <>
          <p className="pr-loadpath-headline">{review.headline}</p>
          <p className="hint">{review.reasons.join(" · ")}</p>
          {review.layers.length ? (
            <div className="pr-loadpath-layers" role="group" aria-label="Filter traces by layer">
              {review.layers.map((layer) => (
                <button
                  key={layer}
                  type="button"
                  className={layerFilter === layer ? "active" : undefined}
                  aria-pressed={layerFilter === layer}
                  onClick={() => {
                    setLayerFilter((cur) => (cur === layer ? null : layer));
                    setShowAllTraces(false);
                  }}
                >
                  {layer}
                </button>
              ))}
            </div>
          ) : null}
          <h4>Traces</h4>
          {review.traces.length === 0 ? (
            <p className="hint">
              No cross-file traces from this diff. Each changed file is a leaf.
            </p>
          ) : traces.length === 0 ? (
            <p className="hint">No traces touch {layerFilter}.</p>
          ) : (
            <>
              <ul className="pr-loadpath-traces">
                {visible.map((trace) => {
                  const seedLayer = review.nodes.find((node) => node.path === trace.seed)?.layer;
                  return (
                    <li key={trace.seed} className="loadpath-trace">
                      <button
                        type="button"
                        className="loadpath-file"
                        onClick={() => props.onJumpToFile(trace.seed)}
                      >
                        <span className="patch-path" title={trace.seed}>
                          {shortLoadPath(trace.seed, allPaths)}
                        </span>
                        {seedLayer ? <span className="hint">{seedLayer}</span> : null}
                      </button>
                      {trace.hops.length ? (
                        <ol className="loadpath-hops">
                          {trace.hops.map((hop) => (
                            <li key={`${trace.seed}:${hop.path}:${hop.via}`}>
                              <span className="loadpath-arrow" aria-hidden>
                                →
                              </span>
                              <button
                                type="button"
                                className="loadpath-file"
                                onClick={() => props.onJumpToFile(hop.path)}
                              >
                                <span className="patch-path" title={hop.path}>
                                  {shortLoadPath(hop.path, allPaths)}
                                </span>
                                <span className="hint">
                                  {hop.layer} · {hop.via.replace(/_/g, " ")}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {traces.length > visible.length ? (
                <button
                  type="button"
                  className="btn ghost loadpath-more"
                  onClick={() => setShowAllTraces(true)}
                >
                  Show {traces.length - visible.length} more traces
                </button>
              ) : null}
            </>
          )}
          {review.untestedSinks.length ? (
            <>
              <h4>Untested sinks</h4>
              <ul className="pr-loadpath-sinks">
                {review.untestedSinks.map((sink) => (
                  <li key={sink.path}>
                    <button
                      type="button"
                      className="loadpath-file"
                      onClick={() => props.onJumpToFile(sink.path)}
                    >
                      <span className="patch-path" title={sink.path}>
                        {shortLoadPath(sink.path, allPaths)}
                      </span>
                      <span className="hint">
                        {sink.layer} {sink.kind}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      <div className="field">
        <label>Notes for the AI review</label>
        <textarea
          value={props.notes}
          onChange={(e) => props.onNotes(e.target.value)}
          rows={3}
          placeholder="Add context the reviewer should treat as ground truth — missing tests, known risk, what to ignore."
        />
      </div>
      <div className="row-actions">
        <button className="btn" disabled={props.busy} onClick={props.onSave}>
          Save notes
        </button>
      </div>
      <p className="hint">
        Saved notes are included when you Review with agent, next to the load path brief.
      </p>
    </section>
  );
}

function fileDelta(file: PatchFile): string {
  if (!file.hunks.length) return file.kind === "delete" ? "deleted" : "stub";
  const stats = fileDiffStats(file);
  const parts = [];
  if (stats.additions) parts.push(`+${stats.additions}`);
  if (stats.deletions) parts.push(`−${stats.deletions}`);
  return parts.join(" ") || "stub";
}

function deltaTone(delta: string): "hint" | "add" | "del" {
  if (delta === "stub" || delta === "deleted") return "hint";
  if (delta.startsWith("+")) return "add";
  return "del";
}

function PrFileExplorer({
  files,
  focusPath,
  onSelect,
  diff,
}: {
  files: PatchFile[];
  focusPath?: string | null;
  onSelect: (path: string) => void;
  diff: { additions: number; deletions: number };
}) {
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [activePath, setActivePath] = useState(focusPath ?? "");
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);
  const builtTree = useMemo(
    () =>
      buildWorkspaceTree(
        files.map((file) => ({
          name: file.path.split("/").pop() ?? file.path,
          path: file.path,
          type: "file" as const,
        })),
      ),
    [files],
  );
  const tree = useMemo(
    () => filterWorkspaceTree(builtTree, deferredFilter),
    [builtTree, deferredFilter],
  );
  const filtering = deferredFilter.trim().length > 0;
  const truncated = filtering && countWorkspaceTreeNodes(tree) >= WORKSPACE_FILTER_MAX_NODES;

  useEffect(() => {
    if (!focusPath) return;
    setActivePath(focusPath);
    setCollapsed((current) => {
      const next = new Set(current);
      const parts = focusPath.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join("/"));
      return next;
    });
  }, [focusPath]);

  function toggleDir(path: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: WorkspaceTreeNode, depth: number): ReactNode {
    const pad = { paddingLeft: 10 + depth * 12 };
    if (node.type === "dir") {
      const open = filtering || !collapsed.has(node.path);
      return (
        <li key={node.path}>
          <button
            type="button"
            className="workspace-tree-row dir"
            style={pad}
            aria-expanded={open}
            onClick={() => {
              if (!filtering) toggleDir(node.path);
            }}
          >
            <span className="workspace-tree-dot" />
            {node.name}/
          </button>
          {open ? <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul> : null}
        </li>
      );
    }
    const file = filesByPath.get(node.path);
    const delta = file ? fileDelta(file) : "";
    return (
      <li key={node.path}>
        <button
          type="button"
          data-path={node.path}
          title={node.path}
          className={`workspace-tree-row ${activePath === node.path ? "on" : ""}`}
          style={pad}
          onClick={() => {
            setActivePath(node.path);
            onSelect(node.path);
          }}
        >
          {file ? <span className={`patch-kind ${file.kind}`}>{file.kind[0]}</span> : null}
          <span className="patch-path">{node.name}</span>
          {delta ? <span className={deltaTone(delta)}>{delta}</span> : null}
        </button>
      </li>
    );
  }

  return (
    <aside className="pr-file-nav" aria-label="Changed files">
      <div className="workspace-tree-head">
        <strong>EXPLORER</strong>
      </div>
      <SearchField
        className="workspace-filter"
        wrapClassName="workspace-filter-wrap"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter files..."
        aria-label="Filter files"
      />
      <div className="workspace-tree-scroll">
        {files.length === 0 ? (
          <p className="hint">No files.</p>
        ) : tree.length === 0 ? (
          <p className="hint">No matching files.</p>
        ) : (
          <>
            <ul>{tree.map((node) => renderNode(node, 0))}</ul>
            {truncated ? (
              <p className="hint">
                Showing first {WORKSPACE_FILTER_MAX_NODES} matches. Type more to narrow.
              </p>
            ) : null}
          </>
        )}
      </div>
      <div className="workspace-tree-foot">
        <span>
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
        <span>
          <span className="add">+{diff.additions}</span>{" "}
          <span className="del">−{diff.deletions}</span>
        </span>
      </div>
    </aside>
  );
}

function PullDetail(props: PullDetailProps) {
  const { pull } = props;
  const [diffFocus, setDiffFocus] = useState<string | null>(null);
  const [stackFocusLayer, setStackFocusLayer] = useState<string | null>(null);
  const [stackOpenToken, setStackOpenToken] = useState(0);
  const chip = pullChip(pull);
  const diffPath = diffFocus ?? props.jumpPath ?? props.pullFiles[0]?.path ?? null;
  const preMerge = useMemo(
    () =>
      buildPreMergeBoard({
        checks: pull.checks,
        comments: pull.comments,
        files: pull.files,
        loadPath: props.loadPath,
        stack: props.changeStack,
      }),
    [pull.checks, pull.comments, pull.files, props.loadPath, props.changeStack],
  );

  useEffect(() => {
    setDiffFocus(null);
    setStackFocusLayer(null);
  }, [pull.repoId, pull.number]);

  function openStack(layerId: string | null) {
    setStackFocusLayer(layerId);
    setStackOpenToken((token) => token + 1);
    props.setPrTab("stack");
  }

  useEffect(() => {
    if (props.jumpPath) setDiffFocus(props.jumpPath);
  }, [props.jumpPath]);
  const tabs: Array<{ id: PullTab; label: string; count?: number }> = [
    { id: "overview", label: "Overview" },
    { id: "stack", label: "Stack", count: props.changeStack?.cohorts.length || undefined },
    { id: "conversation", label: "Conversation", count: pull.comments.length || undefined },
    { id: "commits", label: "Commits", count: pull.commits.length || undefined },
    { id: "checks", label: "Checks", count: pull.checks.length || undefined },
    { id: "files", label: "Files", count: pull.files.length || undefined },
  ];

  return (
    <div className="pr-detail" aria-busy={props.openingLabel ? true : undefined}>
      <div className="pr-detail-head">
        <div className="pr-hero-main">
          <div className="pr-chips">
            <span className={`pr-state-chip ${chip.tone}`}>{chip.label}</span>
            <span className="hint">#{pull.number}</span>
          </div>
          <h2>{pull.title}</h2>
          <p className="pr-branches">
            <code>{pull.headRef}</code>
            <span aria-hidden>→</span>
            <code>{pull.baseRef}</code>
          </p>
          <p className="hint pr-detail-meta">
            {pull.author ? `${pull.author} · ` : ""}
            {formatAgo(pull.updatedAt)}
          </p>
        </div>
        <div className="row-actions">
          <Tooltip label={props.focused ? "Exit full-screen diff" : "Open diff full screen"}>
            <button
              type="button"
              className={`btn icon ghost ${props.focused ? "on" : ""}`}
              aria-pressed={props.focused}
              onClick={props.onToggleFocus}
            >
              {props.focused ? <IconCompress /> : <IconExpand />}
            </button>
          </Tooltip>
          <button className="btn" disabled={props.busy} onClick={props.onFix}>
            Fix with agent
          </button>
          <button className="btn primary" disabled={props.busy} onClick={props.onStartReview}>
            Review with agent
          </button>
          <OverflowMenu
            label={<IconMore />}
            title="Pull request actions"
            toggleClassName="btn icon ghost"
            align="right"
          >
            <MenuItem disabled={props.busy} onClick={() => props.onOpenInIde()}>
              {props.openingLabel ?? "Open PR in IDE"}
            </MenuItem>
            <MenuItem disabled={props.busy} onClick={props.onStartAgent}>
              Start agent
            </MenuItem>
            <MenuItem
              disabled={props.busy || pull.state === "merged" || pull.draft}
              onClick={props.onMerge}
            >
              {pull.state === "merged" ? "Merged" : "Merge"}
            </MenuItem>
          </OverflowMenu>
        </div>
      </div>
      {props.ideBanner}
      <p className="pr-inline-meta">
        <span>
          <code>{pull.headRef}</code>
          <span aria-hidden> → </span>
          <code>{pull.baseRef}</code>
        </span>
        <span>FILES {pull.files.length}</span>
        <span>
          DIFF <span className="add">+{props.pullDiff.additions}</span>{" "}
          <span className="del">−{props.pullDiff.deletions}</span>
        </span>
        <span className={pull.checks.some((row) => row.status === "success") ? "ok" : undefined}>
          CHECKS {checkFraction(pull.checks)}
        </span>
        <span className={props.loadPath ? `loadpath-risk ${props.loadPath.risk}` : undefined}>
          load path · {props.loadPath?.risk ?? "—"}
        </span>
      </p>
      {props.error ? <ErrorBanner error={props.error} /> : null}
      <div className="codebase-tabs">
        {tabs.map((row) => (
          <button
            key={row.id}
            className={props.prTab === row.id ? "active" : ""}
            onClick={() => {
              if (row.id === "stack") openStack(null);
              else props.setPrTab(row.id);
            }}
          >
            {row.label}
            {row.count ? <span className="tab-count">{row.count}</span> : null}
          </button>
        ))}
      </div>
      {props.prTab === "overview" ? (
        <div className="pr-overview">
          <LoadPathPanel
            review={props.loadPath}
            notes={props.loadPathNotes}
            busy={props.busy}
            onNotes={props.setLoadPathNotes}
            onSave={props.onSaveLoadPathNotes}
            onJumpToFile={props.onJumpToFile}
          />
          <section>
            <h3>Change stack</h3>
            {!props.changeStack?.cohorts.length ? (
              <p className="hint">A layer-by-layer walkthrough appears once the pull files load.</p>
            ) : (
              <ul className="pr-stack-overview">
                {props.changeStack.cohorts.map((cohort, index) => (
                  <li key={cohort.id}>
                    <button type="button" onClick={() => openStack(cohort.layers[0]?.id ?? null)}>
                      <span>
                        {index + 1}. {cohort.title}
                      </span>
                      <span className="hint">
                        {cohort.layers.length} layer{cohort.layers.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Agent summary</h3>
            {props.agentSummary ? (
              <p className="pr-summary-text">{props.agentSummary}</p>
            ) : (
              <p className="hint">No agent summary yet. Review with agent to generate one.</p>
            )}
          </section>
          <section>
            <h3>Files changed</h3>
            {props.pullFiles.length === 0 ? <p className="hint">No files.</p> : null}
            <ul className="pr-changed-files">
              {props.pullFiles.map((file) => {
                const delta = fileDelta(file);
                return (
                  <li key={file.path}>
                    <button type="button" onClick={() => props.onJumpToFile(file.path)}>
                      <span className="patch-path">{file.path}</span>
                      <span className={deltaTone(delta)}>{delta}</span>
                    </button>
                    <button
                      type="button"
                      className="btn small ghost pr-open-ide"
                      disabled={props.busy}
                      onClick={() => props.onOpenInIde({ path: file.path })}
                    >
                      {props.openingLabel ?? "Open in IDE"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : null}
      {props.prTab === "stack" ? (
        <ChangeStackPanel
          stack={props.changeStack}
          stale={Boolean(
            props.changeStack &&
            ((props.stackViewSha && props.stackViewSha !== pull.headSha) ||
              (props.changeStack.headSha && props.changeStack.headSha !== pull.headSha)),
          )}
          busy={props.busy}
          pullFiles={props.pullFiles}
          pullHeadSha={pull.headSha}
          selected={props.selectedLine}
          commentBody={props.commentBody}
          focused={props.focused}
          summarizing={props.stackSummarizing}
          revisions={props.stackRevisions}
          viewingSha={props.stackViewSha || props.changeStack?.headSha}
          onViewRevision={props.onViewChangeStackRevision}
          onCommentBody={props.setCommentBody}
          onSelectLine={props.onSelectStackLine}
          onComment={props.onComment}
          onClearComment={props.onClearLoc}
          onUpdate={props.onRefreshChangeStack}
          onJumpToFile={props.onJumpToFile}
          onOpenInIde={props.onOpenInIde}
          openingLabel={props.openingLabel}
          onToggleFocus={props.onToggleFocus}
          layout={props.diffLayout}
          viewedPaths={props.viewedPaths}
          onLayoutChange={props.onLayoutChange}
          onToggleViewed={props.onToggleViewed}
          preMerge={preMerge}
          focusLayerId={stackFocusLayer}
          openToken={stackOpenToken}
        />
      ) : null}
      {props.prTab === "conversation" ? (
        <div className="codebase-body pr-thread">
          <section className="pr-card">
            <header>
              <strong>{pull.author || "description"}</strong>
              <span className="hint">opened {formatAgo(pull.updatedAt)}</span>
            </header>
            {pull.body ? <Markdown text={pull.body} /> : <p className="hint">No description.</p>}
          </section>
          <ul className="pr-comments">
            {pull.comments.map((row) => (
              <li key={row.id} className="pr-card">
                <header>
                  <strong>{row.author || "comment"}</strong>
                  {row.path ? (
                    <>
                      <button
                        className="pr-loc"
                        onClick={() => props.onOpenLoc(row.path, row.line, row.side)}
                      >
                        {row.path}
                        {row.line ? `:${row.line}` : ""}
                      </button>
                      <button
                        type="button"
                        className="btn small ghost pr-open-ide"
                        disabled={props.busy}
                        onClick={() =>
                          props.onOpenInIde({
                            path: row.path,
                            line: row.side === "LEFT" ? undefined : row.line,
                          })
                        }
                      >
                        {props.openingLabel ?? "Open in IDE"}
                      </button>
                    </>
                  ) : null}
                  <span className="hint">{formatAgo(row.createdAt)}</span>
                </header>
                <Markdown text={row.body} />
              </li>
            ))}
          </ul>
          <section className="pr-composer">
            <div className="field">
              <label>Comment</label>
              <textarea
                value={props.commentBody}
                onChange={(e) => props.setCommentBody(e.target.value)}
                rows={3}
                placeholder="Leave a comment on the conversation, or pick a line in Files."
              />
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Path (optional)</label>
                <input
                  value={props.commentPath}
                  onChange={(e) => {
                    props.setCommentPath(e.target.value);
                    if (!e.target.value.trim()) props.setCommentSide("");
                  }}
                  placeholder="src/app.ts"
                />
              </div>
              <div className="field">
                <label>Line (optional)</label>
                <input
                  value={props.commentLine}
                  onChange={(e) => props.setCommentLine(e.target.value)}
                  placeholder="42"
                />
              </div>
            </div>
            {props.commentPath.trim() ? (
              <div className="field">
                <label>Side</label>
                <Select
                  ariaLabel="Side"
                  value={props.commentSide || "RIGHT"}
                  options={[
                    { value: "RIGHT", label: "New file" },
                    { value: "LEFT", label: "Old file" },
                  ]}
                  onChange={(value) => props.setCommentSide(value === "LEFT" ? "LEFT" : "RIGHT")}
                />
              </div>
            ) : null}
            <button
              className="btn"
              disabled={props.busy || !props.commentBody.trim()}
              onClick={props.onComment}
            >
              Comment
            </button>
          </section>
          <section className="pr-composer review">
            <div className="field">
              <label>Review</label>
              <textarea
                value={props.reviewBody}
                onChange={(e) => props.setReviewBody(e.target.value)}
                rows={3}
                placeholder="Summarize the review for the author."
              />
            </div>
            <div className="review-events" role="group" aria-label="Review event">
              {(
                [
                  ["COMMENT", "Comment"],
                  ["APPROVE", "Approve"],
                  ["REQUEST_CHANGES", "Request changes"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={props.reviewEvent === id ? "active" : ""}
                  onClick={() => props.setReviewEvent(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="btn"
              disabled={props.busy || !props.reviewBody.trim()}
              onClick={props.onReview}
            >
              Submit review
            </button>
          </section>
        </div>
      ) : null}
      {props.prTab === "commits" ? (
        <ul className="pr-list commit-list">
          {pull.commits.length === 0 ? <li className="hint">No commits</li> : null}
          {pull.commits.map((row) => (
            <li key={row.sha} className="commit-row">
              <code>{row.sha.slice(0, 8)}</code>
              <span>
                <strong>{row.message.split("\n")[0]}</strong>
                <div className="meta">
                  {row.author ?? "unknown"}
                  {row.createdAt ? ` · ${formatAgo(row.createdAt)}` : ""}
                </div>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {props.prTab === "checks" ? (
        <ul className="pr-list check-list">
          {pull.checks.length === 0 ? <li className="hint">No checks</li> : null}
          {pull.checks.map((row) => (
            <li key={row.name} className="check-row">
              <span className={`check-dot ${checkTone(row.status)}`} />
              <span>
                <strong>{row.name}</strong>
                <div className="meta">{row.status.replace(/_/g, " ")}</div>
              </span>
              {row.url ? (
                <a href={row.url} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {props.prTab === "files" ? (
        <div className="pr-files">
          <PrFileExplorer
            key={`${pull.repoId}:${pull.number}`}
            files={props.pullFiles}
            focusPath={props.selectedLine?.path ?? props.jumpPath ?? diffFocus}
            onSelect={(path) => {
              setDiffFocus(path);
              jumpToFile(path);
            }}
            diff={props.pullDiff}
          />
          <div className="pr-file-diff">
            <PatchCard
              key={`${pull.repoId}:${pull.number}`}
              files={props.pullFiles}
              density="review"
              focusPath={diffPath}
              selected={props.selectedLine}
              onLineSelect={props.onSelectLine}
              layout={props.diffLayout}
              viewedPaths={props.viewedPaths}
              onLayoutChange={props.onLayoutChange}
              onToggleViewed={props.onToggleViewed}
              onOpenSymbol={(path, line) => props.onOpenInIde({ path, line })}
            />
            {props.selectedLine ? (
              <section className="pr-inline-comment">
                <header>
                  <span>
                    Commenting on {props.selectedLine.path}:{props.selectedLine.line} (
                    {props.selectedLine.side === "LEFT" ? "old" : "new"})
                  </span>
                  <button type="button" className="btn small ghost" onClick={props.onClearLoc}>
                    Clear
                  </button>
                </header>
                <textarea
                  value={props.commentBody}
                  onChange={(e) => props.setCommentBody(e.target.value)}
                  rows={3}
                  aria-label="Line comment"
                  placeholder="Write a line comment…"
                />
                <button
                  className="btn"
                  disabled={props.busy || !props.commentBody.trim()}
                  onClick={props.onComment}
                >
                  Comment
                </button>
              </section>
            ) : (
              <p className="hint">Click a diff line to comment on that hunk.</p>
            )}
            <div className="pr-diff-foot">
              <span className={props.loadPath ? `loadpath-risk ${props.loadPath.risk}` : undefined}>
                load path · {props.loadPath?.risk ?? "—"}
              </span>
              <span className={pull.checks.length ? "ok" : undefined}>
                checks {checkFraction(pull.checks)}
                {pull.checks.length ? " passing" : ""}
              </span>
              <span>unified diff</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
