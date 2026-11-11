import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import type { AgentSession } from "@locus/shared";
import { IconGear, IconInbox, IconMore, IconPanel, IconPin, IconWrench } from "../Icons";
import { MenuItem, OverflowMenu } from "../OverflowMenu";
import { sessionFitsSection } from "@/state/store";
import type { UiSection } from "@/state/store";
import { isLockedRailSection } from "@/lib/railNav";
import type { SectionMeta } from "./sectionMeta";

export type RailPeekRow = { key: string; title: string; detail?: string };

export type RailSectionItem = { id: UiSection } & SectionMeta;

export function SideRail(props: {
  collapsed: boolean;
  swarmMode: boolean;
  connected: boolean;
  connTitle: string;
  connDetail: string;
  inboxOpen: boolean;
  inboxCount: number;
  activeSection: UiSection;
  primary: RailSectionItem[];
  secondary: RailSectionItem[];
  waiting: AgentSession[];
  unreadAutomation: boolean;
  slackUnread: boolean;
  boardWaiting: number;
  shortcutHint: (target: "inbox" | UiSection) => string | undefined;
  setupOpen?: boolean;
  onInbox: () => void;
  onSection: (section: UiSection) => void;
  onPin: (section: UiSection) => void;
  onReorder: (section: UiSection, target: UiSection) => void;
  onMove?: (section: UiSection, delta: -1 | 1) => void;
  onSettings: () => void;
  onToggleCollapse: () => void;
  onSetup?: () => void;
  peekRows: (target: "inbox" | UiSection) => RailPeekRow[];
  onPeekOpen: (target: "inbox" | UiSection, row: RailPeekRow) => void;
}) {
  const [peek, setPeek] = useState<null | { target: "inbox" | UiSection; top: number }>(null);
  const hideTimer = useRef<number | null>(null);
  const dragging = useRef<UiSection | null>(null);
  const [pinMenu, setPinMenu] = useState<null | { section: UiSection; x: number; y: number }>(null);

  function openPinMenu(section: UiSection, event: ReactMouseEvent<HTMLElement>) {
    if (isLockedRailSection(section, props.swarmMode ? "swarm" : "developer")) return;
    event.preventDefault();
    event.stopPropagation();
    // Keyboard context-menu keys report 0,0; anchor to the button instead.
    let { clientX: x, clientY: y } = event;
    if (!x && !y) {
      const box = event.currentTarget.getBoundingClientRect();
      x = box.right;
      y = box.top;
    }
    setPeek(null);
    setPinMenu({ section, x, y });
  }

  useEffect(() => {
    if (!pinMenu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPinMenu(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinMenu]);

  function clearHide() {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function showPeek(target: "inbox" | UiSection, el: HTMLElement) {
    if (!props.collapsed || props.swarmMode) return;
    clearHide();
    const rail = el.closest(".side-rail");
    const top = el.getBoundingClientRect().top - (rail?.getBoundingClientRect().top ?? 0);
    setPeek({ target, top });
  }

  function scheduleHide() {
    clearHide();
    hideTimer.current = window.setTimeout(() => setPeek(null), 180);
  }

  useEffect(() => () => clearHide(), []);

  function dragStart(section: UiSection, event: DragEvent<HTMLButtonElement>) {
    if (isLockedRailSection(section, props.swarmMode ? "swarm" : "developer")) {
      event.preventDefault();
      return;
    }
    dragging.current = section;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", section);
  }

  function dropOn(target: UiSection, event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const from = dragging.current ?? (event.dataTransfer.getData("text/plain") as UiSection);
    dragging.current = null;
    if (from) props.onReorder(from, target);
  }

  const mode = props.swarmMode ? "swarm" : "developer";

  function canMove(section: UiSection, delta: -1 | 1): boolean {
    const ids = props.primary.map((row) => row.id);
    const next = ids.indexOf(section) + delta;
    return next >= 0 && next < ids.length && !isLockedRailSection(ids[next], mode);
  }
  const peekItems = peek ? props.peekRows(peek.target) : [];
  const peekLabel =
    peek?.target === "inbox"
      ? "Inbox"
      : (props.primary.find((row) => row.id === peek?.target)?.label ?? "Section");

  return (
    <div className="side-rail">
      <div className="brand-mark rail-brand" aria-hidden="true" />
      <nav className="side-rail-nav" aria-label="Sections">
        <button
          type="button"
          className={props.inboxOpen ? "active" : ""}
          aria-label={props.inboxCount ? `Inbox, ${props.inboxCount} waiting` : "Inbox"}
          aria-current={props.inboxOpen ? "page" : undefined}
          data-testid="sidebar-inbox"
          title={props.shortcutHint("inbox") ? `Inbox · ${props.shortcutHint("inbox")}` : "Inbox"}
          onClick={props.onInbox}
          onMouseEnter={(event) => showPeek("inbox", event.currentTarget)}
          onMouseLeave={scheduleHide}
          onFocus={(event) => showPeek("inbox", event.currentTarget)}
          onBlur={scheduleHide}
        >
          <span className="rail-icon icon-badge-wrap" aria-hidden="true">
            <IconInbox />
            {props.inboxCount ? (
              <span className="icon-badge danger">{props.inboxCount}</span>
            ) : null}
          </span>
          {props.inboxCount ? <span className="unread-dot" aria-hidden="true" /> : null}
          <span className="rail-label">Inbox</span>
        </button>
        {props.primary.map((row) => {
          const sectionWaiting = props.waiting.filter((session) =>
            sessionFitsSection(session, row.id),
          );
          const needCount = sectionWaiting.length;
          const autoUnread = row.id === "automations" && props.unreadAutomation;
          const unread = ((row.id === "ide" || row.id === "agents") && needCount > 0) || autoUnread;
          const label =
            (row.id === "agents" || row.id === "ide") && needCount
              ? `${row.label}, needs you ${needCount}`
              : autoUnread
                ? `${row.label}, unread`
                : row.label;
          const locked = isLockedRailSection(row.id, mode);
          const shortcut = props.shortcutHint(row.id);
          const titleParts = [
            row.label,
            shortcut,
            locked ? null : "Drag to reorder, right-click to unpin",
          ].filter(Boolean);
          return (
            <button
              key={row.id}
              className={!props.inboxOpen && props.activeSection === row.id ? "active" : ""}
              aria-label={label}
              aria-current={!props.inboxOpen && props.activeSection === row.id ? "page" : undefined}
              data-testid={
                props.swarmMode && row.id === "agents"
                  ? "swarm-teammates"
                  : props.swarmMode && row.id === "project"
                    ? "swarm-teams"
                    : undefined
              }
              draggable={!locked}
              title={titleParts.length ? titleParts.join(" · ") : undefined}
              onClick={() => props.onSection(row.id)}
              onDragStart={(event) => dragStart(row.id, event)}
              onDragOver={(event) => {
                if (locked) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => dropOn(row.id, event)}
              onContextMenu={(event) => openPinMenu(row.id, event)}
              onMouseEnter={(event) => showPeek(row.id, event.currentTarget)}
              onMouseLeave={scheduleHide}
              onFocus={(event) => showPeek(row.id, event.currentTarget)}
              onBlur={scheduleHide}
            >
              <span className="rail-icon" aria-hidden="true">
                {row.icon}
              </span>
              {unread ? <span className="unread-dot" aria-hidden="true" /> : null}
              <span className="rail-label">{row.railLabel ?? row.label}</span>
            </button>
          );
        })}
        {props.secondary.length ? <div className="rail-sep" role="separator" /> : null}
        {props.secondary.length ? (
          <OverflowMenu
            className={`rail-more${!props.inboxOpen && props.secondary.some((row) => row.id === props.activeSection) ? " active" : ""}`}
            title="More"
            align="after"
            label={
              <>
                <span className="rail-icon" aria-hidden="true">
                  <IconMore />
                </span>
                {props.secondary.some(
                  (row) =>
                    (row.id === "slack" && props.slackUnread) ||
                    (row.id === "board" && props.boardWaiting > 0),
                ) ? (
                  <span className="unread-dot" aria-hidden="true" />
                ) : null}
                <span className="rail-label">More</span>
              </>
            }
            toggleClassName="rail-more-toggle"
          >
            {props.secondary.map((row) => {
              const unread =
                (row.id === "slack" && props.slackUnread) ||
                (row.id === "board" && props.boardWaiting > 0);
              return (
                <div key={row.id} className="menu-row rail-more-row">
                  <MenuItem
                    active={!props.inboxOpen && props.activeSection === row.id}
                    onClick={() => props.onSection(row.id)}
                  >
                    {row.label}
                    {unread ? " · unread" : ""}
                  </MenuItem>
                  <button
                    type="button"
                    className="menu-row-pin"
                    data-menu-pin
                    tabIndex={-1}
                    aria-pressed={false}
                    aria-label={`Pin ${row.label} to rail`}
                    title={`Pin ${row.label} to rail`}
                    onClick={() => props.onPin(row.id)}
                  >
                    <IconPin />
                  </button>
                </div>
              );
            })}
          </OverflowMenu>
        ) : null}
      </nav>
      <span className="rail-spacer" />
      <div className="side-rail-chrome">
        <span
          className={`conn rail-conn ${props.connected ? "live" : ""}`}
          title={`${props.connTitle}. ${props.connDetail}`}
          role="status"
          aria-label={props.connDetail}
          aria-hidden={props.collapsed ? undefined : true}
        >
          <span className="conn-dot" />
        </span>
        {props.setupOpen ? (
          <button type="button" className="setup-btn" aria-label="Setup" onClick={props.onSetup}>
            <span className="rail-icon" aria-hidden="true">
              <IconWrench />
            </span>
            <span className="rail-label">Setup</span>
          </button>
        ) : null}
        <button
          type="button"
          className={props.activeSection === "settings" ? "active" : ""}
          aria-label="Settings"
          aria-current={props.activeSection === "settings" ? "page" : undefined}
          title="Settings"
          onClick={props.onSettings}
        >
          <span className="rail-icon" aria-hidden="true">
            <IconGear />
          </span>
          <span className="rail-label">Settings</span>
        </button>
        <button
          type="button"
          aria-label={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={props.onToggleCollapse}
        >
          <span className="rail-icon" aria-hidden="true">
            <IconPanel />
          </span>
          <span className="rail-label">{props.collapsed ? "Expand" : "Collapse"}</span>
        </button>
      </div>
      {pinMenu
        ? createPortal(
            <>
              <button
                type="button"
                className="workspace-ctx-backdrop"
                aria-label="Close rail menu"
                onClick={() => setPinMenu(null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setPinMenu(null);
                }}
              />
              <div
                className="workspace-ctx rail-pin-menu"
                data-testid="rail-pin-menu"
                style={{ left: pinMenu.x, top: pinMenu.y }}
                role="menu"
                aria-label={`${props.primary.find((row) => row.id === pinMenu.section)?.label ?? "Section"} on rail`}
              >
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    const section = pinMenu.section;
                    setPinMenu(null);
                    props.onPin(section);
                  }}
                >
                  Unpin from rail
                </button>
                {props.onMove ? (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canMove(pinMenu.section, -1)}
                      onClick={() => {
                        const section = pinMenu.section;
                        setPinMenu(null);
                        props.onMove?.(section, -1);
                      }}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={!canMove(pinMenu.section, 1)}
                      onClick={() => {
                        const section = pinMenu.section;
                        setPinMenu(null);
                        props.onMove?.(section, 1);
                      }}
                    >
                      Move down
                    </button>
                  </>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}
      {peek ? (
        <div
          className="rail-peek"
          data-testid="rail-peek"
          style={{ top: Math.max(8, peek.top) }}
          onMouseEnter={clearHide}
          onMouseLeave={scheduleHide}
        >
          <p className="rail-peek-head">{peekLabel}</p>
          {peekItems.length ? (
            peekItems.slice(0, 8).map((row) => (
              <button
                key={row.key}
                type="button"
                className="rail-peek-item"
                onClick={() => {
                  props.onPeekOpen(peek.target, row);
                  setPeek(null);
                }}
              >
                <span className="title-text">{row.title}</span>
                {row.detail ? <span className="meta">{row.detail}</span> : null}
              </button>
            ))
          ) : (
            <p className="rail-peek-empty">Nothing here yet</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function shortcutCaption(index: number): string | undefined {
  if (index < 0 || index > 8) return undefined;
  return `Alt+${index + 1}`;
}
