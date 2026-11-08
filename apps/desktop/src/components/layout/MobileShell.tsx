import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AgentCanvasPane, useAgentCanvasFocus } from "@/components/workspace/AgentCanvasPane";
import {
  DEFAULT_DOCKER_IMAGE,
  DESIGN_DOCKER_IMAGE,
  THEME_OPTIONS,
  askUserIntro,
  askUserItems,
  chatInputError,
  clusterChatThread,
  formatAskUserReply,
  isAskUserToolName,
  isHiddenChatMessage,
  isSpawnAgentToolName,
  isTaskListToolName,
  isThemeId,
  parseChatDensity,
  latestCloneStartMessageId,
  latestImageBuildStartMessageId,
  CLONE_WAIT_STATUS,
  IMAGE_BUILD_WAIT_STATUS,
  isCloneWaiting,
  isImageBuildWaiting,
  localModelWaitHint,
  localModelWaitLabel,
  matchSubagent,
  findLiveSubagent,
  parseDockerImage,
  patchFilesFromTool,
  parseSubagentKind,
  formatSubagentKind,
  operatorVisibleText,
  sessionRuntime,
  canClearChat,
  CLEAR_CHAT_CONFIRM,
  subagentStatusLabel,
  subagentViewMessages,
  showThoughtTraces,
  themeOption,
  isFoldableToolActivity,
  toolActivityGroups,
  toolActivityLabel,
  toolActivityStatus,
  toolActivitySummary,
  toolChipLabel,
  turnToolCalls,
  workspaceFollowFromTool,
  type AgentSession,
  type ChatMessage,
  type SubagentLive,
  type ToolCall,
} from "@locus/shared";
import { api, type WorkspaceEntry } from "@/lib/api";
import { sessionArtifacts, type SessionArtifact } from "@/lib/artifacts";
import { chatPromptLanded } from "@/lib/chatTurn";
import {
  loadLastAgent,
  rememberedRuntime,
  rememberedWorkerId,
  resolveAgentDefaults,
  saveLastAgent,
} from "@/lib/lastAgent";
import { formatMarkdown, prUrlFromToolOutput } from "@/lib/markdown";
import { clearPhoneAuth, withPhoneToken } from "@/lib/phoneAuth";
import {
  agentStatusTone,
  compactRelativeTime,
  filterMobileAgents,
  groupMobileRows,
  lastChatSnippet,
  matchesMobileQuery,
  mobileDesigns,
  mobileGames,
  mobileAssets,
  mobileIdeWorkspaces,
  mobileSessions,
  pendingApprovals,
  sessionMetaLine,
  sessionNeedsYou,
  sessionShowsBrowser,
  sessionStatusLabel,
  setUiShell,
  bindMobileViewport,
  type MobileAgentFilter,
  type UiShell,
} from "@/lib/mobileShell";
import { loadMobileAgentFilter, saveMobileAgentFilter } from "@/lib/sidebarPrefs";
import { MobileBoardList, MobileBoardView } from "@/components/board/MobileBoard";
import { MobileProjectList } from "@/components/projects/MobileProject";
import { APP_VERSION } from "@/lib/appInfo";
import { batchableApprovals, needsYouHumanItems, type NeedsYouItem } from "@/lib/needsYou";
import { applyChatDensity, applyTheme } from "@/lib/theme";
import { useStore } from "@/state/store";
import { screenshotSrc } from "@/components/chat/GuestTimeline";
import { BrowserPane } from "@/components/guest/BrowserPane";
import {
  IconAgents,
  IconGear,
  IconGlobe,
  IconHash,
  IconMore,
  IconPalette,
  IconPencil,
  IconPlus,
  IconRepo,
  IconSearch,
  IconSend,
  IconStop,
} from "./Icons";
import { MenuItem, OverflowMenu } from "./OverflowMenu";
import { Select } from "./Select";
import { MobileFitPane } from "./MobileFitPane";
import { observePinThreadToLatest } from "@/lib/threadScroll";
import { visitMarkerId } from "@/lib/chatNewMarker";
import { askConfirm } from "@/lib/dialog";
import { showNotice } from "@/lib/notice";
import { PatchCard, ToolPatch } from "@/components/chat/PatchCard";
import { CloneProgressCard, ImageBuildCard } from "@/components/chat/CloneProgressCard";
import { SubagentCard } from "@/components/chat/SubagentCard";
import { ThinkingTrace } from "@/components/chat/ThinkingTrace";
import { NewMessagesDivider } from "@/components/chat/NewMessagesDivider";
import { MobileDesignCanvas, MobileDesignList } from "@/components/design/MobileDesign";
import {
  MobilePullDetail,
  MobileRepoList,
  MobileRepoPulls,
} from "@/components/codebase/MobileCodebase";
import { MobileSlackChat, MobileSlackList } from "@/components/slack/MobileSlack";
import { GrafanaPane } from "@/components/grafana/Grafana";
import { Mascot } from "./Mascot";

type MobileTab = "chats" | "design" | "code" | "slack" | "inbox" | "more";
type ComposeKind = "agent" | "design" | "game" | "assets";

function tabTitle(tab: MobileTab, repoName?: string): string {
  if (tab === "chats") return "Agents";
  if (tab === "design") return "Design";
  if (tab === "code") return repoName ?? "Code";
  if (tab === "slack") return "Slack";
  if (tab === "inbox") return "Needs you";
  return "This phone";
}

function MobileToolLine(props: {
  name: string;
  args: Record<string, unknown>;
  result?: string;
  error?: string;
  finishedAt?: string;
}) {
  const label = toolActivityLabel(props.name, props.args);
  const [name, ...detail] = label.split(" ");
  const activityStatus = toolActivityStatus([
    {
      name: props.name,
      arguments: props.args,
      result: props.result,
      error: props.error,
      finishedAt: props.finishedAt,
    },
  ]);
  const status = props.error
    ? "failed"
    : (activityStatus ?? (props.finishedAt ? "done" : "running"));
  const output =
    props.error ||
    props.result ||
    (props.name === "exec" || props.name === "powershell"
      ? Array.isArray(props.args.commands)
        ? props.args.commands.filter((item): item is string => typeof item === "string").join("\n")
        : typeof props.args.command === "string"
          ? props.args.command
          : undefined
      : undefined);
  return (
    <details className="mobile-tool" data-testid="mobile-tool">
      <summary>
        <span className="mobile-tool-copy">
          <span className="mobile-tool-name">{name}</span>
          {detail.length ? (
            <>
              {" "}
              <span className="mobile-tool-detail">{detail.join(" ")}</span>
            </>
          ) : null}
        </span>
        <span className={`mobile-tool-status mobile-tool-status-${mobileStatusClass(status)}`}>
          {mobileStatusLabel(status)}
        </span>
      </summary>
      {output ? <pre className="mobile-tool-output">{output}</pre> : null}
    </details>
  );
}

function mobileStatusLabel(status: string | undefined): string {
  if (status === "waiting for approval") return "Needs approval";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  return "Completed";
}

function mobileStatusClass(status: string | undefined): string {
  return (status ?? "done").replace(/\s+/g, "-");
}

function isMobileInlineTool(call: ToolCall, tools: ChatMessage[]): boolean {
  const result = mobileToolResult(call, tools);
  return (
    !patchFilesFromTool(call.name, call.arguments, result).length &&
    call.name !== "git_pr" &&
    !isSpawnAgentToolName(call.name)
  );
}

function isMobileGroupableTool(call: ToolCall): boolean {
  return isFoldableToolActivity(call);
}

function MobileToolActivityList(props: {
  calls: ToolCall[];
  tools: ChatMessage[];
  session: AgentSession;
  viewing: boolean;
  onOpenSubagent: (agent: SubagentLive) => void;
}) {
  const nodes: ReactNode[] = [];
  let inline: ToolCall[] = [];

  const flushInline = () => {
    for (const group of toolActivityGroups(inline)) {
      const status = toolActivityStatus(
        group.map((call) => ({ ...call, result: mobileToolResult(call, props.tools) })),
      );
      const summary = toolActivitySummary(group);
      if (group.length === 1) {
        const call = group[0]!;
        nodes.push(
          <MobileToolLine
            key={call.id}
            name={call.name}
            args={call.arguments}
            result={mobileToolResult(call, props.tools)}
            error={call.error}
            finishedAt={call.finishedAt}
          />,
        );
        continue;
      }
      const [name, ...detail] = summary.split(" ");
      nodes.push(
        <details
          className="mobile-tool-group"
          data-testid="mobile-tool-group"
          key={group.map((call) => call.id).join("-")}
        >
          <summary>
            <span className="mobile-tool-copy">
              <span className="mobile-tool-name">{name}</span>
              {detail.length ? (
                <>
                  {" "}
                  <span className="mobile-tool-detail">{detail.join(" ")}</span>
                </>
              ) : null}
            </span>
            <span className={`mobile-tool-status mobile-tool-status-${mobileStatusClass(status)}`}>
              {mobileStatusLabel(status)}
            </span>
          </summary>
          <div className="mobile-tool-group-body">
            {group.map((call) => (
              <MobileToolLine
                key={call.id}
                name={call.name}
                args={call.arguments}
                result={mobileToolResult(call, props.tools)}
                error={call.error}
                finishedAt={call.finishedAt}
              />
            ))}
          </div>
        </details>,
      );
    }
    inline = [];
  };

  for (const call of props.calls) {
    if (isTaskListToolName(call.name)) {
      flushInline();
      continue;
    }
    if (isMobileInlineTool(call, props.tools)) {
      if (isMobileGroupableTool(call)) {
        inline.push(call);
      } else {
        flushInline();
        nodes.push(
          <MobileToolLine
            key={call.id}
            name={call.name}
            args={call.arguments}
            result={mobileToolResult(call, props.tools)}
            error={call.error}
            finishedAt={call.finishedAt}
          />,
        );
      }
      continue;
    }
    flushInline();
    const result = mobileToolResult(call, props.tools);
    if (!props.viewing && isSpawnAgentToolName(call.name)) {
      const agent = matchSubagent(props.session.subagents, call) ?? {
        id: call.id,
        task:
          typeof call.arguments.task === "string" && call.arguments.task.trim()
            ? call.arguments.task.trim()
            : "Subagent",
        status: call.finishedAt ? (call.error ? "error" : "done") : "running",
        lastLine: result,
        kind: parseSubagentKind(call.arguments.kind),
        toolCallId: call.id,
      };
      nodes.push(<SubagentCard key={call.id} agent={agent} onOpen={props.onOpenSubagent} />);
    } else if (patchFilesFromTool(call.name, call.arguments, result).length) {
      nodes.push(
        <ToolPatch
          key={call.id}
          name={call.name}
          args={call.arguments}
          result={result}
          sessionId={props.session.id}
          callId={call.id}
        />,
      );
    } else {
      const pr = call.name === "git_pr" ? prUrlFromToolOutput(result ?? "") : undefined;
      nodes.push(
        pr ? (
          <a className="mobile-pr-card" href={pr} target="_blank" rel="noreferrer" key={call.id}>
            {pr}
          </a>
        ) : null,
      );
    }
  }
  flushInline();
  return <>{nodes}</>;
}

export function MobileShell(props: { onShell: (shell: UiShell) => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<MobileTab>("chats");
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<ComposeKind | null>(null);
  const [fromInbox, setFromInbox] = useState(false);
  const [designId, setDesignId] = useState<string | null>(null);
  const [designComment, setDesignComment] = useState(false);
  const [codeRepoId, setCodeRepoId] = useState<string | null>(null);
  const [codePull, setCodePull] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sessions = mobileSessions(state.sessions);
  const designs = mobileDesigns(state.sessions);
  const games = mobileGames(state.sessions);
  const assets = mobileAssets(state.sessions);
  const inbox = pendingApprovals(state.sessions);
  const open = sessions.find((row) => row.id === openId);
  const designOpen = [...designs, ...games, ...assets].find((row) => row.id === designId);
  const codeRepo = state.repos.find((row) => row.id === codeRepoId);
  const pullOpen = Boolean(codeRepo && codePull != null);
  const slackOpen = tab === "slack" && Boolean(state.selectedSlackChannelId);
  const slackTeam = state.slackStatus?.teamName?.trim();
  const canSearch = tab === "chats" || tab === "design" || tab === "slack" || tab === "code";
  const canCreate = tab === "chats" || tab === "design";

  useEffect(() => {
    document.documentElement.dataset.shell = "mobile";
    const stop = bindMobileViewport();
    return () => {
      stop();
      delete document.documentElement.dataset.shell;
    };
  }, []);

  function openChat(id: string, inbox = false) {
    setOpenId(id);
    setCompose(null);
    setFromInbox(inbox);
    dispatch({ type: "select", id });
  }

  function back() {
    setOpenId(null);
    setCompose(null);
    dispatch({ type: "select", id: null });
    if (fromInbox) setTab("inbox");
    setFromInbox(false);
  }

  function goTab(next: MobileTab) {
    setTab(next);
    setSearchOpen(false);
    setSearch("");
    if (next === "slack") dispatch({ type: "section", section: "slack" });
  }

  const chatting =
    Boolean(open) || Boolean(compose) || slackOpen || Boolean(designOpen) || pullOpen;
  const query = searchOpen ? search : "";

  return (
    <div className={`mobile-shell${chatting ? " is-chat" : ""}`} data-testid="mobile-shell">
      {open ? (
        <MobileChat session={open} onBack={back} />
      ) : designOpen ? (
        <MobileDesignCanvas
          session={designOpen}
          startCommenting={designComment}
          onBack={() => {
            setDesignId(null);
            setDesignComment(false);
          }}
          onOpenAgent={(id) => {
            setDesignId(null);
            setDesignComment(false);
            openChat(id);
          }}
        />
      ) : pullOpen && codeRepo && codePull != null ? (
        <MobilePullDetail repo={codeRepo} number={codePull} onBack={() => setCodePull(null)} />
      ) : slackOpen ? (
        <MobileSlackChat
          onBack={() => {
            dispatch({ type: "selectSlackChannel", id: null });
            dispatch({ type: "slackThread", ts: null });
          }}
        />
      ) : compose ? (
        <MobileCompose
          kind={compose}
          onBack={() => setCompose(null)}
          onCreated={(session) => {
            dispatch({ type: "session", session });
            if (session.kind === "design" || session.kind === "game" || session.kind === "assets") {
              setCompose(null);
              setDesignId(session.id);
              return;
            }
            openChat(session.id);
          }}
        />
      ) : (
        <>
          <header className="mobile-top">
            <div className="mobile-top-row">
              <div className="mobile-top-copy">
                {tab === "code" && codeRepo ? null : (
                  <p className="mobile-brand">
                    <Mascot pose="idle" size={18} />
                    Locus
                  </p>
                )}
                <h1>{tabTitle(tab, codeRepo?.name)}</h1>
                {tab === "slack" && slackTeam ? (
                  <p className="mobile-top-meta">{slackTeam}</p>
                ) : null}
              </div>
              {tab === "code" && codeRepo ? (
                <button
                  type="button"
                  className="mobile-icon-btn mobile-back"
                  onClick={() => {
                    setCodeRepoId(null);
                    setCodePull(null);
                    if (fromInbox) setTab("inbox");
                    setFromInbox(false);
                  }}
                >
                  Back
                </button>
              ) : (
                <div className="mobile-top-actions">
                  {canSearch ? (
                    <button
                      type="button"
                      className={`mobile-icon-btn mobile-search${searchOpen ? " on" : ""}`}
                      aria-label="Search"
                      aria-pressed={searchOpen}
                      onClick={() => {
                        setSearchOpen((openSearch) => {
                          if (openSearch) setSearch("");
                          return !openSearch;
                        });
                      }}
                    >
                      <IconSearch />
                    </button>
                  ) : null}
                  {canCreate ? (
                    <button
                      type="button"
                      className="mobile-icon-btn mobile-new"
                      aria-label="New"
                      onClick={() => setCompose(tab === "design" ? "design" : "agent")}
                    >
                      <IconPlus />
                      <span className="mobile-sr">New</span>
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            {searchOpen && canSearch ? (
              <div className="mobile-search-bar">
                <input
                  className="mobile-search-input"
                  type="search"
                  value={search}
                  autoFocus
                  placeholder={`Search ${tabTitle(tab).toLowerCase()}…`}
                  aria-label="Search"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            ) : null}
          </header>
          <div className="mobile-body">
            {tab === "chats" ? (
              <MobileChatList
                sessions={sessions}
                unreadIds={state.unreadIds}
                query={query}
                onOpen={openChat}
              />
            ) : null}
            {tab === "design" ? (
              <MobileDesignList sessions={designs} query={query} onOpen={setDesignId} />
            ) : null}
            {tab === "code" ? (
              codeRepo ? (
                <MobileRepoPulls repo={codeRepo} onOpen={(number) => setCodePull(number)} />
              ) : (
                <MobileRepoList
                  repos={state.repos}
                  query={query}
                  onOpen={(id) => {
                    setCodeRepoId(id);
                    setCodePull(null);
                  }}
                />
              )
            ) : null}
            {tab === "slack" ? <MobileSlackList query={query} /> : null}
            {tab === "inbox" ? (
              <MobileInbox
                items={inbox}
                designs={designs}
                repos={state.repos}
                onOpen={(id) => openChat(id, true)}
                onDesign={(id) => {
                  setDesignId(id);
                  setDesignComment(true);
                }}
                onRepo={(id) => {
                  setFromInbox(true);
                  setCodeRepoId(id);
                  setCodePull(null);
                  setTab("code");
                }}
              />
            ) : null}
            {tab === "more" ? (
              <MobileMore
                onShell={props.onShell}
                onOpenAgent={(id) => openChat(id)}
                onOpenCanvas={(id) => setDesignId(id)}
                onNewGame={() => setCompose("game")}
                onNewAsset={() => setCompose("assets")}
              />
            ) : null}
          </div>
          <nav className="mobile-tabbar" aria-label="Phone">
            <TabButton
              label="Agents"
              active={tab === "chats"}
              onClick={() => goTab("chats")}
              icon={<IconAgents />}
            />
            <TabButton
              label="Design"
              active={tab === "design"}
              onClick={() => goTab("design")}
              icon={<IconPalette />}
            />
            <TabButton
              label="Code"
              active={tab === "code"}
              onClick={() => goTab("code")}
              icon={<IconRepo />}
            />
            <TabButton
              label="Slack"
              active={tab === "slack"}
              onClick={() => goTab("slack")}
              icon={<IconHash />}
              dot={state.slackActivityUnseen}
            />
            <TabButton
              label="Needs you"
              active={tab === "inbox"}
              onClick={() => goTab("inbox")}
              icon={<IconPencil />}
              dot={inbox.length > 0 || sessions.some((row) => Boolean(row.needsHuman?.trim()))}
            />
            <TabButton
              label="More"
              active={tab === "more"}
              onClick={() => goTab("more")}
              icon={<IconGear />}
            />
          </nav>
        </>
      )}
    </div>
  );
}

function TabButton(props: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mobile-tab${props.active ? " on" : ""}`}
      aria-current={props.active ? "page" : undefined}
      onClick={props.onClick}
    >
      <span className="mobile-tab-icon">
        {props.icon}
        {props.dot ? <span className="mobile-tab-dot" /> : null}
      </span>
      <span className="mobile-tab-label">{props.label}</span>
    </button>
  );
}

function MobileChatList(props: {
  sessions: AgentSession[];
  unreadIds: string[];
  query: string;
  onOpen: (id: string) => void;
}) {
  const { state } = useStore();
  const [filter, setFilter] = useState<MobileAgentFilter>(() => loadMobileAgentFilter());
  useEffect(() => {
    saveMobileAgentFilter(filter);
  }, [filter]);
  const needsCount = props.sessions.filter(sessionNeedsYou).length;
  const visible = filterMobileAgents(props.sessions, filter, props.unreadIds).filter((row) =>
    matchesMobileQuery(`${row.title} ${lastChatSnippet(row)}`, props.query),
  );
  const groups = groupMobileRows(visible);
  const chips: Array<{ id: MobileAgentFilter; label: ReactNode }> = [
    { id: "all", label: "All" },
    {
      id: "needs",
      label: (
        <>Needs you{needsCount ? <span className="mobile-chip-count">{needsCount}</span> : null}</>
      ),
    },
    { id: "running", label: "Running" },
    { id: "unseen", label: "Unseen" },
  ];

  if (!props.sessions.length) {
    return (
      <div className="mobile-empty">
        <Mascot pose="idle" size={64} />
        <h2>No agents yet</h2>
        <p>
          Start one from this phone. Approvals, follow-ups, Design comments, Promote, Codebase
          review, and Docker Browser takeover stay here; VNC stays on the desktop.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mobile-chips" role="tablist" aria-label="Filter agents">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={filter === chip.id}
            className={`mobile-chip${filter === chip.id ? " on" : ""}`}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {groups.length ? (
        groups.map((group) => (
          <section key={group.label} className="mobile-day">
            <h2>{group.label}</h2>
            <ul className="mobile-list">
              {group.items.map((row) => {
                const needs = sessionNeedsYou(row);
                const unread = props.unreadIds.includes(row.id);
                const tone = agentStatusTone(row);
                const time = compactRelativeTime(row.updatedAt);
                const meta = sessionMetaLine(row, state.repos);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="mobile-row"
                      aria-label={`${row.title}, ${sessionStatusLabel(row)}${unread ? ", unread" : ""}`}
                      onClick={() => props.onOpen(row.id)}
                    >
                      <span className={`mobile-status-dot is-${tone}`} aria-hidden="true" />
                      <span className="mobile-row-main">
                        <span className="mobile-row-head">
                          <span className="mobile-row-title">
                            {row.title}
                            {unread ? <span className="mobile-dot" /> : null}
                          </span>
                          <span
                            className={`mobile-row-time${needs ? " is-wait" : time === "now" ? " is-now" : ""}`}
                          >
                            {time}
                          </span>
                        </span>
                        <span className="mobile-row-sub">{lastChatSnippet(row)}</span>
                        <span className={`mobile-row-mono${meta.waiting ? " is-wait" : ""}`}>
                          {meta.text}
                          {meta.waiting ? " — WAITING ON YOU" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <p className="hint mobile-filter-empty">Nothing matches this filter.</p>
      )}
    </>
  );
}

function MobileInbox(props: {
  items: ReturnType<typeof pendingApprovals>;
  designs: AgentSession[];
  repos: { id: string; name: string; openPullCount?: number }[];
  onOpen: (id: string) => void;
  onDesign: (id: string) => void;
  onRepo: (id: string) => void;
}) {
  const { state, dispatch } = useStore();
  const reviewRepos = props.repos.filter((row) => (row.openPullCount ?? 0) > 0);
  const humanGates = needsYouHumanItems(state.sessions);
  const batchable = batchableApprovals(props.items);
  const batchSessions = new Set(batchable.map((item) => item.sessionId)).size;
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const empty =
    !props.items.length && !humanGates.length && !props.designs.length && !reviewRepos.length;

  async function decideAll(decision: "approved" | "denied") {
    if (batchBusy || batchable.length < 2) return;
    setBatchBusy(true);
    setBatchError(null);
    try {
      for (const item of batchable) {
        const session = await api.resolveApproval(item.sessionId, item.call.id, decision);
        dispatch({ type: "session", session });
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Could not resolve");
    } finally {
      setBatchBusy(false);
    }
  }

  if (empty) {
    return (
      <div className="mobile-empty">
        <Mascot pose="rest" size={64} />
        <h2>Nothing waiting</h2>
        <p>
          Approvals land here. You can also comment on a Design canvas or reply to a pull from this
          tab.
        </p>
      </div>
    );
  }
  return (
    <div className="mobile-inbox">
      {batchable.length > 1 ? (
        <div className="mobile-inbox-batch" data-testid="mobile-inbox-batch">
          <p className="hint">
            {batchable.length} tool approvals
            {batchSessions > 1 ? ` across ${batchSessions} chats` : ""}. Approve or deny without
            opening each chat.
          </p>
          {batchError ? <p className="mobile-error">{batchError}</p> : null}
          <div className="mobile-actions">
            <button
              type="button"
              className="btn primary"
              disabled={batchBusy}
              onClick={() => void decideAll("approved")}
            >
              Approve all
            </button>
            <button
              type="button"
              className="btn"
              disabled={batchBusy}
              onClick={() => void decideAll("denied")}
            >
              Deny all
            </button>
          </div>
        </div>
      ) : null}
      {props.items.length ? (
        <ul className="mobile-cards">
          {props.items.map((item) => (
            <li key={`${item.sessionId}:${item.call.id}`} className="mobile-card">
              <p className="mobile-kicker">{item.title}</p>
              <ApprovalCard
                sessionId={item.sessionId}
                call={item.call}
                onDone={(session) => dispatch({ type: "session", session })}
              />
              <div className="mobile-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => props.onOpen(item.sessionId)}
                >
                  Open chat
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {humanGates.length ? (
        <ul className="mobile-cards">
          {humanGates.map((item) => (
            <li key={item.key} className="mobile-card">
              <HumanGateCard
                item={item}
                onOpen={props.onOpen}
                onDone={(session) => dispatch({ type: "session", session })}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {props.designs.length ? (
        <section className="mobile-inbox-section">
          <h2 className="mobile-pr-heading">Comment on a canvas</h2>
          <ul className="mobile-list">
            {props.designs.map((row) => (
              <li key={row.id}>
                <button type="button" className="mobile-row" onClick={() => props.onDesign(row.id)}>
                  <span className="mobile-row-main">
                    <span className="mobile-row-title">{row.title}</span>
                    <span className="mobile-row-sub">Pin an element, then send a change</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {reviewRepos.length ? (
        <section className="mobile-inbox-section">
          <h2 className="mobile-pr-heading">Review a pull</h2>
          <ul className="mobile-list">
            {reviewRepos.map((row) => (
              <li key={row.id}>
                <button type="button" className="mobile-row" onClick={() => props.onRepo(row.id)}>
                  <span className="mobile-row-main">
                    <span className="mobile-row-title">{row.name}</span>
                    <span className="mobile-row-sub">
                      {row.openPullCount} open · reply or approve
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MobileMore(props: {
  onShell: (shell: UiShell) => void;
  onOpenAgent: (sessionId: string) => void;
  onOpenCanvas: (sessionId: string) => void;
  onNewGame?: () => void;
  onNewAsset?: () => void;
}) {
  const { state, dispatch } = useStore();
  const theme = state.config?.theme ?? "ember";
  const themeName = themeOption(theme).name;
  const density = parseChatDensity(state.config?.chatDensity);
  const workspaces = mobileIdeWorkspaces(state.sessions);
  const games = mobileGames(state.sessions);
  const assets = mobileAssets(state.sessions);
  const quietOn = Boolean(state.config?.notifyQuietStart || state.config?.notifyQuietEnd);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [grafanaOpen, setGrafanaOpen] = useState(false);

  if (boardId) {
    return (
      <MobileBoardView
        boardId={boardId}
        onBack={() => setBoardId(null)}
        onOpenAgent={(id) => {
          setBoardId(null);
          setBoardsOpen(false);
          props.onOpenAgent(id);
        }}
      />
    );
  }
  if (boardsOpen) {
    return <MobileBoardList onBack={() => setBoardsOpen(false)} onOpen={(id) => setBoardId(id)} />;
  }
  if (projectsOpen) {
    return (
      <MobileProjectList
        onBack={() => setProjectsOpen(false)}
        onOpen={(id) => {
          void api.projectChat(id).then(
            (result) => {
              dispatch({ type: "project", project: result.project });
              setProjectsOpen(false);
              props.onOpenAgent(result.sessionId);
            },
            (err: unknown) => {
              showNotice(err instanceof Error ? err.message : "Could not open project");
            },
          );
        }}
      />
    );
  }
  if (grafanaOpen) {
    return (
      <div className="mobile-grafana">
        <button type="button" className="mobile-setting-row" onClick={() => setGrafanaOpen(false)}>
          <span>Back</span>
          <span className="mobile-setting-value">More</span>
        </button>
        <GrafanaPane />
      </div>
    );
  }

  async function pickTheme(id: string) {
    if (!state.config || !isThemeId(id)) return;
    applyTheme(id);
    const saved = await api.saveConfig({ ...state.config, theme: id });
    dispatch({ type: "config", config: saved });
  }

  async function pickDensity(id: string) {
    if (!state.config) return;
    const chatDensity = parseChatDensity(id);
    applyChatDensity(chatDensity);
    const saved = await api.saveConfig({ ...state.config, chatDensity });
    dispatch({ type: "config", config: saved });
  }

  async function patchNotify(patch: Partial<NonNullable<typeof state.config>>) {
    if (!state.config) return;
    const saved = await api.saveConfig({ ...state.config, ...patch });
    dispatch({ type: "config", config: saved });
  }

  function goDesktop() {
    setUiShell("desktop");
    props.onShell("desktop");
  }

  function signOut() {
    clearPhoneAuth();
    goDesktop();
  }

  return (
    <div className="mobile-more">
      <section className="mobile-link-row">
        <span className={`mobile-live${state.connected ? " on" : ""}`} aria-hidden="true" />
        <div className="mobile-link-copy">
          <p className="mobile-status">
            {state.connected ? "Linked to this computer" : "Reconnecting to the computer"}
          </p>
          <p className="mobile-row-mono">
            {state.connected ? "synced just now / local network" : "waiting / local network"}
          </p>
        </div>
        <button type="button" className="mobile-text-btn" onClick={goDesktop}>
          Unlink
        </button>
      </section>

      <section className="mobile-settings-block">
        <h2>Phone</h2>
        <label className="mobile-setting-row">
          <span>Theme</span>
          <span className="mobile-setting-value">
            <Select
              compact
              ariaLabel="Theme"
              value={theme}
              options={THEME_OPTIONS.map((opt) => ({ value: opt.id, label: opt.name }))}
              onChange={(id) => void pickTheme(id)}
            />
          </span>
        </label>
        <label className="mobile-setting-row">
          <span>Chat density</span>
          <span className="mobile-setting-value">
            <Select
              compact
              ariaLabel="Chat density"
              value={density}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
                { value: "dense", label: "Dense" },
              ]}
              onChange={(id) => void pickDensity(id)}
            />
          </span>
        </label>
        <label className="mobile-setting-row">
          <span>Needs you</span>
          <button
            type="button"
            className={`settings-switch ${state.config?.notifyNeedsYou !== false ? "on" : ""}`}
            role="switch"
            aria-checked={state.config?.notifyNeedsYou !== false}
            data-testid="mobile-notify-needs-you"
            onClick={() =>
              void patchNotify({ notifyNeedsYou: state.config?.notifyNeedsYou === false })
            }
          />
        </label>
        <label className="mobile-setting-row">
          <span>Agent turns</span>
          <button
            type="button"
            className={`settings-switch ${state.config?.notifyAgents !== false ? "on" : ""}`}
            role="switch"
            aria-checked={state.config?.notifyAgents !== false}
            data-testid="mobile-notify-agents"
            onClick={() => void patchNotify({ notifyAgents: state.config?.notifyAgents === false })}
          />
        </label>
        <label className="mobile-setting-row">
          <span>Slack</span>
          <button
            type="button"
            className={`settings-switch ${state.config?.notifySlack !== false ? "on" : ""}`}
            role="switch"
            aria-checked={state.config?.notifySlack !== false}
            onClick={() => void patchNotify({ notifySlack: state.config?.notifySlack === false })}
          />
        </label>
        <label className="mobile-setting-row">
          <span>Automations</span>
          <button
            type="button"
            className={`settings-switch ${state.config?.notifyAutomations !== false ? "on" : ""}`}
            role="switch"
            aria-checked={state.config?.notifyAutomations !== false}
            onClick={() =>
              void patchNotify({ notifyAutomations: state.config?.notifyAutomations === false })
            }
          />
        </label>
        {state.config?.notifyAutomations !== false ? (
          <label className="mobile-setting-row">
            <span>Automation failures only</span>
            <button
              type="button"
              className={`settings-switch ${state.config?.notifyAutomationsFailedOnly ? "on" : ""}`}
              role="switch"
              aria-checked={Boolean(state.config?.notifyAutomationsFailedOnly)}
              data-testid="mobile-notify-automations-failed-only"
              onClick={() =>
                void patchNotify({
                  notifyAutomationsFailedOnly: !state.config?.notifyAutomationsFailedOnly,
                })
              }
            />
          </label>
        ) : null}
        <label className="mobile-setting-row">
          <span>Quiet hours</span>
          <button
            type="button"
            className={`settings-switch ${quietOn ? "on" : ""}`}
            role="switch"
            aria-checked={quietOn}
            data-testid="mobile-notify-quiet"
            onClick={() =>
              void patchNotify(
                quietOn
                  ? { notifyQuietStart: undefined, notifyQuietEnd: undefined }
                  : { notifyQuietStart: "22:00", notifyQuietEnd: "08:00" },
              )
            }
          />
        </label>
        {quietOn ? (
          <div className="mobile-setting-row">
            <span>From / until</span>
            <span className="mobile-setting-value">
              <input
                type="time"
                aria-label="Quiet hours start"
                value={state.config?.notifyQuietStart ?? "22:00"}
                onChange={(event) =>
                  void patchNotify({ notifyQuietStart: event.target.value || undefined })
                }
              />
              <input
                type="time"
                aria-label="Quiet hours end"
                value={state.config?.notifyQuietEnd ?? "08:00"}
                onChange={(event) =>
                  void patchNotify({ notifyQuietEnd: event.target.value || undefined })
                }
              />
            </span>
          </div>
        ) : null}
        <div className="mobile-setting-row" data-testid="mobile-pairing">
          <span>Pairing</span>
          <span className="mobile-setting-value">
            {state.config?.phoneRemote?.enabled
              ? state.config.phoneRemote.token
                ? "Linked · token on desktop"
                : "Enabled · no token"
              : "Off · enable on desktop"}
          </span>
        </div>
        <div className="mobile-setting-row">
          <span>Layout</span>
          <div className="mobile-seg" role="group" aria-label="Layout">
            <button type="button" className="on" aria-pressed="true">
              Phone
            </button>
            <button type="button" aria-pressed="false" onClick={goDesktop}>
              Desktop
            </button>
          </div>
        </div>
      </section>

      <section className="mobile-settings-block" data-testid="mobile-games">
        <h2>Games</h2>
        <button type="button" className="mobile-setting-row" onClick={() => props.onNewGame?.()}>
          <span>New game</span>
          <span className="mobile-setting-value">Playable canvas</span>
        </button>
        {games.length ? (
          games.map((row) => (
            <button
              key={row.id}
              type="button"
              className="mobile-setting-row"
              onClick={() => props.onOpenCanvas(row.id)}
            >
              <span>{row.title}</span>
              <span className="mobile-setting-value">Play canvas</span>
            </button>
          ))
        ) : (
          <p className="mobile-row-mono">No games yet. New game starts a playable canvas.</p>
        )}
      </section>

      <section className="mobile-settings-block" data-testid="mobile-assets">
        <h2>Assets</h2>
        <button type="button" className="mobile-setting-row" onClick={() => props.onNewAsset?.()}>
          <span>New asset</span>
          <span className="mobile-setting-value">2D / 3D studio</span>
        </button>
        {assets.length ? (
          assets.map((row) => (
            <button
              key={row.id}
              type="button"
              className="mobile-setting-row"
              onClick={() => props.onOpenCanvas(row.id)}
            >
              <span>{row.title}</span>
              <span className="mobile-setting-value">Open studio</span>
            </button>
          ))
        ) : (
          <p className="mobile-row-mono">
            No assets yet. New asset starts a 2D/3D studio from a photo or prompt.
          </p>
        )}
      </section>

      <section className="mobile-settings-block" data-testid="mobile-boards">
        <h2>Boards</h2>
        <button type="button" className="mobile-setting-row" onClick={() => setBoardsOpen(true)}>
          <span>Open boards</span>
          <span className="mobile-setting-value">
            {(state.boards ?? []).filter((row) => !row.archived).length || "None"} · sticky /
            comment / run
          </span>
        </button>
      </section>

      <section className="mobile-settings-block" data-testid="mobile-projects">
        <h2>Projects</h2>
        <button type="button" className="mobile-setting-row" onClick={() => setProjectsOpen(true)}>
          <span>Open projects</span>
          <span className="mobile-setting-value">
            {(state.projects ?? []).filter((row) => !row.archived).length || "None"} · coordinator
            chat
          </span>
        </button>
      </section>

      <section className="mobile-settings-block" data-testid="mobile-brain">
        <h2>Brain</h2>
        <button type="button" className="mobile-setting-row" onClick={goDesktop}>
          <span>Open on desktop</span>
          <span className="mobile-setting-value">Index · remember · orient</span>
        </button>
      </section>

      <section className="mobile-settings-block" data-testid="mobile-grafana">
        <h2>Grafana</h2>
        <button type="button" className="mobile-setting-row" onClick={() => setGrafanaOpen(true)}>
          <span>Open explorer</span>
          <span className="mobile-setting-value">Logs · traces · investigate</span>
        </button>
      </section>

      <section className="mobile-settings-block" data-testid="mobile-docker">
        <h2>Docker</h2>
        <button type="button" className="mobile-setting-row" onClick={goDesktop}>
          <span>Open on desktop</span>
          <span className="mobile-setting-value">Containers · compose</span>
        </button>
      </section>

      <section className="mobile-settings-block" data-testid="mobile-automations">
        <h2>Automations</h2>
        {state.automations.length ? (
          state.automations.map((row) => (
            <div key={row.id} className="mobile-setting-row">
              <span>{row.name}</span>
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  void api
                    .patchAutomation(row.id, { enabled: !row.enabled })
                    .then((automation) => dispatch({ type: "automation", automation }));
                }}
              >
                {row.enabled ? "Pause" : "Enable"}
              </button>
            </div>
          ))
        ) : (
          <p className="mobile-row-mono">No automations yet.</p>
        )}
      </section>

      <section className="mobile-settings-block" data-testid="mobile-ide">
        <h2>IDE</h2>
        {workspaces.length ? (
          workspaces.map((row) => (
            <button
              key={row.id}
              type="button"
              className="mobile-setting-row"
              onClick={() => {
                dispatch({ type: "select", id: row.id });
                goDesktop();
              }}
            >
              <span>{row.title}</span>
              <span className="mobile-setting-value">Open on desktop</span>
            </button>
          ))
        ) : (
          <p className="mobile-row-mono">IDE workspaces stay on the desktop.</p>
        )}
      </section>

      <section className="mobile-cap-block">
        <h2>What this phone does</h2>
        <ul className="mobile-tags">
          {[
            "Chat",
            "Slack",
            "Approvals",
            "Design comments",
            "Games",
            "Promote",
            "Boards",
            "Projects",
            "Codebase review",
            "Grafana explorer",
            "PR merge",
            "Workspace files",
            "Docker agent browser",
            "Login takeover",
          ].map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>
      <section className="mobile-cap-block">
        <h2>Stays on the desktop</h2>
        <ul className="mobile-tags is-muted">
          {["Live VNC", "Settings", "New automation", "Command palette", "Find in chat"].map(
            (label) => (
              <li key={label}>{label}</li>
            ),
          )}
        </ul>
      </section>

      <button type="button" className="mobile-text-btn mobile-signout" onClick={signOut}>
        Sign out
      </button>
      <p className="mobile-version">locus {APP_VERSION} / agent 0.1</p>
      <span className="mobile-sr">{themeName}</span>
    </div>
  );
}

function MobileCompose(props: {
  kind: ComposeKind;
  onBack: () => void;
  onCreated: (session: AgentSession) => void;
}) {
  const { state } = useStore();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prefs = loadLastAgent();
  const runtime = rememberedRuntime(prefs);
  const defaults = resolveAgentDefaults(state.config, prefs.os, prefs);
  const backendId = rememberedWorkerId(prefs, state.config?.workers ?? []);

  async function start() {
    if (!state.config || busy) return;
    const cap = chatInputError(prompt);
    if (cap) {
      setError(cap);
      return;
    }
    if (!defaults.providerId) {
      setError("Add a provider on the desktop in Settings, then try again.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const isCanvas = props.kind === "design" || props.kind === "game" || props.kind === "assets";
      const useDocker = isCanvas || runtime === "docker";
      const dockerImage = useDocker
        ? parseDockerImage(
            isCanvas ? DESIGN_DOCKER_IMAGE : (prefs.dockerImage ?? DEFAULT_DOCKER_IMAGE),
          )
        : undefined;
      const session = await api.createSession({
        os: isCanvas ? "ubuntu" : prefs.os,
        templateId: defaults.templateId || (runtime === "host" && !isCanvas ? "host" : ""),
        kind:
          props.kind === "design"
            ? "design"
            : props.kind === "game"
              ? "game"
              : props.kind === "assets"
                ? "assets"
                : undefined,
        runtime: isCanvas ? "docker" : runtime,
        dockerImage,
        providerId: defaults.providerId,
        model: defaults.model,
        startVm: isCanvas || runtime !== "host" || Boolean(backendId),
        prompt: prompt.trim() || undefined,
        hostDir: !isCanvas && runtime === "host" ? prefs.hostDir : undefined,
        vision: !isCanvas && runtime === "host" ? "off" : undefined,
        ...(backendId ? { placement: "worker" as const, backendId } : {}),
      });
      saveLastAgent({
        ...prefs,
        os: isCanvas ? "ubuntu" : prefs.os,
        runtime: isCanvas ? "docker" : runtime,
        dockerImage: isCanvas ? DESIGN_DOCKER_IMAGE : prefs.dockerImage,
        providerId: defaults.providerId,
        model: defaults.model,
        placement: backendId ? "worker" : "local",
        backendId: backendId || undefined,
      });
      props.onCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chat");
    } finally {
      setBusy(false);
    }
  }

  const isDesign = props.kind === "design";
  const isGame = props.kind === "game";
  const isAssets = props.kind === "assets";

  return (
    <div className="mobile-screen">
      <header className="mobile-top is-thread">
        <button type="button" className="mobile-icon-btn mobile-back" onClick={props.onBack}>
          Back
        </button>
        <h1>
          {isAssets ? "New asset" : isGame ? "New game" : isDesign ? "New canvas" : "New agent"}
        </h1>
        <span className="mobile-top-spacer" />
      </header>
      <div className="mobile-body mobile-compose">
        <p className="hint">
          {isAssets
            ? "Starts an Assets studio on Docker with the last provider you used."
            : isGame
              ? "Starts a playable Games canvas on Docker with the last provider you used."
              : isDesign
                ? "Starts a Design canvas on Docker with the last provider you used."
                : `Starts with the same runtime you last used on the desktop (${
                    backendId ? `worker · ${backendId}` : runtime
                  }${!backendId && runtime === "docker" ? ` · ${prefs.dockerImage ?? DEFAULT_DOCKER_IMAGE}` : ""}).`}
        </p>
        <textarea
          className="mobile-input"
          rows={5}
          autoFocus
          placeholder={
            isAssets
              ? "What should we build?"
              : isGame
                ? "What should we play?"
                : isDesign
                  ? "What should we design?"
                  : "What should I work on?"
          }
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
        {error ? <p className="mobile-error">{error}</p> : null}
      </div>
      <div className="mobile-composer is-solo">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
    </div>
  );
}

function MobileChat(props: { session: AgentSession; onBack: () => void }) {
  const { state, dispatch } = useStore();
  const session = state.sessions.find((row) => row.id === props.session.id) ?? props.session;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outbound, setOutbound] = useState<ChatMessage | null>(null);
  const [openSubagent, setOpenSubagent] = useState<SubagentLive | null>(null);
  const [browser, setBrowser] = useState(false);
  const [pane, setPane] = useState<"chat" | "diff" | "files" | "canvas">("chat");
  const canvasFocus = useAgentCanvasFocus(session.id, session.agentCanvases);
  useEffect(() => {
    if (canvasFocus > 0) setPane("canvas");
  }, [canvasFocus]);
  const thread = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const liveSubagent = openSubagent ? findLiveSubagent(session.subagents, openSubagent) : undefined;
  const viewing = liveSubagent ?? openSubagent ?? null;
  const turning = viewing ? viewing.status === "running" : busy || session.status === "running";
  const thoughtTraces = showThoughtTraces({
    surface: session.surface,
    productMode: state.config?.productMode,
  });
  const canWatchBrowser = sessionShowsBrowser(session);
  const pending = viewing ? [] : pendingApprovals([session]);
  const outboundVisible =
    viewing || !(outbound && !chatPromptLanded(session, outbound.content)) ? null : outbound;
  const messages = (
    viewing
      ? subagentViewMessages(viewing)
      : outboundVisible
        ? [...session.messages, outboundVisible]
        : session.messages
  ).filter((row) => !isHiddenChatMessage(row));
  const newMarkerId = viewing ? undefined : visitMarkerId(state.chatNewVisit, session.id);
  const cloneStartId = viewing ? undefined : latestCloneStartMessageId(messages);
  const cloneProgressLive = state.cloneProgress[session.id];
  const waitingClone = !viewing && isCloneWaiting(cloneProgressLive);
  const buildStartId = viewing ? undefined : latestImageBuildStartMessageId(messages);
  const imageProgressLive = state.imageProgress[session.id];
  const waitingBuild = !viewing && isImageBuildWaiting(imageProgressLive);
  const provider = state.config?.providers.find((row) => row.id === session.providerId);
  const liveThought = viewing
    ? viewing.status === "running"
      ? (viewing.lastLine ?? "")
      : ""
    : (state.thinking[session.id] ?? "");
  const localWait =
    !viewing && turning && !waitingClone && !waitingBuild && !liveThought
      ? localModelWaitLabel(provider)
      : undefined;
  const workingText = waitingBuild
    ? IMAGE_BUILD_WAIT_STATUS
    : waitingClone
      ? CLONE_WAIT_STATUS
      : liveThought && thoughtTraces
        ? liveThought
        : localWait
          ? [localWait, localModelWaitHint(provider)].filter(Boolean).join(" ")
          : "Working…";

  useLayoutEffect(() => {
    if (browser) return;
    return observePinThreadToLatest(thread.current);
  }, [session.id, browser, pane, viewing?.id, messages.length, turning, liveThought]);

  useEffect(() => {
    setOutbound(null);
    setOpenSubagent(null);
    setBrowser(false);
    setPane("chat");
  }, [session.id]);

  const patches = sessionArtifacts(messages).filter(
    (item): item is Extract<SessionArtifact, { kind: "patch" }> => item.kind === "patch",
  );

  async function send() {
    const content = text.trim();
    if (!content || sending.current || viewing) return;
    const cap = chatInputError(content);
    if (cap) {
      setError(cap);
      return;
    }
    sending.current = true;
    setText("");
    setBusy(true);
    setError(null);
    setOutbound({
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      steer: turning || undefined,
      createdAt: new Date().toISOString(),
    });
    try {
      await api.chat(session.id, content, turning ? { steer: true } : undefined);
    } catch (err) {
      setOutbound(null);
      setText(content);
      setError(err instanceof Error ? err.message : "Couldn't send");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function dismissNeedsYou() {
    try {
      const updated = await api.patchSession(session.id, { needsHuman: null });
      dispatch({ type: "session", session: updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't dismiss");
    }
  }

  return (
    <div className={`mobile-screen${browser ? " is-browser" : " has-tabs"}`}>
      <header className="mobile-top is-thread">
        <button
          type="button"
          className="mobile-icon-btn mobile-back"
          onClick={() =>
            viewing ? setOpenSubagent(null) : browser ? setBrowser(false) : props.onBack()
          }
        >
          Back
        </button>
        <div className="mobile-top-title">
          <h1>{viewing ? viewing.task : session.title}</h1>
          <p className="mobile-kicker">
            {viewing
              ? `${formatSubagentKind(viewing.kind ?? "explore")} subagent · ${subagentStatusLabel(viewing.status)}`
              : browser
                ? "Browser"
                : sessionStatusLabel(session)}
          </p>
        </div>
        <span className="mobile-top-actions">
          {canWatchBrowser && !viewing ? (
            <button
              type="button"
              className={`mobile-icon-btn${browser ? " on" : ""}`}
              aria-label={browser ? "Hide browser" : "Open browser"}
              aria-pressed={browser}
              onClick={() => setBrowser((open) => !open)}
            >
              <IconGlobe />
              <span className="mobile-sr">{browser ? "Hide browser" : "Open browser"}</span>
            </button>
          ) : null}
          {turning && !viewing ? (
            <button
              type="button"
              className="mobile-icon-btn mobile-stop"
              onClick={() =>
                void api.abortChat(session.id).catch((err) => {
                  setError(err instanceof Error ? err.message : "Couldn't stop");
                })
              }
            >
              <IconStop />
              Stop
            </button>
          ) : !viewing ? (
            <OverflowMenu label={<IconMore />} title="Thread" toggleClassName="mobile-icon-btn">
              <MenuItem
                onClick={() => {
                  void api
                    .fork(session.id)
                    .then((forked) => {
                      dispatch({ type: "session", session: forked });
                      dispatch({ type: "select", id: forked.id });
                    })
                    .catch((err) => {
                      setError(err instanceof Error ? err.message : "Couldn't duplicate");
                    });
                }}
              >
                Duplicate
              </MenuItem>
              {canClearChat(session) ? (
                <MenuItem
                  onClick={() => {
                    void (async () => {
                      if (
                        !(await askConfirm({
                          title: "Clear chat?",
                          body: CLEAR_CHAT_CONFIRM,
                          confirmLabel: "Clear",
                          danger: true,
                        }))
                      )
                        return;
                      try {
                        const updated = await api.clearChat(session.id);
                        dispatch({ type: "session", session: updated });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Couldn't clear");
                      }
                    })();
                  }}
                >
                  Clear chat
                </MenuItem>
              ) : null}
            </OverflowMenu>
          ) : canWatchBrowser && !viewing ? null : (
            <span className="mobile-top-spacer" />
          )}
        </span>
      </header>
      <nav
        className="mobile-chat-tabs"
        hidden={browser || Boolean(viewing)}
        data-testid="mobile-chat-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={pane === "chat"}
          className="mobile-chat-tab"
          onClick={() => setPane("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "diff"}
          className="mobile-chat-tab"
          onClick={() => setPane("diff")}
        >
          Diff
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={pane === "files"}
          className="mobile-chat-tab"
          onClick={() => setPane("files")}
        >
          Files
        </button>
        {session.agentCanvases?.length ? (
          <button
            type="button"
            role="tab"
            aria-selected={pane === "canvas"}
            className="mobile-chat-tab"
            onClick={() => setPane("canvas")}
          >
            Canvas
          </button>
        ) : null}
      </nav>
      {browser ? (
        <div className="mobile-browser" data-testid="mobile-browser">
          <BrowserPane
            sessionId={session.id}
            overlay={state.overlay}
            browserControl={session.browserControl}
          />
        </div>
      ) : null}
      {session.needsHuman?.trim() && !viewing && !browser ? (
        <div className="needs-you-banner" role="status">
          <span>Needs you — {session.needsHuman.trim()}</span>
          <button type="button" className="btn small ghost" onClick={() => void dismissNeedsYou()}>
            Dismiss
          </button>
        </div>
      ) : null}
      <div className="mobile-thread" ref={thread} hidden={browser}>
        {!state.connected || error ? (
          <div className="mobile-banner" role="status">
            {error ?? "Reconnecting…"}
          </div>
        ) : null}
        {pane === "diff" ? (
          patches.length ? (
            patches.map((item) => <PatchCard key={item.id} files={item.files} />)
          ) : (
            <p className="hint">No file changes in this chat yet.</p>
          )
        ) : pane === "files" ? (
          <MobileFiles session={session} />
        ) : pane === "canvas" && session.agentCanvases?.length ? (
          <AgentCanvasPane
            sessionId={session.id}
            canvases={session.agentCanvases}
            focus={canvasFocus}
          />
        ) : (
          <MobileFitPane>
            {messages.length === 0 ? (
              <p className="hint">
                {sessionRuntime(session) === "host"
                  ? "Host agent on this computer. No VM."
                  : "This chat owns a guest on the computer. Tools stay there."}
              </p>
            ) : null}
            {clusterChatThread(messages).map((block) => {
              const message = block.message;
              const tools = block.kind === "turn" ? block.tools : [];
              const calls =
                message.role === "assistant" || message.role === "tool"
                  ? turnToolCalls(message, tools)
                  : [];
              if (message.role === "tool") return null;
              if (
                message.role === "assistant" &&
                !message.content.trim() &&
                !(thoughtTraces && message.thinking?.trim()) &&
                !message.toolCalls?.length &&
                !tools.length
              )
                return message.id === newMarkerId ? (
                  <NewMessagesDivider key={`new-${message.id}`} />
                ) : null;
              const who =
                message.role === "user" ? "You" : message.role === "system" ? "Locus" : "Agent";
              const visible = operatorVisibleText(message.role, message.content);
              const cloneCard =
                message.id === cloneStartId && cloneProgressLive ? cloneProgressLive : undefined;
              const buildCard =
                message.id === buildStartId && imageProgressLive ? imageProgressLive : undefined;
              const thinkingLive =
                turning && message.role === "assistant" && !message.content.trim();
              return (
                <Fragment key={message.id}>
                  {message.id === newMarkerId ? <NewMessagesDivider /> : null}
                  <article
                    className={`mobile-msg ${message.role}`}
                    data-pending={message.id === outboundVisible?.id ? "true" : undefined}
                  >
                    <span className="mobile-sr">{who}</span>
                    <ThinkingTrace
                      key={thinkingLive ? "live" : "done"}
                      text={thoughtTraces ? (message.thinking ?? "") : ""}
                      live={Boolean(thoughtTraces && thinkingLive)}
                    />
                    {buildCard ? (
                      <ImageBuildCard progress={buildCard} title={message.content} />
                    ) : cloneCard ? (
                      <CloneProgressCard progress={cloneCard} title={message.content} />
                    ) : visible ? (
                      <div
                        className="mobile-bubble"
                        dangerouslySetInnerHTML={{ __html: formatMarkdown(visible) }}
                      />
                    ) : null}
                    <MobileToolActivityList
                      calls={calls}
                      tools={tools}
                      session={session}
                      viewing={Boolean(viewing)}
                      onOpenSubagent={setOpenSubagent}
                    />
                    {mobileShots(session.id, message, tools).map((src) => (
                      <img className="mobile-shot" alt="" key={src} src={src} />
                    ))}
                  </article>
                </Fragment>
              );
            })}
            {turning || waitingClone || waitingBuild ? (
              <p className="mobile-working" data-testid="mobile-working">
                {liveThought && thoughtTraces ? (
                  <span className="mobile-working-label">Thinking</span>
                ) : null}
                <span className="mobile-working-copy">{workingText}</span>
              </p>
            ) : null}
          </MobileFitPane>
        )}
      </div>
      <div className="mobile-pending" hidden={browser || Boolean(viewing)}>
        {pending.map((item) => (
          <ApprovalCard
            key={item.call.id}
            sessionId={session.id}
            call={item.call}
            onDone={(next) => dispatch({ type: "session", session: next })}
          />
        ))}
      </div>
      {viewing ? (
        <div className="mobile-subagent-readonly" data-testid="subagent-readonly">
          This subagent is read-only. You can&apos;t send messages here.
        </div>
      ) : (
        <form
          className="mobile-composer is-thread"
          hidden={browser}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            className="mobile-input"
            rows={2}
            placeholder={turning ? "Send steers this turn…" : "Add a follow up."}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mobile-composer-bar">
            <span className="mobile-model-pill">{session.model}</span>
            <button
              type="submit"
              className="btn primary mobile-send"
              disabled={!text.trim() || busy}
              aria-label={turning ? "Send — steer this turn" : "Send"}
            >
              <IconSend />
              <span className="mobile-sr">Send</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function HumanGateCard(props: {
  item: NeedsYouItem;
  onOpen: (id: string) => void;
  onDone: (session: AgentSession) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!props.item.sessionId) return;
      const session = await api.patchSession(props.item.sessionId, { needsHuman: null });
      props.onDone(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="mobile-kicker">{props.item.title}</p>
      <h2>{props.item.detail}</h2>
      {error ? <p className="mobile-error">{error}</p> : null}
      <div className="mobile-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void dismiss()}>
          Dismiss
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            if (props.item.sessionId) props.onOpen(props.item.sessionId);
          }}
        >
          Open chat
        </button>
      </div>
    </>
  );
}

function ApprovalCard(props: {
  sessionId: string;
  call: ToolCall;
  onDone: (session: AgentSession) => void;
}) {
  const ask = isAskUserToolName(props.call.name);
  const items = ask ? askUserItems(props.call.arguments) : [];
  const intro = ask ? askUserIntro(props.call.arguments) : "";
  const series = items.length > 1;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function answerFor(id: string): string {
    const typedVal = (typed[id] ?? "").trim();
    if (typedVal) return typedVal;
    return (picked[id] ?? "").trim();
  }

  async function decide(decision: "approved" | "denied", answer?: string, persist?: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = persist
        ? await api.resolveApproval(props.sessionId, props.call.id, decision, answer, true)
        : answer !== undefined
          ? await api.resolveApproval(props.sessionId, props.call.id, decision, answer)
          : await api.resolveApproval(props.sessionId, props.call.id, decision);
      props.onDone(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve");
    } finally {
      setBusy(false);
    }
  }

  const heading = ask
    ? series
      ? intro || "The agent has a few questions"
      : items[0]?.question || "The agent has a question"
    : toolChipLabel(props.call.name, props.call.arguments);
  const allAnswered = items.every((item) => answerFor(item.id).length > 0);

  return (
    <div className="mobile-card tight">
      <p className="mobile-kicker">{ask ? "Question" : "Approval"}</p>
      <h2>{heading}</h2>
      {!ask ? (
        <details className="tool-args">
          <summary>Details</summary>
          <pre className="mobile-pre">{argsPreview(props.call)}</pre>
        </details>
      ) : null}
      {ask && series
        ? items.map((item) => (
            <div key={item.id}>
              <p className="mobile-row-sub">{item.question}</p>
              {item.choices.length ? (
                <div className="mobile-actions wrap">
                  {item.choices.map((choice) => (
                    <button
                      type="button"
                      className={`btn${picked[item.id] === choice ? " primary" : ""}`}
                      key={choice}
                      disabled={busy}
                      onClick={() => setPicked((cur) => ({ ...cur, [item.id]: choice }))}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              ) : null}
              {item.allowFreeText ? (
                <textarea
                  className="mobile-input"
                  rows={2}
                  placeholder={item.choices.length ? "Or type an answer" : "Your answer"}
                  value={typed[item.id] ?? ""}
                  onChange={(event) =>
                    setTyped((cur) => ({ ...cur, [item.id]: event.target.value }))
                  }
                />
              ) : null}
            </div>
          ))
        : null}
      {ask && !series && items[0]?.choices.length ? (
        <div className="mobile-actions wrap">
          {items[0].choices.map((choice) => (
            <button
              type="button"
              className="btn"
              key={choice}
              disabled={busy}
              onClick={() => void decide("approved", choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : null}
      {ask && !series && items[0]?.allowFreeText ? (
        <textarea
          className="mobile-input"
          rows={2}
          placeholder="Your answer"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      ) : null}
      {error ? <p className="mobile-error">{error}</p> : null}
      <div className="mobile-actions">
        {ask ? (
          <>
            {series || items[0]?.allowFreeText ? (
              <button
                type="button"
                className="btn primary"
                disabled={busy || (series ? !allAnswered : !text.trim())}
                onClick={() => {
                  if (series) {
                    const answers: Record<string, string> = {};
                    for (const item of items) answers[item.id] = answerFor(item.id);
                    void decide("approved", formatAskUserReply(items, answers));
                    return;
                  }
                  void decide("approved", text.trim());
                }}
              >
                {series ? "Continue" : "Send"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void decide("denied")}
            >
              Skip
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void decide("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void decide("approved", undefined, true)}
            >
              Always allow
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void decide("denied")}
            >
              Deny
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function lastFollowPath(session: AgentSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]!;
    const calls = [...(message.toolCalls ?? [])].reverse();
    for (const call of calls) {
      const follow = workspaceFollowFromTool(
        call.name,
        call.arguments ?? {},
        call.result,
        session.hostDir,
      );
      if (follow?.path) return follow.path;
    }
  }
}

function MobileFiles({ session }: { session: AgentSession }) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .workspaceTree(session.id)
      .then(async (tree) => {
        if (cancelled) return;
        setEntries(tree.entries);
        const files = tree.entries.filter((row) => row.type === "file");
        const follow = lastFollowPath(session);
        const initial =
          (follow && files.some((row) => row.path === follow) ? follow : undefined) ??
          files[0]?.path;
        if (!initial) {
          setPath(null);
          setContent("");
          return;
        }
        setPath(initial);
        const file = await api.workspaceFile(session.id, initial);
        if (!cancelled) setContent(file.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load files");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  async function openFile(next: string) {
    setPath(next);
    setError(null);
    try {
      const file = await api.workspaceFile(session.id, next);
      setContent(file.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read file");
    }
  }

  const files = entries.filter((row) => row.type === "file");

  return (
    <div className="mobile-files" data-testid="mobile-files">
      {error ? <p className="mobile-error">{error}</p> : null}
      {loading ? <p className="hint">Loading files…</p> : null}
      {!loading && !files.length && !error ? <p className="hint">No workspace files yet.</p> : null}
      {files.length ? (
        <ul className="mobile-file-tree">
          {files.map((row) => (
            <li key={row.path}>
              <button
                type="button"
                className={path === row.path ? "active" : ""}
                onClick={() => void openFile(row.path)}
              >
                {row.path}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {path ? <pre className="mobile-file-body">{content}</pre> : null}
    </div>
  );
}

function mobileToolResult(call: ToolCall, tools: ChatMessage[]): string | undefined {
  if (call.result) return call.result;
  const byId = tools.find((row) => row.toolCallId === call.id);
  if (byId?.content) return byId.content;
  return tools.find((row) => row.toolCalls?.some((item) => item.id === call.id))?.content;
}

function mobileShots(sessionId: string, message: ChatMessage, tools: ChatMessage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of [...tools, message]) {
    const raw = screenshotSrc(sessionId, row);
    if (!raw) continue;
    const src = withPhoneToken(raw);
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

function argsPreview(call: ToolCall): string {
  try {
    const text = JSON.stringify(call.arguments, null, 2);
    return text.length > 800 ? `${text.slice(0, 799)}…` : text;
  } catch {
    return "";
  }
}
