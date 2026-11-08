import { useEffect, useMemo, useRef, useState } from "react";
import {
  resolveTheme,
  sessionRuntime,
  canClearChat,
  CLEAR_CHAT_CONFIRM,
  parseProductMode,
} from "@locus/shared";
import { applyTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import { showErrorNotice, showNotice } from "@/lib/notice";
import { archiveOne } from "@/lib/sessionUndo";
import { askConfirm } from "@/lib/dialog";
import { exportSessionChat } from "@/lib/chatExport";
import { liveDockerContainers, runStopContainers } from "@/lib/docker";
import { defaultGoldenName, promptGoldenName } from "@/lib/goldenName";
import { rememberBrainInbox } from "@/lib/brainViewPrefs";
import { needsYouItems, needsYouSessions } from "@/lib/needsYou";
import {
  applyPaletteRecents,
  editorOwnsCommandK,
  filterPaletteItems,
  isPaletteShortcutsQuery,
  paletteItems,
  paletteItemsForMode,
} from "@/lib/palette";
import { matchModDigit, matchModKey } from "@/lib/shortcuts";
import { KeyboardShortcutsSheet } from "./KeyboardShortcutsSheet";
import { loadPaletteRecents, rememberPaletteRecent } from "@/lib/paletteRecents";
import { setPendingSettingsQuery } from "@/lib/settingsQuery";
import { HighlightQuery } from "@/lib/queryMark";
import { Modal } from "./Modal";
import { orderPaletteForBrowse, tryNextContext } from "@/lib/discoverability";
import { confirmLeaveSettings, paletteActionLeavesSettings } from "@/lib/settingsLeave";
import type { SettingsTab } from "@/lib/settingsNav";
import { sessionForDigit } from "@/lib/sessionSwitch";
import { openSettings, useStore } from "@/state/store";
import { setProductMode } from "@/components/layout/ProductModeToggle";
import { SearchField } from "./SearchField";
import {
  requestWorkspaceFormat,
  requestWorkspaceGit,
  requestWorkspaceGoto,
  requestWorkspaceGotoSymbol,
  requestWorkspaceSearch,
  requestWorkspaceReindex,
  requestWorkspaceSplit,
} from "@/components/workspace/WorkspaceQuickOpen";
import {
  requestWorkspaceTerminal,
  requestWorkspaceTerminalNew,
} from "@/components/workspace/WorkspaceTerminal";

export function SessionSwitcher() {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const session = state.sessions.find((s) => s.id === state.selectedId);
  const vm =
    state.vms.find((v) => v.id === session?.vmId) ??
    state.vms.find((v) => v.sessionId === session?.id);
  const showShortcuts = isPaletteShortcutsQuery(query);
  const items = useMemo(() => {
    if (showShortcuts) return [];
    const raw = paletteItems({
      sessions: state.sessions,
      session,
      vm,
      repos: state.repos,
      containers: state.containers,
      slackConversations: state.slackConversations,
      automations: state.automations,
      boards: state.boards,
      brain: state.brain,
      projects: state.projects,
      setup: state.setup,
      config: state.config,
    });
    const scoped = paletteItemsForMode(raw, parseProductMode(state.config?.productMode));
    const filtered = filterPaletteItems(scoped, query);
    if (query.trim()) return filtered;
    const recents = applyPaletteRecents(filtered, loadPaletteRecents());
    const recentRows = recents.filter((item) => item.group === "Recents");
    const rest = recents.filter((item) => item.group !== "Recents");
    return [
      ...recentRows,
      ...orderPaletteForBrowse(
        rest,
        tryNextContext({
          automations: state.automations,
          projects: state.projects,
          boards: state.boards,
          repos: state.repos,
          brain: state.brain,
          slackStatus: state.slackStatus,
          mcpServerCount: state.config?.mcpServers?.length ?? 0,
          session,
          sessions: state.sessions,
        }),
      ),
    ];
  }, [
    state.sessions,
    state.repos,
    state.containers,
    state.slackConversations,
    state.automations,
    state.boards,
    state.projects,
    state.setup,
    state.brain,
    state.slackStatus,
    state.config?.mcpServers,
    state.config?.productMode,
    state.config,
    session,
    vm,
    query,
    showShortcuts,
  ]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (matchModKey(e, "k")) {
        if (editorOwnsCommandK(document.activeElement)) return;
        e.preventDefault();
        setShortcutsOpen(false);
        setOpen((v) => !v);
        setQuery("");
        setActive(0);
        return;
      }
      if (matchModDigit(e) && sessionForDigit(state.sessions, e.key)) {
        e.preventDefault();
        const next = sessionForDigit(state.sessions, e.key);
        if (next) {
          dispatch({ type: "select", id: next.id });
          setOpen(false);
          setShortcutsOpen(false);
        }
        return;
      }
      if (shortcutsOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
      if (showShortcuts) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        if (e.key === "j" && document.activeElement === input.current && query) return;
        e.preventDefault();
        setActive((i) => Math.min(items.length - 1, i + 1));
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        if (e.key === "k" && document.activeElement === input.current && query) return;
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter" && items[active]) {
        e.preventDefault();
        void run(items[active]!.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, shortcutsOpen, showShortcuts, query, active, items, state.sessions, dispatch]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  async function run(id: string) {
    if (
      state.section === "settings" &&
      paletteActionLeavesSettings(id) &&
      !confirmLeaveSettings()
    ) {
      return;
    }
    setOpen(false);
    setQuery("");
    rememberPaletteRecent(id);
    if (id.startsWith("settings:") && query.trim()) {
      setPendingSettingsQuery(query);
    }
    if (id === "keyboard-shortcuts") {
      setShortcutsOpen(true);
      return;
    }
    if (id === "new-agent") {
      dispatch({ type: "section", section: "agents" });
      dispatch({ type: "select", id: null });
      dispatch({ type: "new", open: true });
      return;
    }
    if (id === "new-design") {
      dispatch({ type: "section", section: "design" });
      dispatch({ type: "select", id: null });
      return;
    }
    if (id === "section:games") {
      dispatch({ type: "section", section: "games" });
      return;
    }
    if (id === "new-game") {
      dispatch({ type: "section", section: "games" });
      dispatch({ type: "select", id: null });
      return;
    }
    if (id === "section:assets") {
      dispatch({ type: "section", section: "assets" });
      return;
    }
    if (id === "new-asset") {
      dispatch({ type: "section", section: "assets" });
      dispatch({ type: "select", id: null });
      return;
    }
    if (id === "section:board") {
      dispatch({ type: "section", section: "board" });
      return;
    }
    if (id === "new-board") {
      dispatch({ type: "selectBoard", id: null });
      return;
    }
    if (id.startsWith("board:")) {
      dispatch({ type: "selectBoard", id: id.slice("board:".length) });
      return;
    }
    if (id === "section:project") {
      dispatch({ type: "section", section: "project" });
      return;
    }
    if (id === "new-project") {
      dispatch({ type: "selectProject", id: null });
      return;
    }
    if (id.startsWith("project:")) {
      dispatch({ type: "selectProject", id: id.slice("project:".length) });
      return;
    }
    if (id === "section:ide") {
      dispatch({ type: "section", section: "ide" });
      return;
    }
    if (id === "new-workspace") {
      dispatch({ type: "section", section: "ide" });
      dispatch({ type: "select", id: null });
      return;
    }
    if (id === "workspace-goto") {
      requestWorkspaceGoto();
      return;
    }
    if (id === "workspace-goto-symbol") {
      requestWorkspaceGotoSymbol();
      return;
    }
    if (id === "workspace-search") {
      requestWorkspaceSearch();
      return;
    }
    if (id === "workspace-reindex") {
      requestWorkspaceReindex();
      return;
    }
    if (id === "workspace-format") {
      requestWorkspaceFormat();
      return;
    }
    if (id === "workspace-split") {
      requestWorkspaceSplit();
      return;
    }
    if (id === "workspace-git") {
      requestWorkspaceGit();
      return;
    }
    if (id === "workspace-terminal") {
      requestWorkspaceTerminal();
      return;
    }
    if (id === "workspace-terminal-new") {
      requestWorkspaceTerminalNew();
      return;
    }
    if (id === "new-automation") {
      dispatch({ type: "section", section: "automations" });
      dispatch({ type: "newAutomation", open: true });
      return;
    }
    if (id === "finish-setup") {
      dispatch({ type: "setupOpen", open: true });
      return;
    }
    if (id === "feature:compare") {
      dispatch({ type: "compare", open: true });
      return;
    }
    if (id === "feature:replay") {
      dispatch({ type: "replay", open: true });
      return;
    }
    if (id === "feature:mcp") {
      openSettings(dispatch, "mcp");
      return;
    }
    if (id === "feature:skills") {
      openSettings(dispatch, "skills");
      return;
    }
    if (id === "feature:workers") {
      openSettings(dispatch, "workers");
      return;
    }
    if (id === "feature:webhooks") {
      dispatch({ type: "section", section: "automations" });
      dispatch({ type: "newAutomation", open: true });
      return;
    }
    if (id === "feature:phone") {
      openSettings(dispatch, "phone");
      return;
    }
    if (id === "feature:chrome") {
      openSettings(dispatch, "chrome");
      return;
    }
    if (id === "feature:swarm") {
      if (state.config) {
        const current = state.config.productMode === "swarm" ? "swarm" : "developer";
        const next = current === "swarm" ? "developer" : "swarm";
        void setProductMode(next, {
          config: state.config,
          dispatch,
          vmCollapsed: state.vmCollapsed,
          sidebarCollapsed: state.collapsed,
        });
      }
      return;
    }
    if (id === "feature:memory") {
      dispatch({ type: "section", section: "brain" });
      return;
    }
    if (id === "feature:subscriptions") {
      dispatch({ type: "sessionSettings", open: true });
      return;
    }
    if (id === "section:codebase") {
      dispatch({ type: "section", section: "codebase" });
      return;
    }
    if (id === "needs-you") {
      const waiting = needsYouSessions(state.sessions);
      const details = needsYouItems(state.sessions, state.boards, state.brain);
      const boardWait = details.find((row) => row.boardId);
      const brainWait = details.find((row) => row.section === "brain");
      if (waiting[0]) dispatch({ type: "select", id: waiting[0].id });
      else if (boardWait?.boardId)
        dispatch({
          type: "selectBoard",
          id: boardWait.boardId,
          objectId: boardWait.objectId,
        });
      else if (brainWait) {
        rememberBrainInbox();
        dispatch({ type: "section", section: "brain" });
      } else dispatch({ type: "section", section: "agents" });
      return;
    }
    if (id === "needs-you:brain") {
      rememberBrainInbox();
      dispatch({ type: "section", section: "brain" });
      return;
    }
    if (id.startsWith("needs-you:board:")) {
      const rest = id.slice("needs-you:board:".length);
      const sep = rest.indexOf(":");
      const boardId = sep === -1 ? rest : rest.slice(0, sep);
      const objectId = sep === -1 ? undefined : rest.slice(sep + 1);
      dispatch({ type: "selectBoard", id: boardId, objectId });
      return;
    }
    if (id.startsWith("needs-you:")) {
      dispatch({ type: "select", id: id.slice("needs-you:".length) });
      return;
    }
    if (id === "section:automations") {
      dispatch({ type: "section", section: "automations" });
      return;
    }
    if (id.startsWith("automation:")) {
      dispatch({ type: "selectAutomation", id: id.slice("automation:".length) });
      return;
    }
    if (id.startsWith("settings:")) {
      openSettings(dispatch, id.slice("settings:".length) as SettingsTab);
      return;
    }
    if (id.startsWith("session:")) {
      dispatch({ type: "select", id: id.slice("session:".length) });
      return;
    }
    if (id.startsWith("repo:")) {
      dispatch({ type: "selectRepo", id: id.slice("repo:".length) });
      return;
    }
    if (id === "section:brain") {
      dispatch({ type: "section", section: "brain" });
      return;
    }
    if (id === "section:slack") {
      dispatch({ type: "section", section: "slack" });
      return;
    }
    if (id === "section:grafana") {
      dispatch({ type: "section", section: "grafana" });
      return;
    }
    if (id.startsWith("slack:")) {
      dispatch({ type: "selectSlackChannel", id: id.slice("slack:".length) });
      return;
    }
    if (id === "section:docker") {
      dispatch({ type: "section", section: "docker" });
      return;
    }
    if (id === "docker-stop-running") {
      const live = liveDockerContainers(state.containers);
      try {
        const result = await runStopContainers(live, {
          stop: api.dockerContainersStop,
          list: api.dockerContainers,
        });
        if (!result) return;
        dispatch({ type: "containers", containers: result.containers });
        if (result.errors.length) {
          showNotice(result.errors.map((row) => `${row.id}: ${row.error}`).join("\n"));
        }
      } catch (err) {
        showErrorNotice(err, "Could not stop containers");
      }
      return;
    }
    if (id.startsWith("container:")) {
      dispatch({ type: "selectContainer", id: id.slice("container:".length) });
      return;
    }
    const guestErr = (err: unknown, fallback: string) => {
      showErrorNotice(err, fallback);
    };
    if (id === "guest-start" && session)
      await api.startVm(session.id).catch((err) => guestErr(err, "Could not start the guest"));
    if (id === "guest-stop" && session)
      await api.stopVm(session.id).catch((err) => guestErr(err, "Could not stop the guest"));
    if (id === "guest-takeover" && session)
      await api.takeover(session.id).catch((err) => guestErr(err, "Could not take over"));
    if (id === "guest-handback" && session)
      await api.handback(session.id).catch((err) => guestErr(err, "Could not hand back"));
    if (id === "guest-save-image" && session) {
      const fallback = defaultGoldenName(
        session.title,
        sessionRuntime(session) === "docker" ? "workspace" : "golden",
      );
      const name = await promptGoldenName(fallback);
      if (!name) return;
      await api
        .captureImage(session.id, name)
        .catch((err) => guestErr(err, "Could not save image"));
    }
    if (id === "guest-replay") dispatch({ type: "replay", open: true });
    if (id === "guest-compare") dispatch({ type: "compare", open: true });
    if (id === "chat-export-html" && session) exportSessionChat(session, "html");
    if (id === "chat-export-pdf" && session) exportSessionChat(session, "pdf");
    if (id === "chat-find") {
      dispatch({ type: "findChat", open: true });
      return;
    }
    if (id === "chat-stop" && session) {
      await api.abortChat(session.id).catch((err: unknown) => {
        showErrorNotice(err, "Could not stop");
      });
      return;
    }
    if (id === "chat-archive" && session) {
      if (session.archived) {
        await api.patchSession(session.id, { archived: false }).catch(() => undefined);
      } else {
        archiveOne(session, dispatch);
      }
      return;
    }
    if (id === "chat-clear" && session) {
      if (
        !canClearChat(session) ||
        !(await askConfirm({
          title: "Clear chat?",
          body: CLEAR_CHAT_CONFIRM,
          confirmLabel: "Clear chat",
          danger: true,
        }))
      )
        return;
      const updated = await api.clearChat(session.id).catch((err: unknown) => {
        showErrorNotice(err, "Could not clear chat");
        return undefined;
      });
      if (updated) dispatch({ type: "session", session: updated });
      return;
    }
    if (id === "design-systems") {
      dispatch({ type: "section", section: "design" });
      dispatch({ type: "designSystems", open: true });
      return;
    }
    if (id === "asset-styles") {
      dispatch({ type: "section", section: "assets" });
      dispatch({ type: "assetStyles", open: true });
      return;
    }
    if (id.startsWith("theme:")) {
      const theme = resolveTheme(id.slice("theme:".length));
      applyTheme(theme);
      if (!state.config) return;
      const next = { ...state.config, theme };
      try {
        const saved = await api.saveConfig(next);
        dispatch({ type: "config", config: saved });
        applyTheme(saved.theme);
      } catch {
        dispatch({ type: "config", config: next });
      }
    }
  }

  if (shortcutsOpen) {
    return (
      <Modal
        label="Keyboard shortcuts"
        className="switcher"
        onClose={() => setShortcutsOpen(false)}
      >
        <h2 className="palette-shortcuts-title">Keyboard shortcuts</h2>
        <KeyboardShortcutsSheet />
      </Modal>
    );
  }

  if (!open) return null;

  let lastGroup = "";
  return (
    <Modal label="Command palette" className="switcher" onClose={() => setOpen(false)}>
      <SearchField
        ref={input}
        wrapClassName="switcher-search"
        className="switcher-input"
        placeholder={
          parseProductMode(state.config?.productMode) === "swarm"
            ? "Teammates, teams, configuration…"
            : "Jump to an agent, settings, or command… (? shortcuts)"
        }
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="switcher-list">
        {showShortcuts ? (
          <KeyboardShortcutsSheet />
        ) : items.length === 0 ? (
          <p className="hint">No matching agents or commands</p>
        ) : (
          items.map((item, i) => {
            const heading = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const sessionIndex = item.id.startsWith("session:")
              ? items
                  .filter((row) => row.id.startsWith("session:"))
                  .findIndex((row) => row.id === item.id)
              : -1;
            return (
              <div key={item.id}>
                {heading ? <div className="switcher-group">{heading}</div> : null}
                <button
                  type="button"
                  className={`switcher-item ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void run(item.id)}
                >
                  <span
                    className={`dot ${item.group === "Agents" || item.group === "Design" || item.group === "Board" || item.group === "IDE" ? "idle" : "cmd"}`}
                  />
                  <span>
                    <div className="title">
                      <HighlightQuery text={item.title} query={query} />
                    </div>
                    <div className="meta">{item.hint}</div>
                  </span>
                  {!query && sessionIndex >= 0 && sessionIndex < 9 ? (
                    <kbd>{sessionIndex + 1}</kbd>
                  ) : null}
                </button>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
