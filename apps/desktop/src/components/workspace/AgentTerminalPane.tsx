import { useEffect, useRef, useState } from "react";
import {
  AGENT_TERMINAL_MAX,
  AGENT_TERMINAL_PRESETS,
  agentTerminalPreset,
  type AgentTerminalStatus,
  type SessionViewMode,
} from "@locus/shared";
import { api, agentTerminalWsUrl } from "@/lib/api";
import { IconClose, IconPlus, IconRefresh } from "@/components/layout/Icons";
import { Select } from "@/components/layout/Select";
import { WorkspaceTerminal } from "./WorkspaceTerminal";

const CUSTOM = "custom";

type Tab = {
  id: string;
  /** Preset id or a raw command line, as sent to the server. */
  command: string;
  label: string;
  /** Bumped on Restart so the PTY websocket remounts. */
  gen: number;
  ended?: string;
};

function newTerminalId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function commandLabel(command: string): string {
  return agentTerminalPreset(command)?.label ?? command;
}

/**
 * Terminal mode: interactive agent CLIs (claude, codex, gemini, …) or a shell in a PTY inside
 * this session's workspace. Processes live on the server and survive reconnects.
 */
export function AgentTerminalPane({
  sessionId,
  visible = true,
}: {
  sessionId: string;
  visible?: boolean;
}) {
  const [status, setStatus] = useState<AgentTerminalStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [picker, setPicker] = useState<string>("shell");
  const [custom, setCustom] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setLoadError(null);
    setTabs([]);
    setActiveId(null);
    void api
      .agentTerminals(sessionId)
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setPicker(next.defaultPreset);
        const running: Tab[] = next.terminals.map((row) => ({
          id: row.id,
          command: row.command ?? "shell",
          label: row.label,
          gen: 0,
        }));
        if (!running.length && next.available) {
          running.push({
            id: newTerminalId(),
            command: next.defaultPreset,
            label: commandLabel(next.defaultPreset),
            gen: 0,
          });
        }
        setTabs(running);
        setActiveId(running[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setLoadError(err instanceof Error ? err.message : "Could not load terminals");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const pickedCommand = picker === CUSTOM ? custom.trim() : picker;

  function select(tab: Tab) {
    setActiveId(tab.id);
    if (agentTerminalPreset(tab.command)) setPicker(tab.command);
    else {
      setPicker(CUSTOM);
      setCustom(tab.command);
    }
  }

  function addTab() {
    if (!pickedCommand || tabs.length >= AGENT_TERMINAL_MAX) return;
    const tab: Tab = {
      id: newTerminalId(),
      command: pickedCommand,
      label: commandLabel(pickedCommand),
      gen: 0,
    };
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }

  async function restart() {
    if (!active || !pickedCommand) return;
    await api.closeAgentTerminal(sessionId, active.id).catch(() => undefined);
    setTabs((current) =>
      current.map((tab) =>
        tab.id === active.id
          ? {
              ...tab,
              command: pickedCommand,
              label: commandLabel(pickedCommand),
              gen: tab.gen + 1,
              ended: undefined,
            }
          : tab,
      ),
    );
  }

  async function closeTab(tab: Tab) {
    await api.closeAgentTerminal(sessionId, tab.id).catch(() => undefined);
    setTabs((current) => {
      const index = current.findIndex((row) => row.id === tab.id);
      const next = current.filter((row) => row.id !== tab.id);
      if (tab.id === activeId) setActiveId((next[Math.max(0, index - 1)] ?? next[0])?.id ?? null);
      return next;
    });
  }

  if (loadError) {
    return (
      <div className="agent-term agent-term-empty" data-testid="agent-terminal">
        <p>{loadError}</p>
      </div>
    );
  }
  if (!status) {
    return <div className="agent-term agent-term-empty" data-testid="agent-terminal" />;
  }
  if (!status.available) {
    return (
      <div className="agent-term agent-term-empty" data-testid="agent-terminal">
        <p>
          <strong>Terminal not available.</strong> {status.reason}
        </p>
      </div>
    );
  }

  const options = [
    ...AGENT_TERMINAL_PRESETS.map((row) => ({
      value: row.id,
      label: row.id === status.defaultPreset ? `${row.label} (default)` : row.label,
    })),
    { value: CUSTOM, label: "Custom…" },
  ];

  return (
    <div className="agent-term" data-testid="agent-terminal">
      <div className="agent-term-bar">
        <div className="agent-term-tabs" role="tablist" aria-label="Agent terminals">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active?.id}
              className={`btn small ghost${tab.id === active?.id ? " on" : ""}`}
              title={tab.ended ? `${tab.label} — ${tab.ended}` : tab.label}
              onClick={() => select(tab)}
            >
              {tab.label}
              {tab.ended ? <span className="agent-term-ended"> · ended</span> : null}
            </button>
          ))}
          <button
            type="button"
            className="btn icon ghost small"
            title={
              tabs.length >= AGENT_TERMINAL_MAX
                ? `Up to ${AGENT_TERMINAL_MAX} terminals per agent`
                : "New terminal"
            }
            aria-label="New terminal"
            disabled={tabs.length >= AGENT_TERMINAL_MAX || !pickedCommand}
            onClick={addTab}
          >
            <IconPlus />
          </button>
        </div>
        <div className="agent-term-actions">
          <Select
            compact
            className="agent-term-picker"
            ariaLabel="Terminal command"
            align="right"
            value={picker}
            options={options}
            onChange={setPicker}
          />
          {picker === CUSTOM ? (
            <input
              className="agent-term-custom"
              aria-label="Custom command"
              placeholder="command"
              spellCheck={false}
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (active) void restart();
                  else addTab();
                }
              }}
            />
          ) : null}
          <button
            type="button"
            className="btn icon ghost small"
            title="Restart with this command"
            aria-label="Restart terminal"
            disabled={!active || !pickedCommand}
            onClick={() => void restart()}
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="btn icon ghost small"
            title="Close terminal (stops the process)"
            aria-label="Close terminal"
            disabled={!active}
            onClick={() => active && void closeTab(active)}
          >
            <IconClose />
          </button>
        </div>
      </div>
      {tabs.length ? (
        tabs.map((tab) => (
          <div key={tab.id} className="agent-term-pane" hidden={tab.id !== active?.id}>
            <WorkspaceTerminal
              key={`${tab.id}:${tab.gen}`}
              sessionId={sessionId}
              terminalId={tab.id}
              url={agentTerminalWsUrl(sessionId, tab.id, tab.command)}
              connecting={`Starting ${tab.label}…`}
              active={visible && tab.id === active?.id}
              onClose={({ reason }) =>
                setTabs((current) =>
                  current.map((row) =>
                    row.id === tab.id && row.gen === tab.gen
                      ? { ...row, ended: reason || "disconnected" }
                      : row,
                  ),
                )
              }
            />
          </div>
        ))
      ) : (
        <div className="agent-term-empty">
          <p>No terminals. Pick a command and press +.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Follow the session's Chat / Terminal preference: switching to terminal focuses the
 * Terminal tab, switching back to chat leaves it.
 */
export function useAgentTerminalViewMode(
  sessionId: string | undefined,
  viewMode: SessionViewMode | undefined,
  handlers: { terminal: () => void; chat: () => void },
): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const key = `${sessionId}:${viewMode ?? "chat"}`;
    if (last.current === key) return;
    const sameSession = last.current?.startsWith(`${sessionId}:`) ?? false;
    last.current = key;
    if (viewMode === "terminal") ref.current.terminal();
    else if (sameSession) ref.current.chat();
  }, [sessionId, viewMode]);
}
